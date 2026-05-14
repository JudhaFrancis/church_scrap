const { TARGET_STATE, DELAY_MS } = require('./config');
const { sleep, getDistance, isPointInBox } = require('./utils');
const { searchMaps } = require('./browser');
const { checkExistingCoords, updateRecordSuccess, updateRecordMulti, updateRecordFailed, fetchPreviousVillageCoords, fetchPreviousBlockCoords, fetchStateBoundary } = require('./db');

// Global cache for boundary boxes
const boundaryCache = {};

async function getBoundaryBox(page, name, type, state) {
    const cacheKey = `${type}:${name}:${state}`.toLowerCase();
    if (boundaryCache[cacheKey]) return boundaryCache[cacheKey];

    console.log(`    🔍 Fetching boundary for ${type}: ${name}...`);
    const query = type === 'State' ? `${name}, India` : `${name}, ${state}, India`;
    const result = await searchMaps(page, query, state);

    if (result.status === 'success') {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Define deltas based on type (rough approximation of bounding boxes)
        let delta = 0.1; // Default (Block)
        if (type === 'District') delta = 0.4;
        if (type === 'State') delta = 2.5;

        const bounds = {
            north: lat + delta,
            south: lat - delta,
            east: lon + delta,
            west: lon - delta,
            center: { lat, lon }
        };

        boundaryCache[cacheKey] = bounds;
        console.log(`    📍 Boundary cached for ${name} (${type})`);
        return bounds;
    }

    return null;
}

async function applySafeJitter(connection, lat, lon, range, forceJitter = false) {
    let currentLat = parseFloat(lat);
    let currentLon = parseFloat(lon);
    let attempts = 0;
    let isDuplicate = true;

    if (!forceJitter) {
        isDuplicate = await checkExistingCoords(connection, currentLat, currentLon);
    }

    while ((isDuplicate || (forceJitter && attempts === 0)) && attempts < 10) {
        currentLat = parseFloat(lat) + (Math.random() - 0.5) * range;
        currentLon = parseFloat(lon) + (Math.random() - 0.5) * range;

        isDuplicate = await checkExistingCoords(connection, currentLat, currentLon);
        attempts++;

        if (isDuplicate && attempts < 10) {
            console.log(`    🔄 Jitter collision (attempt ${attempts}). Retrying...`);
        }
    }
    return { lat: currentLat, lon: currentLon };
}

async function processRecords(connection, page, rows) {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        console.log(`\n[${i + 1}/${rows.length}] ID: ${row.id} | Village: ${row['Village/Town Name']} | Church: ${row['Church/Orgn Name'] || 'N/A'}`);

        const block = row.block ? row.block.trim() : '';
        const district = row.district ? row.district.trim() : '';
        const villageName = row['Village/Town Name'].trim();
        const churchName = row['Church/Orgn Name'] ? row['Church/Orgn Name'].trim() : '';

        // Pre-fetch Boundaries
        let stateBounds = await fetchStateBoundary(connection, TARGET_STATE);
        if (stateBounds) {
            console.log(`    📍 Loaded ${TARGET_STATE} boundaries from database.`);
        } else {
            stateBounds = await getBoundaryBox(page, TARGET_STATE, 'State', TARGET_STATE);
        }
        const districtBounds = district ? await getBoundaryBox(page, district, 'District', TARGET_STATE) : null;
        const blockBounds = (block && block.toLowerCase() !== district.toLowerCase())
            ? await getBoundaryBox(page, block, 'Block', TARGET_STATE)
            : districtBounds;

        let finalResult = null;
        let finalSource = 'missing';
        let tier1Status = 'not_found';
        let tier2Status = 'not_found';

        // --- TIER 1: Church Search ---
        if (churchName !== '') {
            console.log('    ⚡ Tier 1: Church Search...');
            const tier1Query = `${churchName}, ${villageName}, ${district}, ${TARGET_STATE}, India`;
            const tier1Result = await searchMaps(page, tier1Query, TARGET_STATE, [churchName, villageName]);
            tier1Status = tier1Result.status;

            if (tier1Result.status === 'success') {
                const isLocal = isPointInBox(tier1Result.lat, tier1Result.lon, blockBounds) ||
                    isPointInBox(tier1Result.lat, tier1Result.lon, districtBounds);

                if (isLocal) {
                    if (isPointInBox(tier1Result.lat, tier1Result.lon, stateBounds)) {
                        console.log('    ✅ Tier 1 success (Validated in District/Block and State)');
                        finalResult = tier1Result;
                        finalSource = 'church';
                    } else {
                        console.log('    ❌ Tier 1 failed: Outside State bounds.');
                        tier1Status = 'outside_state';
                    }
                } else {
                    console.log('    ❌ Tier 1 failed: Outside District/Block bounds.');
                    tier1Status = 'outside_area';
                }
            }
        } else {
            console.log('    ℹ️ Church name empty, skipping Tier 1.');
            tier1Status = 'skipped';
        }

        // --- TIER 2: Village Search (Fallback) ---
        if (!finalResult) {
            console.log('    ⚡ Tier 2: Village Search...');
            const tier2Query = `${villageName}, ${district}, ${TARGET_STATE}, India`;
            const tier2Result = await searchMaps(page, tier2Query, TARGET_STATE, villageName);
            tier2Status = tier2Result.status;

            if (tier2Result.status === 'success') {
                const isLocal = isPointInBox(tier2Result.lat, tier2Result.lon, blockBounds) ||
                    isPointInBox(tier2Result.lat, tier2Result.lon, districtBounds);

                if (isLocal) {
                    if (isPointInBox(tier2Result.lat, tier2Result.lon, stateBounds)) {
                        console.log('    ✅ Tier 2 success (Validated in District/Block and State)');
                        finalResult = tier2Result;
                        finalSource = 'village';
                    } else {
                        console.log('    ❌ Tier 2 failed: Outside State bounds.');
                        tier2Status = 'outside_state';
                    }
                } else {
                    console.log('    ❌ Tier 2 failed: Outside District/Block bounds.');
                    tier2Status = 'outside_area';
                }
            }
        }

        // --- TIER 3: Block DB Fallback ---
        let blockCoords = null;
        let tier3Status = 'not_found';
        const isBlockSameAsDistrict = block && district && block.toLowerCase() === district.toLowerCase();

        if (!finalResult && !isBlockSameAsDistrict) {
            console.log('    ⚠️ Tier 3: Block DB Fallback...');
            blockCoords = await fetchPreviousBlockCoords(connection, block, district);
            if (blockCoords) {
                console.log('    ✅ Tier 3 success (Found in DB)');
                tier3Status = 'success';
                // Note: Tier 3 uses existing DB coords, usually pre-validated.
            }
        }

        // --- TIER 4: Village + District Search ---
        let tier4Status = 'not_found';
        if (!finalResult && !blockCoords) {
            console.log('    ⚡ Tier 4: Village + District Search...');
            const tier4Query = `${villageName}, ${district} District, ${TARGET_STATE}, India`;
            const tier4Result = await searchMaps(page, tier4Query, TARGET_STATE, villageName);
            tier4Status = tier4Result.status;

            if (tier4Result.status === 'success') {
                const isLocal = isPointInBox(tier4Result.lat, tier4Result.lon, districtBounds);
                if (isLocal) {
                    if (isPointInBox(tier4Result.lat, tier4Result.lon, stateBounds)) {
                        console.log('    ✅ Tier 4 success (Validated in District and State)');
                        finalResult = tier4Result;
                        finalSource = 'village-district';
                    } else {
                        console.log('    ❌ Tier 4 failed: Outside State bounds.');
                        tier4Status = 'outside_state';
                    }
                } else {
                    console.log('    ❌ Tier 4 failed: Outside District bounds.');
                    tier4Status = 'outside_area';
                }
            }
        }

        // Final decision: Use Block Fallback if Google Maps failed
        if (!finalResult && blockCoords) {
            finalResult = { lat: blockCoords.latitude, lon: blockCoords.longitude };
            finalSource = 'block-random';
        }

        // --- DUPLICATE CHECK & JITTERING ---
        if (finalResult) {
            const isDuplicate = await checkExistingCoords(connection, finalResult.lat, finalResult.lon);
            if (isDuplicate || finalSource === 'block-random') {
                console.log(`    🔀 Applying jitter (Duplicate: ${isDuplicate}, Source: ${finalSource})`);
                const jitterRange = finalSource === 'block-random' ? 0.005 : 0.0004;
                const jittered = await applySafeJitter(connection, finalResult.lat, finalResult.lon, jitterRange, finalSource === 'block-random');
                finalResult.lat = jittered.lat;
                finalResult.lon = jittered.lon;

                if (finalSource === 'church') finalSource = 'church-random';
                else if (finalSource === 'village') finalSource = 'village-random';
                else if (finalSource === 'village-district') finalSource = 'village-district-random';
            }

            await updateRecordSuccess(connection, row.id, finalResult, finalSource);
            console.log(`    Database updated (Source: ${finalSource})`);
        } else {
            const tierSummary = `T1:${tier1Status}, T2:${tier2Status}, T3:${tier3Status}, T4:${tier4Status}`;
            const errorMsg = `Validation failed for Tier 1 & 2. ${tierSummary}`;
            console.log(`    ❌ ${errorMsg}`);

            if (tier1Status === 'multiple' || tier2Status === 'multiple') {
                await updateRecordMulti(connection, row.id);
            } else {
                await updateRecordFailed(connection, row.id, errorMsg);
            }
        }

        // Dynamic delay
        await sleep(DELAY_MS + (Math.random() * 2000));
    }
}

module.exports = {
    processRecords
};

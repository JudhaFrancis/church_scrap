const { TARGET_STATE, DELAY_MS } = require('./config');
const { sleep, getDistance, isWithinBihar } = require('./utils');
const { searchMaps } = require('./browser');
const { checkExistingCoords, updateRecordSuccess, updateRecordMulti, updateRecordFailed, fetchPreviousVillageCoords, fetchPreviousBlockCoords } = require('./db');

async function applySafeJitter(connection, lat, lon, range, forceJitter = false) {
    let currentLat = parseFloat(lat);
    let currentLon = parseFloat(lon);
    let attempts = 0;
    let isDuplicate = true;

    // If forceJitter is true, we skip the first check and go straight to jittering
    if (!forceJitter) {
        isDuplicate = await checkExistingCoords(connection, currentLat, currentLon);
    }
    
    // If it's a duplicate, or we are forcing, we enter the loop
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

        let finalResult = null;
        let finalSource = 'missing';
        let tier1Status = row['Church/Orgn Name'] && row['Church/Orgn Name'].trim() !== '' ? 'not_found' : 'skipped';
        let tier2Status = 'not_found';
        let tier3Status = 'not_found';
        let tier4Status = 'not_found';
        let tier5Status = 'not_found';

        const block = row.block ? row.block.trim() : '';
        const district = row.district ? row.district.trim() : '';
        
        let areaQuery = '';
        if (block && district) {
            if (block.toLowerCase() === district.toLowerCase()) {
                areaQuery = `${district} District`;
            } else {
                areaQuery = `${block} Block, ${district} District`;
            }
        } else {
            areaQuery = district || block || '';
        }

        // --- TIER 1 & 2: Church & Village baseline ---
        const villageName = row['Village/Town Name'].trim();
        const tier2Query = `${villageName}, ${areaQuery}, ${TARGET_STATE}, India`;
        const tier2Result = await searchMaps(page, tier2Query, TARGET_STATE, villageName);
        tier2Status = tier2Result.status;

        // Verify if in Bihar (if applicable)
        if (tier2Status === 'success' && TARGET_STATE === 'Bihar' && !isWithinBihar(parseFloat(tier2Result.lat), parseFloat(tier2Result.lon))) {
            console.log(`    ⚠️ Tier 2 result (${tier2Result.lat}, ${tier2Result.lon}) outside Bihar. Rejecting.`);
            tier2Status = 'outside_state';
        }

        // Try Tier 1 (Church) if name exists
        if (row['Church/Orgn Name'] && row['Church/Orgn Name'].trim() !== '') {
            const churchName = row['Church/Orgn Name'].trim();
            const tier1Query = `${churchName}, ${villageName}, ${areaQuery}, ${TARGET_STATE}, India`;
            // VERIFY BOTH Church Name and Village Name must be present in the result text
            const tier1Result = await searchMaps(page, tier1Query, TARGET_STATE, [churchName, villageName]);
            tier1Status = tier1Result.status;

            if (tier1Result.status === 'success') {
                // Verify if in Bihar
                if (TARGET_STATE === 'Bihar' && !isWithinBihar(parseFloat(tier1Result.lat), parseFloat(tier1Result.lon))) {
                    console.log(`    ⚠️ Tier 1 result (${tier1Result.lat}, ${tier1Result.lon}) outside Bihar. Rejecting.`);
                    tier1Status = 'outside_state';
                } else if (tier2Status === 'success') {
                    // STRICT CHECK: Must have Tier 2 baseline and be within 2km
                    const dist = getDistance(
                        parseFloat(tier1Result.lat), parseFloat(tier1Result.lon),
                        parseFloat(tier2Result.lat), parseFloat(tier2Result.lon)
                    );
                    if (dist <= 2) { // Strict 2km threshold
                        console.log(`    ✅ Tier 1 (Church) hit! (Within village: ${dist.toFixed(2)} km)`);
                        finalResult = tier1Result;
                        finalSource = 'church';
                    } else {
                        console.log(`    ⚠️ Tier 1 hit but too far from village center (${dist.toFixed(2)} km). Falling back.`);
                    }
                } else {
                    console.log('    ⚠️ Tier 1 hit but valid village baseline (Tier 2) unavailable for strict verification.');
                }
            }
        }

        // Tier 2 Fallback: If Tier 1 failed or was far, use Village center
        if (!finalResult && tier2Status === 'success') {
            console.log('    ✅ Tier 2 (Village) hit!');
            finalResult = tier2Result;
            finalSource = 'village';
        }

        // --- TIER 3: Block Fallback ---
        let blockCoords = null;
        const isBlockSameAsDistrict = block.toLowerCase() === district.toLowerCase();

        if ((!finalResult || tier1Status === 'multiple' || tier2Status === 'multiple') && !isBlockSameAsDistrict) {
            console.log('    ⚠️ Attempting Tier 3 (Block Fallback)...');
            blockCoords = await fetchPreviousBlockCoords(connection, row.block, row.district);
            if (blockCoords) {
                console.log('    ✅ Tier 3 hit! Found block-level data.');
                tier3Status = 'success';
            } else {
                tier3Status = 'not_found';
            }
        } else if (isBlockSameAsDistrict) {
            console.log('    ℹ️ Skipping Tier 3: Block name is same as District name.');
        }

        // --- TIER 4: Village + District ---
        if ((!finalResult && !blockCoords) || tier1Status === 'multiple' || tier2Status === 'multiple') {
            console.log('    ⚠️ Attempting Tier 4 (Village + District)...');
            const tier4Query = `${villageName}, ${district} District, ${TARGET_STATE}, India`;
            const tier4Result = await searchMaps(page, tier4Query, TARGET_STATE, villageName);
            tier4Status = tier4Result.status;
            
            if (tier4Result.status === 'success') {
                if (TARGET_STATE === 'Bihar' && !isWithinBihar(parseFloat(tier4Result.lat), parseFloat(tier4Result.lon))) {
                    console.log(`    ⚠️ Tier 4 result (${tier4Result.lat}, ${tier4Result.lon}) outside Bihar. Rejecting.`);
                    tier4Status = 'outside_state';
                } else {
                    console.log('    ✅ Tier 4 hit!');
                    finalResult = tier4Result;
                    finalSource = 'village-district';
                }
            }
        }

        // --- TIER 5: Village + State ---
        if ((!finalResult && !blockCoords) || tier4Status === 'multiple' || (tier1Status === 'multiple' && tier4Status !== 'success')) {
            console.log('    ⚠️ Attempting Tier 5 (Village + State)...');
            const tier5Query = `${villageName}, ${TARGET_STATE}, India`;
            const tier5Result = await searchMaps(page, tier5Query, TARGET_STATE, villageName);
            tier5Status = tier5Result.status;

            if (tier5Result.status === 'success') {
                if (TARGET_STATE === 'Bihar' && !isWithinBihar(parseFloat(tier5Result.lat), parseFloat(tier5Result.lon))) {
                    console.log(`    ⚠️ Tier 5 result (${tier5Result.lat}, ${tier5Result.lon}) outside Bihar. Rejecting.`);
                    tier5Status = 'outside_state';
                } else {
                    console.log('    ✅ Tier 5 hit!');
                    finalResult = tier5Result;
                    finalSource = 'village-state';
                }
            }
        }

        // --- Final Decision: Use Block Fallback if Google Maps searches failed/multi ---
        if (!finalResult && blockCoords) {
            console.log('    ℹ️ Using Tier 3 (Block Fallback) as last successful resort.');
            finalResult = { lat: blockCoords.latitude, lon: blockCoords.longitude };
            finalSource = 'block-random';
        }

        // Update Database
        if (finalResult && finalResult.lat && finalResult.lon) {
            const lat = parseFloat(finalResult.lat);
            const lon = parseFloat(finalResult.lon);

            // --- DUPLICATE CHECK & JITTERING ---
            const isDuplicate = await checkExistingCoords(connection, lat, lon);
            if (isDuplicate || finalSource === 'block-random') {
                console.log(`    🔀 Applying jitter (Duplicate: ${isDuplicate}, Source: ${finalSource})`);
                const jitterRange = finalSource === 'block-random' ? 0.005 : 0.0004;
                const jittered = await applySafeJitter(connection, lat, lon, jitterRange, finalSource === 'block-random');
                finalResult.lat = jittered.lat;
                finalResult.lon = jittered.lon;
                
                if (finalSource === 'church') finalSource = 'church-random';
                else if (finalSource === 'village') finalSource = 'village-random';
                else if (finalSource === 'village-district') finalSource = 'village-district-random';
                else if (finalSource === 'village-state') finalSource = 'village-state-random';
            }

            await updateRecordSuccess(connection, row.id, finalResult, finalSource);
            console.log(`    Database updated (Source: ${finalSource})`);
        } else {
            const tierSummary = `T1:${tier1Status}, T2:${tier2Status}, T3:${tier3Status}, T4:${tier4Status}, T5:${tier5Status}`;
            
            if (tier1Status === 'multiple' || tier2Status === 'multiple' || tier4Status === 'multiple' || tier5Status === 'multiple') {
                console.log(`    ❌ All tiers failed or returned multiple results. Marking as multi. (${tierSummary})`);
                await updateRecordMulti(connection, row.id);
            } else {
                const errorMsg = `No results found in ${TARGET_STATE} for all tiers (1-5). ${tierSummary}`;
                console.log(`    ❌ ${errorMsg}`);
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

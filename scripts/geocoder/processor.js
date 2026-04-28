const { TARGET_STATE, DELAY_MS } = require('./config');
const { sleep, getDistance } = require('./utils');
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
        let tier1Status = 'not_found';
        let tier2Status = 'not_found';

        const block = row.block ? row.block.trim() : '';
        const district = row.district ? row.district.trim() : '';
        const areaQuery = (block.toLowerCase() === district.toLowerCase() || !block)
            ? district
            : `${block}, ${district}`;

        const villageName = row['Village/Town Name'].trim();
        const tier2Query = `${villageName}, ${areaQuery}, ${TARGET_STATE}, India`;

        // Search for Tier 2 (Village) baseline first to verify Tier 1 proximity
        const tier2Result = await searchMaps(page, tier2Query, TARGET_STATE, villageName);
        tier2Status = tier2Result.status;

        // --- TIER 1: Church + Village + Area ---
        if (row['Church/Orgn Name'] && row['Church/Orgn Name'].trim() !== '') {
            const churchName = row['Church/Orgn Name'].trim();
            const tier1Query = `${churchName}, ${row['Village/Town Name']}, ${areaQuery}, ${TARGET_STATE}, India`;
            const tier1Result = await searchMaps(page, tier1Query, TARGET_STATE, churchName);
            tier1Status = tier1Result.status;

            if (tier1Result.status === 'success') {
                // Verify Proximity to Village center
                if (tier2Result.status === 'success') {
                    const dist = getDistance(
                        parseFloat(tier1Result.lat), parseFloat(tier1Result.lon),
                        parseFloat(tier2Result.lat), parseFloat(tier2Result.lon)
                    );

                    if (dist <= 5) { // 5km Threshold
                        console.log(`    ✅ Tier 1 (Church) hit! (Distance to village: ${dist.toFixed(2)} km)`);
                        finalResult = tier1Result;
                        finalSource = 'church';
                    } else {
                        console.log(`    ⚠️ Tier 1 hit but too far from village center (${dist.toFixed(2)} km). Falling back to Tier 2.`);
                        finalResult = tier2Result;
                        finalSource = 'village';
                    }
                } else {
                    // Fallback to trusting Tier 1 name match if Village search failed
                    console.log('    ✅ Tier 1 (Church) hit! (Village baseline unavailable)');
                    finalResult = tier1Result;
                    finalSource = 'church';
                }
            }
        }

        // --- TIER 2: Fallback ---
        if (!finalResult && tier2Result.status === 'success') {
            console.log('    ✅ Tier 2 (Village) hit!');
            finalResult = tier2Result;
            finalSource = 'village';
        }



        // Update Database
        if (finalResult && finalResult.lat && finalResult.lon) {
            // --- DUPLICATE CHECK & JITTERING ---
            const isDuplicate = await checkExistingCoords(connection, finalResult.lat, finalResult.lon);
            if (isDuplicate) {
                console.log(`    🔀 Duplicate coordinates detected (Source: ${finalSource}). Applying safe jitter...`);
                const jittered = await applySafeJitter(connection, finalResult.lat, finalResult.lon, 0.0004);
                finalResult.lat = jittered.lat;
                finalResult.lon = jittered.lon;
                
                // Mark as random if jittered
                if (finalSource === 'church') finalSource = 'church-random';
                else if (finalSource === 'village') finalSource = 'village-random';
            }

            await updateRecordSuccess(connection, row.id, finalResult, finalSource);
            console.log(`    Database updated (Source: ${finalSource}, Multiple: no)`);
        } else {
            // --- TIER 3: Block Fallback for all other failures ---
            console.log('    ⚠️ Google Maps failed. Attempting Tier 3 (Block Fallback)...');
            const blockCoords = await fetchPreviousBlockCoords(connection, row.block, row.district);

            if (blockCoords) {
                console.log('    ✅ Tier 3 hit! Found block-level coordinates. Applying safe jitter...');
                // Always jitter for block fallback to ensure distribution
                const jitteredResult = await applySafeJitter(connection, blockCoords.latitude, blockCoords.longitude, 0.005, true);
                await updateRecordSuccess(connection, row.id, jitteredResult, 'block-random');
                console.log(`    Database updated (Source: block-random)`);
            } else if (tier1Status === 'multiple' || tier2Status === 'multiple') {
                console.log('    ❌ Tier 3 missed. No block-level data found. Marking as multi.');
                await updateRecordMulti(connection, row.id);
            } else {
                const errorMsg = `No results found in ${TARGET_STATE} for both tiers and Tier 3 missed`;
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

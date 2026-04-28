const { TARGET_STATE, DELAY_MS } = require('./config');
const { sleep } = require('./utils');
const { searchMaps } = require('./browser');
const { checkExistingCoords, updateRecordSuccess, updateRecordMulti, updateRecordFailed } = require('./db');

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

        // --- TIER 1: Church + Village + Area ---
        if (row['Church/Orgn Name'] && row['Church/Orgn Name'].trim() !== '') {
            const churchName = row['Church/Orgn Name'].trim();
            const tier1Query = `${churchName}, ${row['Village/Town Name']}, ${areaQuery}, ${TARGET_STATE}, India`;
            const result = await searchMaps(page, tier1Query, TARGET_STATE, churchName);
            tier1Status = result.status;
            if (result.status === 'success') {
                console.log('    ✅ Tier 1 (Church) hit!');
                finalResult = result;
                finalSource = 'church';
            }
        }

        // --- TIER 2: Village + Area (Fallback) ---
        if (!finalResult) {
            const villageName = row['Village/Town Name'].trim();
            const tier2Query = `${villageName}, ${areaQuery}, ${TARGET_STATE}, India`;
            const result = await searchMaps(page, tier2Query, TARGET_STATE, villageName);
            tier2Status = result.status;
            if (result.status === 'success') {
                console.log('    ✅ Tier 2 (Village) hit!');
                finalResult = result;
                finalSource = 'village';
            }
        }

        // Update Database
        if (finalResult && finalResult.lat && finalResult.lon) {
            // --- DUPLICATE CHECK & JITTERING ---
            if (finalSource === 'village') {
                const isDuplicate = await checkExistingCoords(connection, finalResult.lat, finalResult.lon);
                if (isDuplicate) {
                    finalResult.lat = parseFloat(finalResult.lat) + (Math.random() - 0.5) * 0.0004;
                    finalResult.lon = parseFloat(finalResult.lon) + (Math.random() - 0.5) * 0.0004;
                    finalSource = 'jitter';
                    console.log(`    🔀 Duplicate village coordinates detected. Applied jitter (Source: jitter).`);
                }
            }

            await updateRecordSuccess(connection, row.id, finalResult, finalSource);
            console.log(`    Database updated (Source: ${finalSource}, Multiple: no)`);
        } else if (tier1Status === 'multiple' || tier2Status === 'multiple') {
            console.log('    ⚠️ Multiple results found in one or more tiers. Marking as multi.');
            await updateRecordMulti(connection, row.id);
        } else {
            const errorMsg = `No results found in ${TARGET_STATE} for both tiers`;
            console.log(`    ❌ ${errorMsg}`);
            await updateRecordFailed(connection, row.id, errorMsg);
        }

        // Dynamic delay
        await sleep(DELAY_MS + (Math.random() * 2000));
    }
}

module.exports = {
    processRecords
};

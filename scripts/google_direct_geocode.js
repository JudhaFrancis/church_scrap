const mysql = require('mysql2/promise');
const puppeteer = require('puppeteer');
require('dotenv').config();

// Constants
const DELAY_MS = 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const TARGET_STATE = process.env.STATE || 'Bihar';

/**
 * Parse CLI Arguments
 */
const args = process.argv.slice(2);
const options = {
    start: null,
    end: null,
    status: null
};

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) options.start = parseInt(args[i + 1]);
    if (args[i] === '--end' && args[i + 1]) options.end = parseInt(args[i + 1]);
    if (args[i] === '--status' && args[i + 1]) {
        if (args[i + 1].toLowerCase() === 'all') {
            options.status = 'all';
        } else {
            options.status = args[i + 1].split(',').map(s => s.trim());
        }
    }
}

/**
 * Extract Coordinates from current Google Maps Page
 */
async function extractCoords(page) {
    let url = page.url();
    // Pattern 1: @lat,lon in the URL
    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    let match = url.match(coordRegex);
    if (match) return { lat: match[1], lon: match[2] };

    // Pattern 2: !3d lat !4d lon in the URL
    const dataRegex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
    match = url.match(dataRegex);
    if (match) return { lat: match[1], lon: match[2] };

    return null;
}

/**
 * Perform Geocoding for a specific query
 * Returns { status: 'success'|'multiple'|'not_found', lat, lon, isMultiple }
 */
async function searchMaps(page, query, targetState) {
    try {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        console.log(`    Searching: ${query}`);

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(4000); // Wait for potential list or direct result to load

        // Detect if it's a list or a single result
        const isList = await page.evaluate(() => {
            return !!document.querySelector('[role="article"]') || !!document.querySelector('.m67qEc');
        });

        if (isList) {
            console.log(`    ⚠️ Multiple results found. Skipping...`);
            return { status: 'multiple' };
        }

        const coords = await extractCoords(page);
        if (coords) {
            // Explicit state verification for single results
            const isStateMatch = await page.evaluate((state) => {
                const text = document.body.innerText.toLowerCase();
                return text.includes(state.toLowerCase());
            }, targetState);

            if (isStateMatch) {
                return { status: 'success', ...coords, isMultiple: false };
            } else {
                console.log(`    ❌ State mismatch: Result not found in ${targetState}.`);
                return { status: 'not_found' };
            }
        } else {
            return { status: 'not_found' };
        }

    } catch (error) {
        console.error(`    Search error: ${error.message}`);
        return { status: 'not_found' };
    }
}

async function run() {
    let connection;
    let browser;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            port: parseInt(process.env.DB_PORT) || 3306
        });

        // Construct SQL Query based on CLI options
        let sql = 'SELECT id, district, block, `Village/Town Name`, `Church/Orgn Name`, status FROM bihar_iif_data WHERE 1=1';
        const params = [];

        if (options.start) {
            sql += ' AND id >= ?';
            params.push(options.start);
        }
        if (options.end) {
            sql += ' AND id <= ?';
            params.push(options.end);
        }

        if (options.status === 'all') {
            console.log('Targeting records with ALL statuses.');
        } else if (options.status) {
            sql += ' AND status IN (?)';
            params.push(options.status);
            console.log(`Targeting statuses: ${options.status.join(', ')}`);
        } else {
            // Default to missing if no status provided
            sql += ' AND status = "missing"';
            console.log('Targeting status: missing (default)');
        }

        sql += ' ORDER BY id ASC';

        const [rows] = await connection.query(sql, params);
        console.log(`\nStarting Geocoding Refactor...`);

        if (rows.length === 0) {
            console.log(`Found 0 records to process.`);

            // Helpful debugging: check if records exist in range but with different status
            if (!options.status || options.status !== 'all') {
                let checkSql = 'SELECT status, COUNT(*) as count FROM bihar_iif_data WHERE 1=1';
                const checkParams = [];
                if (options.start) { checkSql += ' AND id >= ?'; checkParams.push(options.start); }
                if (options.end) { checkSql += ' AND id <= ?'; checkParams.push(options.end); }
                checkSql += ' GROUP BY status';

                const [counts] = await connection.query(checkSql, checkParams);
                if (counts.length > 0) {
                    console.log('\n💡 Tip: Records exist in this range but have other statuses:');
                    counts.forEach(c => console.log(`   - ${c.status}: ${c.count} records`));
                    console.log('\nTo process them, use --status all or --status complete,failed,etc.');
                }
            }
            return;
        }

        console.log(`Found ${rows.length} records to process.`);

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1366, height: 768 });

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            console.log(`\n[${i + 1}/${rows.length}] ID: ${row.id} | Village: ${row['Village/Town Name']} | Church: ${row['Church/Orgn Name'] || 'N/A'}`);

            let finalResult = null;
            let finalSource = 'missing';
            let tier1Status = 'not_found';
            let tier2Status = 'not_found';

            // --- TIER 1: Church + Village + Block + District ---
            if (row['Church/Orgn Name'] && row['Church/Orgn Name'].trim() !== '') {
                const tier1Query = `${row['Church/Orgn Name']}, ${row['Village/Town Name']}, ${row.block}, ${row.district}, ${TARGET_STATE}, India`;
                const result = await searchMaps(page, tier1Query, TARGET_STATE);
                tier1Status = result.status;
                if (result.status === 'success') {
                    console.log('    ✅ Tier 1 (Church) hit!');
                    finalResult = result;
                    finalSource = 'church';
                }
            }

            // --- TIER 2: Village + Block + District (Fallback) ---
            if (!finalResult) {
                const tier2Query = `${row['Village/Town Name']}, ${row.block}, ${row.district}, ${TARGET_STATE}, India`;
                const result = await searchMaps(page, tier2Query, TARGET_STATE);
                tier2Status = result.status;
                if (result.status === 'success') {
                    console.log('    ✅ Tier 2 (Village) hit!');
                    finalResult = result;
                    finalSource = 'village';
                }
            }

            // Update Database
            if (finalResult && finalResult.lat && finalResult.lon) {
                const updateQuery = `
                    UPDATE bihar_iif_data SET 
                        latitude = ?, 
                        longitude = ?, 
                        source = ?, 
                        is_multiple = 'no',
                        status = 'complete',
                        error = NULL
                    WHERE id = ?
                `;
                await connection.query(updateQuery, [
                    finalResult.lat,
                    finalResult.lon,
                    finalSource,
                    row.id
                ]);
                console.log(`    Database updated (Source: ${finalSource}, Multiple: no)`);
            } else if (tier1Status === 'multiple' || tier2Status === 'multiple') {
                console.log('    ⚠️ Multiple results found in one or more tiers. Marking as multi.');
                await connection.query('UPDATE bihar_iif_data SET status = "multi", error = "Multiple results found and skipped" WHERE id = ?', [row.id]);
            } else {
                const errorMsg = `No results found in ${TARGET_STATE} for both tiers`;
                console.log(`    ❌ ${errorMsg}`);
                await connection.query('UPDATE bihar_iif_data SET status = "failed", error = ? WHERE id = ?', [errorMsg, row.id]);
            }

            // Dynamic delay
            await sleep(DELAY_MS + (Math.random() * 2000));
        }

        console.log('\n✨ Geocoding job complete.');

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
    } finally {
        if (browser) await browser.close();
        if (connection) await connection.end();
        process.exit(0);
    }
}

run();

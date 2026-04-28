const { getConnection, fetchRecords, getStatusCounts } = require('./db');
const { initBrowser } = require('./browser');
const { processRecords } = require('./processor');

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

async function run() {
    let connection;
    let browserObj;
    try {
        connection = await getConnection();
        const rows = await fetchRecords(connection, options);

        console.log(`\nStarting Geocoding Refactor...`);

        if (rows.length === 0) {
            console.log(`Found 0 records to process.`);

            if (!options.status || options.status !== 'all') {
                const counts = await getStatusCounts(connection, options);
                if (counts.length > 0) {
                    console.log('\n💡 Tip: Records exist in this range but have other statuses:');
                    counts.forEach(c => console.log(`   - ${c.status}: ${c.count} records`));
                    console.log('\nTo process them, use --status all or --status complete,failed,etc.');
                }
            }
            return;
        }

        console.log(`Found ${rows.length} records to process.`);

        browserObj = await initBrowser();
        await processRecords(connection, browserObj.page, rows);

        console.log('\n✨ Geocoding job complete.');

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
    } finally {
        if (browserObj && browserObj.browser) await browserObj.browser.close();
        if (connection) await connection.end();
        process.exit(0);
    }
}

run();

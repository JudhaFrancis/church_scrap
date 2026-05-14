const fs = require('fs');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
require('dotenv').config();

const DB_TABLE = process.env.DB_TABLE;
const CSV_FILE = 'csv_raw_data/bihar iif data - bihar filter data.csv';
const BATCH_SIZE = 500;

async function run() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            port: parseInt(process.env.DB_PORT) || 3306
        });

        console.log('Connected to database.');

        // Verify table is empty or handle truncation if not already done by user
        // The user said they already truncated, but we'll double check.
        const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM ${DB_TABLE}`);
        console.log(`Current record count: ${rows[0].count}`);

        let batch = [];
        let totalCount = 0;

        const processBatch = async (data) => {
            if (data.length === 0) return;

            const query = `
                INSERT INTO ${DB_TABLE} (
                    id, state, country, district, block, \`Village/Town Name\`,
                    \`Gath Type\`, MC, HC, PC, AV, EV,
                    \`Church/Orgn Name\`, \`Pastor/Leader Name\`, \`Comments\`,
                    status
                ) VALUES ?
            `;

            const values = data.map(r => [
                parseInt(r['Sr#']),
                'Bihar',
                'India',
                r['District'],
                r['Block'],
                r['Village/Town Name'],
                r['Gath Type'],
                r['MC'] || 0,
                r['HC'] || 0,
                r['PC'] || 0,
                r['AV'] || 0,
                r['EV'] || 0,
                r['Church/Orgn Name'],
                r['Pastor/Leader Name'],
                r['Comments'],
                'missing'
            ]);

            await connection.query(query, [values]);
            totalCount += data.length;
            console.log(`Inserted ${totalCount} rows...`);
        };

        const stream = fs.createReadStream(CSV_FILE).pipe(csv());

        for await (const row of stream) {
            batch.push(row);

            if (batch.length >= BATCH_SIZE) {
                await processBatch(batch);
                batch = [];
            }
        }

        if (batch.length > 0) {
            await processBatch(batch);
        }

        console.log(`Full import complete. Total rows inserted: ${totalCount}`);

    } catch (error) {
        console.error('Error during full import:', error);
    } finally {
        if (connection) await connection.end();
    }
}

run();

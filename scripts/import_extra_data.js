const fs = require('fs');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
require('dotenv').config();

const DB_TABLE = process.env.DB_TABLE;
const CSV_FILE = 'csv_raw_data/bihar iif data - bihar filter data.csv';
const BATCH_SIZE = 100;

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

        let batch = [];
        let totalCount = 0;

        const processBatch = async (rows) => {
            if (rows.length === 0) return;

            const updates = rows.map(r => {
                const query = `
                    UPDATE ${DB_TABLE} SET 
                        \`Gath Type\` = ?,
                        \`MC\` = ?,
                        \`HC\` = ?,
                        \`PC\` = ?,
                        \`AV\` = ?,
                        \`EV\` = ?,
                        \`Church/Orgn Name\` = ?,
                        \`Pastor/Leader Name\` = ?,
                        \`Comments\` = ?
                    WHERE id = ?
                `;
                const params = [
                    r['Gath Type'],
                    r['MC'],
                    r['HC'],
                    r['PC'],
                    r['AV'],
                    r['EV'],
                    r['Church/Orgn Name'],
                    r['Pastor/Leader Name'],
                    r['Comments'],
                    parseInt(r['Sr#'])
                ];
                return connection.execute(query, params);
            });

            await Promise.all(updates);
            totalCount += rows.length;
            console.log(`Updated ${totalCount} rows...`);
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

        console.log(`Sync completed successfully. Total rows updated: ${totalCount}`);

    } catch (error) {
        console.error('Error during data sync:', error);
    } finally {
        if (connection) await connection.end();
    }
}

run();

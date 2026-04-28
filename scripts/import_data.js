const fs = require('fs');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
require('dotenv').config();

const BATCH_SIZE = 500;
const CSV_FILE = 'bihar iif data - bihar filter data.csv';

async function run() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'church',
            port: parseInt(process.env.DB_PORT) || 3306
        });

        console.log('Connected to MySQL database.');

        // 1. Recreate Table with new schema
        await connection.query('DROP TABLE IF EXISTS bihar_iif_data');
        const createTableQuery = `
            CREATE TABLE bihar_iif_data (
                id INT PRIMARY KEY,
                state VARCHAR(50) DEFAULT 'Bihar',
                country VARCHAR(50) DEFAULT 'India',
                district VARCHAR(100),
                block VARCHAR(100),
                village_name VARCHAR(255),
                latitude DECIMAL(10, 8) NULL,
                longitude DECIMAL(11, 8) NULL,
                geometry GEOMETRY NULL,
                source VARCHAR(100) NULL,
                status ENUM('complete', 'partial', 'missing') NOT NULL
            )
        `;
        await connection.query(createTableQuery);
        console.log('Table bihar_iif_data updated with new columns.');

        // 2. Truncate table for fresh import
        await connection.query('TRUNCATE TABLE bihar_iif_data');
        console.log('Table truncated.');

        // 3. Parse CSV and Insert Data
        let batch = [];
        let totalCount = 0;

        const processBatch = async (rows) => {
            if (rows.length === 0) return;
            const query = `
                INSERT INTO bihar_iif_data (id, state, country, district, block, village_name, latitude, longitude, source, status)
                VALUES ?
            `;
            const values = rows.map(r => [
                r.id,
                'Bihar',
                'India',
                r.district,
                r.block,
                r.village_name,
                r.latitude,
                r.longitude,
                r.source,
                r.status
            ]);
            await connection.query(query, [values]);
            totalCount += rows.length;
            console.log(`Inserted ${totalCount} rows...`);
        };

        const stream = fs.createReadStream(CSV_FILE).pipe(csv());

        for await (const row of stream) {
            const lat = row.latitude && row.latitude.trim() !== '' ? parseFloat(row.latitude) : null;
            const lon = row.longitude && row.longitude.trim() !== '' ? parseFloat(row.longitude) : null;
            
            let status = 'missing';
            if (lat !== null && lon !== null) {
                status = 'complete';
            } else if (lat !== null || lon !== null) {
                status = 'partial';
            }

            const cleanedRow = {
                id: parseInt(row.id),
                district: row.District,
                block: row.Block,
                village_name: row['Village Name'],
                latitude: lat,
                longitude: lon,
                source: row.Source,
                status: status
            };

            batch.push(cleanedRow);

            if (batch.length >= BATCH_SIZE) {
                await processBatch(batch);
                batch = [];
            }
        }

        if (batch.length > 0) {
            await processBatch(batch);
        }



        console.log(`Migration completed successfully. Total rows: ${totalCount}`);

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

run();

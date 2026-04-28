const mysql = require('mysql2/promise');
require('dotenv').config();

async function verify() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'church_scrap',
            port: parseInt(process.env.DB_PORT) || 3306
        });

        console.log('--- Verification Report ---');

        const [total] = await connection.query('SELECT COUNT(*) as count FROM bihar_iif_data');
        console.log(`Total rows in table: ${total[0].count}`);

        const [statusCounts] = await connection.query('SELECT status, COUNT(*) as count FROM bihar_iif_data GROUP BY status');
        console.log('Status Breakdown:');
        statusCounts.forEach(row => {
            console.log(`  ${row.status}: ${row.count}`);
        });

        const [sample] = await connection.query('SELECT id, state, country, district, block, village_name, latitude, longitude, status, ST_AsText(geometry) as geom_text FROM bihar_iif_data LIMIT 1');
        console.log('Sample Record:', sample[0]);

    } catch (error) {
        console.error('Verification failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

verify();

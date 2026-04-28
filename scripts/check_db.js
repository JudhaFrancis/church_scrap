const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            port: parseInt(process.env.DB_PORT) || 3306
        });

        const [rows] = await connection.query('SELECT status, COUNT(*) as count FROM bihar_iif_data_1 GROUP BY status');
        console.log('Status counts in bihar_iif_data_1:');
        console.table(rows);

        const [total] = await connection.query('SELECT COUNT(*) as count FROM bihar_iif_data_1');
        console.log('Total records:', total[0].count);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.end();
    }
}

check();

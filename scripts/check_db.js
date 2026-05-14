const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_TABLE = process.env.DB_TABLE;

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

        const [rows] = await connection.query(`SELECT status, COUNT(*) as count FROM ${DB_TABLE} GROUP BY status`);
        console.log(`Status counts in ${DB_TABLE}:`);
        console.table(rows);

        const [total] = await connection.query(`SELECT COUNT(*) as count FROM ${DB_TABLE}`);
        console.log('Total records:', total[0].count);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.end();
    }
}

check();

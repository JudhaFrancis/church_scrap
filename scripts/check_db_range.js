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

        const [rows] = await connection.query(`SELECT id, status FROM ${DB_TABLE} WHERE id >= 1 AND id <= 100`);
        console.log('Statuses for IDs 1-100:');
        console.table(rows);

        const [missing] = await connection.query(`SELECT COUNT(*) as count FROM ${DB_TABLE} WHERE id >= 1 AND id <= 100 AND status = "missing"`);
        console.log('Count of "missing" in IDs 1-100:', missing[0].count);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.end();
    }
}

check();

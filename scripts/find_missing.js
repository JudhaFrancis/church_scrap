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

        const [rows] = await connection.query(`SELECT MIN(id) as first_missing FROM ${DB_TABLE} WHERE status = "missing"`);
        console.log('First missing ID:', rows[0].first_missing);

        const [sample] = await connection.query(`SELECT id, status FROM ${DB_TABLE} WHERE status = "missing" LIMIT 10`);
        console.log('Sample missing records:');
        console.table(sample);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.end();
    }
}

check();

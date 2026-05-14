const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_TABLE = process.env.DB_TABLE;

async function upgradeTable() {
    console.log(`🚀 Upgrading ${DB_TABLE} table...`);
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: parseInt(process.env.DB_PORT) || 3306
    });

    try {
        // Checking if columns already exist to avoid errors
        const [columns] = await connection.execute(`SHOW COLUMNS FROM ${DB_TABLE}`);
        const columnNames = columns.map(c => c.Field);

        if (!columnNames.includes('created_at')) {
            console.log('➕ Adding created_at column...');
            await connection.execute(`ALTER TABLE ${DB_TABLE} ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        }

        if (!columnNames.includes('updated_at')) {
            console.log('➕ Adding updated_at column...');
            await connection.execute(`ALTER TABLE ${DB_TABLE} ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
        }

        console.log('✅ Table upgrade successful!');
    } catch (error) {
        console.error('❌ Error upgrading table:', error.message);
    } finally {
        await connection.end();
    }
}

upgradeTable();

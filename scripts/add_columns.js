const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_TABLE = process.env.DB_TABLE;

const TARGET_COLUMNS = [
    'Gath Type',
    'MC',
    'HC',
    'PC',
    'AV',
    'EV',
    'Church/Orgn Name',
    'Pastor/Leader Name',
    'Comments'
];

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

        // 1. Check existing columns
        const [columns] = await connection.execute(`SHOW COLUMNS FROM ${DB_TABLE}`);
        const columnNames = columns.map(c => c.Field);

        // 2. Rename village_name if it exists
        if (columnNames.includes('village_name')) {
            console.log('Renaming village_name to "Village/Town Name"...');
            await connection.execute(`ALTER TABLE ${DB_TABLE} CHANGE village_name \`Village/Town Name\` TEXT`);
            console.log('Renamed successfully.');
        }

        // 3. Add target columns if missing
        for (const col of TARGET_COLUMNS) {
            if (!columnNames.includes(col)) {
                console.log(`Adding column: ${col}...`);
                await connection.execute(`ALTER TABLE ${DB_TABLE} ADD COLUMN \`${col}\` TEXT`);
            }
        }

        // 4. Reorder Church/Orgn Name
        console.log('Reordering Church/Orgn Name...');
        await connection.execute(`ALTER TABLE ${DB_TABLE} MODIFY \`Church/Orgn Name\` TEXT AFTER \`Village/Town Name\``);

        // 5. Set id to AUTO_INCREMENT
        console.log('Setting id to AUTO_INCREMENT...');
        await connection.execute(`ALTER TABLE ${DB_TABLE} MODIFY id INT AUTO_INCREMENT`);

        console.log('Schema update complete.');

    } catch (error) {
        console.error('Error during schema update:', error);
    } finally {
        if (connection) await connection.end();
    }
}

run();

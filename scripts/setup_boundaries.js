require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
};

const statesData = [
    { name: 'Andaman and Nicobar Islands', north: 13.7, south: 6.7, east: 94.0, west: 92.0 },
    { name: 'Andhra Pradesh', north: 19.1, south: 12.6, east: 84.8, west: 76.7 },
    { name: 'Arunachal Pradesh', north: 29.5, south: 26.4, east: 97.5, west: 90.5 },
    { name: 'Assam', north: 28.0, south: 24.1, east: 96.1, west: 89.7 },
    { name: 'Bihar', north: 27.5, south: 24.2, east: 88.3, west: 83.3 },
    { name: 'Chandigarh', north: 30.8, south: 30.6, east: 76.9, west: 76.7 },
    { name: 'Chhattisgarh', north: 24.1, south: 17.7, east: 84.4, west: 80.2 },
    { name: 'Dadra and Nagar Haveli and Daman and Diu', north: 20.5, south: 20.0, east: 73.2, west: 72.8 },
    { name: 'Delhi', north: 28.9, south: 28.4, east: 77.4, west: 76.8 },
    { name: 'Goa', north: 15.8, south: 14.9, east: 74.3, west: 73.6 },
    { name: 'Gujarat', north: 24.7, south: 20.1, east: 74.5, west: 68.1 },
    { name: 'Haryana', north: 30.1, south: 27.6, east: 77.6, west: 74.4 },
    { name: 'Himachal Pradesh', north: 33.3, south: 30.3, east: 79.1, west: 75.3 },
    { name: 'Jammu and Kashmir', north: 37.1, south: 32.2, east: 80.3, west: 73.7 },
    { name: 'Jharkhand', north: 25.5, south: 21.9, east: 88.0, west: 83.3 },
    { name: 'Karnataka', north: 18.5, south: 11.5, east: 78.5, west: 74.0 },
    { name: 'Kerala', north: 12.8, south: 8.3, east: 77.5, west: 74.8 },
    { name: 'Ladakh', north: 36.0, south: 32.5, east: 80.0, west: 75.5 },
    { name: 'Lakshadweep', north: 12.5, south: 8.0, east: 74.0, west: 71.0 },
    { name: 'Madhya Pradesh', north: 26.9, south: 21.1, east: 82.8, west: 74.0 },
    { name: 'Maharashtra', north: 22.1, south: 15.6, east: 80.9, west: 72.6 },
    { name: 'Manipur', north: 25.7, south: 23.8, east: 94.8, west: 92.9 },
    { name: 'Meghalaya', north: 26.1, south: 25.0, east: 92.8, west: 89.8 },
    { name: 'Mizoram', north: 24.5, south: 21.9, east: 93.5, west: 92.2 },
    { name: 'Nagaland', north: 27.0, south: 25.1, east: 95.3, west: 93.3 },
    { name: 'Odisha', north: 22.6, south: 17.8, east: 87.5, west: 81.4 },
    { name: 'Puducherry', north: 12.0, south: 10.9, east: 79.9, west: 79.7 },
    { name: 'Punjab', north: 32.5, south: 29.5, east: 77.0, west: 73.8 },
    { name: 'Rajasthan', north: 30.2, south: 23.1, east: 78.3, west: 69.5 },
    { name: 'Sikkim', north: 28.1, south: 27.1, east: 88.9, west: 88.0 },
    { name: 'Tamil Nadu', north: 13.5, south: 8.1, east: 80.3, west: 76.2 },
    { name: 'Telangana', north: 19.9, south: 15.8, east: 81.7, west: 77.2 },
    { name: 'Tripura', north: 24.5, south: 22.9, east: 92.4, west: 91.1 },
    { name: 'Uttar Pradesh', north: 31.5, south: 23.9, east: 84.7, west: 77.1 },
    { name: 'Uttarakhand', north: 31.5, south: 28.7, east: 81.1, west: 77.6 },
    { name: 'West Bengal', north: 27.2, south: 21.5, east: 89.9, west: 85.8 }
];

async function setup() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(DB_CONFIG);

        console.log('Creating state_boundaries table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS state_boundaries (
                id INT AUTO_INCREMENT PRIMARY KEY,
                state_name VARCHAR(100) UNIQUE NOT NULL,
                north DECIMAL(10, 6) NOT NULL,
                south DECIMAL(10, 6) NOT NULL,
                east DECIMAL(10, 6) NOT NULL,
                west DECIMAL(10, 6) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Seeding state data...');
        for (const state of statesData) {
            await connection.query(`
                INSERT INTO state_boundaries (state_name, north, south, east, west)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    north = VALUES(north),
                    south = VALUES(south),
                    east = VALUES(east),
                    west = VALUES(west)
            `, [state.name, state.north, state.south, state.east, state.west]);
        }

        console.log('✨ Setup complete! 36 states/UTs synchronized.');
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
    } finally {
        if (connection) await connection.end();
    }
}

setup();

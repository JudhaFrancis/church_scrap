const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_TABLE } = require('./config');

async function getConnection() {
    return await mysql.createConnection(DB_CONFIG);
}

async function fetchRecords(connection, options) {
    let sql = `SELECT id, district, block, \`Village/Town Name\`, \`Church/Orgn Name\`, status FROM ${DB_TABLE} WHERE 1=1`;
    const params = [];

    if (options.start) {
        sql += ' AND id >= ?';
        params.push(options.start);
    }
    if (options.end) {
        sql += ' AND id <= ?';
        params.push(options.end);
    }

    if (options.status === 'all') {
        console.log('Targeting records with ALL statuses.');
    } else if (options.status) {
        sql += ' AND status IN (?)';
        params.push(options.status);
        console.log(`Targeting statuses: ${options.status.join(', ')}`);
    } else {
        sql += ' AND status = "missing"';
        console.log('Targeting status: missing (default)');
    }

    sql += ' ORDER BY id ASC';
    const [rows] = await connection.query(sql, params);
    return rows;
}

async function checkExistingCoords(connection, lat, lon) {
    const [existing] = await connection.query(
        `SELECT id FROM ${DB_TABLE} WHERE latitude = ? AND longitude = ? LIMIT 1`,
        [lat, lon]
    );
    return existing.length > 0;
}

async function updateRecordSuccess(connection, id, result, source) {
    const query = `
        UPDATE ${DB_TABLE} SET 
            latitude = ?, 
            longitude = ?, 
            source = ?, 
            is_multiple = 'no',
            status = 'complete',
            error = NULL
        WHERE id = ?
    `;
    await connection.query(query, [result.lat, result.lon, source, id]);
}

async function updateRecordMulti(connection, id) {
    await connection.query(
        `UPDATE ${DB_TABLE} SET status = "multi", error = "Multiple results found and skipped" WHERE id = ?`,
        [id]
    );
}

async function updateRecordFailed(connection, id, errorMsg) {
    await connection.query(
        `UPDATE ${DB_TABLE} SET status = "failed", error = ? WHERE id = ?`,
        [errorMsg, id]
    );
}

async function getStatusCounts(connection, options) {
    let checkSql = `SELECT status, COUNT(*) as count FROM ${DB_TABLE} WHERE 1=1`;
    const checkParams = [];
    if (options.start) { checkSql += ' AND id >= ?'; checkParams.push(options.start); }
    if (options.end) { checkSql += ' AND id <= ?'; checkParams.push(options.end); }
    checkSql += ' GROUP BY status';
    const [counts] = await connection.query(checkSql, checkParams);
    return counts;
}

async function fetchPreviousBlockCoords(connection, block, district) {
    const sql = `
        SELECT latitude, longitude 
        FROM ${DB_TABLE} 
        WHERE block = ? AND district = ? 
        AND latitude IS NOT NULL 
        LIMIT 1
    `;
    const [rows] = await connection.query(sql, [block, district]);
    return rows.length > 0 ? rows[0] : null;
}

module.exports = {
    getConnection,
    fetchRecords,
    checkExistingCoords,
    updateRecordSuccess,
    updateRecordMulti,
    updateRecordFailed,
    getStatusCounts,
    fetchPreviousBlockCoords
};

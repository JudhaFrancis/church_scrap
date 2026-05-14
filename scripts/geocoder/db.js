const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_TABLE } = require('./config');

async function getConnection() {
    return await mysql.createConnection(DB_CONFIG);
}

async function fetchRecords(connection, options) {
    let sql = `
        SELECT id, district, block, state, \`Village/Town Name\`, \`Church/Orgn Name\`, status, MC, PC, HC 
        FROM ${DB_TABLE} 
        WHERE (deleted_at IS NULL OR deleted_at = '')
    `;
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

async function fetchStateBoundary(connection, stateName) {
    const sql = `
        SELECT north, south, east, west 
        FROM state_boundaries 
        WHERE state_name = ? 
        LIMIT 1
    `;
    const [rows] = await connection.query(sql, [stateName]);
    return rows.length > 0 ? rows[0] : null;
}

async function findOriginalRecord(connection, row) {
    const sql = `
        SELECT id, MC, PC, HC 
        FROM ${DB_TABLE} 
        WHERE \`Church/Orgn Name\` = ? 
        AND \`Village/Town Name\` = ? 
        AND block = ? 
        AND district = ? 
        AND state = ? 
        AND id < ? 
        AND (deleted_at IS NULL OR deleted_at = '')
        LIMIT 1
    `;
    const [rows] = await connection.query(sql, [
        row['Church/Orgn Name'],
        row['Village/Town Name'],
        row.block,
        row.district,
        row.state,
        row.id
    ]);
    return rows.length > 0 ? rows[0] : null;
}

async function mergeAndSoftDelete(connection, originalRow, duplicateRow) {
    // 1. Merge MC, PC, HC into original if duplicate has them set to 1
    const updates = [];
    const params = [];

    if (duplicateRow.MC == 1 && originalRow.MC != 1) {
        updates.push('MC = 1');
    }
    if (duplicateRow.PC == 1 && originalRow.PC != 1) {
        updates.push('PC = 1');
    }
    if (duplicateRow.HC == 1 && originalRow.HC != 1) {
        updates.push('HC = 1');
    }

    if (updates.length > 0) {
        await connection.query(
            `UPDATE ${DB_TABLE} SET ${updates.join(', ')} WHERE id = ?`,
            [originalRow.id]
        );
    }

    // 2. Soft delete the duplicate
    await connection.query(
        `UPDATE ${DB_TABLE} SET 
            deleted_at = NOW(), 
            source = ?, 
            status = 'duplicate' 
         WHERE id = ?`,
        [`duplicate - original: ${originalRow.id}`, duplicateRow.id]
    );
}

module.exports = {
    getConnection,
    fetchRecords,
    checkExistingCoords,
    updateRecordSuccess,
    updateRecordMulti,
    updateRecordFailed,
    getStatusCounts,
    fetchPreviousBlockCoords,
    fetchStateBoundary,
    findOriginalRecord,
    mergeAndSoftDelete
};

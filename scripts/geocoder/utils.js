const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate distance between two points in km using Haversine formula
 */
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; 
    return d;
}

/**
 * Check if coordinates are within a specific bounding box
 * @param {number|string} lat 
 * @param {number|string} lon 
 * @param {Object} bounds {north, south, east, west}
 */
function isPointInBox(lat, lon, bounds) {
    if (!bounds) return false;
    const pLat = parseFloat(lat);
    const pLon = parseFloat(lon);
    return (
        pLat >= bounds.south &&
        pLat <= bounds.north &&
        pLon >= bounds.west &&
        pLon <= bounds.east
    );
}

module.exports = {
    sleep,
    getDistance,
    isPointInBox
};

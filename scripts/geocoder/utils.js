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
 * Check if coordinates are within Bihar boundaries
 * Bihar roughly: Lat 24.2 to 27.5, Lon 83.3 to 88.3
 */
function isWithinBihar(lat, lon) {
    const minLat = 24.2, maxLat = 27.5;
    const minLon = 83.3, maxLon = 88.3;
    return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

module.exports = {
    sleep,
    getDistance,
    isWithinBihar
};

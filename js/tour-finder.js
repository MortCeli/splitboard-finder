// ── Toppturfinner — Tour Finder ──
// Filtrering, scoring og rangering av turer.
// Bruker TOURS fra tours-data.js og API-funksjoner fra api.js.

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDriveHours(distanceKm) {
    return distanceKm / 55;
}

/**
 * Finn og ranger turer basert på alle kriterier.
 * @param {Object} opts
 * @param {number|null} opts.userLat
 * @param {number|null} opts.userLon
 * @param {number} opts.maxDriveHours
 * @param {string|null} opts.targetDate - YYYY-MM-DD
 * @param {string|null} opts.difficulty
 * @param {string|null} opts.region
 * @param {number} opts.minSlope
 * @param {number} opts.maxSlope
 * @param {function|null} opts.onProgress - callback(message) for progress updates
 * @returns {Promise<Array>}
 */
async function findTours({
    userLat = null,
    userLon = null,
    maxDriveHours = 4.0,
    targetDate = null,
    difficulty = null,
    region = null,
    minSlope = 15,
    maxSlope = 30,
    onProgress = null,
} = {}) {
    // Filtrer turer
    let tours = TOURS;

    if (region) {
        tours = tours.filter(t => t.region.toLowerCase() === region.toLowerCase());
    }

    // Helningsfilter
    tours = tours.filter(t => {
        const slope = t.slope_avg_deg || 25;
        return slope >= minSlope && slope <= maxSlope;
    });

    // Vanskelighetsfilter
    if (difficulty) {
        tours = tours.filter(t =>
            (t.difficulty || '').toLowerCase().includes(difficulty.toLowerCase())
        );
    }

    if (onProgress) onProgress(`Filtrert: ${tours.length} turer funnet`);

    // ── Steg 1: Beregn kjøretid for alle turer (parallelt) ──
    if (onProgress) onProgress('Beregner kjøretid...');

    let toursWithDrive = [];

    if (userLat != null && userLon != null) {
        const drivePromises = tours.map(async (tour) => {
            const osrmResult = await fetchDriveTime(
                userLat, userLon,
                tour.start.lat, tour.start.lon
            );

            let dist, driveHours, driveSource;
            if (osrmResult) {
                dist = osrmResult.distance_km;
                driveHours = osrmResult.duration_hours;
                driveSource = 'osrm';
            } else {
                dist = haversineKm(userLat, userLon, tour.start.lat, tour.start.lon);
                driveHours = estimateDriveHours(dist);
                driveSource = 'estimate';
            }

            if (driveHours > maxDriveHours) return null;

            return { tour, dist, driveHours, driveSource };
        });

        const driveResults = await Promise.all(drivePromises);
        toursWithDrive = driveResults.filter(r => r !== null);
    } else {
        toursWithDrive = tours.map(tour => ({
            tour,
            dist: null,
            driveHours: null,
            driveSource: null,
        }));
    }

    if (onProgress) onProgress(`${toursWithDrive.length} turer innenfor kjøreavstand`);

    // ── Steg 2: Hent skredvarsel (cachet per region, parallelt) ──
    if (onProgress) onProgress('Henter skredvarsel...');

    const uniqueRegions = [...new Set(toursWithDrive.map(r => r.tour.varsom_region_id))];
    const avalancheResults = {};

    await Promise.all(uniqueRegions.map(async (regionId) => {
        const cacheKey = `aval_${regionId}`;
        if (_avalancheCache.has(cacheKey)) {
            avalancheResults[regionId] = _avalancheCache.get(cacheKey);
        } else {
            try {
                const warnings = await fetchAvalanche(regionId);
                _avalancheCache.set(cacheKey, warnings);
                avalancheResults[regionId] = warnings;
            } catch (e) {
                console.warn(`Skred-API feilet for region ${regionId}: ${e.message}`);
                avalancheResults[regionId] = null;
            }
        }
    }));

    // ── Steg 3: Hent vær, soldata og RegObs (parallelt, cachet per område) ──
    if (onProgress) onProgress('Henter vær og soldata...');

    const results = [];

    // Grupper API-kall for å unngå duplikater
    const weatherPromises = new Map();
    const sunrisePromises = new Map();
    const regobsPromises = new Map();

    for (const item of toursWithDrive) {
        const t = item.tour;

        // Vær: cache per 0.1° koordinat
        const weatherKey = `${t.summit.lat.toFixed(1)}_${t.summit.lon.toFixed(1)}`;
        if (!weatherPromises.has(weatherKey)) {
            if (_weatherCache.has(weatherKey)) {
                weatherPromises.set(weatherKey, Promise.resolve(_weatherCache.get(weatherKey)));
            } else {
                weatherPromises.set(weatherKey, fetchWeather(t.summit.lat, t.summit.lon).then(f => {
                    _weatherCache.set(weatherKey, f);
                    return f;
                }));
            }
        }

        // Sunrise: cache per 0.2° koordinat
        const sunKey = `${(Math.round(t.summit.lat * 5) / 5).toFixed(1)}_${(Math.round(t.summit.lon * 5) / 5).toFixed(1)}_${targetDate || 'default'}`;
        if (!sunrisePromises.has(sunKey)) {
            if (_sunriseCache.has(sunKey)) {
                sunrisePromises.set(sunKey, Promise.resolve(_sunriseCache.get(sunKey)));
            } else {
                sunrisePromises.set(sunKey, fetchDaylight(t.summit.lat, t.summit.lon, targetDate).then(s => {
                    _sunriseCache.set(sunKey, s);
                    return s;
                }));
            }
        }

        // RegObs: cache per 1° koordinat
        const regKey = `${Math.round(t.summit.lat)}_${Math.round(t.summit.lon)}`;
        if (!regobsPromises.has(regKey)) {
            if (_regobsCache.has(regKey)) {
                regobsPromises.set(regKey, Promise.resolve(_regobsCache.get(regKey)));
            } else {
                regobsPromises.set(regKey, fetchRegObs(t.summit.lat, t.summit.lon).then(o => {
                    _regobsCache.set(regKey, o);
                    return o;
                }));
            }
        }
    }

    // Vent på alle API-kall
    await Promise.all([
        ...weatherPromises.values(),
        ...sunrisePromises.values(),
        ...regobsPromises.values(),
    ]);

    if (onProgress) onProgress('Beregner score...');

    // ── Steg 4: Bygg resultater ──
    for (const item of toursWithDrive) {
        const t = item.tour;

        // Hent cached data
        const weatherKey = `${t.summit.lat.toFixed(1)}_${t.summit.lon.toFixed(1)}`;
        const forecasts = _weatherCache.get(weatherKey) || null;
        const weatherEval = evaluateWeather(forecasts, targetDate);

        const avalWarnings = avalancheResults[t.varsom_region_id];
        const avalEval = evaluateAvalanche(avalWarnings, targetDate);

        const sunKey = `${(Math.round(t.summit.lat * 5) / 5).toFixed(1)}_${(Math.round(t.summit.lon * 5) / 5).toFixed(1)}_${targetDate || 'default'}`;
        const sunriseData = _sunriseCache.get(sunKey) || null;

        const regKey = `${Math.round(t.summit.lat)}_${Math.round(t.summit.lon)}`;
        const nearbyObs = _regobsCache.get(regKey) || [];

        // Total score
        const avalScore = avalEval.score;
        const weatherScore = weatherEval.score;
        const distanceScore = item.driveHours != null
            ? 100 - (item.driveHours / maxDriveHours * 30)
            : 70;

        let totalScore = (
            avalScore * 0.50 +
            weatherScore * 0.35 +
            distanceScore * 0.15
        );

        // Sikkerhetsregel: faregrad >= 4 → score maks 10
        if ((avalEval.danger_level || 0) >= 4) {
            totalScore = Math.min(totalScore, 10);
        }

        results.push({
            tour: t,
            total_score: Math.round(totalScore * 10) / 10,
            weather: weatherEval,
            avalanche: avalEval,
            distance_km: item.dist != null ? Math.round(item.dist * 10) / 10 : null,
            drive_hours: item.driveHours != null ? Math.round(item.driveHours * 10) / 10 : null,
            drive_source: item.driveSource,
            sunrise: sunriseData,
            observations: nearbyObs.slice(0, 3),
        });
    }

    // Sorter etter total score (best først)
    results.sort((a, b) => b.total_score - a.total_score);

    if (onProgress) onProgress(`Ferdig! ${results.length} turer rangert`);

    return results;
}

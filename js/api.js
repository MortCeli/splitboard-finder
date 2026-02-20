// ── Splitboard Finder — API Module ──
// Alle eksterne API-kall: vær, skredvarsel, kjøretid, soloppgang, RegObs.
// Alle API-er har Access-Control-Allow-Origin: * og kan kalles direkte fra nettleseren.

// ═══════════════════════════════════════
// Cacher (in-memory, lever i session)
// ═══════════════════════════════════════
const _weatherCache = new Map();
const _avalancheCache = new Map();
const _routeCache = new Map();
const _sunriseCache = new Map();
const _regobsCache = new Map();

// ═══════════════════════════════════════
// WEATHER — MET Norway Locationforecast 2.0
// ═══════════════════════════════════════

async function fetchWeather(lat, lon) {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const timeseries = data.properties.timeseries;
        const forecasts = [];

        for (const entry of timeseries.slice(0, 48)) {
            const instant = entry.data.instant.details;

            const forecast = {
                time: entry.time,
                temp_c: instant.air_temperature ?? null,
                wind_speed_ms: instant.wind_speed ?? null,
                wind_from_direction: instant.wind_from_direction ?? null,
                cloud_area_fraction: instant.cloud_area_fraction ?? null,
                precipitation_mm: null,
                symbol: null,
            };

            // Nedbør fra next_1_hours eller next_6_hours
            for (const period of ['next_1_hours', 'next_6_hours']) {
                if (entry.data[period]) {
                    const details = entry.data[period].details || {};
                    forecast.precipitation_mm = details.precipitation_amount ?? 0;
                    const summary = entry.data[period].summary || {};
                    forecast.symbol = summary.symbol_code ?? null;
                    break;
                }
            }

            forecasts.push(forecast);
        }

        return forecasts;
    } catch (e) {
        console.warn(`Feil ved henting av værdata: ${e.message}`);
        return null;
    }
}

function evaluateWeather(forecasts, targetDate = null) {
    if (!forecasts || !forecasts.length) {
        return { score: 0, description: 'Ingen værdata tilgjengelig', details: {} };
    }

    // Finn target date
    let target;
    if (targetDate) {
        target = targetDate.slice(0, 10); // YYYY-MM-DD
    } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        target = tomorrow.toISOString().slice(0, 10);
    }

    // Filtrer på target_date
    let dayForecasts = forecasts.filter(f => {
        const fDate = f.time.slice(0, 10);
        return fDate === target;
    });

    if (!dayForecasts.length) {
        dayForecasts = forecasts.slice(0, 12); // Fallback: neste 12 timer
    }

    // Beregn gjennomsnitt
    const n = dayForecasts.length;
    const avgWind = dayForecasts.reduce((s, f) => s + (f.wind_speed_ms || 0), 0) / n;
    const avgTemp = dayForecasts.reduce((s, f) => s + (f.temp_c || 0), 0) / n;
    const totalPrecip = dayForecasts.reduce((s, f) => s + (f.precipitation_mm || 0), 0);
    const avgClouds = dayForecasts.reduce((s, f) => s + (f.cloud_area_fraction || 0), 0) / n;

    // Scoring
    let score = 100;

    // Vind
    if (avgWind > 15) score -= 50;
    else if (avgWind > 10) score -= 30;
    else if (avgWind > 5) score -= 10;

    // Nedbør
    if (totalPrecip > 15) score -= 30;
    else if (totalPrecip > 5) score -= 15;
    else if (totalPrecip > 1) score -= 5;

    // Temperatur
    if (avgTemp > 2) score -= 20;
    else if (avgTemp > 0) score -= 10;
    else if (avgTemp < -15) score -= 10;

    // Skydekke
    if (avgClouds > 90) score -= 15;
    else if (avgClouds > 70) score -= 5;

    score = Math.max(0, Math.min(100, score));

    // Beskrivelse
    let desc;
    if (score >= 80) desc = '\u{1F7E2} Utmerkede forhold';
    else if (score >= 60) desc = '\u{1F7E1} Gode forhold';
    else if (score >= 40) desc = '\u{1F7E0} Moderate forhold';
    else desc = '\u{1F534} Dårlige forhold';

    return {
        score,
        description: desc,
        details: {
            avg_wind_ms: Math.round(avgWind * 10) / 10,
            avg_temp_c: Math.round(avgTemp * 10) / 10,
            total_precip_mm: Math.round(totalPrecip * 10) / 10,
            avg_cloud_pct: Math.round(avgClouds),
        },
    };
}

// ═══════════════════════════════════════
// AVALANCHE — Varsom / NVE API
// ═══════════════════════════════════════

const DANGER_LEVELS = {
    1: { name: 'Liten', color: '#50B848', emoji: '\u{1F7E2}' },
    2: { name: 'Moderat', color: '#FFF200', emoji: '\u{1F7E1}' },
    3: { name: 'Betydelig', color: '#F5A623', emoji: '\u{1F7E0}' },
    4: { name: 'Stor', color: '#D0021B', emoji: '\u{1F534}' },
    5: { name: 'Meget stor', color: '#1A1A1A', emoji: '\u26AB' },
};

async function fetchAvalanche(regionId, daysAhead = 2) {
    const now = new Date();
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

    const url = `https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api/AvalancheWarningByRegion/Simple/${regionId}/1/${start}/${end}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const warnings = [];
        for (const w of data) {
            const dangerLevel = parseInt(w.DangerLevel || 0, 10);
            const levelInfo = DANGER_LEVELS[dangerLevel] || { name: 'Ukjent', color: '#999', emoji: '\u2753' };

            warnings.push({
                date: (w.ValidFrom || '').slice(0, 10),
                danger_level: dangerLevel,
                danger_name: levelInfo.name,
                danger_color: levelInfo.color,
                danger_emoji: levelInfo.emoji,
                region_name: w.RegionName || '',
                region_id: w.RegionId || regionId,
                main_text: w.MainText || '',
            });
        }

        return warnings;
    } catch (e) {
        console.warn(`Feil ved henting av skredvarsel: ${e.message}`);
        return null;
    }
}

function evaluateAvalanche(warnings, targetDate = null) {
    if (!warnings || !warnings.length) {
        return {
            score: 0,
            description: 'Ingen skredvarsel tilgjengelig',
            danger_level: null,
            danger_name: '',
            region_name: '',
            main_text: '',
        };
    }

    // Finn varsel for target_date
    let target;
    if (targetDate) {
        target = targetDate.slice(0, 10);
    } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        target = tomorrow.toISOString().slice(0, 10);
    }

    let dayWarning = warnings.find(w => w.date === target);
    if (!dayWarning) dayWarning = warnings[0];

    const danger = dayWarning.danger_level;

    // Scoring
    const scoreMap = { 1: 100, 2: 75, 3: 35, 4: 5, 5: 0 };
    const score = scoreMap[danger] ?? 0;

    let desc;
    if (danger <= 2) {
        desc = `${dayWarning.danger_emoji} Faregrad ${danger} (${dayWarning.danger_name}) \u2013 gode forhold for tur`;
    } else if (danger === 3) {
        desc = `${dayWarning.danger_emoji} Faregrad ${danger} (${dayWarning.danger_name}) \u2013 vær forsiktig, velg trygge ruter`;
    } else {
        desc = `${dayWarning.danger_emoji} Faregrad ${danger} (${dayWarning.danger_name}) \u2013 tur frarådes`;
    }

    return {
        score,
        description: desc,
        danger_level: danger,
        danger_name: dayWarning.danger_name,
        region_name: dayWarning.region_name,
        main_text: dayWarning.main_text,
    };
}

// ═══════════════════════════════════════
// ROUTING — OSRM
// ═══════════════════════════════════════

async function fetchDriveTime(startLat, startLon, endLat, endLon) {
    // Cache med avrundede koordinater (2 desimaler)
    const key = `${startLat.toFixed(2)},${startLon.toFixed(2)};${endLat.toFixed(2)},${endLon.toFixed(2)}`;
    if (_routeCache.has(key)) return _routeCache.get(key);

    // OSRM bruker lon,lat rekkefølge!
    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=false`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
            return null;
        }

        const route = data.routes[0];
        const distanceKm = Math.round(route.distance / 100) / 10; // 1 desimal
        const durationHours = Math.round(route.duration / 36) / 100; // 2 desimaler

        const result = { distance_km: distanceKm, duration_hours: durationHours };
        _routeCache.set(key, result);
        return result;
    } catch (e) {
        console.warn(`OSRM-feil: ${e.message}`);
        return null;
    }
}

// ═══════════════════════════════════════
// SUNRISE — MET Norway Sunrise API 3.0
// ═══════════════════════════════════════

async function fetchDaylight(lat, lon, date = null) {
    if (!date) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        date = tomorrow.toISOString().slice(0, 10);
    }

    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${date}`;
    if (_sunriseCache.has(key)) return _sunriseCache.get(key);

    const url = `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&date=${date}&offset=+01:00`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const props = data.properties || {};
        const sunriseData = props.sunrise || {};
        const sunsetData = props.sunset || {};

        const sunriseTime = sunriseData.time || '';
        const sunsetTime = sunsetData.time || '';

        // Beregn dagslys-timer
        let daylightHours = null;
        if (sunriseTime && sunsetTime) {
            try {
                const sr = new Date(sunriseTime);
                const ss = new Date(sunsetTime);
                daylightHours = Math.round((ss - sr) / 360000) / 10; // 1 desimal
            } catch (_) {}
        }

        // Formater klokkeslett (HH:MM)
        const sunriseFmt = sunriseTime.length > 16 ? sunriseTime.slice(11, 16) : '\u2014';
        const sunsetFmt = sunsetTime.length > 16 ? sunsetTime.slice(11, 16) : '\u2014';

        const result = {
            sunrise: sunriseFmt,
            sunset: sunsetFmt,
            daylight_hours: daylightHours,
        };

        _sunriseCache.set(key, result);
        return result;
    } catch (e) {
        console.warn(`Sunrise API-feil: ${e.message}`);
        return null;
    }
}

// ═══════════════════════════════════════
// REGOBS — Skredobservasjoner
// ═══════════════════════════════════════

async function fetchRegObs(lat, lon, radiusKm = 20, days = 7) {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)},${days}`;
    if (_regobsCache.has(key)) return _regobsCache.get(key);

    const now = new Date();
    const fromDate = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);

    const body = {
        FromDate: fromDate,
        ToDate: toDate,
        Latitude: lat,
        Longitude: lon,
        Radius: radiusKm * 1000, // API bruker meter
        NumberOfRecords: 10,
        GeoHazardTID: 10, // 10 = snø/skred
    };

    try {
        const resp = await fetch('https://api.regobs.no/v5/Search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const observations = [];
        for (const obs of data) {
            const reg = obs.Registrations || [];
            const summaries = [];
            for (const r of reg) {
                const name = r.RegistrationName || '';
                if (name) summaries.push(name);
            }

            observations.push({
                date: (obs.DtObsTime || '').slice(0, 10),
                observer: obs.ObserverNickName || obs.CompetenceLevelName || '',
                types: summaries,
                latitude: (obs.ObsLocation || {}).Latitude,
                longitude: (obs.ObsLocation || {}).Longitude,
                location_name: (obs.ObsLocation || {}).LocationName || '',
            });
        }

        _regobsCache.set(key, observations);
        return observations;
    } catch (e) {
        console.warn(`RegObs API-feil: ${e.message}`);
        return [];
    }
}

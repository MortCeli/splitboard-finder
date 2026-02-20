// ── Toppturfinner — GeoJSON Tour Loader ──
// Leser turer.geojson og bygger TOURS-array.
// Start = laveste Z-punkt, topp = høyeste Z-punkt i linja.
// Nedkjøringsalternativer grupperes med hovedruta via Rutenavn.

let TOURS = [];
let GEOJSON_RAW = null;

// Finn property-verdi uavhengig av encoding-problemer med norske tegn
function getProp(props, ...keys) {
    for (const key of keys) {
        if (props[key] !== undefined) return props[key];
    }
    // Fallback: søk etter delvis match
    for (const key of Object.keys(props)) {
        for (const wanted of keys) {
            if (key.toLowerCase().includes(wanted.toLowerCase())) return props[key];
        }
    }
    return null;
}

function isNedkjoring(props) {
    const val = getProp(props, 'Nedkjøringsalternativ', 'Nedkjoringsalternativ', 'nedkjoring');
    return val === true || val === 'true' || val === 'sann' || val === 1;
}

async function loadTours() {
    // Last GeoJSON og vinterstengte veier parallelt
    const [geoResp] = await Promise.all([
        fetch('data/turer.geojson'),
        fetchWinterClosedRoads().catch(e => {
            console.warn('Kunne ikke laste vinterstengte veier:', e);
        }),
    ]);

    if (!geoResp.ok) throw new Error('Kunne ikke laste turer.geojson');
    GEOJSON_RAW = await geoResp.json();

    const mainRoutes = new Map();   // Rutenavn -> tour object
    const altRoutes = [];           // nedkjøringsalternativer

    for (const feature of GEOJSON_RAW.features) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates; // [lon, lat, z]

        if (isNedkjoring(props)) {
            altRoutes.push(feature);
            continue;
        }

        // Finn laveste og høyeste Z-punkt
        let minZ = Infinity, maxZ = -Infinity;
        let startCoord = null, summitCoord = null;

        for (const c of coords) {
            const z = c[2] || 0;
            if (z < minZ) { minZ = z; startCoord = c; }
            if (z > maxZ) { maxZ = z; summitCoord = c; }
        }

        const name = props.Rutenavn || '';

        // Sjekk om startpunkt er nær en vinterstengt vei
        const winterCheck = checkWinterClosure(startCoord[1], startCoord[0]);

        const tour = {
            id: props.fid || name,
            name: name,
            region: props.region || '',
            varsom_region_id: props.varsom_region_id || 3023,
            kast: props.KAST || null,
            indeks: props.Indeks || null,
            start: {
                lat: startCoord[1],
                lon: startCoord[0],
                name: props.start_name || '',
            },
            summit: {
                lat: summitCoord[1],
                lon: summitCoord[0],
                elevation: Math.round(maxZ),
            },
            vertical_gain: Math.round(maxZ - minZ),
            winterClosed: winterCheck.closed,
            // Rutelinje for kart (alle punkter som [lat, lon] for Leaflet)
            routeCoords: coords.map(c => [c[1], c[0]]),
            altRoutes: [], // fylles inn under
        };

        mainRoutes.set(name, tour);
        TOURS.push(tour);
    }

    // Koble nedkjøringsalternativer til hovedruter
    for (const feature of altRoutes) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        const name = props.Rutenavn || '';

        const mainTour = mainRoutes.get(name);
        if (mainTour) {
            mainTour.altRoutes.push({
                routeCoords: coords.map(c => [c[1], c[0]]),
                kast: props.KAST || null,
            });
        }
    }

    const winterCount = TOURS.filter(t => t.winterClosed).length;
    console.log(`Lastet ${TOURS.length} turer fra GeoJSON (${altRoutes.length} nedkjoringsalt., ${winterCount} med vinterstengt vei)`);
    return TOURS;
}

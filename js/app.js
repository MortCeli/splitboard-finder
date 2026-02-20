// ── Toppturfinner — Frontend ──
// Bruker tours-loader.js, api.js og tour-finder.js (lastes før denne filen)

// Map setup: center on Sunnmørsalpene / Jotunheimen
const map = L.map('map', {
    zoomControl: false,
}).setView([61.8, 7.5], 8);

L.control.zoom({ position: 'topright' }).addTo(map);

// Kartverket topografisk kart
L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://kartverket.no">Kartverket</a>',
}).addTo(map);

// ── NVE Bratthet + utløpssoner ──
const nveBratthetAlle = L.tileLayer(
    'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/WMTS/tile/1.0.0/wmts_Bratthet_med_utlop_2024/default/GoogleMapsCompatible/{z}/{y}/{x}.png', {
    opacity: 0.55,
    maxZoom: 18,
    attribution: '&copy; <a href="https://nve.no">NVE</a> Bratthet/utl\u00f8p',
});

const nveWmsUrl = 'https://gis3.nve.no/arcgis/services/wmts/Bratthet_med_utlop_2024/MapServer/WMSServer';

const nveBratthet = L.tileLayer.wms(nveWmsUrl, {
    layers: '9', format: 'image/png', transparent: true, opacity: 0.55,
    attribution: '&copy; <a href="https://nve.no">NVE</a>',
});
const nveUtlopKort = L.tileLayer.wms(nveWmsUrl, {
    layers: '8', format: 'image/png', transparent: true, opacity: 0.45,
    attribution: '&copy; <a href="https://nve.no">NVE</a>',
});
const nveUtlopMiddels = L.tileLayer.wms(nveWmsUrl, {
    layers: '7', format: 'image/png', transparent: true, opacity: 0.35,
    attribution: '&copy; <a href="https://nve.no">NVE</a>',
});
const nveUtlopLang = L.tileLayer.wms(nveWmsUrl, {
    layers: '6', format: 'image/png', transparent: true, opacity: 0.30,
    attribution: '&copy; <a href="https://nve.no">NVE</a>',
});

const overlays = {
    'Bratthet + utl\u00f8p (alle)': nveBratthetAlle,
    'Bratthet (>30\u00b0)': nveBratthet,
    'Utl\u00f8p kort': nveUtlopKort,
    'Utl\u00f8p middels': nveUtlopMiddels,
    'Utl\u00f8p lang': nveUtlopLang,
};

L.control.layers(null, overlays, {
    position: 'topright',
    collapsed: true,
}).addTo(map);

// State
let userLat = null;
let userLon = null;
let mapLayers = [];      // alt som legges på kartet (markers, linjer)
let userMarker = null;
let tourResults = [];
let currentSort = 'score';

// ── KAST-farger ──
const KAST_COLORS = {
    1: '#4ade80',  // grønn
    2: '#facc15',  // gul
    3: '#f87171',  // rød
};

const KAST_LABELS = {
    1: 'KAST 1 (enkel)',
    2: 'KAST 2 (middels)',
    3: 'KAST 3 (krevende)',
};

function kastColor(kast) {
    return KAST_COLORS[kast] || '#5ba4f5';
}

// ── Custom marker icons ──
function createIcon(color) {
    return L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            width: 14px; height: 14px;
            background: ${color};
            border: 2.5px solid #fff;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10],
    });
}

const icons = {
    great: createIcon('#4ade80'),
    good: createIcon('#facc15'),
    ok: createIcon('#fb923c'),
    bad: createIcon('#f87171'),
    default: createIcon('#5ba4f5'),
    user: L.divIcon({
        className: '',
        html: `<div class="user-marker-dot"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    }),
};

function scoreIcon(score) {
    if (score >= 75) return icons.great;
    if (score >= 55) return icons.good;
    if (score >= 35) return icons.ok;
    return icons.bad;
}

function scoreClass(score) {
    if (score >= 75) return 'score-great';
    if (score >= 55) return 'score-good';
    if (score >= 35) return 'score-ok';
    return 'score-bad';
}

// ── Geolocation ──
function getLocation() {
    const status = document.getElementById('locationStatus');
    if ('geolocation' in navigator) {
        status.textContent = '\u{1F4CD} Henter posisjon...';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLat = pos.coords.latitude;
                userLon = pos.coords.longitude;
                status.textContent = `\u{1F4CD} Posisjon funnet (${userLat.toFixed(2)}, ${userLon.toFixed(2)})`;
                userMarker = L.marker([userLat, userLon], { icon: icons.user })
                    .addTo(map)
                    .bindPopup('Din posisjon');
            },
            (err) => {
                status.textContent = '\u{1F4CD} Posisjon ikke tilgjengelig \u2014 viser alle turer';
            },
            { enableHighAccuracy: false, timeout: 8000 }
        );
    } else {
        status.textContent = '\u{1F4CD} Geolokasjon st\u00f8ttes ikke';
    }
}

// ── Clear map layers ──
function clearMapLayers() {
    mapLayers.forEach(m => map.removeLayer(m));
    mapLayers = [];
}

// ── Tegn tur-rute på kartet ──
function drawRoute(tour, color, weight, dashArray) {
    if (!tour.routeCoords || tour.routeCoords.length < 2) return;

    // Hovedrute
    const line = L.polyline(tour.routeCoords, {
        color: color,
        weight: weight,
        opacity: 0.8,
        dashArray: dashArray || null,
    }).addTo(map);
    mapLayers.push(line);

    // Nedkjøringsalternativer (stiplet)
    if (tour.altRoutes) {
        for (const alt of tour.altRoutes) {
            const altLine = L.polyline(alt.routeCoords, {
                color: kastColor(alt.kast || tour.kast),
                weight: weight - 1,
                opacity: 0.6,
                dashArray: '8,6',
            }).addTo(map);
            mapLayers.push(altLine);
        }
    }
}

// ── Sorting ──
function sortResults(results, key) {
    const sorted = [...results];
    switch (key) {
        case 'score':
            sorted.sort((a, b) => b.total_score - a.total_score);
            break;
        case 'nearest':
            sorted.sort((a, b) => (a.drive_hours || 999) - (b.drive_hours || 999));
            break;
        case 'elevation':
            sorted.sort((a, b) => b.tour.summit.elevation - a.tour.summit.elevation);
            break;
        case 'gain':
            sorted.sort((a, b) => b.tour.vertical_gain - a.tour.vertical_gain);
            break;
        case 'danger':
            sorted.sort((a, b) => (a.avalanche.danger_level || 99) - (b.avalanche.danger_level || 99));
            break;
        case 'kast':
            sorted.sort((a, b) => (a.tour.kast || 1) - (b.tour.kast || 1));
            break;
    }
    return sorted;
}

// ── Render results ──
function renderResults() {
    clearMapLayers();

    const list = document.getElementById('resultsList');
    const count = document.getElementById('resultsCount');
    const sorted = sortResults(tourResults, currentSort);

    if (!sorted.length) {
        list.innerHTML = '<div class="loading-state">Ingen turer funnet med valgte filtre</div>';
        count.textContent = '0 turer';
        return;
    }

    count.textContent = `${sorted.length} turer`;
    list.innerHTML = '';

    const bounds = [];

    sorted.forEach((r) => {
        const tour = r.tour;
        const score = r.total_score;
        const kColor = kastColor(tour.kast);

        // Tegn rute på kartet
        drawRoute(tour, kColor, 3);

        // Topp-markør
        const marker = L.marker(
            [tour.summit.lat, tour.summit.lon],
            { icon: scoreIcon(score) }
        ).addTo(map);

        const altCount = tour.altRoutes ? tour.altRoutes.length : 0;
        const popupHtml = `
            <div class="popup-title">${tour.name}</div>
            <span class="popup-badge" style="background:${(r.avalanche.danger_level || 0) <= 2 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}">
                ${r.avalanche.description || 'Ingen skreddata'}
            </span>
            <div class="popup-detail">
                \u{1F3D4} ${tour.summit.elevation}m &nbsp; \u2197 ${tour.vertical_gain}m &nbsp;
                <span style="color:${kColor}">\u25CF KAST ${tour.kast || '?'}</span>
            </div>
            <div class="popup-detail">${r.weather.description || ''}</div>
            ${r.sunrise ? `<div class="popup-detail">\u2600\uFE0F ${r.sunrise.sunrise}\u2013${r.sunrise.sunset} (${r.sunrise.daylight_hours}t)</div>` : ''}
            ${r.drive_hours ? `<div class="popup-detail">\u{1F697} ~${r.drive_hours}t (${r.distance_km} km)</div>` : ''}
            ${altCount ? `<div class="popup-detail">${altCount} nedkj\u00f8ringsalternativ (stiplet)</div>` : ''}
        `;

        marker.bindPopup(popupHtml, { maxWidth: 280 });
        mapLayers.push(marker);
        bounds.push([tour.summit.lat, tour.summit.lon]);

        // Start-markør (parkering)
        const startMarker = L.circleMarker(
            [tour.start.lat, tour.start.lon],
            { radius: 5, color: '#5ba4f5', fillColor: '#5ba4f5', fillOpacity: 0.7, weight: 1 }
        ).addTo(map).bindPopup(`\u{1F17F} ${tour.start.name}`);
        mapLayers.push(startMarker);

        // Hjelpetekster
        let driveText = '';
        if (r.drive_hours) {
            const src = r.drive_source === 'osrm' ? 'OSRM' : 'estimat';
            driveText = `\u{1F697} ${r.drive_hours}t (${r.distance_km} km, ${src})`;
        }

        let sunText = '';
        if (r.sunrise) {
            sunText = `\u2600\uFE0F ${r.sunrise.sunrise}\u2013${r.sunrise.sunset} (${r.sunrise.daylight_hours}t dagslys)`;
        }

        // RegObs-observasjoner
        let obsHtml = '';
        if (r.observations && r.observations.length) {
            obsHtml = '<div class="tour-detail-row"><span class="tour-detail-label">Observasjoner (RegObs):</span></div>';
            r.observations.forEach(obs => {
                const types = obs.types.join(', ') || 'Observasjon';
                obsHtml += `<div class="tour-detail-row tour-obs-item">${obs.date} \u2014 ${types}${obs.location_name ? ' (' + obs.location_name + ')' : ''}</div>`;
            });
        }

        // Result card
        const card = document.createElement('div');
        card.className = 'tour-card';
        card.dataset.tourId = tour.id;
        card.innerHTML = `
            <div class="tour-card-header">
                <span class="tour-name">${tour.name}</span>
                <span class="tour-score ${scoreClass(score)}">${score}</span>
                <button class="map-btn" title="Vis p\u00e5 kart">\u{1F5FA}</button>
            </div>
            <div class="tour-meta">
                <span>\u{1F3D4} ${tour.summit.elevation}m</span>
                <span>\u2197 ${tour.vertical_gain}m</span>
                <span style="color:${kColor}">\u25CF KAST ${tour.kast || '?'}</span>
                <span>\u{1F4CD} ${tour.region}</span>
            </div>
            <div class="tour-info-row">${r.avalanche.description || 'Ingen skreddata'}</div>
            <div class="tour-info-row">${r.weather.description || 'Ingen v\u00e6rdata'}</div>
            ${sunText ? `<div class="tour-info-row">${sunText}</div>` : ''}
            ${driveText ? `<div class="tour-info-row">${driveText}</div>` : ''}
            <div class="tour-expand-hint">Trykk for detaljer</div>
            <div class="tour-detail">
                <div class="tour-detail-row"><span class="tour-detail-label">KAST:</span> ${KAST_LABELS[tour.kast] || 'Ukjent'}</div>
                <div class="tour-detail-row"><span class="tour-detail-label">Parkering:</span> ${tour.start.name} (${tour.start.lat.toFixed(4)}, ${tour.start.lon.toFixed(4)})</div>
                <div class="tour-detail-row"><span class="tour-detail-label">Topp:</span> ${tour.summit.elevation}m (${tour.summit.lat.toFixed(4)}, ${tour.summit.lon.toFixed(4)})</div>
                ${tour.altRoutes && tour.altRoutes.length ? `<div class="tour-detail-row"><span class="tour-detail-label">Nedkj\u00f8ring:</span> ${tour.altRoutes.length} alternativ(er) vist p\u00e5 kart (stiplet)</div>` : ''}
                ${r.avalanche.main_text ? `<div class="tour-detail-row"><span class="tour-detail-label">Skredvarsel:</span> ${r.avalanche.main_text}</div>` : ''}
                ${r.weather.details ? `<div class="tour-detail-row"><span class="tour-detail-label">V\u00e6r detaljer:</span> ${r.weather.details.avg_temp_c}\u00b0C, vind ${r.weather.details.avg_wind_ms} m/s, nedb\u00f8r ${r.weather.details.total_precip_mm} mm</div>` : ''}
                ${obsHtml}
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.map-btn')) return;
            card.classList.toggle('expanded');
        });

        card.querySelector('.map-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tour-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            // Zoom til hele ruta
            if (tour.routeCoords && tour.routeCoords.length > 1) {
                map.fitBounds(L.latLngBounds(tour.routeCoords), { padding: [40, 40], maxZoom: 14 });
            } else {
                map.setView([tour.summit.lat, tour.summit.lon], 13);
            }
            marker.openPopup();
        });

        list.appendChild(card);
    });

    if (bounds.length) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// ── Show results ──
function showResults(results) {
    tourResults = results;
    renderResults();
}

// ── Search ──
async function searchTours() {
    const btn = document.getElementById('searchBtn');
    const list = document.getElementById('resultsList');

    btn.classList.add('loading');
    btn.textContent = 'Henter data...';
    list.innerHTML = Array(3).fill(`
        <div class="skeleton-card">
            <div class="skeleton-line medium"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-line"></div>
        </div>
    `).join('');

    try {
        const results = await findTours({
            userLat,
            userLon,
            maxDriveHours: parseFloat(document.getElementById('driveFilter').value),
            targetDate: document.getElementById('dateFilter').value || null,
            region: document.getElementById('regionFilter').value || null,
            maxKast: parseInt(document.getElementById('kastFilter').value) || null,
            onProgress: (msg) => {
                btn.textContent = msg;
            },
        });
        showResults(results);
    } catch (e) {
        list.innerHTML = `<div class="loading-state">Feil: ${e.message}</div>`;
        console.error(e);
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = '<span>\u{1F50D}</span> Finn turer';
        if (window.innerWidth < 768) {
            document.getElementById('filterPanel').classList.add('collapsed');
        }
    }
}

// ── Vis alle turer på kartet ved oppstart ──
function showAllToursOnMap() {
    clearMapLayers();
    const bounds = [];

    TOURS.forEach(tour => {
        const kColor = kastColor(tour.kast);

        // Tegn rute
        drawRoute(tour, kColor, 2);

        // Topp-markør
        const m = L.marker(
            [tour.summit.lat, tour.summit.lon],
            { icon: createIcon(kColor) }
        ).addTo(map).bindPopup(`
            <div class="popup-title">${tour.name}</div>
            <div class="popup-detail">
                \u{1F3D4} ${tour.summit.elevation}m &nbsp; \u2197 ${tour.vertical_gain}m &nbsp;
                <span style="color:${kColor}">\u25CF KAST ${tour.kast || '?'}</span>
            </div>
            <div class="popup-detail">\u{1F17F} ${tour.start.name}</div>
            <div class="popup-detail" style="margin-top:6px; color: var(--accent);">Trykk "Finn turer" for v\u00e6r og skreddata</div>
        `);
        mapLayers.push(m);
        bounds.push([tour.summit.lat, tour.summit.lon]);
    });

    if (bounds.length) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// ── Event listeners ──
document.getElementById('searchBtn').addEventListener('click', searchTours);

document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    if (tourResults.length) renderResults();
});

document.getElementById('filterToggle').addEventListener('click', () => {
    document.getElementById('filterPanel').classList.toggle('collapsed');
});

document.getElementById('resultsHeader').addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
    if (window.innerWidth < 768) {
        document.getElementById('resultsPanel').classList.toggle('expanded-results');
    }
});

// Set default date to tomorrow
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
document.getElementById('dateFilter').value = tomorrow.toISOString().split('T')[0];

// ── PWA Install Prompt ──
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
});

function showInstallButton() {
    const header = document.querySelector('.app-header');
    if (header.querySelector('.install-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'install-btn';
    btn.innerHTML = 'Installer app';
    btn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const result = await deferredPrompt.userChoice;
            deferredPrompt = null;
            btn.remove();
        }
    });
    header.appendChild(btn);
}

if (window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
}

// ── Init: Last turer fra GeoJSON, deretter vis på kart ──
getLocation();

loadTours().then(() => {
    showAllToursOnMap();
    // Oppdater region-filter med faktiske regioner fra data
    const regions = [...new Set(TOURS.map(t => t.region))].sort();
    const regionSelect = document.getElementById('regionFilter');
    regions.forEach(r => {
        if (r && !regionSelect.querySelector(`option[value="${r}"]`)) {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            regionSelect.appendChild(opt);
        }
    });
}).catch(err => {
    console.error('Feil ved lasting av turer:', err);
    document.getElementById('resultsList').innerHTML =
        '<div class="loading-state">Kunne ikke laste turer. Sjekk at data/turer.geojson finnes.</div>';
});

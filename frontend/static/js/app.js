// ── Splitboard Finder — Frontend ──

// Map setup: center on Hemsedal/Jotunheimen area
const map = L.map('map', {
    zoomControl: false,
}).setView([61.15, 8.30], 9);

L.control.zoom({ position: 'topright' }).addTo(map);

// Kartverket topografisk kart — perfekt for fjellbruk
L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://kartverket.no">Kartverket</a>',
}).addTo(map);

// State
let userLat = null;
let userLon = null;
let markers = [];
let userMarker = null;
let tourResults = [];
let currentSort = 'score';

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
        status.textContent = '📍 Henter posisjon...';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLat = pos.coords.latitude;
                userLon = pos.coords.longitude;
                status.textContent = `📍 Posisjon funnet (${userLat.toFixed(2)}, ${userLon.toFixed(2)})`;
                userMarker = L.marker([userLat, userLon], { icon: icons.user })
                    .addTo(map)
                    .bindPopup('Din posisjon');
            },
            (err) => {
                status.textContent = '📍 Posisjon ikke tilgjengelig — viser alle turer';
            },
            { enableHighAccuracy: false, timeout: 8000 }
        );
    } else {
        status.textContent = '📍 Geolokasjon støttes ikke';
    }
}

// ── Clear markers ──
function clearMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
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
    }
    return sorted;
}

// ── Render results (bruker lagret tourResults) ──
function renderResults() {
    clearMarkers();

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

        // Map marker at summit
        const marker = L.marker(
            [tour.summit.lat, tour.summit.lon],
            { icon: scoreIcon(score) }
        ).addTo(map);

        const popupHtml = `
            <div class="popup-title">${tour.name}</div>
            <span class="popup-badge" style="background:${(r.avalanche.danger_level || 0) <= 2 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}">
                ${r.avalanche.description || 'Ingen skreddata'}
            </span>
            <div class="popup-detail">
                🏔 ${tour.summit.elevation}m &nbsp; ↗ ${tour.vertical_gain}m &nbsp; ⛰ ${tour.slope_avg_deg}°
            </div>
            <div class="popup-detail">${r.weather.description || ''}</div>
            ${r.sunrise ? `<div class="popup-detail">☀️ ${r.sunrise.sunrise}–${r.sunrise.sunset} (${r.sunrise.daylight_hours}t)</div>` : ''}
            ${r.drive_hours ? `<div class="popup-detail">🚗 ~${r.drive_hours}t (${r.distance_km} km)</div>` : ''}
            <div class="popup-detail" style="margin-top:6px;">${tour.description}</div>
        `;

        marker.bindPopup(popupHtml, { maxWidth: 280 });
        markers.push(marker);
        bounds.push([tour.summit.lat, tour.summit.lon]);

        // Start marker (parking)
        const startMarker = L.circleMarker(
            [tour.start.lat, tour.start.lon],
            { radius: 4, color: '#5ba4f5', fillColor: '#5ba4f5', fillOpacity: 0.6, weight: 1 }
        ).addTo(map).bindPopup(`🅿 ${tour.start.name}`);
        markers.push(startMarker);

        // Line from start to summit
        const line = L.polyline(
            [[tour.start.lat, tour.start.lon], [tour.summit.lat, tour.summit.lon]],
            { color: 'rgba(91,164,245,0.35)', weight: 2, dashArray: '6,4' }
        ).addTo(map);
        markers.push(line);

        // Hjelpetekster
        let driveText = '';
        if (r.drive_hours) {
            const src = r.drive_source === 'osrm' ? 'OSRM' : 'estimat';
            driveText = `🚗 ${r.drive_hours}t (${r.distance_km} km, ${src})`;
        }

        let sunText = '';
        if (r.sunrise) {
            sunText = `☀️ ${r.sunrise.sunrise}–${r.sunrise.sunset} (${r.sunrise.daylight_hours}t dagslys)`;
        }

        // RegObs-observasjoner for detalj-seksjonen
        let obsHtml = '';
        if (r.observations && r.observations.length) {
            obsHtml = '<div class="tour-detail-row"><span class="tour-detail-label">Observasjoner (RegObs):</span></div>';
            r.observations.forEach(obs => {
                const types = obs.types.join(', ') || 'Observasjon';
                obsHtml += `<div class="tour-detail-row tour-obs-item">${obs.date} — ${types}${obs.location_name ? ' (' + obs.location_name + ')' : ''}</div>`;
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
                <button class="map-btn" title="Vis på kart">🗺</button>
            </div>
            <div class="tour-meta">
                <span>🏔 ${tour.summit.elevation}m</span>
                <span>↗ ${tour.vertical_gain}m</span>
                <span>⛰ ${tour.slope_avg_deg}°</span>
                <span>📍 ${tour.region}</span>
            </div>
            <div class="tour-info-row">${r.avalanche.description || 'Ingen skreddata'}</div>
            <div class="tour-info-row">${r.weather.description || 'Ingen værdata'}</div>
            ${sunText ? `<div class="tour-info-row">${sunText}</div>` : ''}
            ${driveText ? `<div class="tour-info-row">${driveText}</div>` : ''}
            <div class="tour-expand-hint">Trykk for detaljer</div>
            <div class="tour-detail">
                <div class="tour-detail-row">${tour.description}</div>
                <div class="tour-detail-row"><span class="tour-detail-label">Vanskelighet:</span> ${tour.difficulty}</div>
                <div class="tour-detail-row"><span class="tour-detail-label">Himmelretning:</span> ${tour.aspect}</div>
                <div class="tour-detail-row"><span class="tour-detail-label">Parkering:</span> ${tour.start.name}</div>
                ${r.avalanche.main_text ? `<div class="tour-detail-row"><span class="tour-detail-label">Skredvarsel:</span> ${r.avalanche.main_text}</div>` : ''}
                ${r.weather.details ? `<div class="tour-detail-row"><span class="tour-detail-label">Vær detaljer:</span> ${r.weather.details.avg_temp_c}°C, vind ${r.weather.details.avg_wind_ms} m/s, nedbør ${r.weather.details.total_precip_mm} mm</div>` : ''}
                ${obsHtml}
            </div>
        `;

        // Klikk på kortet → expand/collapse detaljer
        card.addEventListener('click', (e) => {
            // Ikke toggle hvis man klikket kart-knappen
            if (e.target.closest('.map-btn')) return;
            card.classList.toggle('expanded');
        });

        // Kart-knapp → pan til topp
        card.querySelector('.map-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tour-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            map.setView([tour.summit.lat, tour.summit.lon], 12);
            marker.openPopup();
        });

        list.appendChild(card);
    });

    // Fit map to results
    if (bounds.length) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// ── Show results (lagrer data + renderer) ──
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

    const params = new URLSearchParams();
    if (userLat && userLon) {
        params.set('lat', userLat);
        params.set('lon', userLon);
    }
    params.set('max_hours', document.getElementById('driveFilter').value);
    params.set('min_slope', document.getElementById('minSlope').value);
    params.set('max_slope', document.getElementById('maxSlope').value);

    const date = document.getElementById('dateFilter').value;
    if (date) params.set('date', date);

    const region = document.getElementById('regionFilter').value;
    if (region) params.set('region', region);

    const diff = document.getElementById('diffFilter').value;
    if (diff) params.set('difficulty', diff);

    try {
        const resp = await fetch(`/api/tours?${params}`);
        const data = await resp.json();
        showResults(data);
    } catch (e) {
        list.innerHTML = `<div class="loading-state">Feil: ${e.message}</div>`;
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = '<span>🔍</span> Finn turer';
        // Auto-collapse filtre etter søk på mobil
        if (window.innerWidth < 768) {
            document.getElementById('filterPanel').classList.add('collapsed');
        }
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

// Results-panel expand/collapse ved trykk på header (mobil)
document.getElementById('resultsHeader').addEventListener('click', (e) => {
    if (e.target.closest('select')) return; // Ikke toggle ved sortering
    if (window.innerWidth < 768) {
        document.getElementById('resultsPanel').classList.toggle('expanded-results');
    }
});

// Slope range labels
['minSlope', 'maxSlope'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        const min = document.getElementById('minSlope').value;
        const max = document.getElementById('maxSlope').value;
        document.getElementById('slopeLabel').textContent = `${min}° – ${max}°`;
    });
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

// Detect standalone mode (allerede installert)
if (window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
}

// ── Init ──
getLocation();

// Load all tours on map initially (without weather/avalanche data)
fetch('/api/tours/all')
    .then(r => r.json())
    .then(tours => {
        tours.forEach(tour => {
            const m = L.marker(
                [tour.summit.lat, tour.summit.lon],
                { icon: icons.default }
            ).addTo(map).bindPopup(`
                <div class="popup-title">${tour.name}</div>
                <div class="popup-detail">🏔 ${tour.summit.elevation}m &nbsp; ↗ ${tour.vertical_gain}m</div>
                <div class="popup-detail">${tour.description}</div>
                <div class="popup-detail" style="margin-top:6px; color: var(--accent);">Trykk "Finn turer" for vær og skreddata</div>
            `);
            markers.push(m);
        });
    });

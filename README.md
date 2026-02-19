# 🏔️ Splitboard Tour Finder — Hemsedal & Jotunheimen

En web-app (PWA) som foreslår splitboard-/randonée-turer basert på terreng, vær, skredvarsel og brukerens lokasjon.

## Datakilder

| Data | Kilde | API |
|------|-------|-----|
| Høydemodell (DTM10) | Kartverket / hoydedata.no | WCS / GeoTIFF nedlasting |
| Kart & veier | OpenStreetMap | Overpass API |
| Vær | MET Norway | api.met.no (Locationforecast) |
| Skredvarsel | Varsom / NVE | api.varsom.no |
| Kjøretid | OSRM | router.project-osrm.org |

## Arkitektur

```
Backend (Python/Flask)
├── modules/
│   ├── terrain.py      # DTM-analyse, helningsberegning
│   ├── weather.py       # MET Norway API
│   ├── avalanche.py     # Varsom API (skredvarsel)
│   ├── routing.py       # Kjøretidsberegning (OSRM)
│   ├── tour_finder.py   # Hovedlogikk – rangering av turer
│   └── known_tours.py   # Database med kjente startpunkter/topper
│
Frontend (HTML/JS/Leaflet)
├── templates/
│   └── index.html       # Hoved-app med kart
└── static/
    ├── css/app.css
    └── js/app.js
```

## Kjøre lokalt

```bash
pip install flask requests numpy rasterio geopandas shapely folium
python app.py
# Åpne http://localhost:5000
```

## Kjøre med Claude Code

```bash
claude
# "Les README.md og hjelp meg videreutvikle splitboard-finder appen"
```

## Prioritert utviklingsplan

### Fase 1 — MVP (dette prosjektet)
- [x] Kjente turer i Hemsedal/Jotunheimen med koordinater
- [x] Skredvarsel fra Varsom API
- [x] Værdata fra MET Norway API
- [x] Kartvisning med Leaflet
- [x] Enkel rangering basert på skredfare + vær

### Fase 2 — Terrenganalyse
- [ ] Last ned DTM10-fliser for Hemsedal/Jotunheimen
- [ ] Beregn helning (slope) fra DTM
- [ ] Filtrer terreng 15–30° og finn sammenhengende korridorer
- [ ] Automatisk turforslag basert på terrenganalyse

### Fase 3 — Full PWA
- [ ] Service Worker for offline-støtte
- [ ] Manifest for "Add to Home Screen"
- [ ] Geolocation for brukerens posisjon
- [ ] Kjøretidsberegning med OSRM
- [ ] Push-varsler ved gode forhold

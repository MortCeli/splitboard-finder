# CLAUDE.md — Splitboard Tour Finder

## Prosjektbeskrivelse
Web-app (PWA) som foreslår splitboard-turer i Hemsedal og Jotunheimen basert på terreng, vær, skredvarsel og brukerens lokasjon.

## Teknisk stack
- **Backend**: Python 3.12, Flask
- **Frontend**: Vanilla HTML/CSS/JS med Leaflet kart
- **Kart**: Kartverket topografisk (WMTS) + OpenStreetMap
- **APIer**: MET Norway (vær), Varsom/NVE (skredvarsel), OSRM (kjøretid)

## Prosjektstruktur
```
app.py                          # Flask-app, kjøres med `python app.py`
backend/modules/
  known_tours.py                # Database med kjente turer (koordinater, metadata)
  weather.py                    # MET Norway API-integrasjon
  avalanche.py                  # Varsom API-integrasjon (skredvarsel)
  tour_finder.py                # Hovedlogikk — filtrering og rangering
  routing.py                    # (TODO) OSRM kjøretid
  terrain.py                    # (TODO) DTM10 terrenganalyse
frontend/
  templates/index.html          # Hoved-HTML
  static/css/app.css            # Styling
  static/js/app.js              # Leaflet-kart og UI-logikk
```

## Kjøre lokalt
```bash
pip install -r requirements.txt
python app.py
# → http://localhost:5000
```

## API-endepunkter
- `GET /` — Hoved-app
- `GET /api/tours` — Hent rangerte turforslag (med vær + skred)
  - Params: lat, lon, max_hours, date, region, difficulty, min_slope, max_slope
- `GET /api/tours/all` — Alle turer uten sanntidsdata

## Viktige noter
- MET Norway API krever unik User-Agent header
- Varsom region-ID 3027 = Hallingdal (Hemsedal), 3028 = Jotunheimen
- Skredvarsel vektes tyngst (50%) i total score
- Faregrad ≥ 4 → tur frarådes uansett andre score

## Neste steg (prioritert)
1. Legg til OSRM routing for nøyaktig kjøretid (erstatt haversine-estimat)
2. Utvid turdatabasen med flere ruter
3. Legg til "aspect filter" — filtrer turer basert på himmelretning vs. soleksponering
4. DTM10-integrasjon for automatiske turforslag
5. Service Worker + manifest.json for PWA
6. Detaljert turprofil (høydeprofil, helningsdiagram)

## Kodestil
- Python: Norske kommentarer, engelske variabelnavn
- Modulær arkitektur — hver modul har sitt eget ansvarsområde
- API-kall caches per forespørsel i tour_finder.py

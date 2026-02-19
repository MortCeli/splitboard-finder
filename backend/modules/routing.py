"""
OSRM-integrasjon for nøyaktig kjøretid.
Bruker den offentlige OSRM demo-serveren.
Fallback til haversine-estimat ved feil.
"""

import requests

OSRM_BASE = "http://router.project-osrm.org/route/v1/driving"
_route_cache = {}


def _cache_key(lat1, lon1, lat2, lon2):
    """Rund av koordinater for å gruppere nærliggende forespørsler."""
    return (round(lat1, 2), round(lon1, 2), round(lat2, 2), round(lon2, 2))


def get_drive_time(start_lat, start_lon, end_lat, end_lon):
    """
    Hent kjøretid fra OSRM.
    Returnerer (distance_km, duration_hours) eller None ved feil.
    """
    key = _cache_key(start_lat, start_lon, end_lat, end_lon)
    if key in _route_cache:
        return _route_cache[key]

    try:
        url = f"{OSRM_BASE}/{start_lon},{start_lat};{end_lon},{end_lat}"
        resp = requests.get(
            url,
            params={"overview": "false"},
            timeout=5,
            headers={"User-Agent": "SplitboardFinder/0.1"},
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != "Ok" or not data.get("routes"):
            return None

        route = data["routes"][0]
        distance_km = round(route["distance"] / 1000, 1)
        duration_hours = round(route["duration"] / 3600, 2)

        result = (distance_km, duration_hours)
        _route_cache[key] = result
        return result
    except Exception as e:
        print(f"OSRM-feil: {e}")
        return None

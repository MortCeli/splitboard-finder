"""
Henter skredobservasjoner fra RegObs (NVE/Varsom).
Viser nylige observasjoner nær turområder.
https://api.regobs.no/v5/swagger/index.html
"""

import requests
from datetime import datetime, timedelta

HEADERS = {
    "Content-Type": "application/json",
}

SEARCH_URL = "https://api.regobs.no/v5/Search"

_regobs_cache = {}


def get_nearby_observations(lat: float, lon: float, radius_km: int = 20, days: int = 7) -> list:
    """
    Hent nylige snø-/skredobservasjoner nær et punkt.
    Returnerer liste med forenklede observasjoner.
    """
    key = (round(lat, 1), round(lon, 1), days)
    if key in _regobs_cache:
        return _regobs_cache[key]

    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")

    body = {
        "FromDate": from_date,
        "ToDate": to_date,
        "Latitude": lat,
        "Longitude": lon,
        "Radius": radius_km * 1000,  # API bruker meter
        "NumberOfRecords": 10,
        "GeoHazardTID": 10,  # 10 = snø/skred
    }

    try:
        resp = requests.post(
            SEARCH_URL,
            json=body,
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        observations = []
        for obs in data:
            reg = obs.get("Registrations", [])
            summaries = []
            for r in reg:
                name = r.get("RegistrationName", "")
                if name:
                    summaries.append(name)

            observations.append({
                "date": (obs.get("DtObsTime") or "")[:10],
                "observer": obs.get("ObserverNickName") or obs.get("CompetenceLevelName", ""),
                "types": summaries,
                "latitude": obs.get("ObsLocation", {}).get("Latitude"),
                "longitude": obs.get("ObsLocation", {}).get("Longitude"),
                "location_name": obs.get("ObsLocation", {}).get("LocationName", ""),
            })

        _regobs_cache[key] = observations
        return observations

    except Exception as e:
        print(f"RegObs API-feil: {e}")
        return []

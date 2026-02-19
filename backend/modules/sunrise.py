"""
Henter soloppgang/solnedgang fra MET Norway Sunrise API 3.0.
Viktig for planlegging av vinterturer med begrenset dagslys.
"""

import requests
from datetime import datetime, timedelta

HEADERS = {
    "User-Agent": "SplitboardFinder/0.1 github.com/splitboard-finder"
}

BASE_URL = "https://api.met.no/weatherapi/sunrise/3.0/sun"

_sunrise_cache = {}


def get_daylight(lat: float, lon: float, date: str = None) -> dict | None:
    """
    Hent soldata for et punkt og en dato.
    Returnerer dict med sunrise, sunset, daylight_hours, eller None ved feil.
    """
    if not date:
        date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    key = (round(lat, 2), round(lon, 2), date)
    if key in _sunrise_cache:
        return _sunrise_cache[key]

    try:
        resp = requests.get(
            BASE_URL,
            params={
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "date": date,
                "offset": "+01:00",
            },
            headers=HEADERS,
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()

        props = data.get("properties", {})
        sunrise_data = props.get("sunrise", {})
        sunset_data = props.get("sunset", {})

        sunrise_time = sunrise_data.get("time", "")
        sunset_time = sunset_data.get("time", "")

        # Beregn dagslys-timer
        daylight_hours = None
        if sunrise_time and sunset_time:
            try:
                sr = datetime.fromisoformat(sunrise_time)
                ss = datetime.fromisoformat(sunset_time)
                daylight_hours = round((ss - sr).total_seconds() / 3600, 1)
            except (ValueError, TypeError):
                pass

        # Formater klokkeslett (HH:MM)
        sunrise_fmt = sunrise_time[11:16] if len(sunrise_time) > 16 else "—"
        sunset_fmt = sunset_time[11:16] if len(sunset_time) > 16 else "—"

        result = {
            "sunrise": sunrise_fmt,
            "sunset": sunset_fmt,
            "daylight_hours": daylight_hours,
        }

        _sunrise_cache[key] = result
        return result

    except Exception as e:
        print(f"Sunrise API-feil: {e}")
        return None

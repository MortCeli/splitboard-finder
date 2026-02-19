"""
Henter værdata fra MET Norway API (Locationforecast 2.0).
https://api.met.no/weatherapi/locationforecast/2.0/documentation
"""

import requests
from datetime import datetime, timedelta

# MET Norway krever en unik User-Agent
HEADERS = {
    "User-Agent": "SplitboardFinder/0.1 github.com/splitboard-finder"
}

BASE_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"


def get_forecast(lat: float, lon: float) -> dict | None:
    """Hent værmelding for et punkt. Returnerer forenklet data."""
    try:
        resp = requests.get(
            BASE_URL,
            params={"lat": round(lat, 4), "lon": round(lon, 4)},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        timeseries = data["properties"]["timeseries"]
        forecasts = []

        for entry in timeseries[:48]:  # Neste 48 timer
            time = entry["time"]
            instant = entry["data"]["instant"]["details"]

            forecast = {
                "time": time,
                "temp_c": instant.get("air_temperature"),
                "wind_speed_ms": instant.get("wind_speed"),
                "wind_from_direction": instant.get("wind_from_direction"),
                "cloud_area_fraction": instant.get("cloud_area_fraction"),
                "precipitation_mm": None,
                "symbol": None,
            }

            # Nedbør fra next_1_hours eller next_6_hours
            for period in ["next_1_hours", "next_6_hours"]:
                if period in entry["data"]:
                    details = entry["data"][period].get("details", {})
                    forecast["precipitation_mm"] = details.get(
                        "precipitation_amount", 0
                    )
                    summary = entry["data"][period].get("summary", {})
                    forecast["symbol"] = summary.get("symbol_code")
                    break

            forecasts.append(forecast)

        return forecasts

    except Exception as e:
        print(f"Feil ved henting av værdata: {e}")
        return None


def evaluate_weather(forecasts: list, target_date: str = None) -> dict:
    """
    Vurder værforhold for splitboard.
    Returnerer en score 0-100 og en beskrivelse.
    """
    if not forecasts:
        return {"score": 0, "description": "Ingen værdata tilgjengelig", "details": {}}

    # Filtrer på target_date om oppgitt, ellers bruk i morgen
    if target_date:
        target = datetime.fromisoformat(target_date).date()
    else:
        target = (datetime.now() + timedelta(days=1)).date()

    day_forecasts = [
        f
        for f in forecasts
        if datetime.fromisoformat(f["time"].replace("Z", "+00:00")).date() == target
    ]

    if not day_forecasts:
        day_forecasts = forecasts[:12]  # Fallback: neste 12 timer

    # Beregn gjennomsnitt
    avg_wind = sum(f["wind_speed_ms"] or 0 for f in day_forecasts) / len(day_forecasts)
    avg_temp = sum(f["temp_c"] or 0 for f in day_forecasts) / len(day_forecasts)
    total_precip = sum(f["precipitation_mm"] or 0 for f in day_forecasts)
    avg_clouds = sum(f["cloud_area_fraction"] or 0 for f in day_forecasts) / len(
        day_forecasts
    )

    # Scoring
    score = 100

    # Vind: ideelt < 5 m/s, ok < 10, dårlig > 15
    if avg_wind > 15:
        score -= 50
    elif avg_wind > 10:
        score -= 30
    elif avg_wind > 5:
        score -= 10

    # Nedbør: noe snø er ok, regn er dårlig
    if total_precip > 15:
        score -= 30
    elif total_precip > 5:
        score -= 15
    elif total_precip > 1:
        score -= 5

    # Temperatur: for varmt (> 2°C) = dårlig for snøkvalitet
    if avg_temp > 2:
        score -= 20
    elif avg_temp > 0:
        score -= 10
    elif avg_temp < -15:
        score -= 10  # Veldig kaldt er også lite hyggelig

    # Skydekke
    if avg_clouds > 90:
        score -= 15
    elif avg_clouds > 70:
        score -= 5

    score = max(0, min(100, score))

    # Beskriv forholdene
    if score >= 80:
        desc = "🟢 Utmerkede forhold"
    elif score >= 60:
        desc = "🟡 Gode forhold"
    elif score >= 40:
        desc = "🟠 Moderate forhold"
    else:
        desc = "🔴 Dårlige forhold"

    return {
        "score": score,
        "description": desc,
        "details": {
            "avg_wind_ms": round(avg_wind, 1),
            "avg_temp_c": round(avg_temp, 1),
            "total_precip_mm": round(total_precip, 1),
            "avg_cloud_pct": round(avg_clouds, 0),
        },
    }

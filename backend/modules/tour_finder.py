"""
Hovedmodul: Finner og rangerer splitboard-turer basert på
vær, skredvarsel, brukerens posisjon og preferanser.
"""

from math import radians, sin, cos, sqrt, atan2
from .known_tours import get_tours_by_region, TOURS
from .weather import get_forecast, evaluate_weather
from .avalanche import get_avalanche_warning, evaluate_avalanche_danger
from .routing import get_drive_time
from .sunrise import get_daylight
from .regobs import get_nearby_observations


def haversine_km(lat1, lon1, lat2, lon2):
    """Avstand mellom to koordinater i km."""
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def estimate_drive_time_hours(distance_km):
    """
    Grov estimering av kjøretid basert på avstand.
    Fjellveier i Norge: ca 50–60 km/t gjennomsnitt.
    """
    return distance_km / 55


def find_tours(
    user_lat: float = None,
    user_lon: float = None,
    max_drive_hours: float = 4.0,
    target_date: str = None,
    difficulty: str = None,
    region: str = None,
    min_slope: float = 15,
    max_slope: float = 30,
) -> list:
    """
    Finn og ranger turer basert på alle kriterier.
    Returnerer sortert liste med turforslag.
    """
    # Hent alle turer, eventuelt filtrert på region
    tours = get_tours_by_region(region) if region else TOURS

    results = []

    # Cache for API-kall per region
    weather_cache = {}
    avalanche_cache = {}
    sunrise_cache = {}
    regobs_cache = {}

    for tour in tours:
        # --- Avstandsfilter ---
        if user_lat and user_lon:
            # Prøv OSRM først, fallback til haversine
            osrm_result = get_drive_time(
                user_lat, user_lon,
                tour["start"]["lat"], tour["start"]["lon"]
            )
            if osrm_result:
                dist, drive_hours = osrm_result
                drive_source = "osrm"
            else:
                dist = haversine_km(
                    user_lat, user_lon,
                    tour["start"]["lat"], tour["start"]["lon"]
                )
                drive_hours = estimate_drive_time_hours(dist)
                drive_source = "estimate"
            if drive_hours > max_drive_hours:
                continue
        else:
            dist = None
            drive_hours = None
            drive_source = None

        # --- Helningsfilter ---
        slope = tour.get("slope_avg_deg", 25)
        if slope < min_slope or slope > max_slope:
            continue

        # --- Vanskelighetsfilter ---
        if difficulty and difficulty.lower() not in tour.get("difficulty", "").lower():
            continue

        # --- Hent vær (cachet per koordinat-område) ---
        weather_key = f"{round(tour['summit']['lat'], 1)}_{round(tour['summit']['lon'], 1)}"
        if weather_key not in weather_cache:
            try:
                forecasts = get_forecast(tour["summit"]["lat"], tour["summit"]["lon"])
            except Exception as e:
                print(f"Vær-API feilet for {tour['name']}: {e}")
                forecasts = None
            weather_cache[weather_key] = forecasts

        weather_eval = evaluate_weather(weather_cache[weather_key], target_date)

        # --- Hent skredvarsel (cachet per region) ---
        region_id = tour["varsom_region_id"]
        if region_id not in avalanche_cache:
            try:
                warnings = get_avalanche_warning(region_id)
            except Exception as e:
                print(f"Skred-API feilet for region {region_id}: {e}")
                warnings = None
            avalanche_cache[region_id] = warnings

        aval_eval = evaluate_avalanche_danger(avalanche_cache[region_id], target_date)

        # --- Hent soldata (cachet per koordinat-område) ---
        sunrise_key = f"{round(tour['summit']['lat'], 1)}_{round(tour['summit']['lon'], 1)}"
        if sunrise_key not in sunrise_cache:
            try:
                sunrise_cache[sunrise_key] = get_daylight(
                    tour["summit"]["lat"], tour["summit"]["lon"], target_date
                )
            except Exception as e:
                print(f"Sunrise-API feilet for {tour['name']}: {e}")
                sunrise_cache[sunrise_key] = None

        sunrise_data = sunrise_cache[sunrise_key]

        # --- Hent RegObs-observasjoner (cachet per region-område) ---
        regobs_key = f"{round(tour['summit']['lat'], 0)}_{round(tour['summit']['lon'], 0)}"
        if regobs_key not in regobs_cache:
            try:
                regobs_cache[regobs_key] = get_nearby_observations(
                    tour["summit"]["lat"], tour["summit"]["lon"]
                )
            except Exception as e:
                print(f"RegObs-API feilet for {tour['name']}: {e}")
                regobs_cache[regobs_key] = []

        nearby_obs = regobs_cache[regobs_key]

        # --- Total score ---
        # Vekting: skredfare er viktigst, deretter vær, deretter avstand
        aval_score = aval_eval["score"]
        weather_score = weather_eval["score"]
        distance_score = 100 - (drive_hours / max_drive_hours * 30) if drive_hours else 70

        total_score = (
            aval_score * 0.50       # Skredfare veier tyngst
            + weather_score * 0.35  # Vær er viktig
            + distance_score * 0.15 # Avstand er bonus
        )

        # Sikkerhetsregel: faregrad >= 4 → tur frarådes uansett
        if aval_eval.get("danger_level", 0) >= 4:
            total_score = min(total_score, 10)

        results.append({
            "tour": tour,
            "total_score": round(total_score, 1),
            "weather": weather_eval,
            "avalanche": aval_eval,
            "distance_km": round(dist, 1) if dist else None,
            "drive_hours": round(drive_hours, 1) if drive_hours else None,
            "drive_source": drive_source,
            "sunrise": sunrise_data,
            "observations": nearby_obs[:3],
        })

    # Sorter etter total score (best først)
    results.sort(key=lambda x: x["total_score"], reverse=True)

    return results

"""
Henter skredvarsel fra Varsom.no API (NVE).
https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api
"""

import requests
from requests.exceptions import SSLError
from datetime import datetime, timedelta

BASE_URL = "https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api"

# Faregrader
DANGER_LEVELS = {
    1: {"name": "Liten", "color": "#50B848", "emoji": "🟢"},
    2: {"name": "Moderat", "color": "#FFF200", "emoji": "🟡"},
    3: {"name": "Betydelig", "color": "#F5A623", "emoji": "🟠"},
    4: {"name": "Stor", "color": "#D0021B", "emoji": "🔴"},
    5: {"name": "Meget stor", "color": "#1A1A1A", "emoji": "⚫"},
}


def get_avalanche_warning(region_id: int, days_ahead: int = 2) -> list | None:
    """
    Hent skredvarsel for en region.
    region_id: Varsom region-ID (f.eks. 3027 for Hallingdal, 3028 for Jotunheimen)
    """
    start = datetime.now().strftime("%Y-%m-%d")
    end = (datetime.now() + timedelta(days=days_ahead)).strftime("%Y-%m-%d")

    try:
        url = f"{BASE_URL}/AvalancheWarningByRegion/Simple/{region_id}/1/{start}/{end}"
        try:
            resp = requests.get(url, timeout=10)
        except SSLError:
            # SSL fallback ved sertifikatproblemer
            resp = requests.get(url, timeout=10, verify=False)
        resp.raise_for_status()
        data = resp.json()

        warnings = []
        for w in data:
            danger_level = int(w.get("DangerLevel", 0))
            level_info = DANGER_LEVELS.get(danger_level, {"name": "Ukjent", "color": "#999", "emoji": "❓"})

            warnings.append({
                "date": w.get("ValidFrom", "")[:10],
                "danger_level": danger_level,
                "danger_name": level_info["name"],
                "danger_color": level_info["color"],
                "danger_emoji": level_info["emoji"],
                "region_name": w.get("RegionName", ""),
                "region_id": w.get("RegionId", region_id),
                "main_text": w.get("MainText", ""),
            })

        return warnings

    except Exception as e:
        print(f"Feil ved henting av skredvarsel: {e}")
        return None


def evaluate_avalanche_danger(warnings: list, target_date: str = None) -> dict:
    """
    Vurder skredfaren for splitboard.
    Returnerer score 0-100 og anbefaling.
    """
    if not warnings:
        return {
            "score": 0,
            "description": "Ingen skredvarsel tilgjengelig",
            "danger_level": None,
        }

    # Finn varsel for target_date
    if target_date:
        target = target_date[:10]
    else:
        target = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    day_warning = None
    for w in warnings:
        if w["date"] == target:
            day_warning = w
            break

    if not day_warning:
        day_warning = warnings[0]  # Fallback til første tilgjengelige

    danger = day_warning["danger_level"]

    # Scoring basert på faregrad
    score_map = {
        1: 100,  # Liten – toppforhold
        2: 75,   # Moderat – de fleste turer er ok
        3: 35,   # Betydelig – kun trygge turer
        4: 5,    # Stor – frarådes
        5: 0,    # Meget stor – ingen tur
    }

    score = score_map.get(danger, 0)

    if danger <= 2:
        desc = f"{day_warning['danger_emoji']} Faregrad {danger} ({day_warning['danger_name']}) – gode forhold for tur"
    elif danger == 3:
        desc = f"{day_warning['danger_emoji']} Faregrad {danger} ({day_warning['danger_name']}) – vær forsiktig, velg trygge ruter"
    else:
        desc = f"{day_warning['danger_emoji']} Faregrad {danger} ({day_warning['danger_name']}) – tur frarådes"

    return {
        "score": score,
        "description": desc,
        "danger_level": danger,
        "danger_name": day_warning["danger_name"],
        "region_name": day_warning.get("region_name", ""),
        "main_text": day_warning.get("main_text", ""),
    }

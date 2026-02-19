"""
Splitboard Tour Finder — Flask app
Kjør: python app.py
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template, jsonify, request, send_from_directory
from backend.modules.tour_finder import find_tours
from backend.modules.known_tours import TOURS

app = Flask(
    __name__,
    template_folder="frontend/templates",
    static_folder="frontend/static",
)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/offline.html")
def offline():
    """Offline fallback-side for PWA."""
    return render_template("offline.html")


@app.route("/sw.js")
def service_worker():
    """Server service worker fra root for riktig scope."""
    return send_from_directory(app.static_folder, "sw.js")


@app.route("/api/tours", methods=["GET"])
def api_tours():
    """
    Hent turforslag.
    Query params:
      lat, lon       - Brukerens posisjon
      max_hours      - Maks kjøretid (default 4)
      date           - Måldato (YYYY-MM-DD)
      region         - "Hemsedal" eller "Jotunheimen"
      difficulty     - "lett", "middels", "krevende"
      min_slope      - Min helning i grader (default 15)
      max_slope      - Maks helning i grader (default 30)
    """
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    max_hours = request.args.get("max_hours", default=4.0, type=float)
    date = request.args.get("date")
    region = request.args.get("region")
    difficulty = request.args.get("difficulty")
    min_slope = request.args.get("min_slope", default=15, type=float)
    max_slope = request.args.get("max_slope", default=30, type=float)

    try:
        results = find_tours(
            user_lat=lat,
            user_lon=lon,
            max_drive_hours=max_hours,
            target_date=date,
            difficulty=difficulty,
            region=region,
            min_slope=min_slope,
            max_slope=max_slope,
        )
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/tours/all", methods=["GET"])
def api_all_tours():
    """Returner alle kjente turer (uten vær/skreddata)."""
    return jsonify(TOURS)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)

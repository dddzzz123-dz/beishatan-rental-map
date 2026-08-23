#!/usr/bin/env python3
"""Re-route every mapped community to the nearest Beishatan subway exit.

Exit coordinates are WGS84 OpenStreetMap subway entrance nodes, cross-checked
against AMap's A-exit POI and Beijing Subway's B1/C accessibility listing.
Walking paths use Valhalla's pedestrian graph over OpenStreetMap. No API key is
stored or required. Run this only when refreshing the static route snapshot.
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from build_map_data import POI_SOURCE, route_points


ROOT = Path(__file__).resolve().parents[1]
MAP_FILE = ROOT / "data" / "map-data.js"
VALHALLA = "https://valhalla1.openstreetmap.de"

EXITS = [
    {"id": "A", "name": "A 西北口", "location": [40.0003329, 116.3611584], "osmNode": "7553495970"},
    {"id": "B1", "name": "B1 东北口", "location": [40.0008724, 116.3626245], "osmNode": "7553495968", "accessible": True},
    {"id": "B2", "name": "B2 东北口", "location": [40.0007137, 116.3639156], "osmNode": "7553495969"},
    {"id": "C", "name": "C 东南口", "location": [39.9995947, 116.3635919], "osmNode": "7553495967", "accessible": True},
]


def read_map() -> dict:
    text = MAP_FILE.read_text(encoding="utf-8").strip()
    prefix = "window.MAP_DATA="
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValueError("Unexpected map-data.js wrapper")
    return json.loads(text[len(prefix):-1])


def request(path: str, payload: dict) -> dict:
    query = urllib.parse.quote(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    req = urllib.request.Request(
        f"{VALHALLA}{path}?json={query}",
        headers={"User-Agent": "BeishatanRentalMap/1.0 (static route refresh)"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def decode_polyline(encoded: str, precision: int = 6) -> list[list[float]]:
    factor = 10 ** precision
    lat = lon = index = 0
    points: list[list[float]] = []
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            result = shift = 0
            while True:
                value = ord(encoded[index]) - 63
                index += 1
                result |= (value & 0x1F) << shift
                shift += 5
                if value < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append([round(lat / factor, 6), round(lon / factor, 6)])
    return points


def out_of_china(lon: float, lat: float) -> bool:
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def transform_lat(lon: float, lat: float) -> float:
    value = -100 + 2 * lon + 3 * lat + .2 * lat * lat + .1 * lon * lat + .2 * math.sqrt(abs(lon))
    value += (20 * math.sin(6 * lon * math.pi) + 20 * math.sin(2 * lon * math.pi)) * 2 / 3
    value += (20 * math.sin(lat * math.pi) + 40 * math.sin(lat / 3 * math.pi)) * 2 / 3
    value += (160 * math.sin(lat / 12 * math.pi) + 320 * math.sin(lat * math.pi / 30)) * 2 / 3
    return value


def transform_lon(lon: float, lat: float) -> float:
    value = 300 + lon + 2 * lat + .1 * lon * lon + .1 * lon * lat + .1 * math.sqrt(abs(lon))
    value += (20 * math.sin(6 * lon * math.pi) + 20 * math.sin(2 * lon * math.pi)) * 2 / 3
    value += (20 * math.sin(lon * math.pi) + 40 * math.sin(lon / 3 * math.pi)) * 2 / 3
    value += (150 * math.sin(lon / 12 * math.pi) + 300 * math.sin(lon / 30 * math.pi)) * 2 / 3
    return value


def wgs84_to_gcj02(lat: float, lon: float) -> str:
    if out_of_china(lon, lat):
        return f"{lon:.6f},{lat:.6f}"
    radlat = lat / 180 * math.pi
    magic = 1 - 0.00669342162296594323 * math.sin(radlat) ** 2
    sqrtmagic = math.sqrt(magic)
    dlat = transform_lat(lon - 105, lat - 35) * 180 / ((6335552.717000426 / (magic * sqrtmagic)) * math.pi)
    dlon = transform_lon(lon - 105, lat - 35) * 180 / ((6378245 / sqrtmagic * math.cos(radlat)) * math.pi)
    return f"{lon + dlon:.6f},{lat + dlat:.6f}"


def haversine_m(a: list[float], b: list[float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def main() -> None:
    data = read_map()
    raw_pois = json.loads(POI_SOURCE.read_text(encoding="utf-8"))["pois"]
    raw_by_id = {item["poi_id"]: item for item in raw_pois}
    communities = data["communities"]
    origins = []
    for item in communities:
        origin = item.get("routeOriginLocation") or (item["route"][0] if item.get("route") else item["location"])
        item["routeOriginLocation"] = origin
        item["routeOriginAmap"] = wgs84_to_gcj02(origin[0], origin[1])
        origins.append({"lat": origin[0], "lon": origin[1]})
    targets = [{"lat": e["location"][0], "lon": e["location"][1]} for e in EXITS]
    matrix = request("/sources_to_targets", {"sources": origins, "targets": targets, "costing": "pedestrian", "units": "kilometers"})
    rows = matrix["sources_to_targets"]
    if len(rows) != len(communities):
        raise RuntimeError("Incomplete route matrix")

    for index, (item, row) in enumerate(zip(communities, rows), 1):
        options = [cell for cell in row if cell.get("distance") is not None]
        if not options:
            raise RuntimeError(f"No walkable exit for {item['name']}")
        winner = min(options, key=lambda cell: (cell["distance"], cell["time"]))
        exit_info = EXITS[winner["to_index"]]
        route_data = request("/route", {
            "locations": [origins[index - 1], targets[winner["to_index"]]],
            "costing": "pedestrian", "units": "kilometers",
        })
        summary = route_data["trip"]["summary"]
        new_distance = round(summary["length"] * 1000)
        item["walkingM"] = new_distance
        item["walkingS"] = round(summary["time"])
        item["withinWalkLimit"] = item["walkingM"] <= data.get("walkLimitM", 1200)
        item["nearestExit"] = exit_info["id"]
        item["nearestExitName"] = exit_info["name"]
        item["routeProvider"] = "Valhalla pedestrian / OpenStreetMap"
        item["route"] = decode_polyline(route_data["trip"]["legs"][0]["shape"])
        item.pop("routeQualityNote", None)
        raw = raw_by_id.get(item["id"])
        if raw and raw.get("walking_m") and new_distance > max(raw["walking_m"] * 2, raw.get("straight_line_m", 0) * 2 + 200):
            legacy_route = route_points(raw.get("walking_polyline_gcj02", ""))
            legacy_exit = min(EXITS, key=lambda candidate: haversine_m(legacy_route[-1], candidate["location"])) if legacy_route else None
            if legacy_exit and legacy_exit["id"] == exit_info["id"]:
                item["walkingM"] = raw["walking_m"]
                item["walkingS"] = raw["walking_s"]
                item["route"] = legacy_route
                item["routeProvider"] = "AMap legacy route (nearest-exit validated)"
                item["routeQualityNote"] = "Valhalla pedestrian graph produced an implausible detour; retained the existing AMap route because it terminates at the same selected exit."
                item["withinWalkLimit"] = item["walkingM"] <= data.get("walkLimitM", 1200)
        print(f"[{index:02d}/{len(communities)}] {item['name']} -> {exit_info['id']} {item['walkingM']}m", flush=True)
        time.sleep(0.12)

    for exit_info in EXITS:
        exit_info["amapLocation"] = wgs84_to_gcj02(exit_info["location"][0], exit_info["location"][1])
    data["station"]["exits"] = EXITS
    data["routeProvider"] = "Valhalla pedestrian / OpenStreetMap"
    data["routeMethod"] = "Shortest routed walking distance across A, B1, B2 and C exits"
    data["generatedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    MAP_FILE.write_text("window.MAP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"ok": True, "communities": len(communities), "exits": len(EXITS)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

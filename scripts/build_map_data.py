#!/usr/bin/env python3
"""Build browser-ready, key-free map data from the AMap research export."""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT.parent / "生活" / "租房找房" / "北京北沙滩"
POI_SOURCE = SOURCE_ROOT / "amap-residential-pois-20260824.json"
RENTALS_SOURCE = ROOT / "data" / "rentals.json"
OUTPUT = ROOT / "data" / "map-data.js"

ALIASES = {
    "北沙滩": "北沙滩小区",
    "冠军城": "华源冠军城",
    "海淀区清华东路9号院": "清华东路9号院",
    "南沙滩小区西区": "南沙滩小区",
}


def out_of_china(lon: float, lat: float) -> bool:
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def transform_lat(lon: float, lat: float) -> float:
    value = -100.0 + 2.0 * lon + 3.0 * lat + 0.2 * lat * lat + 0.1 * lon * lat + 0.2 * math.sqrt(abs(lon))
    value += (20.0 * math.sin(6.0 * lon * math.pi) + 20.0 * math.sin(2.0 * lon * math.pi)) * 2.0 / 3.0
    value += (20.0 * math.sin(lat * math.pi) + 40.0 * math.sin(lat / 3.0 * math.pi)) * 2.0 / 3.0
    value += (160.0 * math.sin(lat / 12.0 * math.pi) + 320.0 * math.sin(lat * math.pi / 30.0)) * 2.0 / 3.0
    return value


def transform_lon(lon: float, lat: float) -> float:
    value = 300.0 + lon + 2.0 * lat + 0.1 * lon * lon + 0.1 * lon * lat + 0.1 * math.sqrt(abs(lon))
    value += (20.0 * math.sin(6.0 * lon * math.pi) + 20.0 * math.sin(2.0 * lon * math.pi)) * 2.0 / 3.0
    value += (20.0 * math.sin(lon * math.pi) + 40.0 * math.sin(lon / 3.0 * math.pi)) * 2.0 / 3.0
    value += (150.0 * math.sin(lon / 12.0 * math.pi) + 300.0 * math.sin(lon / 30.0 * math.pi)) * 2.0 / 3.0
    return value


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    if out_of_china(lon, lat):
        return lon, lat
    dlat = transform_lat(lon - 105.0, lat - 35.0)
    dlon = transform_lon(lon - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - 0.00669342162296594323 * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = dlat * 180.0 / ((6335552.717000426 / (magic * sqrtmagic)) * math.pi)
    dlon = dlon * 180.0 / ((6378245.0 / sqrtmagic * math.cos(radlat)) * math.pi)
    return lon + dlon, lat + dlat


def gcj02_to_wgs84(lon: float, lat: float) -> tuple[float, float]:
    if out_of_china(lon, lat):
        return lon, lat
    low_lon, high_lon = lon - 0.02, lon + 0.02
    low_lat, high_lat = lat - 0.02, lat + 0.02
    guess_lon, guess_lat = lon, lat
    for _ in range(24):
        guess_lon = (low_lon + high_lon) / 2
        guess_lat = (low_lat + high_lat) / 2
        test_lon, test_lat = wgs84_to_gcj02(guess_lon, guess_lat)
        if test_lon < lon:
            low_lon = guess_lon
        else:
            high_lon = guess_lon
        if test_lat < lat:
            low_lat = guess_lat
        else:
            high_lat = guess_lat
    return guess_lon, guess_lat


def coord(value: str) -> list[float]:
    lon, lat = (float(part) for part in value.split(",", 1))
    wlon, wlat = gcj02_to_wgs84(lon, lat)
    return [round(wlat, 6), round(wlon, 6)]


def route_points(value: str) -> list[list[float]]:
    points: list[list[float]] = []
    for item in (value or "").split(";"):
        if not item or "," not in item:
            continue
        point = coord(item)
        if not points or point != points[-1]:
            points.append(point)
    return points


def median(values: list[int]) -> int | None:
    if not values:
        return None
    values = sorted(values)
    middle = len(values) // 2
    return values[middle] if len(values) % 2 else round((values[middle - 1] + values[middle]) / 2)


def main() -> None:
    poi_data = json.loads(POI_SOURCE.read_text(encoding="utf-8"))
    rental_data = json.loads(RENTALS_SOURCE.read_text(encoding="utf-8"))
    by_community: dict[str, list[dict]] = {}
    for listing in rental_data["listings"]:
        by_community.setdefault(listing.get("community") or "未知小区", []).append(listing)

    known = set(by_community)
    selected = []
    for poi in poi_data["pois"]:
        platform_name = ALIASES.get(poi["name"], poi["name"])
        is_known = platform_name in known
        is_clear_residential = poi.get("typecode") == "120302" and "建设中" not in poi.get("name", "")
        if not ((poi.get("within_walk_limit") and is_clear_residential) or is_known):
            continue
        listings = by_community.get(platform_name, [])
        rents = [int(item["rentYuanPerMonth"]) for item in listings if item.get("rentYuanPerMonth")]
        selected.append({
            "id": poi["poi_id"],
            "name": poi["name"],
            "platformCommunity": platform_name if is_known else "",
            "coverage": "beike_listed" if is_known else "map_only_candidate",
            "district": poi.get("district", ""),
            "address": poi.get("address", ""),
            "location": coord(poi["location"]),
            "amapLocation": poi["location"],
            "walkingM": poi.get("walking_m"),
            "walkingS": poi.get("walking_s"),
            "withinWalkLimit": bool(poi.get("within_walk_limit")),
            "routeOriginKind": poi.get("route_origin_kind", "poi_center"),
            "route": route_points(poi.get("walking_polyline_gcj02", "")),
            "inventory": len(listings),
            "minRent": min(rents) if rents else None,
            "medianRent": median(rents),
            "multiPhoto": sum(1 for item in listings if item.get("photoStatus") == "multi"),
        })

    station = poi_data["station"]
    payload = {
        "generatedAt": poi_data.get("generated_at"),
        "station": {"id": station["id"], "name": station["name"], "location": coord(station["location"]), "amapLocation": station["location"]},
        "walkLimitM": 1200,
        "communities": sorted(selected, key=lambda item: (item["walkingM"] or 999999, item["name"])),
    }
    OUTPUT.write_text("window.MAP_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"ok": True, "communities": len(selected), "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

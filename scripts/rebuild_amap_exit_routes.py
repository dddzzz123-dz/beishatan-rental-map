#!/usr/bin/env python3
"""Refresh every community-to-exit walk with AMap Web Service v5.

The API key is read only from AMAP_WEB_KEY. It is never written to the site,
cache, console output, or git. Successful route responses are cached outside
the repository so an interrupted run can resume without spending quota twice.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from build_map_data import route_points


ROOT = Path(__file__).resolve().parents[1]
MAP_FILE = ROOT / "data" / "map-data.js"
CACHE_FILE = ROOT.parent / "生活" / "租房找房" / "北京北沙滩" / "amap-exit-route-cache.json"
BASE = "https://restapi.amap.com"


def read_map() -> dict[str, Any]:
    text = MAP_FILE.read_text(encoding="utf-8").strip()
    prefix = "window.MAP_DATA="
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValueError("Unexpected map-data.js wrapper")
    return json.loads(text[len(prefix):-1])


def read_cache() -> dict[str, Any]:
    if not CACHE_FILE.exists():
        return {}
    try:
        value = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def write_cache(cache: dict[str, Any]) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = CACHE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(CACHE_FILE)


def request_json(path: str, params: dict[str, Any], key: str) -> dict[str, Any]:
    query = dict(params)
    query["key"] = key
    url = BASE + path + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"User-Agent": "BeishatanRentalMap/1.0"})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.load(response)
            if str(data.get("status")) != "1":
                raise RuntimeError(f"AMap error: {data.get('info', 'unknown')} ({data.get('infocode', '')})")
            return data
        except Exception as exc:  # bounded retry for transient network errors
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error))


def walking_route(origin: str, destination: str, key: str) -> dict[str, Any]:
    data = request_json(
        "/v5/direction/walking",
        {"origin": origin, "destination": destination, "show_fields": "polyline,cost"},
        key,
    )
    paths = (data.get("route") or {}).get("paths") or []
    if not paths:
        raise RuntimeError("AMap returned no walking path")
    path = paths[0]
    duration = (path.get("cost") or {}).get("duration") or path.get("duration") or 0
    polylines = [str(step.get("polyline") or "") for step in (path.get("steps") or [])]
    polyline = ";".join(part for part in polylines if part)
    points = route_points(polyline)
    if len(points) < 2:
        raise RuntimeError("AMap walking path has no usable polyline")
    return {
        "distance": int(float(path.get("distance") or 0)),
        "duration": int(float(duration or 0)),
        "polyline": polyline,
    }


def main() -> int:
    key = os.environ.get("AMAP_WEB_KEY", "").strip()
    if not key:
        print("AMAP_WEB_KEY is not set")
        return 2

    data = read_map()
    exits = data.get("station", {}).get("exits") or []
    if not exits or any(not item.get("amapLocation") for item in exits):
        raise RuntimeError("Station exits or AMap exit coordinates are missing")

    cache = read_cache()
    communities = data.get("communities") or []
    failures: list[str] = []
    fresh_calls = 0
    for index, item in enumerate(communities, 1):
        origin = item.get("routeOriginAmap") or item.get("amapLocation")
        if not origin:
            failures.append(str(item.get("name") or item.get("id")))
            continue
        options = []
        for exit_info in exits:
            cache_key = f"{item['id']}::{exit_info['id']}::{origin}::{exit_info['amapLocation']}"
            result = cache.get(cache_key)
            if not result:
                try:
                    result = walking_route(origin, exit_info["amapLocation"], key)
                    cache[cache_key] = result
                    write_cache(cache)
                    fresh_calls += 1
                    time.sleep(0.08)
                except Exception as exc:
                    print(f"route failed: {item['name']} -> {exit_info['id']}: {exc}")
                    continue
            if result.get("distance") and result.get("polyline"):
                options.append((result["distance"], result.get("duration") or 0, exit_info, result))
        if not options:
            failures.append(item["name"])
            continue
        distance, duration, winner, result = min(options, key=lambda value: (value[0], value[1]))
        item["walkingM"] = distance
        item["walkingS"] = duration
        item["withinWalkLimit"] = distance <= data.get("walkLimitM", 1200)
        item["nearestExit"] = winner["id"]
        item["nearestExitName"] = winner["name"]
        item["route"] = route_points(result["polyline"])
        item["routeProvider"] = "AMap Web Service walking v5"
        item.pop("routeQualityNote", None)
        print(f"[{index:02d}/{len(communities)}] {item['name']} -> {winner['id']} {distance}m")

    if failures:
        raise RuntimeError("No complete AMap route for: " + ", ".join(failures))

    data["routeProvider"] = "AMap Web Service walking v5"
    data["routeMethod"] = "Shortest AMap walking route across A, B1, B2 and C exits"
    data["generatedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    MAP_FILE.write_text(
        "window.MAP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "communities": len(communities), "exits": len(exits), "fresh_calls": fresh_calls}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

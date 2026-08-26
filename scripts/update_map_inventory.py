#!/usr/bin/env python3
"""Refresh map inventory badges without touching verified exits or routes."""

from __future__ import annotations

import json
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAP_FILE = ROOT / "data" / "map-data.js"
RENTALS_FILE = ROOT / "data" / "rentals.json"

PLATFORM_NAMES = {
    "北沙滩": "北沙滩小区",
    "冠军城": "华源冠军城",
    "海淀区清华东路9号院": "清华东路9号院",
    "南沙滩小区西区": "南沙滩小区",
}


def read_wrapped(path: Path, prefix: str) -> dict:
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValueError(f"Unexpected wrapper in {path}")
    return json.loads(text[len(prefix) : -1])


def main() -> None:
    map_data = read_wrapped(MAP_FILE, "window.MAP_DATA=")
    rentals = json.loads(RENTALS_FILE.read_text(encoding="utf-8"))["listings"]
    grouped: dict[str, list[dict]] = {}
    for listing in rentals:
        grouped.setdefault(listing.get("community") or "", []).append(listing)

    for community in map_data["communities"]:
        source_name = community.get("platformCommunity") or PLATFORM_NAMES.get(community["name"], community["name"])
        items = grouped.get(source_name, [])
        rents = sorted(int(item["rentYuanPerMonth"]) for item in items)
        community["inventory"] = len(items)
        community["minRent"] = min(rents) if rents else None
        community["medianRent"] = round(statistics.median(rents)) if rents else None
        community["multiPhoto"] = sum((item.get("photoCount") or len(item.get("photoUrls") or [])) >= 2 for item in items)
        if items:
            community["coverage"] = "platform_listed"

    MAP_FILE.write_text(
        "window.MAP_DATA=" + json.dumps(map_data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "communities": len(map_data["communities"]), "listings": len(rentals)}))


if __name__ == "__main__":
    main()

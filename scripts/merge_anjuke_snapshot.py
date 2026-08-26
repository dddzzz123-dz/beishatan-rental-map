#!/usr/bin/env python3
"""Merge a bounded Anjuke public-page snapshot into the Beishatan site data."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ALIASES = {
    "北沙滩 1号院": "北沙滩1号院",
    "北沙滩 6号院": "北沙滩6号院",
    "北沙滩 8号院": "北沙滩8号院",
    "龙欣苑": "龙欣苑小区",
    "南沙滩汽车南院": "汽车南院小区",
}


def compact_name(value: str | None) -> str:
    return re.sub(r"[\s·・•（）()\-—_]", "", value or "")


def area_number(value: str | None) -> float | None:
    match = re.search(r"[\d.]+", value or "")
    return float(match.group()) if match else None


def layout_rooms(value: str | None) -> int | None:
    match = re.match(r"(\d+)室", value or "")
    return int(match.group(1)) if match else None


def layout_key(value: str | None) -> str:
    match = re.match(r"(\d+室\d+厅)", value or "")
    return match.group(1) if match else value or ""


def load_map(path: Path) -> dict:
    text = path.read_text(encoding="utf-8").strip()
    prefix = "window.MAP_DATA="
    if not text.startswith(prefix):
        raise ValueError("map-data.js structure changed")
    return json.loads(text[len(prefix) :].rstrip(";"))


def normalize_community(name: str, route_names: dict[str, str]) -> str | None:
    candidate = ALIASES.get(name, name)
    return route_names.get(compact_name(candidate))


def probable_duplicate(left: dict, right: dict) -> bool:
    if compact_name(left.get("community")) != compact_name(right.get("community")):
        return False
    if layout_key(left.get("layout")) != layout_key(right.get("layout")):
        return False
    if left.get("rentYuanPerMonth") != right.get("rentYuanPerMonth"):
        return False
    left_area, right_area = area_number(left.get("area")), area_number(right.get("area"))
    return left_area is not None and right_area is not None and abs(left_area - right_area) <= 2


def write_csv(path: Path, rows: list[dict]) -> None:
    fields = [
        "source", "houseCode", "title", "sourceTitle", "rentYuanPerMonth", "district",
        "businessArea", "community", "area", "orientation", "layout", "floor", "tags",
        "brand", "maintenance", "detailUrl", "coverUrl", "photoCount", "photoStatus",
        "photoUrls", "crossPlatformUrls", "snapshotDate", "verificationStatus", "listPageUrl",
        "page", "collectedAt",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            output = dict(row)
            for key in ("tags", "photoUrls", "crossPlatformUrls"):
                output[key] = "|".join(output.get(key) or [])
            writer.writerow(output)


def write_summary(path: Path, rows: list[dict]) -> None:
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["community"]].append(row)
    fields = ["community", "inventory", "minRent", "medianRent", "averageRent", "maxRent", "multiPhotoListings", "noneOrSingleListings"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for community in sorted(groups):
            items = groups[community]
            rents = sorted(int(item["rentYuanPerMonth"]) for item in items)
            middle = len(rents) // 2
            median = rents[middle] if len(rents) % 2 else round((rents[middle - 1] + rents[middle]) / 2)
            writer.writerow({
                "community": community,
                "inventory": len(items),
                "minRent": min(rents),
                "medianRent": median,
                "averageRent": round(sum(rents) / len(rents)),
                "maxRent": max(rents),
                "multiPhotoListings": sum((item.get("photoCount") or 0) >= 2 for item in items),
                "noneOrSingleListings": sum((item.get("photoCount") or 0) <= 1 for item in items),
            })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    rentals_path = project / "data" / "rentals.json"
    data = json.loads(rentals_path.read_text(encoding="utf-8"))
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    map_data = load_map(project / "data" / "map-data.js")
    walkable = {
        compact_name(item["name"]): item["name"]
        for item in map_data["communities"]
        if item.get("withinWalkLimit")
    }

    base = [item for item in data["listings"] if "安居客" not in item.get("source", "")]
    for item in base:
        item.setdefault("snapshotDate", "2026-08-24")
        item.setdefault("verificationStatus", "historical_snapshot")
        item.pop("crossPlatformUrls", None)

    eligible, rejected = [], []
    for item in snapshot["listings"]:
        rooms = layout_rooms(item.get("layout"))
        if "整租" not in (item.get("tags") or []) or rooms not in {2, 3}:
            continue
        canonical = normalize_community(item.get("community") or "", walkable)
        if not canonical:
            rejected.append(item.get("community"))
            continue
        item["community"] = canonical
        item["snapshotDate"] = snapshot["collectedAt"][:10]
        item["verificationStatus"] = "listed_on_source"
        item["tags"] = list(dict.fromkeys(["安居客", *(item.get("tags") or [])]))
        eligible.append(item)

    added, cross_checked = [], 0
    for candidate in eligible:
        match = next((item for item in base if probable_duplicate(item, candidate)), None)
        if match:
            match["crossPlatformUrls"] = list(dict.fromkeys([*(match.get("crossPlatformUrls") or []), candidate["detailUrl"]]))
            match["lastCrossCheckedAt"] = snapshot["collectedAt"]
            match["verificationStatus"] = "cross_platform_match"
            match["tags"] = list(dict.fromkeys([*(match.get("tags") or []), "跨平台同价核验"]))
            cross_checked += 1
        else:
            added.append(candidate)

    combined = [*base, *added]
    data.update({
        "scope": "北京15号线北沙滩站｜整租｜两居+三居｜多平台候选库",
        "reportedTotal": len(combined),
        "updatedAt": snapshot["collectedAt"],
        "sourceSnapshots": [
            {"platform": "贝壳", "date": "2026-08-24", "status": "historical_snapshot", "count": len(base)},
            {"platform": "安居客", "date": snapshot["collectedAt"][:10], "status": "one_public_page_then_blocked", "raw": len(snapshot["listings"]), "walkableWholeRent": len(eligible), "added": len(added), "crossChecked": cross_checked},
        ],
        "coverageNote": "安居客公开结果页首屏已采集；第二页触发验证后停止。本页是去重候选库，不代表平台穷尽库存。",
        "listings": combined,
    })
    rentals_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (project / "data" / "rentals.js").write_text("window.RENTALS_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    write_csv(project / "data" / "rentals.csv", combined)
    write_summary(project / "data" / "community-summary.csv", combined)
    print(json.dumps({
        "base": len(base), "eligible": len(eligible), "added": len(added), "crossChecked": cross_checked,
        "combined": len(combined), "rejectedCommunities": sorted(set(filter(None, rejected))),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

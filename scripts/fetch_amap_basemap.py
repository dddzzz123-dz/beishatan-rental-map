#!/usr/bin/env python3
"""Download a key-free AMap static basemap snapshot for the published site.

The Web Service key is read only from AMAP_WEB_KEY. The request URL is never
printed or persisted. The committed frontend receives only the PNG and its
WGS84 display bounds, so GitHub Pages never exposes the key.
"""

from __future__ import annotations

import json
import math
import os
import struct
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from build_map_data import gcj02_to_wgs84


ROOT = Path(__file__).resolve().parents[1]
IMAGE_FILE = ROOT / "assets" / "amap-basemap.png"
META_FILE = ROOT / "data" / "basemap.js"
CENTER_GCJ = (116.368281, 40.001518)
REQUEST_ZOOM = 14
REQUEST_SIZE = 1024
SCALE = 2


def projected_pixel(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    world = 256 * (2 ** zoom)
    x = (lon + 180) / 360 * world
    sin_lat = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world
    return x, y


def geographic_point(x: float, y: float, zoom: int) -> tuple[float, float]:
    world = 256 * (2 ** zoom)
    lon = x / world * 360 - 180
    n = math.pi - 2 * math.pi * y / world
    lat = math.degrees(math.atan(math.sinh(n)))
    return lon, lat


def main() -> int:
    key = os.environ.get("AMAP_WEB_KEY", "").strip()
    if not key:
        print("AMAP_WEB_KEY is not set")
        return 2
    params = {
        "key": key,
        "location": f"{CENTER_GCJ[0]:.6f},{CENTER_GCJ[1]:.6f}",
        "zoom": REQUEST_ZOOM,
        "size": f"{REQUEST_SIZE}*{REQUEST_SIZE}",
        "scale": SCALE,
        "traffic": 0,
    }
    url = "https://restapi.amap.com/v3/staticmap?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "BeishatanRentalMap/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        image = response.read()
        content_type = response.headers.get("Content-Type", "")
    if not image.startswith(b"\x89PNG\r\n\x1a\n") or "image" not in content_type:
        raise RuntimeError("AMap static map did not return a PNG image")
    width, height = struct.unpack(">II", image[16:24])
    IMAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    IMAGE_FILE.write_bytes(image)

    effective_zoom = REQUEST_ZOOM + (1 if SCALE == 2 else 0)
    center_x, center_y = projected_pixel(*CENTER_GCJ, effective_zoom)
    west, north = geographic_point(center_x - width / 2, center_y - height / 2, effective_zoom)
    east, south = geographic_point(center_x + width / 2, center_y + height / 2, effective_zoom)
    west_wgs, south_wgs = gcj02_to_wgs84(west, south)
    east_wgs, north_wgs = gcj02_to_wgs84(east, north)
    center_wgs = gcj02_to_wgs84(*CENTER_GCJ)
    payload = {
        "provider": "AMap static map Web Service",
        "image": "assets/amap-basemap.png",
        "bounds": [[round(south_wgs, 7), round(west_wgs, 7)], [round(north_wgs, 7), round(east_wgs, 7)]],
        "center": [round(center_wgs[1], 7), round(center_wgs[0], 7)],
        "sourceZoom": effective_zoom,
        "imageSize": [width, height],
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    META_FILE.write_text("window.AMAP_BASEMAP=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"ok": True, "width": width, "height": height, "provider": payload["provider"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

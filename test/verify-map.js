const fs = require("fs");

const source = fs.readFileSync("data/map-data.js", "utf8").trim();
const data = JSON.parse(source.slice("window.MAP_DATA=".length, -1));
const basemapSource = fs.readFileSync("data/basemap.js", "utf8").trim();
const basemap = JSON.parse(basemapSource.slice("window.AMAP_BASEMAP=".length, -1));
const indexHtml = fs.readFileSync("index.html", "utf8");
const mapJs = fs.readFileSync("js/map.js", "utf8");
const expectedExits = ["A", "B1", "B2", "C"];
const actualExits = data.station.exits.map((exit) => exit.id);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("ok  " + message);
}

function distanceM(a, b) {
  const radius = 6371000;
  const rad = (value) => value * Math.PI / 180;
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const dlat = lat2 - lat1;
  const dlon = rad(b[1] - a[1]);
  const value = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

assert(JSON.stringify(actualExits) === JSON.stringify(expectedExits), "北沙滩四个出口完整");
assert(data.communities.length === 57, "地图小区总数为 57");
assert(data.communities.every((item) => expectedExits.includes(item.nearestExit)), "每个小区均绑定最近出口");
assert(data.communities.every((item) => item.walkingM > 0 && item.walkingS > 0), "每个小区均有步行距离与时间");
assert(data.communities.every((item) => Array.isArray(item.route) && item.route.length >= 2), "每个小区均有完整路线折线");
assert(data.communities.every((item) => item.withinWalkLimit === (item.walkingM <= data.walkLimitM)), "步行圈状态与出口路线米数一致");

assert(data.routeProvider === "AMap Web Service walking v5", "全站路线来源为高德步行路径规划");
assert(data.communities.every((item) => item.routeProvider === data.routeProvider), "每个小区均使用同一高德路线来源");
assert(data.communities.every((item) => !item.routeQualityNote), "高德刷新后无遗留回退路线标记");
assert(data.communities.every((item) => {
  const exit = data.station.exits.find((candidate) => candidate.id === item.nearestExit);
  return exit && distanceM(item.route[item.route.length - 1], exit.location) < 30;
}), "每条高德路线均实际终止于标记出口附近");
assert(basemap.provider === "AMap static map Web Service", "底图来源为高德静态地图服务");
assert(Array.isArray(basemap.bounds) && basemap.bounds.length === 2, "高德底图具有可用地理边界");
assert(fs.statSync(basemap.image).size > 500000, "高德底图图片已随网站本地发布");
assert(indexHtml.includes("vendor/leaflet/leaflet.js") && !indexHtml.includes("unpkg.com"), "地图运行库不再依赖海外 CDN");
assert(!indexHtml.includes("tile.openstreetmap.org"), "手机端不再请求 OpenStreetMap 在线瓦片");
assert(mapJs.includes("L.circleMarker") && !mapJs.includes("markerClusterGroup"), "小区使用自适应位置光斑且不再聚合吞并");
assert(mapJs.includes("touchZoom: true") && mapJs.includes("scrollWheelZoom: true"), "双指与鼠标滚轮缩放均显式启用");
console.log("MAP ALL PASS ✔");

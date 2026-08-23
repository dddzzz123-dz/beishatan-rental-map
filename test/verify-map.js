const fs = require("fs");

const source = fs.readFileSync("data/map-data.js", "utf8").trim();
const data = JSON.parse(source.slice("window.MAP_DATA=".length, -1));
const expectedExits = ["A", "B1", "B2", "C"];
const actualExits = data.station.exits.map((exit) => exit.id);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("ok  " + message);
}

assert(JSON.stringify(actualExits) === JSON.stringify(expectedExits), "北沙滩四个出口完整");
assert(data.communities.length === 57, "地图小区总数为 57");
assert(data.communities.every((item) => expectedExits.includes(item.nearestExit)), "每个小区均绑定最近出口");
assert(data.communities.every((item) => item.walkingM > 0 && item.walkingS > 0), "每个小区均有步行距离与时间");
assert(data.communities.every((item) => Array.isArray(item.route) && item.route.length >= 2), "每个小区均有完整路线折线");
assert(data.communities.every((item) => item.withinWalkLimit === (item.walkingM <= data.walkLimitM)), "步行圈状态与出口路线米数一致");

const fallback = data.communities.filter((item) => item.routeQualityNote);
assert(fallback.length === 1 && fallback[0].name === "海淀区清华东路9号院", "异常绕路仅保留一条经验证的高德回退路线");
console.log("MAP ALL PASS ✔");

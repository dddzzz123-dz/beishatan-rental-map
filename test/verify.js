/* test/verify.js — lightweight Node logic verification (no deps) */
"use strict";

const Core = require("../js/core.js");
const data = require("../data/rentals.json");

const listings = (data.listings || []).map(Core.normalize);
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ok  " + msg); }
  else { failures++; console.error("  FAIL " + msg); }
}

console.log("== 数据事实 ==");
assert(listings.length === 69, "总量 = 69 (got " + listings.length + ")");
const comms = Core.communityStats(listings);
assert(Object.keys(comms).length === 10, "小区数 = 10 (got " + Object.keys(comms).length + ")");
const multi = listings.filter((l) => l.photoStatus === "multi").length;
assert(multi === 67, "多图 = 67 (got " + multi + ")");
const noneSingle = listings.length - multi;
assert(noneSingle === 2, "无图/单图 = 2 (got " + noneSingle + ")");
const imgs = listings.reduce((a, l) => a + l.photos.length, 0);
assert(imgs === 602, "相册图总数 = 602 (got " + imgs + ")");
// community inventory sums to 69
const sumInv = Object.keys(comms).reduce((a, c) => a + comms[c].inventory, 0);
assert(sumInv === 69, "小区存量合计 = 69 (got " + sumInv + ")");

console.log("\n== 筛选 ==");
let f = Core.filterByConfig(listings, {});
assert(f.length === 69, "无筛选 = 69 (got " + f.length + ")");
f = Core.filterByConfig(listings, { rooms: [2] });
assert(f.length > 0 && f.every((l) => l.rooms === 2), "仅两居，全部为 2 居 (" + f.length + " 套)");
f = Core.filterByConfig(listings, { rooms: [3] });
assert(f.length > 0 && f.every((l) => l.rooms === 3), "仅三居，全部为 3 居 (" + f.length + " 套)");
f = Core.filterByConfig(listings, { onlyMulti: true });
assert(f.length === 67, "仅多图 = 67 (got " + f.length + ")");
f = Core.filterByConfig(listings, { minRent: 5000, maxRent: 9000 });
assert(f.length > 0 && f.every((l) => l.rentYuanPerMonth >= 5000 && l.rentYuanPerMonth <= 9000), "租金 [5000,9000] 全部命中 (got " + f.length + ")");
f = Core.filterByConfig(listings, { keyword: "中和家园" });
const allHit = f.every((l) => (l.title + l.community + l.businessArea + l.district + l.layout + (l.tags || []).join(" ") + l.area).toLowerCase().includes("中和家园"));
assert(f.length > 0 && allHit, "关键词‘中和家园’命中 (" + f.length + " 套)");
f = Core.filterByConfig(listings, { communities: ["华源冠军城"], onlyMulti: true });
assert(f.length > 0 && f.every((l) => l.community === "华源冠军城" && l.photoStatus === "multi"), "小区+仅多图 组合 (got " + f.length + ")");

console.log("\n== 排序 ==");
const rentAsc = Core.sortListings(listings, "rent_asc");
assert(rentAsc[0].rentYuanPerMonth === Math.min(...listings.map((l) => l.rentYuanPerMonth)), "租金升序首项为最低价");
const rentDesc = Core.sortListings(listings, "rent_desc");
assert(rentDesc[0].rentYuanPerMonth === Math.max(...listings.map((l) => l.rentYuanPerMonth)), "租金降序首项为最高价");
const photoDesc = Core.sortListings(listings, "photos_desc");
assert(photoDesc[0].photoCount >= photoDesc[1].photoCount, "图片多→少 首项 >= 次项");
const fresh = Core.sortListings(listings, "fresh");
assert(Core.maintenanceDays(fresh[0].maintenance) <= Core.maintenanceDays(fresh[1].maintenance), "最新维护排序首项早于次项");

console.log("\n== 分页 ==");
let pg = Core.paginate(listings, 1, 8);
assert(pg.items.length === 8 && pg.total === 69, "第1页 8 套 / 共 69");
assert(pg.pageCount === 9, "页数 = 9 (got " + pg.pageCount + ")");
pg = Core.paginate(listings, 9, 8);
assert(pg.items.length === 69 - 8 * 8, "第9页余 " + (69 - 8 * 8) + " 套 (got " + pg.items.length + ")");
pg = Core.paginate(listings, 99, 8);
assert(pg.page === 9, "超范围页被钳制到 9");

console.log("\n== 统计 ==");
const stats = Core.overallStats(listings, comms);
assert(stats.total === 69, "overallStats.total = 69");
assert(stats.multiCount === 67, "overallStats.multiCount = 67");
assert(stats.communityCount === 10, "overallStats.communityCount = 10");
const medArr = listings.map((l) => l.rentYuanPerMonth).sort((a, b) => a - b);
const expectMedian = medArr[Math.floor(medArr.length / 2)];
assert(stats.medianRent === expectMedian, "Overall median = " + expectMedian + " (got " + stats.medianRent + ")");
// per community median recomputed
const c0 = "南沙滩小区";
const cList = listings.filter((l) => l.community === c0).map((l) => l.rentYuanPerMonth);
assert(comms[c0].inventory === cList.length, c0 + " 存量一致 (" + cList.length + ")");
const cMedian = Core.median(cList);
assert(comms[c0].medianRent === cMedian, c0 + " 中位一致 (" + cMedian + ")");

console.log("\n== median 工具 ==");
assert(Core.median([1, 2, 3]) === 2, "奇数中位数 = 2");
assert(Core.median([1, 2]) === Math.round(1.5) && Core.median([1, 2]) >= 1, "偶数中位数=两数均值");

console.log("\n" + (failures === 0 ? "ALL PASS ✔" : failures + " FAILED ✘"));
process.exit(failures === 0 ? 0 : 1);

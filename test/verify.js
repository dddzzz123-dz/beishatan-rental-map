/* test/verify.js — lightweight Node logic verification (no deps) */
"use strict";

const Core = require("../js/core.js");
const data = require("../data/rentals.json");

const listings = (data.listings || []).map(Core.normalize);
const expected = { total: 86, communities: 16, multi: 67, noneSingle: 19, images: 619, pages: 11 };
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ok  " + msg); }
  else { failures++; console.error("  FAIL " + msg); }
}

console.log("== 数据事实 ==");
assert(listings.length === expected.total, "总量 = " + expected.total + " (got " + listings.length + ")");
const comms = Core.communityStats(listings);
assert(Object.keys(comms).length === expected.communities, "小区数 = " + expected.communities + " (got " + Object.keys(comms).length + ")");
const multi = listings.filter((l) => l.photoStatus === "multi").length;
assert(multi === expected.multi, "多图 = " + expected.multi + " (got " + multi + ")");
const noneSingle = listings.length - multi;
assert(noneSingle === expected.noneSingle, "无图/单图 = " + expected.noneSingle + " (got " + noneSingle + ")");
const imgs = listings.reduce((a, l) => a + l.photos.length, 0);
assert(imgs === expected.images, "相册图总数 = " + expected.images + " (got " + imgs + ")");
// community inventory sums to total
const sumInv = Object.keys(comms).reduce((a, c) => a + comms[c].inventory, 0);
assert(sumInv === expected.total, "小区存量合计 = " + expected.total + " (got " + sumInv + ")");
assert(listings.filter((l) => (l.source || "").includes("安居客")).length === 17, "安居客新增候选 = 17");
assert(listings.filter((l) => l.verificationStatus === "cross_platform_match").length === 1, "跨平台同价核验 = 1");

console.log("\n== 筛选 ==");
let f = Core.filterByConfig(listings, {});
assert(f.length === expected.total, "无筛选 = " + expected.total + " (got " + f.length + ")");
f = Core.filterByConfig(listings, { rooms: [2] });
assert(f.length > 0 && f.every((l) => l.rooms === 2), "仅两居，全部为 2 居 (" + f.length + " 套)");
f = Core.filterByConfig(listings, { rooms: [3] });
assert(f.length > 0 && f.every((l) => l.rooms === 3), "仅三居，全部为 3 居 (" + f.length + " 套)");
f = Core.filterByConfig(listings, { onlyMulti: true });
assert(f.length === expected.multi, "仅多图 = " + expected.multi + " (got " + f.length + ")");
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
assert(pg.items.length === 8 && pg.total === expected.total, "第1页 8 套 / 共 " + expected.total);
assert(pg.pageCount === expected.pages, "页数 = " + expected.pages + " (got " + pg.pageCount + ")");
pg = Core.paginate(listings, expected.pages, 8);
assert(pg.items.length === expected.total - 8 * (expected.pages - 1), "末页余 " + (expected.total - 8 * (expected.pages - 1)) + " 套 (got " + pg.items.length + ")");
pg = Core.paginate(listings, 99, 8);
assert(pg.page === expected.pages, "超范围页被钳制到 " + expected.pages);

console.log("\n== 统计 ==");
const stats = Core.overallStats(listings, comms);
assert(stats.total === expected.total, "overallStats.total = " + expected.total);
assert(stats.multiCount === expected.multi, "overallStats.multiCount = " + expected.multi);
assert(stats.communityCount === expected.communities, "overallStats.communityCount = " + expected.communities);
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

/*
 * core.js — pure data logic shared by the app and the Node verification test.
 * No DOM/window access at definition time; works in the browser (attaches to
 * window.RentalCore) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RentalCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PER_PAGE = 8;

  function parseArea(value) {
    if (value == null) return null;
    var m = String(value).match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  function roomsFromLayout(layout) {
    var m = String(layout || "").match(/(\d+)室/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Maintenance string -> sortable "days ago" key. Unknown -> Infinity (last).
  function maintenanceDays(value) {
    if (value == null) return Infinity;
    var s = String(value);
    var m;
    if (/今天维护/.test(s)) return 0;
    m = s.match(/(\d+)小时前维护/);
    if (m) return parseFloat((parseFloat(m[1]) / 24).toFixed(3));
    m = s.match(/(\d+)分钟内/.test(s) ? /(\d+)分钟内/ : /(\d+)天前维护/);
    if (m) return parseInt(m[1], 10);
    return Infinity;
  }

  function median(values) {
    if (!values || !values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function round0(n) { return Math.round(n); }

  function normalize(l) {
    var photos = (l.photoUrls || []).slice();
    return Object.assign({}, l, {
      rooms: roomsFromLayout(l.layout),
      areaNum: parseArea(l.area),
      photoCount: (l.photoCount != null ? l.photoCount : photos.length),
      photos: photos,
    });
  }

  function communityStats(listings) {
    var map = {};
    listings.forEach(function (l) {
      var c = l.community || "未知";
      if (!map[c]) map[c] = { community: c, rents: [], multi: 0, noneSingle: 0 };
      map[c].rents.push(l.rentYuanPerMonth);
      if (l.photoStatus === "multi") map[c].multi += 1; else map[c].noneSingle += 1;
    });
    var out = {};
    Object.keys(map).forEach(function (c) {
      var g = map[c];
      var r = g.rents;
      out[c] = {
        community: c,
        inventory: r.length,
        minRent: Math.min.apply(null, r),
        maxRent: Math.max.apply(null, r),
        medianRent: median(r),
        averageRent: round0(r.reduce(function (a, b) { return a + b; }, 0) / r.length),
        multi: g.multi,
        noneSingle: g.noneSingle,
      };
    });
    return out;
  }

  function overallStats(listings, communities) {
    var rents = listings.map(function (l) { return l.rentYuanPerMonth; });
    var multi = listings.filter(function (l) { return l.photoStatus === "multi"; }).length;
    return {
      total: listings.length,
      medianRent: median(rents),
      minRent: rents.length ? Math.min.apply(null, rents) : null,
      maxRent: rents.length ? Math.max.apply(null, rents) : null,
      multiCount: multi,
      noneSingleCount: listings.length - multi,
      communityCount: Object.keys(communities || {}).length,
    };
  }

  // cfg: { minRent, maxRent, rooms: [], communities: [], onlyMulti, keyword }
  function filterByConfig(listings, cfg) {
    cfg = cfg || {};
    var kw = (cfg.keyword || "").trim().toLowerCase();
    var rooms = cfg.rooms && cfg.rooms.length ? cfg.rooms : null;
    var comms = cfg.communities && cfg.communities.length ? cfg.communities : null;

    return listings.filter(function (l) {
      var rent = l.rentYuanPerMonth;
      if (cfg.minRent != null && rent < cfg.minRent) return false;
      if (cfg.maxRent != null && rent > cfg.maxRent) return false;
      if (rooms && rooms.indexOf(l.rooms) === -1) return false;
      if (comms && comms.indexOf(l.community) === -1) return false;
      if (cfg.onlyMulti && l.photoStatus !== "multi") return false;
      if (kw) {
        var hay = [
          l.title, l.community, l.businessArea, l.district, l.layout,
          l.orientation, l.floor, (l.tags || []).join(" "), l.area,
        ].join(" ").toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  var SORTERS = {
    rent_asc: function (a, b) { return a.rentYuanPerMonth - b.rentYuanPerMonth; },
    rent_desc: function (a, b) { return b.rentYuanPerMonth - a.rentYuanPerMonth; },
    photos_desc: function (a, b) { return (b.photoCount || 0) - (a.photoCount || 0); },
    fresh: function (a, b) { return maintenanceDays(a.maintenance) - maintenanceDays(b.maintenance); },
  };

  function sortListings(listings, key) {
    var fn = SORTERS[key] || SORTERS.rent_asc;
    return listings.slice().sort(fn);
  }

  function paginate(listings, page, perPage) {
    perPage = perPage || PER_PAGE;
    var pageCount = Math.max(1, Math.ceil(listings.length / perPage));
    var p = Math.min(Math.max(1, page), pageCount);
    var start = (p - 1) * perPage;
    return {
      items: listings.slice(start, start + perPage),
      page: p,
      pageCount: pageCount,
      total: listings.length,
      perPage: perPage,
    };
  }

  function defaultConfig() {
    return {
      minRent: null,
      maxRent: null,
      rooms: [],
      communities: [],
      onlyMulti: false,
      keyword: "",
      sort: "rent_asc",
      page: 1,
      favOnly: false,
    };
  }

  return {
    PER_PAGE: PER_PAGE,
    parseArea: parseArea,
    roomsFromLayout: roomsFromLayout,
    maintenanceDays: maintenanceDays,
    median: median,
    normalize: normalize,
    communityStats: communityStats,
    overallStats: overallStats,
    filterByConfig: filterByConfig,
    sortListings: sortListings,
    paginate: paginate,
    SORTERS: SORTERS,
    defaultConfig: defaultConfig,
  };
});

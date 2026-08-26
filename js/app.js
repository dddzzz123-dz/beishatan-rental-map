/* ============================================================
   app.js — 北沙滩·看房手册 前端逻辑
   无后端；数据来自 data/rentals.js (window.RENTALS_DATA)
   ============================================================ */
(function () {
  "use strict";

  var Core = window.RentalCore;
  var DATA = window.RENTALS_DATA || { listings: [] };

  var LS_FAVS = "bs_favs";
  var LS_COMPARE = "bs_compare";
  var LS_STATE = "bs_state";
  var PER_PAGE = Core.PER_PAGE; // 8

  // ---- normalized listings ----
  var listings = (DATA.listings || []).map(Core.normalize);
  var allCommunities = Object.keys(Core.communityStats(listings));
  allCommunities.sort(function (a, b) { return Core.communityStats(listings)[b].inventory - Core.communityStats(listings)[a].inventory || a.localeCompare(b, "zh"); });

  // ---- rent bounds (slider) ----
  var rentArr = listings.map(function (l) { return l.rentYuanPerMonth; });
  var BOUND_MIN = Math.floor(Math.min.apply(null, rentArr) / 500) * 500;
  var BOUND_MAX = Math.ceil(Math.max.apply(null, rentArr) / 500) * 500;

  // ---- state ----
  var state = {
    minRent: BOUND_MIN,
    maxRent: BOUND_MAX,
    rooms: [2, 3],
    communities: [],
    onlyMulti: false,
    keyword: "",
    sort: "rent_asc",
    page: 1,
    favOnly: false,
  };

  // ---- persisted sets ----
  var favs = loadList(LS_FAVS);
  var compares = loadList(LS_COMPARE);

  // ---- gallery index cache (per houseCode) ----
  var galleryIndex = {};
  var detailHouse = null;
  var detailPhotoIndex = 0;
  var detailReturnFocus = null;

  // ---- dom refs ----
  var $ = function (id) { return document.getElementById(id); };
  var byId = {
    statCurrent: $("statCurrent"), statTotal: $("statTotal"), statMedian: $("statMedian"), statMulti: $("statMulti"),
    conditions: $("conditions"),
    commGrid: $("commGrid"), toggleComm: $("toggleComm"),
    cards: $("cards"), empty: $("empty"), resultsMeta: $("resultsMeta"),
    pagination: $("pagination"),
    favToggle: $("favToggle"), favCount: $("favCount"),
    compareBar: $("compareBar"), compareCount: $("compareCount"), compareClear: $("compareClear"), compareOpen: $("compareOpen"),
    compareGrid: $("compareGrid"), detailBody: $("detailBody"),
    scrim: $("scrim"),
  };

  var sheets = {
    filter: $("filterSheet"), sort: $("sortSheet"), compare: $("compareSheet"), info: $("infoSheet"), detail: $("detailSheet"),
  };
  var sheetClose = {
    filter: $("filterClose"), sort: $("sortClose"), compare: $("compareClose"), info: $("infoClose"), detail: $("detailClose"),
  };
  var filterEls = {
    rangeWrap: $("rangeWrap"), rangeReadout: $("rangeReadout"),
    roomChips: $("roomChips"), onlyMulti: $("onlyMulti"), keyword: $("keyword"), commList: $("commList"),
    reset: $("resetFilters"),
  };

  /* ---------- persistence helpers ---------- */
  function loadList(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveList(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }

  function loadState() {
    var params = new URLSearchParams(window.location.search);
    function num(k, d) { var v = params.get(k); return v == null || v === "" ? d : Number(v); }
    function str(k, d) { var v = params.get(k); return v == null ? d : v; }
    function list(k, d) { var v = params.get(k); return v ? v.split(",").filter(Boolean) : d; }
    var fresh = {
      minRent: paramNumRange(params, "rmin", BOUND_MIN, BOUND_MIN, BOUND_MAX),
      maxRent: paramNumRange(params, "rmax", BOUND_MAX, BOUND_MIN, BOUND_MAX),
      rooms: list("rooms", [2, 3]).map(Number).filter(function (n) { return n === 2 || n === 3; }),
      communities: list("comm", []),
      onlyMulti: params.get("multi") === "1",
      keyword: str("kw", ""),
      sort: str("sort", "rent_asc") in Core.SORTERS ? str("sort", "rent_asc") : "rent_asc",
      page: Math.max(1, Math.floor(num("page", 1))),
      favOnly: params.get("fav") === "1",
    };
    if (!fresh.rooms.length) fresh.rooms = [2, 3];
    return fresh;
  }
  function paramNumRange(params, key, dflt, lo, hi) {
    var v = params.get(key);
    if (v == null || v === "") return dflt;
    var n = Number(v);
    if (isNaN(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }

  function serializeState() {
    var p = new URLSearchParams();
    p.set("rmin", String(state.minRent));
    p.set("rmax", String(state.maxRent));
    if (state.rooms.length) p.set("rooms", state.rooms.slice().sort().join(","));
    if (state.communities.length) p.set("comm", state.communities.join(","));
    if (state.onlyMulti) p.set("multi", "1");
    if (state.keyword) p.set("kw", state.keyword);
    if (state.sort !== "rent_asc") p.set("sort", state.sort);
    if (state.page > 1) p.set("page", String(state.page));
    if (state.favOnly) p.set("fav", "1");
    var q = p.toString();
    return q ? ("?" + q) : window.location.pathname;
  }
  function persistState() {
    var url = serializeState();
    try { history.replaceState(null, "", url); } catch (e) { /* file:// may not allow replaceState */ }
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------- selectors / filtering ---------- */
  function familyOf(listing) { return listing; }

  function getFiltered() {
    var cfg = {
      minRent: state.minRent,
      maxRent: state.maxRent,
      rooms: state.rooms,
      communities: state.communities,
      onlyMulti: state.onlyMulti,
      keyword: state.keyword,
    };
    var filtered = Core.filterByConfig(listings, cfg);
    if (state.favOnly) {
      var favSet = new Set(favs);
      filtered = filtered.filter(function (l) { return favSet.has(l.houseCode); });
    }
    return Core.sortListings(filtered, state.sort);
  }

  /* ---------- live summary ---------- */
  function renderSummary(filtered) {
    var rents = filtered.map(function (l) { return l.rentYuanPerMonth; });
    var multi = filtered.filter(function (l) { return l.photoStatus === "multi"; }).length;
    byId.statCurrent.textContent = String(filtered.length);
    byId.statTotal.textContent = String(listings.length);
    byId.statMedian.textContent = rents.length ? ("¥" + formatMoney(Core.median(rents))) : "—";
    byId.statMulti.textContent = String(multi);
  }

  function formatMoney(n) {
    if (n == null) return "—";
    return Math.round(n).toLocaleString("zh-CN");
  }
  function fmtArea(a) { return a == null ? "" : a.replace(/\s*㎡/, "㎡"); }

  /* ---------- conditions (active filter chips) ---------- */
  function renderConditions() {
    var c = byId.conditions;
    var chips = [];
    function add(label, removeFn, key) {
      chips.push('<span class="chip"><span>' + label + "</span><button type=\"button\" data-chip=\"" + key + "\" aria-label=\"移除 " + label + "\">×</button></span>");
    }
    if (state.minRent > BOUND_MIN || state.maxRent < BOUND_MAX) {
      add(formatMoney(state.minRent) + "–" + formatMoney(state.maxRent) + " 元", null, "rent");
    }
    if (state.rooms.length < 2) {
      add(state.rooms.map(function (r) { return r + "居"; }).join("/"), null, "rooms");
    }
    if (state.onlyMulti) add("仅多图", null, "multi");
    if (state.keyword) add("关键词：" + state.keyword, null, "kw");
    if (state.communities.length) add("小区：" + state.communities.length + " 个", null, "comm");
    if (state.favOnly) add("只看收藏", null, "fav");
    var hasActive = chips.length > 0;
    c.innerHTML = chips.join("") + (hasActive ? '<button class="chip-reset" type="button" data-chip="all">清除全部</button>' : "");
    c.querySelectorAll("[data-chip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-chip");
        if (key === "all") { resetFilters(); return; }
        if (key === "rent") { state.minRent = BOUND_MIN; state.maxRent = BOUND_MAX; }
        if (key === "rooms") { state.rooms = [2, 3]; }
        if (key === "multi") { state.onlyMulti = false; }
        if (key === "kw") { state.keyword = ""; filterEls.keyword.value = ""; }
        if (key === "comm") { state.communities = []; }
        if (key === "fav") { state.favOnly = false; }
        resetPage(); render(); syncFilterControls();
      });
    });
  }

  /* ---------- community overview grid ---------- */
  var commCollapsed = false;
  function renderCommGrid() {
    var stats = Core.communityStats(listings);
    var commSet = new Set(state.communities);
    var html = allCommunities.map(function (c) {
      var s = stats[c];
      var active = commSet.has(c) ? "is-active" : "";
      return (
        '<button type="button" class="comm-card ' + active + '" data-comm="' + esc(c) + '" aria-pressed="' + (commSet.has(c)) + '">' +
          '<p class="comm-name">' + esc(c) + '</p>' +
          '<p class="comm-meta">' + (s.multi + s.noneSingle) + " 套在租 · " + (s.multi > 0 ? s.multi + " 多图" : "无多图") + "</p>" +
          '<div class="comm-stats">' +
            '<span><b>' + s.inventory + "</b> 存量</span>" +
            "<span>最低 <b>¥" + formatMoney(s.minRent) + "</b></span>" +
            "<span>中位 <b>¥" + formatMoney(s.medianRent) + "</b></span>" +
            "<span>均价 <b>¥" + formatMoney(s.averageRent) + "</b></span>" +
          "</div>" +
          '<p class="comm-note">' + (s.noneSingle > 0 ? "含 " + s.noneSingle + " 套无图/单图" : "均为多图") + "</p>" +
        "</button>"
      );
    }).join("");
    byId.commGrid.innerHTML = html;
    byId.commGrid.hidden = commCollapsed;
    byId.toggleComm.textContent = commCollapsed ? "展开" : "收起";
    byId.commGrid.querySelectorAll("[data-comm]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = btn.getAttribute("data-comm");
        var set = new Set(state.communities);
        if (set.has(c)) set.delete(c); else set.add(c);
        state.communities = Array.from(set);
        resetPage(); render(); syncFilterControls();
        window.dispatchEvent(new CustomEvent("rental:community-focus", { detail: { community: c } }));
      });
    });
  }

  /* ---------- result cards ---------- */
  function renderCards(items) {
    var html = items.map(renderCard).join("");
    byId.cards.innerHTML = html;
    byId.empty.hidden = items.length > 0;
    // lazy-load image appear handler
    byId.cards.querySelectorAll(".g-img").forEach(function (img) {
      if (img.complete && img.naturalWidth) { img.classList.add("is-loaded"); }
      img.addEventListener("load", function () { img.classList.add("is-loaded"); });
      img.addEventListener("error", function () { handleImgError(img); });
    });
  }

  function handleImgError(img) {
    var card = img.closest(".card");
    var ph = img.closest(".gallery") && img.closest(".gallery").querySelector(".ph");
    if (ph) {
      ph.hidden = false;
      ph.textContent = "图片加载失败";
      img.style.visibility = "hidden";
    } else {
      var holder = document.createElement("div");
      holder.className = "ph"; holder.textContent = "图片加载失败";
      img.parentNode.appendChild(holder); img.style.visibility = "hidden";
    }
  }

  function photoCountOf(listing) { return listing.photos.length || (listing.coverUrl ? 1 : 0); }

  function sourceName(listing) {
    return String(listing.source || "").indexOf("安居客") !== -1 ? "安居客" : "贝壳";
  }

  function sourceLinkLabel(listing, longForm) {
    var platform = sourceName(listing);
    return longForm ? "查看" + platform + "原房源" : platform + "房源";
  }

  function listingFreshness(listing) {
    if (listing.maintenance) return listing.maintenance;
    return (listing.snapshotDate || "日期未知") + " · " + sourceName(listing);
  }

  function renderCard(l) {
    var n = photoCountOf(l);
    var low = l.photoStatus !== "multi" || n <= 1;
    var firstUrl = l.photos[0] || l.coverUrl || null;
    var badge = low
      ? '<span class="badge-low">' + (n > 0 ? n + " 图" : "无图") + "</span>"
      : '<span class="badge-count">' + n + " 张</span>";
    var pager = n > 0 ? '<span class="pager">第 1 / ' + n + ' 张</span>' : "";
    var arrows = (n > 1 && !low)
      ? '<button type="button" class="gallery-btn prev" data-action="gallery-prev" aria-label="上一张">‹</button>' +
        '<button type="button" class="gallery-btn next" data-action="gallery-next" aria-label="下一张">›</button>'
      : "";
    var isFav = favs.indexOf(l.houseCode) !== -1 ? "is-fav" : "";
    var isCmp = compares.indexOf(l.houseCode) !== -1 ? "is-in" : "";
    var favLabel = isFav ? "★ 已收藏" : "☆ 收藏";
    var cmpLabel = isCmp ? "对比中" : "对比";
    var title = (l.title || "").replace(/^整租·/, "整租·").trim();

    return (
      '<article class="card" data-house="' + esc(l.houseCode) + '">' +
        '<div class="gallery" data-gallery="' + esc(l.houseCode) + '">' +
          (firstUrl
            ? '<img class="g-img" src="' + esc(firstUrl) + '" alt="' + esc(title) + (n > 1 ? " 图 1/" + n + " 张" : "") + '" loading="lazy" referrerpolicy="no-referrer" data-idx="0">'
            : "") +
          '<div class="ph" hidden>暂无图片</div>' +
          pager + badge + arrows +
          '<button class="gallery-open" type="button" data-action="detail" data-house="' + esc(l.houseCode) + '" aria-label="打开 ' + esc(title) + ' 大图详情"></button>' +
        "</div>" +
        '<div class="card-body">' +
          '<div class="rent-row">' +
            '<span class="rent">¥' + formatMoney(l.rentYuanPerMonth) + '<span class="unit">/月</span></span>' +
            "<span class=\"rent-sub\">" + esc(fmtArea(l.area)) + " · " + esc(l.layout) + "</span>" +
          "</div>" +
          '<p class="comm-line">' + esc(l.community) + '<span class="dot">·</span>' + esc(l.businessArea) + "</p>" +
          '<div class="meta-line">' +
            "<span>" + esc(l.floor || "楼层未知") + "</span>" +
            "<span>" + esc(listingFreshness(l)) + "</span>" +
          "</div>" +
          '<div class="tag-list">' + renderTags(l.tags) + "</div>" +
          '<div class="card-actions">' +
            '<button type="button" class="btn btn-detail" data-action="detail" data-house="' + esc(l.houseCode) + '">大图详情</button>' +
            '<button type="button" class="btn btn-fav ' + isFav + '" data-action="fav" data-house="' + esc(l.houseCode) + '" aria-pressed="' + isFav + '">' + favLabel + "</button>" +
            '<button type="button" class="btn cmp-btn ' + isCmp + '" data-action="compare" data-house="' + esc(l.houseCode) + '" aria-pressed="' + isCmp + '">' + cmpLabel + "</button>" +
            '<a class="btn btn-link" href="' + esc(l.detailUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(sourceLinkLabel(l, true)) + '">' + esc(sourceLinkLabel(l, false)) + '<span class="ext">↗</span></a>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return "";
    return tags.map(function (t) {
      var cls = "";
      if (t === "官方核验") cls = "tag-red";
      else if (t === "近地铁" || t === "自营") cls = "tag-plum";
      return '<span class="tag ' + cls + '">' + esc(t) + "</span>";
    }).join("");
  }

  /* ---------- gallery ---------- */
  function setGallery(house, idx) {
    var card = byId.cards.querySelector('[data-house="' + cssEscape(house) + '"]');
    if (!card) return;
    var gallery = card.querySelector(".gallery");
    var img = gallery.querySelector(".g-img");
    var pager = gallery.querySelector(".pager");
    var prev = gallery.querySelector(".gallery-btn.prev");
    var next = gallery.querySelector(".gallery-btn.next");
    var l = listingByHouse(house);
    var n = photoCountOf(l);
    if (!n) return;
    var safeIdx = Math.max(0, Math.min(n - 1, idx));
    var url = l.photos[safeIdx] || l.coverUrl;
    if (img) {
      img.src = url;
      img.setAttribute("alt", (l.title || "") + " 图 " + (safeIdx + 1) + "/" + n + " 张");
      img.setAttribute("data-idx", String(safeIdx));
      img.classList.remove("is-loaded");
      img.style.visibility = "";
      var ph = gallery.querySelector(".ph");
      if (ph) ph.hidden = true;
      var oldErr = img.onerror; img.onerror = function () { handleImgError(img); };
    }
    if (pager) pager.textContent = "第 " + (safeIdx + 1) + " / " + n + " 张";
    if (prev) prev.disabled = safeIdx <= 0;
    if (next) next.disabled = safeIdx >= n - 1;
    galleryIndex[house] = safeIdx;
  }

  function listingByHouse(house) {
    for (var i = 0; i < listings.length; i++) if (listings[i].houseCode === house) return listings[i];
    return null;
  }

  /* ---------- full listing detail ---------- */
  function detailPhotos(l) {
    if (!l) return [];
    return l.photos.length ? l.photos : (l.coverUrl ? [l.coverUrl] : []);
  }

  function openListingDetail(house, trigger) {
    var l = listingByHouse(house);
    if (!l) return;
    detailHouse = house;
    detailPhotoIndex = 0;
    detailReturnFocus = trigger || document.activeElement;
    renderListingDetail();
    openSheet("detail");
    document.body.classList.add("detail-open");
    $("detailTitle").textContent = l.community + " · " + l.layout;
    setDetailParam(house);
    setTimeout(function () { $("detailClose").focus(); }, 0);
  }

  function renderListingDetail() {
    var l = listingByHouse(detailHouse);
    if (!l) return;
    var photos = detailPhotos(l);
    var n = photos.length;
    if (n) detailPhotoIndex = (detailPhotoIndex + n) % n;
    else detailPhotoIndex = 0;
    var main = n
      ? '<img class="detail-main-img" src="' + esc(photos[detailPhotoIndex]) + '" alt="' + esc(l.title) + '，第 ' + (detailPhotoIndex + 1) + '/' + n + ' 张" referrerpolicy="no-referrer">'
      : '<div class="detail-no-photo">此房源暂无可用图片</div>';
    var thumbs = photos.map(function (url, i) {
      return '<button type="button" class="detail-thumb' + (i === detailPhotoIndex ? " is-active" : "") + '" data-detail-index="' + i + '" aria-label="查看第 ' + (i + 1) + ' 张图"><img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></button>';
    }).join("");
    var isFav = favs.indexOf(l.houseCode) !== -1;
    var isCmp = compares.indexOf(l.houseCode) !== -1;
    byId.detailBody.innerHTML =
      '<div class="detail-gallery">' +
        '<div class="detail-stage">' + main +
          (n > 1 ? '<button class="detail-arrow prev" type="button" data-detail-step="-1" aria-label="上一张">‹</button><button class="detail-arrow next" type="button" data-detail-step="1" aria-label="下一张">›</button>' : "") +
          '<span class="detail-counter">' + (n ? (detailPhotoIndex + 1) + " / " + n : "无图") + '</span>' +
        '</div>' +
        (n > 1 ? '<div class="detail-thumbs" aria-label="房源图片缩略图">' + thumbs + '</div>' : "") +
      '</div>' +
      '<aside class="detail-info">' +
        '<div class="detail-price">¥' + formatMoney(l.rentYuanPerMonth) + '<span>/月</span></div>' +
        '<h3>' + esc(l.title) + '</h3>' +
        '<p class="detail-place">' + esc(l.community) + ' · ' + esc(l.businessArea) + ' · ' + esc(l.district) + '</p>' +
        '<dl class="detail-facts">' +
          '<div><dt>户型</dt><dd>' + esc(l.layout || "—") + '</dd></div>' +
          '<div><dt>面积</dt><dd>' + esc(fmtArea(l.area) || "—") + '</dd></div>' +
          '<div><dt>朝向</dt><dd>' + esc(l.orientation || "—") + '</dd></div>' +
          '<div><dt>楼层</dt><dd>' + esc(l.floor || "—") + '</dd></div>' +
          '<div><dt>维护</dt><dd>' + esc(l.maintenance || "未知") + '</dd></div>' +
          '<div><dt>图片</dt><dd>' + n + ' 张</dd></div>' +
        '</dl>' +
        '<div class="tag-list detail-tags">' + renderTags(l.tags) + '</div>' +
        '<p class="detail-note">采集于 ' + esc(l.snapshotDate || "未知日期") + '；库存和价格以' + esc(sourceName(l)) + '页面实时信息为准。</p>' +
        '<div class="detail-actions">' +
          '<button type="button" class="btn btn-fav ' + (isFav ? "is-fav" : "") + '" data-detail-action="fav">' + (isFav ? "★ 已收藏" : "☆ 收藏") + '</button>' +
          '<button type="button" class="btn cmp-btn ' + (isCmp ? "is-in" : "") + '" data-detail-action="compare">' + (isCmp ? "对比中" : "加入对比") + '</button>' +
          '<a class="btn btn-link detail-source" href="' + esc(l.detailUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(sourceLinkLabel(l, true)) + ' <span class="ext">↗</span></a>' +
        '</div>' +
      '</aside>';
    var activeThumb = byId.detailBody.querySelector(".detail-thumb.is-active");
    if (activeThumb) activeThumb.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function stepDetail(delta) {
    var l = listingByHouse(detailHouse);
    var n = detailPhotos(l).length;
    if (n <= 1) return;
    detailPhotoIndex = (detailPhotoIndex + delta + n) % n;
    renderListingDetail();
  }

  function setDetailParam(house) {
    try {
      var url = new URL(window.location.href);
      if (house) url.searchParams.set("listing", house); else url.searchParams.delete("listing");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  /* ---------- pagination ---------- */
  function renderPagination(pageInfo) {
    var nav = byId.pagination;
    if (pageInfo.pageCount <= 1) { nav.innerHTML = ""; return; }
    var html = '<button type="button" class="page-btn" data-page="' + (pageInfo.page - 1) + '" ' + (pageInfo.page <= 1 ? "disabled" : "") + ' aria-label="上一页">‹ 上一页</button>';
    for (var p = 1; p <= pageInfo.pageCount; p++) {
      html += '<button type="button" class="page-btn' + (p === pageInfo.page ? " is-active" : "") + '" data-page="' + p + '" aria-current="' + (p === pageInfo.page ? "page" : "false") + '">' + p + "</button>";
    }
    html += '<button type="button" class="page-btn" data-page="' + (pageInfo.page + 1) + '" ' + (pageInfo.page >= pageInfo.pageCount ? "disabled" : "") + ' aria-label="下一页">下一页 ›</button>';
    nav.innerHTML = html;
    nav.querySelectorAll("[data-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        state.page = Number(btn.getAttribute("data-page"));
        render(); persistState();
      });
    });
  }

  /* ---------- compare ---------- */
  function renderCompareBar() {
    var n = compares.length;
    byId.compareBar.hidden = n === 0;
    byId.compareCount.textContent = "已选 " + n + " / 4";
  }
  function openCompareSheet() {
    if (!compares.length) { toast("请先加入要对比的房源"); return; }
    byId.compareGrid.innerHTML = compares.map(function (h) {
      var l = listingByHouse(h);
      if (!l) return "";
      return (
        '<div class="compare-item" data-house="' + esc(h) + '">' +
          '<button type="button" class="cmp-remove" data-cmp-remove="' + esc(h) + '" aria-label="移除对比">×</button>' +
          (l.photos[0] ? '<img src="' + esc(l.photos[0]) + '" alt="' + esc(l.title || "") + ' 主图" loading="lazy" referrerpolicy="no-referrer">' : "") +
          '<div class="cmp-head"><span class="cmp-rent">¥' + formatMoney(l.rentYuanPerMonth) + '</span><span class="cmp-title">' + esc(l.layout) + "</span></div>" +
          '<dl>' +
            "<dt>面积</dt><dd>" + esc(fmtArea(l.area)) + "</dd>" +
            "<dt>小区</dt><dd>" + esc(l.community) + "</dd>" +
            "<dt>商圈</dt><dd>" + esc(l.businessArea) + "</dd>" +
            "<dt>楼层</dt><dd>" + esc(l.floor || "未知") + "</dd>" +
            "<dt>图片</dt><dd>" + photoCountOf(l) + " 张</dd>" +
            "<dt>标签</dt><dd>" + esc((l.tags || []).slice(0, 4).join(" · ")) + "</dd>" +
          "</dl>" +
          '<div class="cmp-actions">' +
            '<a class="btn btn-link" href="' + esc(l.detailUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(sourceLinkLabel(l, true)) + '<span class="ext">↗</span></a>' +
          "</div>" +
        "</div>"
      );
    }).join("");
    openSheet("compare");
    byId.compareGrid.querySelectorAll("[data-cmp-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var h = btn.getAttribute("data-cmp-remove");
        compares = compares.filter(function (x) { return x !== h; });
        saveList(LS_COMPARE, compares); renderCompareBar(); openCompareSheet();
      });
    });
  }

  /* ---------- favorites ---------- */
  function toggleFav(house) {
    var i = favs.indexOf(house);
    if (i !== -1) favs.splice(i, 1); else favs.push(house);
    saveList(LS_FAVS, favs);
    byId.favCount.textContent = String(favs.length);
    render();
  }
  function toggleCompare(house) {
    var i = compares.indexOf(house);
    if (i !== -1) { compares.splice(i, 1); }
    else {
      if (compares.length >= 4) { toast("最多对比 4 套"); return; }
      compares.push(house);
    }
    saveList(LS_COMPARE, compares);
    renderCompareBar();
    render();
  }

  /* ---------- filter controls render ---------- */
  function syncFilterControls() {
    // room chips
    filterEls.roomChips.innerHTML = [2, 3].map(function (r) {
      var on = state.rooms.indexOf(r) !== -1;
      return '<button type="button" class="room-chip' + (on ? " is-active" : "") + '" data-room="' + r + '" aria-pressed="' + on + '">' + r + "居</button>";
    }).join("");
    filterEls.roomChips.querySelectorAll("[data-room]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var r = Number(btn.getAttribute("data-room"));
        var idx = state.rooms.indexOf(r);
        if (idx !== -1) state.rooms.splice(idx, 1); else state.rooms.push(r);
        if (!state.rooms.length) { state.rooms = [2, 3]; }
        resetPage(); syncFilterControls(); render(); persistState();
      });
    });
    // onlyMulti
    filterEls.onlyMulti.checked = state.onlyMulti;
    // keyword
    if (document.activeElement !== filterEls.keyword) filterEls.keyword.value = state.keyword;
    // community list
    var stats = Core.communityStats(listings);
    filterEls.commList.innerHTML = allCommunities.map(function (c) {
      var on = state.communities.indexOf(c) !== -1;
      return '<label><input type="checkbox" value="' + esc(c) + '"' + (on ? " checked" : "") + "><span>" + esc(c) + '</span><span class="comm-count">' + stats[c].inventory + "</span></label>";
    }).join("");
    filterEls.commList.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () {
        var c = input.value;
        var set = new Set(state.communities);
        if (input.checked) set.add(c); else set.delete(c);
        state.communities = Array.from(set);
        resetPage(); render(); persistState(); syncFilterControls();
      });
    });
    // rent range fill + readout
    updateRange();
  }

  function updateRange() {
    var pct = function (v) { return ((v - BOUND_MIN) / (BOUND_MAX - BOUND_MIN)) * 100; };
    var lo = pct(state.minRent), hi = pct(state.maxRent);
    var fill = filterEls.rangeWrap.querySelector(".range-fill");
    if (fill) { fill.style.left = lo + "%"; fill.style.width = Math.max(0, hi - lo) + "%"; }
    filterEls.rangeReadout.textContent = "¥" + formatMoney(state.minRent) + " – ¥" + formatMoney(state.maxRent) + " /月";
  }

  function buildRangeInputs() {
    filterEls.rangeWrap.innerHTML =
      '<div class="range-track"></div><div class="range-fill"></div>' +
      '<input type="range" class="range-min" aria-label="最低租金" min="' + BOUND_MIN + '" max="' + BOUND_MAX + '" step="100">' +
      '<input type="range" class="range-max" aria-label="最高租金" min="' + BOUND_MIN + '" max="' + BOUND_MAX + '" step="100">';
    var minInput = filterEls.rangeWrap.querySelector(".range-min");
    var maxInput = filterEls.rangeWrap.querySelector(".range-max");
    minInput.value = state.minRent;
    maxInput.value = state.maxRent;
    var cache = null;
    function onMove() {
      var lo = Math.min(Number(minInput.value), Number(maxInput.value));
      var hi = Math.max(Number(minInput.value), Number(maxInput.value));
      minInput.value = lo; maxInput.value = hi;
      state.minRent = lo; state.maxRent = hi;
      updateRange();
      clearTimeout(cache);
      cache = setTimeout(function () { resetPage(); render(); persistState(); }, 140);
    }
    minInput.addEventListener("input", onMove);
    maxInput.addEventListener("input", onMove);
  }

  function renderSortOptions() {
    var opts = [
      ["rent_asc", "租金 低 → 高"],
      ["rent_desc", "租金 高 → 低"],
      ["photos_desc", "图片 多 → 少"],
      ["fresh", "最新维护优先"],
    ];
    $("sortBody").innerHTML = opts.map(function (o) {
      var on = state.sort === o[0];
      return '<button type="button" class="sort-option' + (on ? " is-active" : "") + '" data-sort="' + o[0] + '">' + o[1] + '<span class="check-mark">' + (on ? "✓" : "") + "</span></button>";
    }).join("");
    $("sortBody").querySelectorAll("[data-sort]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.sort = btn.getAttribute("data-sort");
        resetPage(); renderSortOptions(); render(); persistState();
      });
    });
  }

  /* ---------- sheet open/close ---------- */
  var openSheetName = null;
  function openSheet(name) {
    Object.keys(sheets).forEach(function (k) { sheets[k].hidden = true; });
    sheets[name].hidden = false;
    byId.scrim.hidden = false;
    openSheetName = name;
  }
  function closeSheets() {
    var wasDetail = openSheetName === "detail";
    Object.keys(sheets).forEach(function (k) { sheets[k].hidden = true; });
    byId.scrim.hidden = true;
    openSheetName = null;
    document.body.classList.remove("detail-open");
    if (wasDetail) {
      setDetailParam(null);
      detailHouse = null;
      if (detailReturnFocus && document.contains(detailReturnFocus)) detailReturnFocus.focus();
    }
  }

  /* ---------- toast ---------- */
  var toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1400);
  }

  /* ---------- main render ---------- */
  function resetPage() { state.page = 1; }

  function render() {
    var sorted = getFiltered();
    var pageInfo = Core.paginate(sorted, state.page, PER_PAGE);

    // clamp page if out of range
    if (state.page > pageInfo.pageCount) { state.page = pageInfo.pageCount; pageInfo = Core.paginate(sorted, state.page, PER_PAGE); }

    renderSummary(sorted);
    renderConditions();
    renderCommGrid();
    renderCards(pageInfo.items);
    renderPagination(pageInfo);
    renderCompareBar();
    byId.favCount.textContent = String(favs.length);
    byId.favToggle.classList.toggle("is-active", state.favOnly);
    byId.resultsMeta.textContent = "共 " + sorted.length + " 套 · " + (pageInfo.pageCount > 1 ? "第 " + pageInfo.page + " / " + pageInfo.pageCount + " 页" : "单页");
    renderSortOptions();
    if (!state.favOnly) byId.favToggle.classList.remove("is-active");
  }

  /* ---------- info modal ---------- */
  function renderInfo() {
    var snapshots = DATA.sourceSnapshots || [];
    var snapshotText = snapshots.length
      ? snapshots.map(function (item) { return item.platform + " " + item.date + "（" + (item.count || item.walkableWholeRent || 0) + " 套）"; }).join("；")
      : (DATA.updatedAt || "未知");
    $("infoBody").innerHTML =
      '<div class="info-block">' +
        '<div class="info-kv"><b>采集快照</b><span>' + esc(snapshotText) + '</span></div>' +
        '<div class="info-kv"><b>数据来源</b><span>贝壳详情相册快照 + 安居客公开列表页交叉更新</span></div>' +
        '<div class="info-kv"><b>候选库</b><span>' + listings.length + " 套整租两居/三居 · " + allCommunities.length + " 个小区（跨平台近似重复已去重）</span></div>" +
        '<div class="info-kv"><b>图片</b><span>' + listings.filter(function (l) { return l.photoStatus === "multi"; }).length + " 套多图 · " + listings.length + " 套共" + listings.reduce(function (a, l) { return a + photoCountOf(l); }, 0) + " 张相册图</span></div>" +
      "</div>" +
      '<div class="info-note"><strong>重要说明</strong>：<ul>' +
        "<li>地图中的步行距离和时间来自高德 Web 服务，并比较北沙滩站 A、B1、B2、C 四个出口后选择最短路线；入口缺失时以 POI 中心点起算。</li>" +
        "<li>贝壳为 8 月 24 日相册快照；安居客于 8 月 26 日读取公开首屏，第二页遇验证即停止。<b>这是候选库，不代表任一平台穷尽库存</b>。</li>" +
        "<li>“多图”按 ≥2 张真实房源图片判定；无图/单图房源已单独标注，不伪造成多图。</li>" +
        "<li>本页为纯静态工具，无第三方追踪、无 Cookie 读取、无密钥；外链使用 <code>noopener noreferrer</code>。</li>" +
        "<li>收藏与对比仅保存在本机 localStorage。</li>" +
      "</ul></div>";
  }

  /* ---------- main ---------- */
  function resetFilters() {
    state.minRent = BOUND_MIN; state.maxRent = BOUND_MAX;
    state.rooms = [2, 3]; state.communities = []; state.onlyMulti = false;
    state.keyword = ""; state.sort = "rent_asc"; state.page = 1; state.favOnly = false;
    filterEls.keyword.value = "";
    filterEls.onlyMulti.checked = false;
    render(); syncFilterControls(); persistState();
  }

  function initStateAndHandlers() {
    var requestedListing = new URLSearchParams(window.location.search).get("listing");
    var s = loadState();
    state = Object.assign(state, s);

    // elements
    buildRangeInputs();
    syncFilterControls();
    renderInfo();
    render();
    persistState();

    if (requestedListing && listingByHouse(requestedListing)) openListingDetail(requestedListing);

    // header fav count
    byId.favCount.textContent = String(favs.length);

    // toolbar
    $("openFilter").addEventListener("click", function () { openSheet("filter"); });
    $("openSort").addEventListener("click", function () { openSheet("sort"); });
    $("openInfo").addEventListener("click", function () { openSheet("info"); });
    byId.favToggle.addEventListener("click", function () {
      state.favOnly = !state.favOnly; resetPage(); render(); persistState(); syncFilterControls();
    });

    // sheets close
    Object.keys(sheetClose).forEach(function (k) {
      sheetClose[k].addEventListener("click", closeSheets);
    });
    byId.scrim.addEventListener("click", closeSheets);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSheets();
      else if (openSheetName === "detail" && e.key === "ArrowLeft") stepDetail(-1);
      else if (openSheetName === "detail" && e.key === "ArrowRight") stepDetail(1);
    });

    // filter controls
    filterEls.reset.addEventListener("click", resetFilters);
    filterEls.onlyMulti.addEventListener("change", function () {
      state.onlyMulti = filterEls.onlyMulti.checked; resetPage(); render(); persistState();
    });
    filterEls.keyword.addEventListener("input", function () {
      state.keyword = filterEls.keyword.value; resetPage(); render(); persistState();
    });

    // community collapse
    byId.toggleComm.addEventListener("click", function () {
      commCollapsed = !commCollapsed; renderCommGrid();
    });

    // comparison bar
    byId.compareClear.addEventListener("click", function () { compares = []; saveList(LS_COMPARE, compares); renderCompareBar(); render(); });
    byId.compareOpen.addEventListener("click", openCompareSheet);

    window.addEventListener("rental:filter-community", function (event) {
      var community = event.detail && event.detail.community;
      if (!community || allCommunities.indexOf(community) === -1) return;
      state.communities = [community];
      state.page = 1;
      render(); syncFilterControls(); persistState();
      var results = document.getElementById("resultsHeading");
      if (results) results.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // cards delegation via click
    byId.cards.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var house = btn.getAttribute("data-house");
      var action = btn.getAttribute("data-action");
      if (action === "fav") toggleFav(house);
      else if (action === "compare") toggleCompare(house);
      else if (action === "detail") openListingDetail(house, btn);
      else if (action === "gallery-prev" || action === "gallery-next") {
        var gallery = btn.closest(".gallery");
        var house2 = gallery.getAttribute("data-gallery");
        var cur = galleryIndex[house2] || 0;
        var l = listingByHouse(house2); var n = photoCountOf(l);
        var nextIdx = action === "gallery-next" ? cur + 1 : cur - 1;
        setGallery(house2, nextIdx);
      }
    });

    // touch swipe on gallery
    var tx = null, ty = null;
    byId.cards.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      tx = t.clientX; ty = t.clientY;
    }, { passive: true });

    byId.detailBody.addEventListener("click", function (e) {
      var step = e.target.closest("[data-detail-step]");
      var thumb = e.target.closest("[data-detail-index]");
      var action = e.target.closest("[data-detail-action]");
      if (step) stepDetail(Number(step.getAttribute("data-detail-step")));
      else if (thumb) { detailPhotoIndex = Number(thumb.getAttribute("data-detail-index")); renderListingDetail(); }
      else if (action && action.getAttribute("data-detail-action") === "fav") { toggleFav(detailHouse); renderListingDetail(); }
      else if (action && action.getAttribute("data-detail-action") === "compare") { toggleCompare(detailHouse); renderListingDetail(); }
    });

    var detailTouchX = null, detailTouchY = null;
    byId.detailBody.addEventListener("touchstart", function (e) {
      if (!e.target.closest(".detail-stage")) return;
      detailTouchX = e.touches[0].clientX; detailTouchY = e.touches[0].clientY;
    }, { passive: true });
    byId.detailBody.addEventListener("touchend", function (e) {
      if (detailTouchX == null) return;
      var dx = e.changedTouches[0].clientX - detailTouchX;
      var dy = e.changedTouches[0].clientY - detailTouchY;
      detailTouchX = null;
      if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy)) stepDetail(dx < 0 ? 1 : -1);
    }, { passive: true });
    byId.cards.addEventListener("touchend", function (e) {
      if (e.touches.length) return;
      if (tx == null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - tx, dy = t.clientY - ty;
      tx = null;
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
      var gal = e.target.closest(".gallery");
      if (!gal) return;
      var house = gal.getAttribute("data-gallery");
      var cur = galleryIndex[house] || 0;
      var l = listingByHouse(house); var n = photoCountOf(l);
      if (n <= 1) return;
      setGallery(house, dx < 0 ? cur + 1 : cur - 1);
    }, { passive: true });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // toast styles injected
  (function injectToastStyle() {
    var st = document.createElement("style");
    st.textContent = ".toast{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);background:#26221c;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;opacity:0;transition:opacity .2s;z-index:70;pointer-events:none;white-space:nowrap}.toast.show{opacity:1}";
    document.head.appendChild(st);
  })();

  // bootstrap
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStateAndHandlers);
  } else {
    initStateAndHandlers();
  }
})();

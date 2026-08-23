(function () {
  "use strict";

  var data = window.MAP_DATA;
  var panel = document.getElementById("routePanel");
  var mapEl = document.getElementById("rentalMap");
  if (!data || !mapEl || !window.L) return;

  var map = L.map(mapEl, { zoomControl: true, minZoom: 13, maxZoom: 19, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  }).addTo(map);

  var stationIcon = L.divIcon({ className: "station-marker", html: "<span>15</span>", iconSize: [34, 34], iconAnchor: [17, 30] });
  L.marker(data.station.location, { icon: stationIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindTooltip("北沙滩地铁站", { direction: "top", offset: [0, -25] });

  var exitById = {};
  (data.station.exits || []).forEach(function (exit) {
    exitById[exit.id] = exit;
    var icon = L.divIcon({
      className: "exit-marker",
      html: "<span>" + escapeHtml(exit.id) + "</span>",
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    L.marker(exit.location, { icon: icon, zIndexOffset: 1500, title: "北沙滩站 " + exit.name })
      .addTo(map)
      .bindTooltip("北沙滩站 " + exit.name + (exit.accessible ? " · 无障碍" : ""), { direction: "top", offset: [0, -10] });
  });

  var markers = {};
  var markerGroup = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 38, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 17 });
  var routeLayer = null;
  var activeId = null;

  function money(value) {
    return value == null ? "—" : "¥" + Number(value).toLocaleString("zh-CN");
  }

  function minutes(seconds) {
    return seconds ? Math.max(1, Math.round(seconds / 60)) : "—";
  }

  function amapRouteUrl(item) {
    var from = (item.routeOriginAmap || item.amapLocation).split(",");
    var selectedExit = exitById[item.nearestExit];
    var to = (selectedExit ? selectedExit.amapLocation : data.station.amapLocation).split(",");
    var query = new URLSearchParams({
      from: from[0] + "," + from[1] + "," + item.name,
      to: to[0] + "," + to[1] + ",北沙滩地铁站" + (item.nearestExitName || ""),
      mode: "walk",
      policy: "1",
      src: "beishatan-rental-map",
      coordinate: "gaode",
      callnative: "0",
    });
    return "https://uri.amap.com/navigation?" + query.toString();
  }

  function panelHtml(item) {
    var listed = item.coverage === "beike_listed";
    var originNote = item.routeOriginKind === "entrance"
      ? "路线从高德记录的小区入口起算。"
      : "高德未返回入口，本路线从小区 POI 中心点起算，到现场需再确认居民入口。";
    return (
      '<span class="route-kicker">步行至北沙滩站 ' + escapeHtml(item.nearestExitName || "入口") + "</span>" +
      "<h3>" + escapeHtml(item.name) + "</h3>" +
      "<p>" + escapeHtml(item.district + " · " + (item.address || "地址待补")) + "</p>" +
      '<span class="route-status ' + (listed ? "listed" : "candidate") + '">' + (listed ? "贝壳已有房源" : "高德补充候选") + "</span>" +
      '<div class="route-metrics">' +
        '<div class="route-metric"><b>' + item.walkingM + '</b><span>至' + escapeHtml(item.nearestExit || "地铁") + '口米数</span></div>' +
        '<div class="route-metric"><b>' + minutes(item.walkingS) + '</b><span>预计分钟</span></div>' +
        '<div class="route-metric"><b>' + (listed ? item.inventory : "待查") + '</b><span>当前房源</span></div>' +
      "</div>" +
      (listed
        ? '<p>最低 ' + money(item.minRent) + " · 中位 " + money(item.medianRent) + " · " + item.multiPhoto + " 套多图</p>"
        : "<p>地图上确认存在，但当前贝壳样本未覆盖；不代表没有出租房。</p>") +
      '<p class="route-caveat">已比较 A、B1、B2、C 四个出口；' + escapeHtml(originNote) + "</p>" +
      '<div class="route-actions">' +
        (listed ? '<button class="btn btn-primary" type="button" data-map-filter="' + escapeHtml(item.platformCommunity) + '">查看该小区房源</button>' : "") +
        '<a class="btn btn-ghost" href="' + amapRouteUrl(item) + '" target="_blank" rel="noopener noreferrer">在高德继续查看 ↗</a>' +
      "</div>"
    );
  }

  function setActive(item, options) {
    options = options || {};
    if (activeId && markers[activeId] && markers[activeId].getElement()) markers[activeId].getElement().classList.remove("active");
    activeId = item.id;
    var marker = markers[item.id];
    if (marker && marker.getElement()) marker.getElement().classList.add("active");
    if (routeLayer) map.removeLayer(routeLayer);
    var casing = L.polyline(item.route, { color: "#fffdf7", weight: 11, opacity: 0.9, lineCap: "round", lineJoin: "round" });
    var route = L.polyline(item.route, { color: "#b01b1e", weight: 6, opacity: 0.96, lineCap: "round", lineJoin: "round", className: "active-route" });
    routeLayer = L.layerGroup([casing, route]).addTo(map);
    panel.innerHTML = panelHtml(item);
    var bounds = route.getBounds();
    var selectedExit = exitById[item.nearestExit];
    bounds.extend(selectedExit ? selectedExit.location : data.station.location);
    (data.station.exits || []).forEach(function (exit) { bounds.extend(exit.location); });
    function fitRoute() {
      if (options.focus !== false) map.fitBounds(bounds, { paddingTopLeft: [35, 35], paddingBottomRight: [35, 35], maxZoom: 17 });
    }
    if (marker && options.focus !== false) {
      markerGroup.zoomToShowLayer(marker, function () {
        if (marker.getElement()) marker.getElement().classList.add("active");
        fitRoute();
      });
    } else {
      if (marker && marker.getElement()) marker.getElement().classList.add("active");
      fitRoute();
    }
  }

  data.communities.forEach(function (item) {
    var listed = item.coverage === "beike_listed";
    var icon = L.divIcon({
      className: "map-marker " + (listed ? "listed" : "candidate"),
      html: "<span></span>", iconSize: [24, 24], iconAnchor: [12, 12],
    });
    var marker = L.marker(item.location, { icon: icon, title: item.name, riseOnHover: true });
    marker.bindTooltip(item.name + " · " + item.walkingM + "米", { direction: "top", offset: [0, -9] });
    marker.on("click", function () { setActive(item); });
    markers[item.id] = marker;
    markerGroup.addLayer(marker);
  });
  markerGroup.addTo(map);

  panel.addEventListener("click", function (event) {
    var button = event.target.closest("[data-map-filter]");
    if (!button) return;
    window.dispatchEvent(new CustomEvent("rental:filter-community", { detail: { community: button.getAttribute("data-map-filter") } }));
  });

  window.addEventListener("rental:community-focus", function (event) {
    var community = event.detail && event.detail.community;
    var item = data.communities.find(function (candidate) { return candidate.platformCommunity === community; });
    if (!item) return;
    setActive(item);
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  var initialBounds = L.latLngBounds([data.station.location]);
  (data.station.exits || []).forEach(function (exit) { initialBounds.extend(exit.location); });
  data.communities.filter(function (item) { return item.withinWalkLimit; }).forEach(function (item) { initialBounds.extend(item.location); });
  map.fitBounds(initialBounds, { padding: [24, 24], maxZoom: 15 });
  var initial = data.communities.find(function (item) { return item.coverage === "beike_listed" && item.withinWalkLimit; });
  if (initial) setActive(initial);

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();

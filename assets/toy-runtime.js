/* 风眼 · Toy 运行时增强
   1) 长时间停留时每 15 分钟检查一次在线数据，有新数据则刷新页面并恢复滚动位置；
   2) 在路径图中加入可随 SVG 缩放的南海诸岛九段线示意插图。 */
(function () {
  "use strict";

  var LIVE_DATA_URL = "https://mr-salticidae.github.io/typhoon-eye/data/typhoon.json";
  var REFRESH_INTERVAL = 15 * 60 * 1000;
  var LAST_CHECK_KEY = "typhoon-eye:last-online-check";
  var SCROLL_KEY = "typhoon-eye:restore-scroll";
  var refreshTimer = null;
  var refreshing = false;

  function now() { return Date.now ? Date.now() : new Date().getTime(); }

  function readNumber(storage, key) {
    try {
      var value = Number(storage.getItem(key));
      return isFinite(value) ? value : 0;
    } catch (e) { return 0; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, String(value)); } catch (e) { /* Toy 无痕环境静默降级 */ }
  }

  function displayedUpdatedAt() {
    var node = document.getElementById("tyUpdated");
    return node ? node.textContent.replace(/（(?:缓存|演示)）/g, "").trim() : "";
  }

  function validData(data) {
    return !!data && typeof data.updatedAt === "string" && Array.isArray(data.typhoons);
  }

  function fetchLatest() {
    /* app.js 暴露的多镜像取数逻辑优先；不可用时回退单源请求 */
    if (typeof window.__typhoonEyeFetchLatest === "function") {
      return window.__typhoonEyeFetchLatest();
    }
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);
    var options = { cache: "no-store" };
    if (controller) options.signal = controller.signal;

    return fetch(LIVE_DATA_URL + "?toy_check=" + now(), options)
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!validData(data)) throw new Error("invalid data");
        return data;
      })
      .then(function (data) {
        clearTimeout(timeout);
        return data;
      }, function (error) {
        clearTimeout(timeout);
        throw error;
      });
  }

  function scheduleNextRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    var last = readNumber(sessionStorage, LAST_CHECK_KEY);
    var elapsed = last ? now() - last : 0;
    var delay = Math.max(1000, REFRESH_INTERVAL - elapsed);
    refreshTimer = setTimeout(function () { checkForUpdate("timer"); }, delay);
  }

  function checkForUpdate(reason) {
    if (refreshing || document.visibilityState === "hidden") {
      scheduleNextRefresh();
      return;
    }
    refreshing = true;
    fetchLatest()
      .then(function (data) {
        writeStorage(sessionStorage, LAST_CHECK_KEY, now());
        var shown = displayedUpdatedAt();
        if (shown && data.updatedAt !== shown) {
          writeStorage(sessionStorage, SCROLL_KEY, window.pageYOffset || document.documentElement.scrollTop || 0);
          window.location.reload();
          return;
        }
      })
      .catch(function () {
        /* 网络失败保留当前可靠快照；online/visibilitychange 会补查 */
      })
      .then(function () {
        refreshing = false;
        scheduleNextRefresh();
      });
  }

  function restoreScroll() {
    var y = readNumber(sessionStorage, SCROLL_KEY);
    if (!y) return;
    try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) { /* ignore */ }
    setTimeout(function () { window.scrollTo(0, y); }, 0);
  }

  function startRefreshLoop() {
    restoreScroll();
    /* app.js 已在首次打开时请求在线数据，这里从本次打开开始计时。 */
    writeStorage(sessionStorage, LAST_CHECK_KEY, now());
    scheduleNextRefresh();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      var last = readNumber(sessionStorage, LAST_CHECK_KEY);
      if (!last || now() - last >= REFRESH_INTERVAL) checkForUpdate("resume");
      else scheduleNextRefresh();
    });
    window.addEventListener("online", function () { checkForUpdate("online"); });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) checkForUpdate("pageshow");
    });
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  var NINE_DASH_SEGMENTS = [
    [[121.4, 21.7], [120.9, 20.3]],
    [[120.0, 18.7], [119.5, 17.2]],
    [[118.2, 15.0], [117.6, 13.3]],
    [[116.0, 11.0], [114.8, 9.4]],
    [[112.8, 7.7], [111.2, 6.5]],
    [[109.6, 8.9], [108.6, 10.3]],
    [[109.3, 12.8], [109.2, 14.3]],
    [[110.2, 16.4], [110.7, 17.9]],
    [[111.9, 19.3], [113.1, 20.5]]
  ];
  var HAINAN_INSET = [[110.6, 20.0], [111.0, 19.6], [110.5, 18.8], [109.7, 18.2], [108.9, 18.4], [108.7, 19.2], [109.3, 19.9]];
  var TAIWAN_INSET = [[121.6, 25.3], [122.0, 25.0], [121.3, 22.9], [120.75, 21.9], [120.1, 23.1], [120.7, 24.6]];

  function svgElement(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, attrs[key]);
    }
    return node;
  }

  function addOverlayStyle() {
    if (document.getElementById("toy-runtime-style")) return;
    var style = document.createElement("style");
    style.id = "toy-runtime-style";
    style.textContent =
      ".scs-inset .scs-frame{fill:var(--paper-2);fill-opacity:.94;stroke:var(--line);stroke-width:1.2;vector-effect:non-scaling-stroke}" +
      ".scs-inset .scs-grid{fill:none;stroke:var(--line);stroke-width:.7;stroke-dasharray:2 3;opacity:.55;vector-effect:non-scaling-stroke}" +
      ".scs-inset .scs-land{fill:var(--land);stroke:var(--ink-soft);stroke-width:.75;opacity:.95;vector-effect:non-scaling-stroke}" +
      ".scs-inset .scs-dash{fill:none;stroke:var(--w-red);stroke-width:2.1;stroke-linecap:round;vector-effect:non-scaling-stroke}" +
      ".scs-inset .scs-title{fill:var(--ink);font-family:var(--sans);font-weight:700;letter-spacing:.08em}" +
      ".scs-inset .scs-note{fill:var(--ink-soft);font-family:var(--sans)}" +
      "@media(max-width:600px){.scs-inset .scs-title{font-weight:600}}";
    document.head.appendChild(style);
  }

  function pointsString(points, project) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = project(points[i][0], points[i][1]);
      out.push(p[0] + "," + p[1]);
    }
    return out.join(" ");
  }

  function drawNineDashInset() {
    var svg = document.getElementById("trackMap");
    var base = document.getElementById("baseLayer");
    if (!svg || !base || !base.childNodes.length) return;

    var old = document.getElementById("southChinaSeaInset");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return;
    var scale = Math.max(1, vb.width / 800);
    var width = Math.min(vb.width * 0.25, 168 * scale);
    var height = width * 1.03;
    var pad = Math.max(10, 16 * scale);
    var x = vb.x + vb.width - width - pad;
    var y = vb.y + pad;
    var innerX = x + width * 0.10;
    var innerY = y + height * 0.19;
    var innerW = width * 0.80;
    var innerH = height * 0.70;

    function project(lon, lat) {
      return [
        innerX + (lon - 105) / 18 * innerW,
        innerY + (25.5 - lat) / 20.5 * innerH
      ];
    }

    var group = svgElement("g", { id: "southChinaSeaInset", "class": "scs-inset", "aria-hidden": "true" });
    group.appendChild(svgElement("rect", {
      x: x, y: y, width: width, height: height, rx: width * 0.055, "class": "scs-frame"
    }));

    for (var lon = 110; lon <= 120; lon += 5) {
      var a = project(lon, 25.5), b = project(lon, 5);
      group.appendChild(svgElement("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "class": "scs-grid" }));
    }
    for (var lat = 10; lat <= 20; lat += 5) {
      var c = project(105, lat), d = project(123, lat);
      group.appendChild(svgElement("line", { x1: c[0], y1: c[1], x2: d[0], y2: d[1], "class": "scs-grid" }));
    }

    group.appendChild(svgElement("polygon", { points: pointsString(HAINAN_INSET, project), "class": "scs-land" }));
    group.appendChild(svgElement("polygon", { points: pointsString(TAIWAN_INSET, project), "class": "scs-land" }));

    for (var i = 0; i < NINE_DASH_SEGMENTS.length; i++) {
      var seg = NINE_DASH_SEGMENTS[i];
      var p1 = project(seg[0][0], seg[0][1]);
      var p2 = project(seg[1][0], seg[1][1]);
      group.appendChild(svgElement("line", {
        x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], "class": "scs-dash"
      }));
    }

    var title = svgElement("text", {
      x: x + width * 0.10, y: y + height * 0.105,
      "font-size": Math.max(10, width * 0.075), "class": "scs-title"
    });
    title.textContent = "南海诸岛";
    group.appendChild(title);

    var note = svgElement("text", {
      x: x + width * 0.10, y: y + height * 0.164,
      "font-size": Math.max(8, width * 0.052), "class": "scs-note"
    });
    note.textContent = "九段线示意";
    group.appendChild(note);

    base.appendChild(group);
    var mapNote = document.querySelector("#mapWrap .map-note");
    if (mapNote && mapNote.textContent.indexOf("九段线") < 0) {
      mapNote.textContent = mapNote.textContent.replace(/海岸线为示意/, "海岸线及九段线为示意");
    }
  }

  function startMapOverlay() {
    addOverlayStyle();
    var svg = document.getElementById("trackMap");
    var track = document.getElementById("trackLayer");
    if (!svg || !track || typeof MutationObserver !== "function") {
      setTimeout(drawNineDashInset, 1200);
      return;
    }
    var queued = false;
    function queueDraw() {
      if (queued) return;
      queued = true;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () {
        queued = false;
        drawNineDashInset();
      });
    }
    new MutationObserver(queueDraw).observe(track, { childList: true });
    new MutationObserver(queueDraw).observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
    queueDraw();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      startRefreshLoop();
      startMapOverlay();
    });
  } else {
    startRefreshLoop();
    startMapOverlay();
  }
})();

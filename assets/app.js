/* 风眼 · Typhoon Eye —— 页面交互
   零依赖。优先加载 data/typhoon.json（Actions 定时生成的实时数据），
   失败时降级为 assets/data.js 内置演示数据。 */
(function () {
  "use strict";

  /* ---------- 小工具 ---------- */
  var store = {
    get: function (k, fallback) {
      try { var v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 无痕模式等场景下静默降级 */ }
    },
  };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ---------- 主题 ---------- */
  var THEME_KEY = "typhoon-eye:theme";
  $("themeToggle").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
  });

  /* ---------- 地理底图（示意） ---------- */
  /* 等距投影：经度 105–125 → x 0–800，纬度 29–15 → y 0–560；
     视窗按路径范围动态扩展，投影公式不变，底图坐标恒定 */
  function proj(lat, lng) { return [(lng - 105) * 40, (29 - lat) * 40]; }

  /* 大陆海岸线 [lat, lng]，西南 → 东北（广西 → 苏北，示意精度） */
  var COAST = [
    [21.6, 105], [21.3, 106.5], [21.5, 108], [21.4, 109.5], [21.2, 110.4],
    [21.6, 111.8], [22.2, 113.2], [22.6, 114.3], [22.8, 115.5], [23.3, 116.5],
    [23.7, 117.5], [24.4, 118.1], [25.2, 119], [25.9, 119.6], [26.8, 120.2],
    [27.9, 120.7], [28.8, 121.2], [29.8, 121.8], [30.4, 121.5], [31.0, 121.9],
    [31.9, 121.3], [32.4, 120.5], [33.2, 119.9], [34.3, 120.2], [35.0, 119.5],
  ];
  var HAINAN = [[20.0, 110.6], [19.6, 111.0], [18.8, 110.5], [18.2, 109.7], [18.4, 108.9], [19.2, 108.7], [19.9, 109.3]];
  var TAIWAN = [[25.3, 121.6], [25.0, 122.0], [22.9, 121.3], [21.9, 120.75], [23.1, 120.1], [24.6, 120.7]];
  var CITIES = [
    { name: "湛江", lat: 21.2, lng: 110.4 },
    { name: "广州", lat: 23.13, lng: 113.26 },
    { name: "深圳", lat: 22.55, lng: 114.05 },
    { name: "汕头", lat: 23.35, lng: 116.68 },
    { name: "厦门", lat: 24.48, lng: 118.09 },
    { name: "福州", lat: 26.07, lng: 119.3 },
    { name: "温州", lat: 28.0, lng: 120.65 },
    { name: "宁波", lat: 29.87, lng: 121.55 },
    { name: "上海", lat: 31.23, lng: 121.47 },
    { name: "海口", lat: 20.03, lng: 110.32 },
  ];
  /* 远海路径不参与显示范围（避免底图缩得太小） */
  var DISPLAY_MAX_LNG = 140, DISPLAY_MIN_LAT = 10;

  function polyPoints(lls) {
    return lls.map(function (ll) { var p = proj(ll[0], ll[1]); return p[0] + "," + p[1]; }).join(" ");
  }

  function renderMap(track) {
    var svg = $("trackMap");
    var baseLayer = $("baseLayer");
    var cityLayer = $("cityLayer");
    var trackLayer = $("trackLayer");
    baseLayer.innerHTML = ""; cityLayer.innerHTML = ""; trackLayer.innerHTML = "";
    hideTip();

    var shown = track.filter(function (p) { return p.lng <= DISPLAY_MAX_LNG && p.lat >= DISPLAY_MIN_LAT; });
    var omitted = track.length - shown.length;
    var pts = shown.map(function (p) {
      var xy = proj(p.lat, p.lng);
      return { x: xy[0], y: xy[1], data: p };
    });

    /* 视窗 = 默认底图范围 ∪ 路径范围 + 留白 */
    var minX = 0, minY = 0, maxX = 800, maxY = 560;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var pad = 44;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    svg.setAttribute("viewBox", minX + " " + minY + " " + (maxX - minX) + " " + (maxY - minY));
    /* 视窗越大，标注与半径按比例放大（线宽由 non-scaling-stroke 保持恒定） */
    var f = Math.min(1.9, Math.max(1, (maxX - minX) / 800));

    /* 大陆：海岸线 + 闭合出西北侧陆地 */
    var first = proj(COAST[0][0], COAST[0][1]);
    var last = proj(COAST[COAST.length - 1][0], COAST[COAST.length - 1][1]);
    var d = "M " + (minX - 20) + " " + first[1] +
      " L " + COAST.map(function (ll) { var p = proj(ll[0], ll[1]); return p[0] + " " + p[1]; }).join(" L ") +
      " L " + last[0] + " " + (minY - 20) +
      " L " + (minX - 20) + " " + (minY - 20) + " Z";
    baseLayer.appendChild(svgEl("path", { class: "land", d: d }));
    baseLayer.appendChild(svgEl("polygon", { class: "land", points: polyPoints(HAINAN) }));
    baseLayer.appendChild(svgEl("polygon", { class: "land", points: polyPoints(TAIWAN) }));

    CITIES.forEach(function (c) {
      var p = proj(c.lat, c.lng);
      cityLayer.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 3 * f }));
      var t = svgEl("text", { x: p[0] - 8 * f, y: p[1] - 8 * f, "text-anchor": "end", "font-size": Math.round(13 * f) });
      t.textContent = c.name;
      cityLayer.appendChild(t);
    });

    var nowIdx = -1;
    pts.forEach(function (p, i) { if (p.data.phase === "now") nowIdx = i; });
    if (nowIdx < 0) nowIdx = pts.length - 1;

    function lineOf(list) { return list.map(function (p) { return p.x + "," + p.y; }).join(" "); }
    trackLayer.appendChild(svgEl("polyline", { points: lineOf(pts.slice(0, nowIdx + 1)), class: "track-line" }));
    trackLayer.appendChild(svgEl("polyline", { points: lineOf(pts.slice(nowIdx)), class: "track-line forecast" }));

    pts.forEach(function (p, i) {
      var g = svgEl("g", { class: "tp " + p.data.phase, tabindex: "0" });
      g.setAttribute("aria-label", p.data.t + "，" + (p.data.strong || "") + "，风力" + p.data.wind + "级，" + (PHASE_TEXT[p.data.phase] || ""));
      var r = Math.max(4, Math.min(9, 4 + (p.data.wind - 8) * 0.6)) * f;
      if (i === nowIdx) {
        g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 10 * f, class: "tp-now-halo" }));
        g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: r, class: "dot tp-now-core" }));
      } else {
        g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: r, class: "dot" }));
      }
      g.addEventListener("pointerenter", function () { showTip(g, p); });
      g.addEventListener("pointerleave", hideTip);
      g.addEventListener("focus", function () { showTip(g, p); });
      g.addEventListener("blur", hideTip);
      g.addEventListener("click", function (e) { e.stopPropagation(); showTip(g, p); });
      trackLayer.appendChild(g);
    });

    $("mapWrap").querySelector(".map-note").textContent =
      omitted > 0 ? "海岸线为示意 · 更早的远海路径未显示" : "海岸线为示意";
  }

  /* ---------- 路径点提示 ---------- */
  var tooltip = $("mapTooltip");
  var mapWrap = $("mapWrap");
  var activeTp = null;
  var PHASE_TEXT = { past: "已过", now: "当前位置", forecast: "预报" };

  function showTip(g, p) {
    if (activeTp) activeTp.classList.remove("is-active");
    activeTp = g;
    g.classList.add("is-active");
    tooltip.innerHTML = "";
    tooltip.appendChild(el("b", null, p.data.t));
    tooltip.appendChild(document.createElement("br"));
    var strong = p.data.strong ? p.data.strong + " · " : "";
    tooltip.appendChild(document.createTextNode(strong + "风力 " + p.data.wind + " 级 · "));
    tooltip.appendChild(el("span", "ph", PHASE_TEXT[p.data.phase] || ""));
    tooltip.hidden = false;
    /* 锚定实心点而非动画光晕，光晕在缩放中会导致定位漂移 */
    var dot = g.querySelector("circle.dot") || g.querySelector("circle");
    var r = dot.getBoundingClientRect();
    var wr = mapWrap.getBoundingClientRect();
    var cx = r.left - wr.left + r.width / 2;
    var cy = r.top - wr.top;
    /* map-wrap 为 overflow:hidden，需水平钳位、上缘翻转，避免边缘点的提示被裁切 */
    var half = tooltip.offsetWidth / 2;
    cx = Math.max(half + 6, Math.min(cx, wr.width - half - 6));
    var flipBelow = cy < tooltip.offsetHeight + 18;
    tooltip.classList.toggle("below", flipBelow);
    if (flipBelow) cy = r.top - wr.top + r.height;
    tooltip.style.left = cx + "px";
    tooltip.style.top = cy + "px";
  }
  function hideTip() {
    tooltip.hidden = true;
    if (activeTp) { activeTp.classList.remove("is-active"); activeTp = null; }
  }
  document.addEventListener("click", function (e) {
    if (!tooltip.hidden && !e.target.closest(".tp")) hideTip();
  });

  /* ---------- 实况面板 ---------- */
  function fmt(v, dash) { return (v === null || v === undefined || v === "") ? (dash || "—") : v; }

  /* 16 方位 → 方位角（自正北顺时针）。
     浙江源对四隅位用"北西/北东/南西/南东"写法（如"北西"=西北），一并收录 */
  var DIR_DEG = {
    "北": 0, "北北东": 22.5, "东北": 45, "北东": 45, "东北东": 67.5,
    "东": 90, "东南东": 112.5, "东南": 135, "南东": 135, "南南东": 157.5,
    "南": 180, "南南西": 202.5, "西南": 225, "南西": 225, "西南西": 247.5,
    "西": 270, "西北西": 292.5, "西北": 315, "北西": 315, "北北西": 337.5,
  };
  /* "北西" → "西北"：转回通行写法再进白话翻译 */
  var DIR_CANON = { "北东": "东北", "南东": "东南", "南西": "西南", "北西": "西北" };
  /* 罗盘术语 → 白话："北北西" → "接近正北、略偏西" */
  function dirPlain(d) {
    if (typeof d !== "string" || DIR_DEG[d] === undefined) return null;
    d = DIR_CANON[d] || d;
    if (d.length === 1) return "朝正" + d + "方向移动";
    if (d.length === 2) return "朝" + d + "方向移动";
    return "接近正" + d[0] + "、略偏" + (d[0] === d[1] ? d[2] : d[1]);
  }
  /* 小罗盘：外圈 + 指北刻度 + 按方位角旋转的指针 */
  function compassEl(deg) {
    var svg = svgEl("svg", { class: "compass", viewBox: "0 0 24 24", "aria-label": "方位角约 " + deg + " 度" });
    svg.setAttribute("role", "img");
    svg.appendChild(svgEl("circle", { cx: 12, cy: 12, r: 10.5, class: "compass-ring" }));
    svg.appendChild(svgEl("line", { x1: 12, y1: 1.5, x2: 12, y2: 4, class: "compass-north" }));
    svg.appendChild(svgEl("path", {
      d: "M12 4.5 L15.2 15.5 L12 13.4 L8.8 15.5 Z",
      class: "compass-needle",
      transform: "rotate(" + deg + " 12 12)",
    }));
    return svg;
  }

  function renderTyphoon(t) {
    $("tyCode").textContent = t.code;
    $("tyEnName").textContent = t.enName;
    $("tyName").textContent = t.name;
    $("tyLevel").textContent = t.level;
    $("tySummary").textContent = t.summary;
    $("tyPosition").textContent = t.now.position + "（" + t.now.time + "）。";

    var statDefs = [
      { k: "最大风力", v: fmt(t.now.windLevel), unit: "级", sub: "风速约 " + fmt(t.now.windSpeed) + " 米/秒" },
      { k: "中心气压", v: fmt(t.now.pressure), unit: "hPa", sub: "数值越低，台风越强" },
      { k: "移动方向", v: fmt(t.now.moveDir), unit: "", sub: dirPlain(t.now.moveDir) || "以中心移动趋势为准", compass: DIR_DEG[t.now.moveDir] },
      { k: "移动速度", v: fmt(t.now.moveSpeed), unit: "km/h", sub: "约为骑行速度" },
      /* 风圈半径并非每个时次都有:台风登陆减弱后官方停发,新生/远海台风也可能暂缺。
         空值时说明缘由,避免被误读为数据故障 */
      { k: "七级风圈", v: fmt(t.now.r7), unit: "km", sub: t.now.r7 === null ? "官方本时次未发布，登陆减弱后常见" : "圈内阵风明显" },
      { k: "十级风圈", v: fmt(t.now.r10), unit: "km", sub: t.now.r10 === null ? "官方本时次未发布，登陆减弱后常见" : "圈内破坏力强" },
    ];
    var statsGrid = $("statsGrid");
    statsGrid.innerHTML = "";
    statDefs.forEach(function (d) {
      var card = el("div", "stat");
      card.appendChild(el("p", "k", d.k));
      var v = el("p", "v", String(d.v));
      if (d.unit && d.v !== "—") v.appendChild(el("small", null, d.unit));
      if (d.compass !== undefined) v.appendChild(compassEl(d.compass));
      card.appendChild(v);
      card.appendChild(el("p", "sub", d.sub));
      statsGrid.appendChild(card);
    });

    renderMap(t.track);
  }

  /* ---------- 数据装载 ---------- */
  var DATA = null, IS_LIVE = false, current = 0;

  function suggestLevel(t) {
    if (!t || !t.nearCoast) return "blue";
    var w = t.now.windLevel || 0;
    if (w >= 14) return "orange";
    if (w >= 10) return "yellow";
    return "blue";
  }

  function init(data, mode) {
    var isLive = mode === "live";
    var isSnapshot = mode === "snapshot";
    DATA = data; IS_LIVE = isLive;
    var badge = $("dataBadge");
    var notice = $("noticeBar");
    if (isLive) {
      badge.textContent = "实时数据";
      badge.classList.add("live");
      badge.title = "来源：" + data.source + "，更新于 " + data.updatedAt;
      notice.innerHTML = "";
      notice.appendChild(document.createTextNode("数据来自" + data.source + "，更新于 " + data.updatedAt + "；防灾决策请以"));
      notice.appendChild(el("b", null, "当地政府与气象部门"));
      notice.appendChild(document.createTextNode("发布的官方预警为准。"));
    } else if (isSnapshot) {
      badge.textContent = "缓存数据";
      badge.classList.remove("live");
      badge.title = "在线数据暂不可用，当前为包内缓存数据";
      notice.innerHTML = "";
      notice.appendChild(document.createTextNode("在线数据暂不可用，当前展示"));
      notice.appendChild(el("b", null, "包内缓存数据"));
      notice.appendChild(document.createTextNode("；防灾决策请以"));
      notice.appendChild(el("b", null, "当地政府与气象部门"));
      notice.appendChild(document.createTextNode("发布的官方预警为准。"));
    } else {
      badge.textContent = "演示数据";
      badge.classList.remove("live");
      badge.title = "实时数据加载失败，当前为内置演示数据";
      notice.innerHTML = "";
      notice.appendChild(document.createTextNode("实时数据加载失败，当前展示"));
      notice.appendChild(el("b", null, "演示数据"));
      notice.appendChild(document.createTextNode("；防灾决策请以"));
      notice.appendChild(el("b", null, "当地政府与气象部门"));
      notice.appendChild(document.createTextNode("发布的官方预警为准。"));
    }
    var list = data.typhoons || [];
    var switcher = $("tySwitch");
    switcher.hidden = list.length < 2;
    switcher.innerHTML = "";
    list.forEach(function (t, i) {
      var b = el("button", "ty-chip", t.name + " " + t.enName);
      b.type = "button";
      b.addEventListener("click", function () {
        current = i;
        Array.prototype.forEach.call(switcher.children, function (c, j) { c.classList.toggle("is-active", j === i); });
        renderTyphoon(list[i]);
      });
      if (i === 0) b.classList.add("is-active");
      switcher.appendChild(b);
    });

    var planHeadTitle = $("planHeadTitle");
    var planFirst = $("planFirst");
    if (list.length) {
      $("tySummary").classList.remove("is-calm");
      renderTyphoon(list[0]);
      currentLevel = suggestLevel(list[0]);
      $("levelHint").hidden = false;
      planHeadTitle.textContent = "现在，该做什么";
      planFirst.innerHTML = "第一原则：<b>服从当地政府与社区的统一安排</b>，收到转移指令立即执行。";
      planFirst.classList.remove("is-calm");
    } else {
      /* 无活跃台风：收起实况与路径板块，预案常备 */
      $("tyKicker").textContent = "西北太平洋";
      $("tyName").textContent = "风平浪静";
      $("tyLevel").textContent = "西北太平洋暂无编号台风";
      $("tySummary").textContent = "风来之前，都是准备的好时候。";
      $("tySummary").classList.add("is-calm");
      $("live").hidden = true;
      $("track").hidden = true;
      currentLevel = "blue";
      planHeadTitle.textContent = "风来之前，备好清单";
      planFirst.textContent = "清单供平时备查，收到官方预警时启用。";
      planFirst.classList.add("is-calm");
    }
    renderPlan();
  }

  /* 在线数据源：多镜像并行请求，取 updatedAt 最新者。
     Pages 为主源；jsDelivr 镜像应对部分网络无法访问 github.io 的情况，
     Actions 在每次数据更新后会主动清理 jsDelivr 缓存；raw 为最后兜底。 */
  var DATA_SOURCES = [
    "https://mr-salticidae.github.io/typhoon-eye/data/typhoon.json",
    "https://cdn.jsdelivr.net/gh/Mr-Salticidae/typhoon-eye@main/data/typhoon.json",
    "https://fastly.jsdelivr.net/gh/Mr-Salticidae/typhoon-eye@main/data/typhoon.json",
    "https://raw.githubusercontent.com/Mr-Salticidae/typhoon-eye/main/data/typhoon.json"
  ];

  function validData(d) {
    return !!d && typeof d.updatedAt === "string" && Array.isArray(d.typhoons) &&
      d.typhoons.every(function (t) { return !!t && !!t.now && Array.isArray(t.track); });
  }

  function fetchJSON(url, bustCache) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    var finalUrl = bustCache
      ? url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + Math.floor(Date.now() / 300000)
      : url;
    return fetch(finalUrl, { cache: "no-store", signal: controller.signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!validData(d)) throw new Error("invalid data");
        return d;
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* 并行请求全部镜像；首个成功后再留 800ms 收集更快镜像里可能更新的数据，
     然后取 updatedAt 最新者返回。updatedAt 为"YYYY-MM-DD HH:mm"，字典序即时序。 */
  function fetchLatestOnline() {
    return new Promise(function (resolve, reject) {
      var results = [];
      var pending = DATA_SOURCES.length;
      var graceTimer = null;
      var done = false;
      function settle() {
        if (done) return;
        var best = null;
        results.forEach(function (d) { if (!best || d.updatedAt > best.updatedAt) best = d; });
        if (best) { done = true; resolve(best); }
        else if (pending === 0) { done = true; reject(new Error("all data sources failed")); }
      }
      DATA_SOURCES.forEach(function (url) {
        fetchJSON(url, true)
          .then(function (d) { results.push(d); }, function () { /* 单源失败忽略 */ })
          .then(function () {
            pending--;
            if (pending === 0) { clearTimeout(graceTimer); settle(); return; }
            if (results.length === 1 && !graceTimer) graceTimer = setTimeout(settle, 800);
          });
      });
    });
  }

  /* 供 toy-runtime.js 的定时刷新复用同一套多镜像逻辑 */
  window.__typhoonEyeFetchLatest = fetchLatestOnline;

  function boot() {
    fetchLatestOnline()
      .then(function (d) { init(d, "live"); })
      .catch(function () {
        return fetchJSON("data/typhoon.json", false)
          .then(function (d) { init(d, "snapshot"); })
          .catch(function () { init(DEMO_DATA, "demo"); });
      });
  }

  /* ---------- 分级预案 ---------- */
  var CHECK_KEY = "typhoon-eye:checks";
  var checks = store.get(CHECK_KEY, {});
  var currentLevel = "blue";

  var tabsBox = $("levelTabs");
  WARNING_LEVELS.forEach(function (key) {
    var plan = PLANS[key];
    var b = el("button", "level-tab", plan.name);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.style.setProperty("--lv", "var(--w-" + key + ")");
    b.dataset.level = key;
    b.addEventListener("click", function () {
      currentLevel = key;
      renderPlan();
    });
    tabsBox.appendChild(b);
  });

  function renderPlan() {
    var idx = WARNING_LEVELS.indexOf(currentLevel);
    var plan = PLANS[currentLevel];
    $("planPanel").style.setProperty("--lv", "var(--w-" + currentLevel + ")");

    Array.prototype.forEach.call(tabsBox.children, function (tab) {
      var on = tab.dataset.level === currentLevel;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });

    $("planTitle").textContent = "台风" + plan.name;
    $("planSignal").textContent = plan.signal;

    /* 递进清单：包含当前级及以下所有事项；事项身份 = 来源级:序号，勾选跨级共享 */
    var items = [];
    for (var i = 0; i <= idx; i++) {
      var lv = WARNING_LEVELS[i];
      PLANS[lv].items.forEach(function (text, j) {
        items.push({ id: lv + ":" + j, text: text, from: lv });
      });
    }

    var list = $("checklist");
    list.innerHTML = "";
    items.forEach(function (it) {
      var li = el("li");
      var label = el("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!checks[it.id];
      input.addEventListener("change", function () {
        checks[it.id] = input.checked;
        store.set(CHECK_KEY, checks);
        updateProgress(items);
      });
      var span = el("span", null, it.text);
      if (it.from !== currentLevel) {
        var badge = el("i", "from-lower", PLANS[it.from].short + "级");
        badge.title = "来自" + PLANS[it.from].name + "的事项";
        badge.style.setProperty("--flv", "var(--w-" + it.from + ")");
        span.appendChild(badge);
      }
      label.appendChild(input);
      label.appendChild(span);
      li.appendChild(label);
      list.appendChild(li);
    });
    updateProgress(items);
  }

  function updateProgress(items) {
    var done = items.filter(function (it) { return checks[it.id]; }).length;
    var total = items.length;
    $("progressBar").style.width = total ? (done / total * 100) + "%" : "0";
    $("progressText").textContent = done + " / " + total;
    var tone = $("planTone");
    if (total && done === total) {
      tone.textContent = "全部完成——你已经为这场风做好了准备。照顾好自己，也看看邻居是否需要帮忙。";
      tone.classList.add("done");
    } else {
      tone.textContent = "—— " + PLANS[currentLevel].tone;
      tone.classList.remove("done");
    }
  }

  /* ---------- 应急信息 ---------- */
  /* B 站 Toy 环境中页面运行在沙箱 iframe 内，tel: 的本框架导航会被静默拦截。
     检测到 iframe 时依次尝试：顶层导航（沙箱授予用户手势顶层导航权）→
     弹窗唤起 → 本框架导航；同时始终复制号码并提示，保证拨号可达。 */
  var IN_FRAME = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  var toastTimer = null;
  function showToast(msg) {
    var t = $("tyToast");
    if (!t) {
      t = el("div", "ty-toast");
      t.id = "tyToast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function dialNumber(num) {
    var telUrl = "tel:" + num;
    /* 沙箱内禁止任何页面级导航:B站 App 的 webview 未注册 tel: 处理器,
       顶层/本页导航会整页跳到 ERR_UNKNOWN_URL_SCHEME 错误页(2026-07-12 真机实测)。
       隐藏 iframe 触发:支持 tel: 的浏览器静默唤起拨号,不支持的静默失败、页面不动。 */
    try {
      var jumper = document.getElementById("tyTelJumper");
      if (!jumper) {
        jumper = document.createElement("iframe");
        jumper.id = "tyTelJumper";
        jumper.setAttribute("aria-hidden", "true");
        jumper.style.cssText = "display:none;width:0;height:0;border:0";
        document.body.appendChild(jumper);
      }
      jumper.src = telUrl;
    } catch (e) { /* ignore */ }
    copyText(num).then(function (copied) {
      showToast(copied
        ? "号码 " + num + " 已复制；如未唤起拨号，请到拨号盘粘贴"
        : "请手动拨打 " + num);
    });
  }

  var contactGrid = $("contactGrid");
  CONTACTS.forEach(function (c) {
    var a = el("a", "contact");
    a.href = "tel:" + c.num;
    a.appendChild(el("span", "num", c.num));
    a.appendChild(el("span", "lb", c.label));
    a.addEventListener("click", function (ev) {
      if (!IN_FRAME) return; /* 顶层环境交给浏览器原生 tel: 处理 */
      ev.preventDefault();
      dialNumber(c.num);
    });
    contactGrid.appendChild(a);
  });
  var sourceList = $("sourceList");
  SOURCES.forEach(function (s) {
    var a = el("a", "source-link", s.name);
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener";
    sourceList.appendChild(a);
  });

  boot();
})();

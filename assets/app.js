/* 风眼 · Typhoon Eye —— 页面交互
   零依赖；数据来自 assets/data.js 的全局常量。 */
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

  /* ---------- 主题 ---------- */
  var THEME_KEY = "typhoon-eye:theme";
  $("themeToggle").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
  });

  /* ---------- hero 与实况 ---------- */
  var T = TYPHOON_DATA;
  $("tyCode").textContent = T.code;
  $("tyEnName").textContent = T.enName;
  $("tyName").textContent = T.name;
  $("tyLevel").textContent = T.level;
  $("tySummary").textContent = T.summary;
  $("tyUpdated").textContent = T.updatedAt + (T.demo ? "（演示）" : "");
  $("tyPosition").textContent = "中心位置：" + T.now.position + "。";

  var statDefs = [
    { k: "最大风力", v: T.now.windLevel, unit: "级", sub: "风速约 " + T.now.windSpeed + " 米/秒" },
    { k: "中心气压", v: T.now.pressure, unit: "hPa", sub: "数值越低，台风越强" },
    { k: "移动方向", v: T.now.moveDir, unit: "", sub: "朝向我国沿海" },
    { k: "移动速度", v: T.now.moveSpeed, unit: "km/h", sub: "约为骑行速度" },
    { k: "七级风圈", v: T.now.r7, unit: "km", sub: "圈内阵风明显" },
    { k: "十级风圈", v: T.now.r10, unit: "km", sub: "圈内破坏力强" },
  ];
  var statsGrid = $("statsGrid");
  statDefs.forEach(function (d) {
    var card = el("div", "stat");
    card.appendChild(el("p", "k", d.k));
    var v = el("p", "v", String(d.v));
    if (d.unit) { var u = el("small", null, d.unit); v.appendChild(u); }
    card.appendChild(v);
    card.appendChild(el("p", "sub", d.sub));
    statsGrid.appendChild(card);
  });

  /* ---------- 路径图 ---------- */
  var SVG_NS = "http://www.w3.org/2000/svg";
  function proj(lat, lng) { return [(lng - 105) * 40, (29 - lat) * 40]; }
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  var CITIES = [
    { name: "湛江", lat: 21.2, lng: 110.4 },
    { name: "广州", lat: 23.1, lng: 113.3 },
    { name: "深圳", lat: 22.55, lng: 114.05 },
    { name: "汕尾", lat: 22.8, lng: 115.4 },
    { name: "厦门", lat: 24.45, lng: 118.1 },
    { name: "福州", lat: 26.05, lng: 119.3 },
    { name: "温州", lat: 28.0, lng: 120.65 },
    { name: "海口", lat: 20.0, lng: 110.3 },
  ];
  var cityLayer = $("cityLayer");
  CITIES.forEach(function (c) {
    var p = proj(c.lat, c.lng);
    cityLayer.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 3 }));
    var t = svgEl("text", { x: p[0] - 8, y: p[1] - 8, "text-anchor": "end" });
    t.textContent = c.name;
    cityLayer.appendChild(t);
  });

  var trackLayer = $("trackLayer");
  var pts = T.track.map(function (p) {
    var xy = proj(p.lat, p.lng);
    return { x: xy[0], y: xy[1], data: p };
  });
  var nowIdx = T.track.findIndex(function (p) { return p.phase === "now"; });
  if (nowIdx < 0) nowIdx = pts.length - 1;

  function lineOf(list) { return list.map(function (p) { return p.x + "," + p.y; }).join(" "); }
  var pastLine = svgEl("polyline", { points: lineOf(pts.slice(0, nowIdx + 1)), class: "track-line" });
  var fcLine = svgEl("polyline", { points: lineOf(pts.slice(nowIdx)), class: "track-line forecast" });
  trackLayer.appendChild(pastLine);
  trackLayer.appendChild(fcLine);

  var tooltip = $("mapTooltip");
  var mapWrap = $("mapWrap");
  var activeTp = null;
  var PHASE_TEXT = { past: "已过", now: "当前位置", forecast: "预报" };

  function showTip(g, p) {
    if (activeTp) activeTp.classList.remove("is-active");
    activeTp = g;
    g.classList.add("is-active");
    tooltip.innerHTML = "";
    var b = el("b", null, p.data.t);
    tooltip.appendChild(b);
    tooltip.appendChild(document.createElement("br"));
    tooltip.appendChild(document.createTextNode("风力 " + p.data.wind + " 级 · "));
    var ph = el("span", "ph", PHASE_TEXT[p.data.phase] || "");
    tooltip.appendChild(ph);
    tooltip.hidden = false;
    var dot = g.querySelector("circle");
    var r = dot.getBoundingClientRect();
    var wr = mapWrap.getBoundingClientRect();
    tooltip.style.left = (r.left - wr.left + r.width / 2) + "px";
    tooltip.style.top = (r.top - wr.top) + "px";
  }
  function hideTip() {
    tooltip.hidden = true;
    if (activeTp) { activeTp.classList.remove("is-active"); activeTp = null; }
  }

  pts.forEach(function (p, i) {
    var g = svgEl("g", { class: "tp " + p.data.phase, tabindex: "0" });
    g.setAttribute("aria-label", p.data.t + "，风力" + p.data.wind + "级，" + (PHASE_TEXT[p.data.phase] || ""));
    var r = Math.max(4, Math.min(9, 4 + (p.data.wind - 8) * 0.6));
    if (i === nowIdx) {
      g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 10, class: "tp-now-halo" }));
      g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: r, class: "tp-now-core dot" }));
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
  document.addEventListener("click", function (e) {
    if (!tooltip.hidden && !e.target.closest(".tp")) hideTip();
  });

  /* ---------- 分级预案 ---------- */
  var CHECK_KEY = "typhoon-eye:checks";
  var checks = store.get(CHECK_KEY, {});
  var currentLevel = WARNING_LEVELS.indexOf(T.warning) >= 0 ? T.warning : "blue";

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
    var panel = $("planPanel");
    panel.style.setProperty("--lv", "var(--w-" + currentLevel + ")");

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
        span.appendChild(el("i", "from-lower", PLANS[it.from].short + "级已列"));
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
  renderPlan();

  /* ---------- 应急信息 ---------- */
  var contactGrid = $("contactGrid");
  CONTACTS.forEach(function (c) {
    var a = el("a", "contact");
    a.href = "tel:" + c.num;
    a.appendChild(el("span", "num", c.num));
    a.appendChild(el("span", "lb", c.label));
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
})();

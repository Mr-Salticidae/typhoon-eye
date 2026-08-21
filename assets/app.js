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
  /* 默认底图范围与宽高比：远洋视图按同一比例出图，保证图幅观感一致 */
  var BASE_W = 800, BASE_H = 560, BASE_RATIO = BASE_W / BASE_H;
  /* 远洋视图最小跨度 12 经度：新生台风只有两三个点时，避免把图放大到失真 */
  var MIN_FAR_SPAN = 480;

  function polyPoints(lls) {
    return lls.map(function (ll) { var p = proj(ll[0], ll[1]); return p[0] + "," + p[1]; }).join(" ");
  }

  /* 球面距离（公里）：远洋视图用它标注台风离中国大陆还有多远 */
  function greatCircle(lat1, lng1, lat2, lng2) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /* 到海岸线折线顶点的最近距离，取整到百公里（底图为示意精度，不做更细的表述） */
  function mainlandKm(lat, lng) {
    var min = Infinity;
    COAST.forEach(function (ll) {
      var d = greatCircle(lat, lng, ll[0], ll[1]);
      if (d < min) min = d;
    });
    return Math.max(100, Math.round(min / 100) * 100);
  }

  /* 经纬网间隔：跨度越大间隔越粗，始终保持 4–8 条网格线 */
  function gridStep(span) {
    if (span <= 8) return 1;
    if (span <= 18) return 2;
    if (span <= 45) return 5;
    if (span <= 90) return 10;
    return 20;
  }
  function lngLabel(lng) {
    var v = ((lng + 180) % 360 + 360) % 360 - 180;
    if (v === 0 || v === -180) return Math.abs(v) + "°";
    return (v > 0 ? v : -v) + (v > 0 ? "°E" : "°W");
  }
  function latLabel(lat) { return (lat >= 0 ? lat + "°N" : -lat + "°S"); }

  /* 远洋视图没有海岸线可参照，用经纬网给出绝对位置读数 */
  function drawGraticule(layer, box, f) {
    var g = svgEl("g", { class: "graticule", "aria-hidden": "true" });
    var lngA = box.minX / 40 + 105, lngB = box.maxX / 40 + 105;
    var latA = 29 - box.maxY / 40, latB = 29 - box.minY / 40;
    var fs = Math.round(12 * f);
    var stepX = gridStep(lngB - lngA), stepY = gridStep(latB - latA);
    var lng, lat, t;
    for (lng = Math.ceil(lngA / stepX) * stepX; lng <= lngB; lng += stepX) {
      var x = proj(0, lng)[0];
      g.appendChild(svgEl("line", { class: "grat-line", x1: x, y1: box.minY, x2: x, y2: box.maxY }));
      if (x > box.maxX - 46 * f) continue; /* 贴右边框的度数会被裁掉，只留网格线 */
      t = svgEl("text", { class: "grat-label", x: x + 5 * f, y: box.minY + 17 * f, "font-size": fs });
      t.textContent = lngLabel(lng);
      g.appendChild(t);
    }
    for (lat = Math.ceil(latA / stepY) * stepY; lat <= latB; lat += stepY) {
      var y = proj(lat, 105)[1];
      g.appendChild(svgEl("line", { class: "grat-line", x1: box.minX, y1: y, x2: box.maxX, y2: y }));
      /* 图幅下缘压着 HTML 图例、上缘会裁字，这两处只留网格线不标度数 */
      if (y < box.minY + 22 * f || y > box.maxY - 34 * f) continue;
      t = svgEl("text", { class: "grat-label", x: box.minX + 8 * f, y: y - 6 * f, "font-size": fs });
      t.textContent = latLabel(lat);
      g.appendChild(t);
    }
    layer.appendChild(g);
  }

  /* ---------- 小地图 ---------- */
  /* 经度取值窗口的切点，须与 assets/basemap.js 的产物一致（太平洋居中不被劈开） */
  var MINI_CUT = -30;
  var MINI_KEY = "typhoon-eye:mini-zoom";
  /* 三档尺度：默认"亚太"——既能靠日本/菲律宾/澳大利亚认出这块陆地是哪儿，
     台风点与图幅框又不至于小到看不见；两端留给"全球"和"西北太平洋" */
  var MINI_LEVELS = [
    { name: "全球", lng: [-30, 330], lat: [-58, 82] },
    { name: "亚太", lng: [70, 205], lat: [-46, 56] },
    { name: "西北太平洋", lng: [100, 190], lat: [-2, 52] },
  ];
  /* 地名锚点：from = 从哪一档开始显示（全球档只留"中国"，避免糊成一片） */
  var MINI_MARKS = [
    { name: "中国", lat: 34, lng: 103, from: 0 },
    { name: "日本", lat: 37.5, lng: 139.5, from: 1 },
    { name: "菲律宾", lat: 12.5, lng: 122.5, from: 1 },
    { name: "澳大利亚", lat: -25, lng: 134, from: 1 },
    { name: "夏威夷", lat: 20.5, lng: 204, from: 1 },
  ];
  var miniZoom = (function () {
    var z = Number(store.get(MINI_KEY, 1));
    return isFinite(z) ? Math.min(MINI_LEVELS.length - 1, Math.max(0, Math.round(z))) : 1;
  })();
  var lastTrack = null, zoomFocus = 0;

  /* 文字放不下就按比例缩字号（须在入 DOM 后调用才量得到）。
     档位名和距离位数都会变，写死字号迟早会压到按钮上 */
  function fitText(node, maxW) {
    var len = 0;
    try { len = node.getComputedTextLength(); } catch (e) { /* 非渲染态跳过 */ }
    if (!len || len <= maxW) return;
    var fs = parseFloat(node.getAttribute("font-size"));
    node.setAttribute("font-size", Math.max(fs * 0.6, fs * maxW / len));
  }

  /* 底图各环的经纬包围盒，用来跳过窗口外的环（只算一次） */
  var LAND_BOXES = null;
  function landBoxes() {
    if (LAND_BOXES) return LAND_BOXES;
    LAND_BOXES = WORLD_LAND.map(function (flat) {
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      for (var i = 0; i < flat.length; i += 2) {
        b[0] = Math.min(b[0], flat[i]); b[2] = Math.max(b[2], flat[i]);
        b[1] = Math.min(b[1], flat[i + 1]); b[3] = Math.max(b[3], flat[i + 1]);
      }
      return b;
    });
    return LAND_BOXES;
  }

  /* 面板右上角的 －／＋：到头的一侧置灰。SVG 里没有原生按钮，
     补上 role/tabindex 与回车空格，键盘也能用 */
  function zoomButtons(x, y, W) {
    var g = svgEl("g", { class: "mm-zoom" });
    var focusTarget = null;
    var size = W * 0.115, pad = W * 0.05, gap2 = W * 0.028;
    [-1, 1].forEach(function (dir, i) {
      var bx = x + W - pad - size * (2 - i) - gap2 * (1 - i);
      var by = y + pad * 0.85;
      var next = miniZoom + dir;
      var off = next < 0 || next >= MINI_LEVELS.length;
      var b = svgEl("g", { class: "mm-btn" + (off ? " is-off" : "") });
      if (!off) {
        b.setAttribute("role", "button");
        b.setAttribute("tabindex", "0");
        b.setAttribute("aria-label", (dir < 0 ? "缩小到" : "放大到") + MINI_LEVELS[next].name);
      } else {
        b.setAttribute("aria-hidden", "true");
      }
      /* 视觉按钮只有十几像素，窄屏上点不准：外面套一圈透明热区，
         各自吃掉朝外的留白与两钮之间一半的缝，热区互不重叠 */
      if (!off) {
        var hp = size * 0.55;
        b.appendChild(svgEl("rect", {
          class: "mm-hit",
          x: bx - (dir < 0 ? hp : gap2 / 2), y: by - hp,
          width: size + hp + gap2 / 2, height: size + hp * 2,
        }));
      }
      b.appendChild(svgEl("rect", { class: "mm-btn-bg", x: bx, y: by, width: size, height: size, rx: size * 0.28 }));
      b.appendChild(svgEl("line", {
        class: "mm-btn-ink", x1: bx + size * 0.26, y1: by + size / 2, x2: bx + size * 0.74, y2: by + size / 2,
      }));
      if (dir > 0) {
        b.appendChild(svgEl("line", {
          class: "mm-btn-ink", x1: bx + size / 2, y1: by + size * 0.26, x2: bx + size / 2, y2: by + size * 0.74,
        }));
      }
      if (!off) {
        var go = function (e, viaKey) {
          e.preventDefault(); e.stopPropagation();
          miniZoom = next;
          store.set(MINI_KEY, miniZoom);
          /* 重画会丢焦点，键盘用户要能连按；鼠标点击不还焦点，免得留下焦点框 */
          zoomFocus = viaKey ? dir : 0;
          if (lastTrack) renderMap(lastTrack);
        };
        b.addEventListener("click", function (e) { go(e, false); });
        b.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") go(e, true);
        });
        /* 换档后把焦点还回同一个按钮；若它这档已置灰，退给另一个 */
        if (zoomFocus === dir || (zoomFocus === -dir && miniZoom + zoomFocus < 0) ||
            (zoomFocus === -dir && miniZoom + zoomFocus >= MINI_LEVELS.length)) {
          focusTarget = b;
        }
      }
      g.appendChild(b);
    });
    if (focusTarget && focusTarget.focus) {
      /* 等本轮 DOM 装配完再聚焦；:focus-visible 保证鼠标点击不会留下焦点框 */
      setTimeout(function () { try { focusTarget.focus(); } catch (e) { /* 忽略 */ } }, 0);
    }
    zoomFocus = 0;
    return g;
  }

  /* 远洋视图的小地图：把世界底图、整条路径与"当前图幅"框缩进一块面板，
     回答"台风在地球的哪个位置"——单靠方位箭头或只画中国海岸线都不够直观。
     槽位按路径空白处自动选择，避免压住路径本身。 */
  function drawMiniMap(layer, box, f, pts, nowIdx, km) {
    var W = Math.min((box.maxX - box.minX) * 0.3, 215 * f), H = W * 0.8;
    var gap = 16 * f;

    /* 折线中点一并参与碰撞检测：只看顶点会漏掉横穿槽位的长直线段 */
    var samples = pts.slice();
    for (var i = 1; i < pts.length; i++) {
      samples.push({ x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 });
    }

    /* 可放置区域先让开三类既有信息：顶部经度标注行、左侧纬度标注列、
       底部 HTML 图例与角注。 */
    var x0 = box.minX + gap + 40 * f, x1 = box.maxX - W - gap;
    var y0 = box.minY + gap + 24 * f, y1 = box.maxY - H - gap - 26 * f;
    if (x1 < x0) { x0 = x1 = box.maxX - W - gap; }
    if (y1 < y0) { y0 = y1 = Math.max(box.minY + gap, box.maxY - H - gap); }

    function clearOf(rx, ry, px, py) {
      var dx = Math.max(rx - px, 0, px - (rx + W));
      var dy = Math.max(ry - py, 0, py - (ry + H));
      return Math.sqrt(dx * dx + dy * dy);
    }

    /* 候选网格：先按压住的路径点数排序，同分再挑离路径最远的那格 */
    var now = pts[nowIdx] || null;
    var best = { x: x1, y: y0 }, bestScore = Infinity;
    for (var gx = 0; gx <= 5; gx++) {
      for (var gy = 0; gy <= 3; gy++) {
        var cx2 = x0 + (x1 - x0) * gx / 5, cy2 = y0 + (y1 - y0) * gy / 3;
        var hits = 0, clear = Infinity;
        for (var si = 0; si < samples.length; si++) {
          var s = samples[si];
          if (s.x >= cx2 - gap && s.x <= cx2 + W + gap && s.y >= cy2 - gap && s.y <= cy2 + H + gap) hits++;
          clear = Math.min(clear, clearOf(cx2, cy2, s.x, s.y));
        }
        /* 当前位置是全图最该保住的元素，压中它单独重罚 */
        var onNow = now && clearOf(cx2, cy2, now.x, now.y) < 22 * f ? 1 : 0;
        var score = hits * 12 + onNow * 60
          - Math.min(clear / f, 150) * 0.06;
        if (score < bestScore) { bestScore = score; best = { x: cx2, y: cy2 }; }
      }
    }
    var x = best.x, y = best.y;
    var ix = x + W * 0.05, iy = y + W * 0.185, iw = W * 0.9, ih = iw / 1.6;

    /* 取景窗口 = 当前档位的固定经纬范围 ∪ 当前图幅，保证"你在这里"框永远在图内 */
    var lv = MINI_LEVELS[miniZoom];
    var win = { lng: lv.lng.slice(), lat: lv.lat.slice() };
    var fl0 = box.minX / 40 + 105, fl1 = box.maxX / 40 + 105;
    var fa0 = 29 - box.maxY / 40, fa1 = 29 - box.minY / 40;
    win.lng[0] = Math.min(win.lng[0], fl0); win.lng[1] = Math.max(win.lng[1], fl1);
    win.lat[0] = Math.min(win.lat[0], fa0); win.lat[1] = Math.max(win.lat[1], fa1);

    /* contain 式适配：窗口整体缩放居中，空出来的边缘就是海面，不裁掉任何陆地 */
    var k = Math.min(iw / (win.lng[1] - win.lng[0]), ih / (win.lat[1] - win.lat[0]));
    var ox = ix + (iw - (win.lng[1] - win.lng[0]) * k) / 2;
    var oy = iy + (ih - (win.lat[1] - win.lat[0]) * k) / 2;
    function mll(lng, lat) {
      var l = lng < MINI_CUT ? lng + 360 : lng;
      return [ox + (l - win.lng[0]) * k, oy + (win.lat[1] - lat) * k];
    }
    function mp(px, py) { return mll(px / 40 + 105, 29 - py / 40); }

    var g = svgEl("g", { id: "farMiniMap", class: "mini-map" });
    g.appendChild(svgEl("rect", { class: "mm-frame", x: x, y: y, width: W, height: H, rx: W * 0.05 }));

    var head = svgEl("g", { "aria-hidden": "true" });
    /* 档位名放标题行、距离放副标题：两行都要让开右上角的按钮，别被压住 */
    var t = svgEl("text", { class: "mm-title", x: ix, y: y + W * 0.115, "font-size": W * 0.072 });
    t.textContent = "位置总览 · " + lv.name;
    head.appendChild(t);
    var sub = svgEl("text", { class: "mm-note", x: ix, y: y + W * 0.168, "font-size": W * 0.05 });
    sub.textContent = "距中国大陆约 " + km + " 公里";
    head.appendChild(sub);
    g.appendChild(head);
    g.appendChild(zoomButtons(x, y, W));

    /* 内框裁切：窗口外的陆地一律修掉，不糊出面板 */
    var clip = svgEl("clipPath", { id: "mmClip" });
    clip.appendChild(svgEl("rect", { x: ix, y: iy, width: iw, height: ih, rx: W * 0.02 }));
    g.appendChild(clip);
    var inner = svgEl("g", { "clip-path": "url(#mmClip)", "aria-hidden": "true" });
    inner.appendChild(svgEl("rect", { class: "mm-sea", x: ix, y: iy, width: iw, height: ih, rx: W * 0.02 }));

    /* 陆地：只画与窗口相交的环 */
    if (typeof WORLD_LAND !== "undefined") {
      landBoxes().forEach(function (b, i) {
        if (b[2] < win.lng[0] || b[0] > win.lng[1] || b[3] < win.lat[0] || b[1] > win.lat[1]) return;
        var flat = WORLD_LAND[i], out = [];
        for (var j = 0; j < flat.length; j += 2) {
          var p = mll(flat[j], flat[j + 1]);
          out.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
        }
        inner.appendChild(svgEl("polygon", { class: "mm-land", points: out.join(" ") }));
      });
    }

    /* 当前图幅框：小地图里这一小块，就是上面的整幅大图 */
    var v0 = mp(box.minX, box.minY), v1 = mp(box.maxX, box.maxY);
    var vw = Math.max(v1[0] - v0[0], 3), vh = Math.max(v1[1] - v0[1], 3);

    /* 地名：帮"这块陆地是哪儿"落地；落进图幅框的略去，免得压住台风 */
    MINI_MARKS.forEach(function (mk) {
      if (miniZoom < mk.from) return;
      if (mk.lng < win.lng[0] || mk.lng > win.lng[1] || mk.lat < win.lat[0] || mk.lat > win.lat[1]) return;
      var p = mll(mk.lng, mk.lat);
      if (p[0] > v0[0] - 4 && p[0] < v0[0] + vw + 4 && p[1] > v0[1] - 4 && p[1] < v0[1] + vh + 4) return;
      /* 贴边的地名会被内框裁掉半个字，往里收一收 */
      var half = mk.name.length * W * 0.05 * 0.55, fs2 = W * 0.05;
      p[0] = Math.min(Math.max(p[0], ix + half + 2), ix + iw - half - 2);
      p[1] = Math.min(Math.max(p[1], iy + fs2), iy + ih - fs2 * 0.4);
      var lb = svgEl("text", { class: "mm-mark", x: p[0], y: p[1], "text-anchor": "middle", "font-size": fs2 });
      lb.textContent = mk.name;
      inner.appendChild(lb);
    });

    inner.appendChild(svgEl("rect", {
      class: "mm-view", x: v0[0], y: v0[1], width: vw, height: vh, rx: W * 0.012,
    }));
    inner.appendChild(svgEl("polyline", {
      class: "mm-track",
      points: pts.map(function (p) { var q = mp(p.x, p.y); return q[0] + "," + q[1]; }).join(" "),
    }));
    if (nowIdx >= 0) {
      var np = mp(pts[nowIdx].x, pts[nowIdx].y);
      inner.appendChild(svgEl("circle", { class: "mm-now", cx: np[0], cy: np[1], r: Math.max(2, W * 0.022) }));
    }
    g.appendChild(inner);
    layer.appendChild(g);
    /* 入 DOM 后再量：标题两行都不能伸进右上角按钮区 */
    var headMax = W - W * 0.05 * 2 - (W * 0.115 * 2 + W * 0.028) - W * 0.03;
    fitText(t, headMax);
    fitText(sub, headMax);
  }

  function renderMap(track) {
    var svg = $("trackMap");
    var baseLayer = $("baseLayer");
    var cityLayer = $("cityLayer");
    var trackLayer = $("trackLayer");
    baseLayer.innerHTML = ""; cityLayer.innerHTML = ""; trackLayer.innerHTML = "";
    hideTip();
    lastTrack = track; /* 小地图缩放要按同一条路径重画 */

    /* 截断远海段是为了不把底图缩得太小，代价是当前位置也可能被截掉：整条路径都在
       西北太平洋远洋时图上会空无一物。因此以"当前位置在不在近海窗口内"决定视图——
       在窗内走近海视图（远海历史照旧截断），在窗外整条路径改走远洋视图 */
    function inNearWindow(p) { return p.lng <= DISPLAY_MAX_LNG && p.lat >= DISPLAY_MIN_LAT; }
    var anchor = null;
    track.forEach(function (p) { if (p.phase === "now") anchor = p; });
    if (!anchor && track.length) anchor = track[track.length - 1];
    var farOcean = !!anchor && !inNearWindow(anchor);
    var shown = farOcean ? track : track.filter(inNearWindow);
    var omitted = track.length - shown.length;
    var pts = shown.map(function (p) {
      var xy = proj(p.lat, p.lng);
      return { x: xy[0], y: xy[1], data: p };
    });

    /* 视窗：近海视图 = 默认底图范围 ∪ 路径范围；远洋视图 = 路径范围。均加留白 */
    var minX = 0, minY = 0, maxX = BASE_W, maxY = BASE_H;
    if (farOcean) { minX = minY = Infinity; maxX = maxY = -Infinity; }
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var pad = 44;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    if (farOcean) {
      /* 先兜住最小跨度，再补齐到底图宽高比，避免图幅细成一条或放大到失真 */
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      if (maxX - minX < MIN_FAR_SPAN) { minX = cx - MIN_FAR_SPAN / 2; maxX = cx + MIN_FAR_SPAN / 2; }
      if (maxY - minY < MIN_FAR_SPAN / BASE_RATIO) {
        minY = cy - MIN_FAR_SPAN / BASE_RATIO / 2; maxY = cy + MIN_FAR_SPAN / BASE_RATIO / 2;
      }
      var w = maxX - minX, h = maxY - minY;
      if (w / h > BASE_RATIO) { var gh = (w / BASE_RATIO - h) / 2; minY -= gh; maxY += gh; }
      else { var gw = (h * BASE_RATIO - w) / 2; minX -= gw; maxX += gw; }
    }
    var box = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    svg.setAttribute("viewBox", minX + " " + minY + " " + (maxX - minX) + " " + (maxY - minY));
    /* 视窗越大，标注与半径按比例放大（线宽由 non-scaling-stroke 保持恒定）；
       远洋视图可能比底图更窄，f 需要能小于 1，否则点会被放大到糊成一团 */
    var f = Math.min(1.9, (maxX - minX) / BASE_W);

    if (farOcean) {
      /* 远洋视图内没有海岸线可参照，用经纬网代替底图给出位置读数 */
      drawGraticule(baseLayer, box, f);
    } else {
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
    }

    var nowIdx = -1;
    pts.forEach(function (p, i) { if (p.data.phase === "now") nowIdx = i; });
    if (nowIdx < 0) nowIdx = pts.length - 1;

    /* 远洋视图补一块小地图，给出全域位置参照 */
    if (farOcean && nowIdx >= 0) {
      drawMiniMap(baseLayer, box, f, pts, nowIdx, mainlandKm(pts[nowIdx].data.lat, pts[nowIdx].data.lng));
    }

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

    $("mapWrap").querySelector(".map-note").textContent = farOcean
      ? "远洋视图 · 小地图框出当前图幅 · 经纬网为示意"
      : (omitted > 0 ? "海岸线为示意 · 部分远海路径未显示" : "海岸线为示意");
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

  /* 多源交叉校验说明行：一致/分歧/单源 三态；命名依据另起一行 */
  var VERIFY_LABEL = { consistent: "多源校验一致", divergent: "多源存在分歧", single: "单源跟踪" };
  function renderVerify(t) {
    var box = $("tyVerify");
    if (!box) return;
    var v = t && t.verification;
    if (!v && !(t && t.nameNote)) { box.hidden = true; return; }
    box.innerHTML = "";
    box.className = "hero-verify" + (v && v.status ? " " + v.status : "");
    if (v) {
      box.appendChild(el("i", "vf-dot"));
      box.appendChild(el("b", null, VERIFY_LABEL[v.status] || "多源校验"));
      if (v.detail) box.appendChild(document.createTextNode(" · " + v.detail));
    }
    if (t.nameNote) {
      if (v) box.appendChild(document.createElement("br"));
      box.appendChild(el("span", "vf-note", t.nameNote));
    }
    box.hidden = false;
  }

  /* #tyKicker 内含 #tyCode / #tyEnName 两个 span。设置 kicker 的 textContent 会连带
     移除这两个子节点，因此凡是改写过 kicker 的状态（风平浪静 / 影响持续期），
     再切回台风态时必须重建结构，否则 $("tyCode") 为 null 直接抛错。 */
  function setKickerStorm(code, enName) {
    var k = $("tyKicker");
    k.textContent = "";
    k.appendChild(document.createTextNode("第 "));
    var c = el("span", null, String(code));
    c.id = "tyCode";
    k.appendChild(c);
    k.appendChild(document.createTextNode(" 号台风 · "));
    var e = el("span", null, String(enName));
    e.id = "tyEnName";
    k.appendChild(e);
  }

  function renderTyphoon(t) {
    setKickerStorm(t.code, t.enName);
    $("tyName").textContent = t.name;
    $("tyLevel").textContent = t.level;
    $("tySummary").textContent = t.summary;
    renderVerify(t);
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
    renderRisk(t);
  }

  /* ---------- 数据装载 ---------- */
  var DATA = null, IS_LIVE = false, current = 0;

  /* ---------- 预案档位建议 ---------- */
  /* 历史教训（2026 年第 10 号台风美莎克）：
     它以强热带风暴级（10 级）登陆，按风力推档只到黄色；但登陆后在陆上重建眼区、
     于广西内陆滞留 26 小时，极端降雨引发六蓝、云表等水库溃坝，最终致 159 人遇难。
     减弱为热带低压后风力档位甚至回落到蓝色——恰恰是伤亡最集中的时段。
     因此档位取「风力档」与「洪涝预警档」的较高者，绝不由风力单独决定。 */
  var LEVEL_ZH = { blue: "蓝", yellow: "黄", orange: "橙", red: "红" };

  function tierRank(l) { return WARNING_LEVELS.indexOf(l) + 1; }

  function windTier(t) {
    if (!t || !t.nearCoast) return "blue";
    var w = (t.now && t.now.windLevel) || 0;
    if (w >= 14) return "orange";
    if (w >= 10) return "yellow";
    return "blue";
  }

  function rainTier(t) {
    return (t && t.rainRisk && t.rainRisk.floodLevel) || null;
  }

  /* 洪涝档高于风力档 = 典型"弱级强灾"，需要显式点破 */
  function riskMismatch(t) {
    var w = windTier(t), r = rainTier(t);
    return tierRank(r) > tierRank(w) ? { wind: w, rain: r } : null;
  }

  function suggestLevel(t) {
    var w = windTier(t), r = rainTier(t);
    return tierRank(r) > tierRank(w) ? r : w;
  }

  /* ---------- 雨情：洪涝类预警 ---------- */

  function renderRisk(t) {
    var sec = $("risk"), box = $("riskProvinces");
    var callout = $("riskCallout"), note = $("riskNote");
    var alerts = DATA && DATA.alerts;
    box.innerHTML = "";
    sec.hidden = false;
    callout.hidden = true;

    if (!alerts) {
      /* 演示数据或改版前的旧缓存：没有 alerts 字段，不能报成"抓取失败" */
      sec.hidden = true;
      return;
    }
    if (!alerts.ok) {
      note.textContent = "洪涝类预警本次抓取失败（" + (alerts.error || "原因未知") +
        "），请直接查看中央气象台预警发布平台。";
      return;
    }
    var risk = t && t.rainRisk;
    if (!risk || !risk.provinces.length) {
      note.textContent = "台风影响范围内暂无洪涝类预警在效（数据更新于 " + DATA.updatedAt + "）。";
      return;
    }

    var mis = riskMismatch(t);
    if (mis) {
      callout.hidden = false;
      callout.className = "risk-callout lv-" + mis.rain;
      callout.textContent = "注意：本台风按风力只对应" + LEVEL_ZH[mis.wind] + "色档位，" +
        "但其影响范围内已有" + LEVEL_ZH[mis.rain] + "色洪涝类预警在效。" +
        "台风等级只反映风速，不代表致灾程度——下方预案已按较高者预选。";
    }

    risk.provinces.forEach(function (p) {
      var card = el("div", "risk-prov lv-" + (p.floodLevel || p.maxLevel));
      card.appendChild(el("p", "rp-name", p.province));
      var kinds = el("p", "rp-kinds");
      Object.keys(p.kinds).forEach(function (k) {
        kinds.appendChild(el("span", "rp-tag lv-" + p.kinds[k], k + LEVEL_ZH[p.kinds[k]]));
      });
      card.appendChild(kinds);
      card.appendChild(el("p", "rp-sub", p.count + " 条在效 · " + p.via));
      if (p.top && p.top.title) {
        var a = el("a", "rp-link", p.top.title);
        a.href = p.top.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        card.appendChild(a);
      }
      box.appendChild(card);
    });

    note.textContent = "预警来自" + alerts.source + "，取台风影响范围内各省级行政区的最高档位" +
      "（省内可能仅部分区县发布）。这是台风与省份的关联，页面不判断你所在位置。";
  }

  /* ---------- 影响持续期 ---------- */
  /* 停编 ≠ 风险结束：美莎克 2026-07-07 停编，遇难数字此后六周从 39 升至 159。
     只要停编台风的影响省份仍有洪涝类预警在效，页面就不回落到"风平浪静"。 */

  /* 取最近一条"已停编但影响省份仍有洪涝预警在效"的台风；没有则返回 null */
  function aftermath() {
    var list = (DATA && DATA.recentlyEnded) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].ongoingFloodLevel) return list[i];
    }
    return null;
  }

  function renderAftermath(e) {
    $("tyKicker").textContent = "第 " + e.code + " 号台风 · " + (e.enName || "—") + " · 影响持续期";
    $("tyName").textContent = e.name;
    $("tyLevel").textContent = (e.lastLevel || "已停编") + " · 停编" +
      (e.daysSince != null ? " " + e.daysSince + " 天" : "");
    $("tySummary").textContent = e.name + "已停止编号，但其影响省份（" +
      (e.provinces || []).join("、") + "）仍有" + LEVEL_ZH[e.ongoingFloodLevel] +
      "色洪涝类预警在效。台风停编不等于风险结束，降雨、山洪与水库险情可能持续更久。";
    $("tySummary").classList.remove("is-calm");
    var v = $("tyVerify");
    if (v) v.hidden = true;
    $("live").hidden = true;
    $("track").hidden = true;
  }

  function init(data, mode) {
    var isLive = mode === "live";
    var isSnapshot = mode === "snapshot";
    DATA = data; IS_LIVE = isLive;
    var badge = $("dataBadge");
    var notice = $("noticeBar");
    if (isLive) {
      badge.textContent = data.sources ? "实时 · 多源校验" : "实时数据";
      badge.classList.add("live");
      badge.title = "来源：" + data.source + "，更新于 " + data.updatedAt;
      if (data.sources && data.sources.map) {
        badge.title += "。源状态：" + data.sources.map(function (s) {
          return s.name + (s.ok ? " ✓" : " ×");
        }).join(" · ");
      }
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
      $("live").hidden = false;
      $("track").hidden = false;
      renderTyphoon(list[0]);
      currentLevel = suggestLevel(list[0]);
      $("levelHint").hidden = false;
      planHeadTitle.textContent = "现在，该做什么";
      planFirst.innerHTML = "第一原则：<b>服从当地政府与社区的统一安排</b>，收到转移指令立即执行。";
      planFirst.classList.remove("is-calm");
    } else if (aftermath()) {
      /* 停编但影响未结束：保留风险姿态，档位跟随在效洪涝预警 */
      var af = aftermath();
      renderAftermath(af);
      $("risk").hidden = true;
      currentLevel = af.ongoingFloodLevel;
      $("levelHint").hidden = false;
      planHeadTitle.textContent = "风还没走完";
      planFirst.innerHTML = "第一原则：<b>服从当地政府与社区的统一安排</b>；台风虽已停编，洪水与山洪风险仍在。";
      planFirst.classList.remove("is-calm");
    } else {
      /* 无活跃台风：收起实况与路径板块，预案常备 */
      $("risk").hidden = true;
      $("tyKicker").textContent = "西北太平洋";
      $("tyName").textContent = "风平浪静";
      $("tyLevel").textContent = "西北太平洋暂无编号台风";
      $("tySummary").textContent = "风来之前，都是准备的好时候。";
      $("tySummary").classList.add("is-calm");
      var calmVerify = $("tyVerify");
      if (calmVerify) calmVerify.hidden = true;
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
    return fetch(finalUrl, { cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal })
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
  /* 地区选择和地区清单进度只存在内存中，刷新即清空，不构成位置档案。 */
  var selectedRegions = {};
  var regionChecks = {};
  var currentLevel = "blue";

  var regionBox = $("regionOptions");
  REGION_PROFILES.forEach(function (profile) {
    var b = el("button", "region-option");
    b.type = "button";
    b.dataset.region = profile.id;
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", profile.name + "：" + profile.risk);
    b.appendChild(el("span", "region-option-name", profile.name));
    b.appendChild(el("small", "region-option-risk", profile.risk));
    b.addEventListener("click", function () {
      selectedRegions[profile.id] = !selectedRegions[profile.id];
      b.classList.toggle("is-active", selectedRegions[profile.id]);
      b.setAttribute("aria-pressed", selectedRegions[profile.id] ? "true" : "false");
      renderPlan();
    });
    regionBox.appendChild(b);
  });

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

    /* 递进清单：包含当前级及以下所有通用事项；事项身份 = 来源级:序号，勾选跨级共享 */
    var items = [];
    for (var i = 0; i <= idx; i++) {
      var lv = WARNING_LEVELS[i];
      PLANS[lv].items.forEach(function (text, j) {
        items.push({ id: lv + ":" + j, text: text, from: lv, kind: "common" });
      });
    }

    /* 地区事项同样随等级递进，但选择和勾选均不落盘。 */
    var activeProfiles = REGION_PROFILES.filter(function (profile) { return !!selectedRegions[profile.id]; });
    activeProfiles.forEach(function (profile) {
      for (var n = 0; n <= idx; n++) {
        var regionLevel = WARNING_LEVELS[n];
        (profile.items[regionLevel] || []).forEach(function (text, j) {
          items.push({
            id: profile.id + ":" + regionLevel + ":" + j,
            text: text,
            from: regionLevel,
            kind: "region",
            region: profile,
          });
        });
      }
    });

    var regionStatus = $("regionStatus");
    if (activeProfiles.length) {
      regionStatus.textContent = "已补充：" + activeProfiles.map(function (profile) { return profile.short; }).join("、") + "。地区选择与对应勾选不会保存，刷新后自动清空。";
      regionStatus.classList.add("has-selection");
    } else {
      regionStatus.textContent = "当前仅显示全国通用清单。";
      regionStatus.classList.remove("has-selection");
    }

    var list = $("checklist");
    list.innerHTML = "";
    items.forEach(function (it) {
      var li = el("li", it.kind === "region" ? "is-region-item" : "");
      var label = el("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = it.kind === "region" ? !!regionChecks[it.id] : !!checks[it.id];
      input.addEventListener("change", function () {
        if (it.kind === "region") {
          regionChecks[it.id] = input.checked;
        } else {
          checks[it.id] = input.checked;
          store.set(CHECK_KEY, checks);
        }
        updateProgress(items);
      });
      var span = el("span", null, it.text);
      if (it.kind === "region") {
        var regionBadge = el("i", "region-item-badge", it.region.short);
        regionBadge.title = "适用于" + it.region.name + "：" + it.region.risk;
        span.appendChild(regionBadge);
      } else if (it.from !== currentLevel) {
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
    var done = items.filter(function (it) {
      return it.kind === "region" ? regionChecks[it.id] : checks[it.id];
    }).length;
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
    a.rel = "noopener noreferrer";
    sourceList.appendChild(a);
  });

  boot();
})();

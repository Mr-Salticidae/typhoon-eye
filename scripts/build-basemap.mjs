/* 生成小地图底图 assets/basemap.js —— 离线跑一次，产物是静态坐标，页面运行时零依赖。
 *
 * 数据源：Natural Earth 1:110m Land（public domain，无署名要求）
 *   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
 * 只取陆地轮廓，不含任何国界线——避免边界画法争议；南海诸岛九段线由页面内专门插图表达。
 *
 * 用法：node scripts/build-basemap.mjs
 */
import { writeFile } from "node:fs/promises";

const SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";
const OUT = new URL("../assets/basemap.js", import.meta.url);

/* 经度取值窗口 [CUT, CUT+360)：切在大西洋中部，太平洋居中不被劈开，
   只有格陵兰跨切线，按半平面裁剪成左右两片（世界地图的正常画法）。 */
const CUT = -30;

/* 环太平洋窗口内放宽保留阈值：台湾、海南、日本、菲律宾、新西兰、夏威夷这些
   小块正是"我在哪"的关键地标，不能被面积阈值筛掉 */
const AP = { lng: [60, 215], lat: [-50, 60] };

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
}
function inAP(r) {
  return r.some(function (p) {
    const lng = p[0] < CUT ? p[0] + 360 : p[0]; /* 与取值窗口对齐，否则东太平洋岛屿判不进来 */
    return lng >= AP.lng[0] && lng <= AP.lng[1] && p[1] >= AP.lat[0] && p[1] <= AP.lat[1];
  });
}

/* 闭合环不能直接喂 DP：首尾同点会让基线退化成零长，所有中间点偏移量算成 0、
   整环被抽成两点。先在离起点最远处断开成两段折线，分别抽稀再接回。 */
function simplifyRing(ring, tol) {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  if (r.length < 5) return r;
  let far = 1, maxD = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > maxD) { maxD = d; far = i; }
  }
  return simplify(r.slice(0, far + 1), tol).concat(simplify(r.slice(far), tol).slice(1));
}

/* Douglas–Peucker（平面近似，示意图精度足够） */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const ax = pts[s][0], ay = pts[s][1], bx = pts[e][0], by = pts[e][1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter(function (_, i) { return keep[i]; });
}

/* 半平面裁剪（Sutherland–Hodgman），用于沿切线把跨界多边形切成两片 */
function clipHalf(ring, keepLeft, x0) {
  const out = [];
  const inside = (p) => (keepLeft ? p[0] <= x0 : p[0] >= x0);
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i], prev = ring[(i + ring.length - 1) % ring.length];
    const ci = inside(cur), pi = inside(prev);
    if (ci !== pi) {
      const t = (x0 - prev[0]) / (cur[0] - prev[0]);
      out.push([x0, prev[1] + t * (cur[1] - prev[1])]);
    }
    if (ci) out.push(cur);
  }
  return out;
}

/* 经度解缠 + 平移进取值窗口 */
function normalize(ring) {
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let lng = ring[i][0];
    const prev = out[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, ring[i][1]]);
  }
  let min = Math.min(...out.map((p) => p[0]));
  let shift = 0;
  while (min + shift < CUT) shift += 360;
  while (min + shift >= CUT + 360) shift -= 360;
  return shift ? out.map((p) => [p[0] + shift, p[1]]) : out;
}

const res = await fetch(SRC);
if (!res.ok) throw new Error("下载底图失败：HTTP " + res.status);
const geo = await res.json();

const rings = [];
for (const f of geo.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) rings.push(poly[0]); /* 只取外环，湖泊内环对示意图无意义 */
}

const kept = [];
for (const raw of rings) {
  /* 南极洲环绕极点，投影后是贴底的一条带，对台风定位无信息量，直接丢弃 */
  if (Math.max(...raw.map((p) => p[1])) < -55) continue;
  const near = inAP(raw);
  const area = ringArea(raw);
  if (area < (near ? 0.8 : 15)) continue;

  const norm = normalize(raw);
  const max = Math.max(...norm.map((p) => p[0]));
  const pieces = max > CUT + 360
    ? [clipHalf(norm, true, CUT + 360), clipHalf(norm, false, CUT + 360).map((p) => [p[0] - 360, p[1]])]
    : [norm];

  for (const piece of pieces) {
    if (piece.length < 4) continue;
    /* 产物不含闭合重复点，由 SVG polygon 自动闭合 */
    let s = simplifyRing(piece, near ? 0.35 : 0.7).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    s = s.filter((p, i) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
    if (s.length >= 4) kept.push(s);
  }
}

kept.sort((a, b) => ringArea(b) - ringArea(a));
const body = kept.map((r) => "[" + r.map((p) => p[0] + "," + p[1]).join(",") + "]").join(",\n");
const js = `/* 小地图底图 —— 由 scripts/build-basemap.mjs 生成，请勿手改。
   数据源：Natural Earth 1:110m Land（public domain）
   https://www.naturalearthdata.com/  只含陆地轮廓，不含任何国界线。
   坐标为扁平数组 [lng,lat,lng,lat,...]，经度取值窗口 [${CUT}, ${CUT + 360})，太平洋居中。 */
var WORLD_LAND = [
${body}
];
`;
await writeFile(OUT, js, "utf8");
const pts = kept.reduce((n, r) => n + r.length, 0);
console.log(`环 ${kept.length} 个 / 顶点 ${pts} 个 / ${(js.length / 1024).toFixed(1)} KB`);

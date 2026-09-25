/* 台风季存档 → data/season.json
   防台是长期工作。停编 7 天后台风就会从 typhoon.json 消失，此前页面查不到任何历史
   （PLAN.md M8：美莎克的轨迹从未进过存档）。这里把每个见过的编号台风写进年度存档：
     - 活跃台风：每轮把实况与已过路径并入存档，轨迹随抓取逐轮累积；
     - 存档建立前已停编的台风：用浙江源年度列表 + TyphoonInfo 补齐（有预算、可失败）。
   纯函数，不做网络请求；由 fetch-typhoon.mjs 驱动。存档失败绝不影响实况主产物。

   存档条目：
     { code, name, enName, active, source: "live"|"backfill",
       start, end,                 // "MM-DD HH时"（北京时间）
       peakWind, peakStrong, minPressure,
       provinces,                  // 期间关联过洪涝类预警的省份（仅 live 条目可知）
       track: [["MM-DD HH时", lat, lng, wind], ...] }  // 只含实况与已过路径，≤ 48 点 */

export const SEASON_MAX_POINTS = 48;

/* 只存档本年度正式编号的台风：编号 = 年份后两位 + 两位序号（如 2626） */
function seasonCode(code, year) {
  const c = String(code || "");
  const yy = String(year).slice(2);
  return /^\d{4}$/.test(c) && c.startsWith(yy) && c.slice(2) !== "00" ? c : null;
}

/* 下采样：保 ≤maxN 个点且必含首尾（与 fetch-typhoon.mjs 的 thin 同义） */
function thin(list, maxN) {
  if (list.length <= maxN) return list;
  const step = (list.length - 1) / (maxN - 1);
  const out = [];
  for (let i = 0; i < maxN; i++) out.push(list[Math.round(i * step)]);
  return out;
}

const valid = (p) => p && typeof p[0] === "string" &&
  Number.isFinite(p[1]) && Number.isFinite(p[2]) && Number.isFinite(p[3]);

/* 按时次去重合并，新数据覆盖旧数据；"MM-DD HH时" 在同一年内字典序即时序 */
export function mergeTrack(old, add) {
  const byT = new Map();
  for (const p of old || []) if (valid(p)) byT.set(p[0], p);
  for (const p of add || []) if (valid(p)) byT.set(p[0], p);
  const merged = [...byT.values()].sort((a, b) => a[0].localeCompare(b[0]));
  return thin(merged, SEASON_MAX_POINTS);
}

function applyPeak(e, wind, strong, pressure) {
  if (Number.isFinite(wind) && (e.peakWind == null || wind > e.peakWind)) {
    e.peakWind = wind;
    if (strong) e.peakStrong = strong;
  }
  if (Number.isFinite(pressure) && pressure > 800 && (e.minPressure == null || pressure < e.minPressure)) {
    e.minPressure = pressure;
  }
}

function refreshSpan(e) {
  if (!e.track.length) return;
  e.start = e.track[0][0];
  e.end = e.track[e.track.length - 1][0];
}

export function emptySeason(year) {
  return { year, updatedAt: null, storms: [] };
}

/* 活跃台风并入存档；本轮不在列表里的活跃条目标为已停编 */
export function upsertActive(season, typhoons) {
  const live = new Set();
  for (const t of typhoons || []) {
    const code = seasonCode(t.code, season.year);
    if (!code) continue;
    live.add(code);
    let e = season.storms.find((s) => s.code === code);
    if (!e) {
      e = { code, name: t.name, enName: t.enName, active: true, source: "live",
        start: null, end: null, peakWind: null, peakStrong: null, minPressure: null,
        provinces: [], track: [] };
      season.storms.push(e);
    }
    /* 命名可能晚于编号（NAMELESS → 正式名），每轮以最新为准 */
    e.name = t.name;
    e.enName = t.enName;
    e.active = true;

    const observed = (t.track || []).filter((p) => p.phase !== "forecast");
    for (const p of observed) applyPeak(e, p.wind, p.strong, null);
    applyPeak(e, t.now?.windLevel, null, t.now?.pressure);
    e.track = mergeTrack(e.track, observed.map((p) => [p.t, p.lat, p.lng, p.wind]));
    refreshSpan(e);

    const provs = (t.rainRisk?.provinces || []).map((p) => p.province).filter(Boolean);
    e.provinces = [...new Set([...(e.provinces || []), ...provs])];
  }
  for (const e of season.storms) {
    if (e.active && !live.has(e.code)) e.active = false;
  }
}

/* 浙江源年度列表中已停编、且存档里还没有的台风 → 待补齐的 tfid */
export function pendingBackfill(season, yearList) {
  if (!Array.isArray(yearList)) return [];
  const have = new Set(season.storms.map((s) => s.code));
  return yearList
    .filter((r) => r && String(r.isactive) !== "1")
    .map((r) => String(r.tfid || ""))
    .filter((id) => /^\d{6}$/.test(id) && id.startsWith(String(season.year)))
    .filter((id) => seasonCode(id.slice(-4), season.year) && !have.has(id.slice(-4)));
}

/* 浙江源 TyphoonInfo → 存档条目。points: { time:"YYYY-MM-DD HH:mm:ss", lat, lng, power, strong, pressure } */
export function addBackfilled(season, info, shortTime) {
  const code = seasonCode(String(info?.tfid || "").slice(-4), season.year);
  if (!code || season.storms.some((s) => s.code === code)) return false;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const e = { code, name: info.name || "", enName: String(info.enname || "").toUpperCase(),
    active: false, source: "backfill", start: null, end: null,
    peakWind: null, peakStrong: null, minPressure: null, provinces: [], track: [] };
  const pts = [];
  for (const p of info.points || []) {
    const q = [shortTime(p.time), num(p.lat), num(p.lng), num(p.power)];
    if (!valid(q)) continue;
    pts.push(q);
    applyPeak(e, q[3], p.strong || "", num(p.pressure));
  }
  if (!pts.length) return false;
  e.track = mergeTrack([], pts);
  refreshSpan(e);
  season.storms.push(e);
  return true;
}

export function sortSeason(season) {
  season.storms.sort((a, b) => a.code.localeCompare(b.code));
}

/* 缩进 JSON，但把只含原始值的数组（轨迹点）收成一行，存档体积约减四成 */
export function serializeSeason(season) {
  return JSON.stringify(season, null, 2)
    .replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, inner) => "[" + inner.split(/,\s*\n\s*/).join(", ") + "]") + "\n";
}

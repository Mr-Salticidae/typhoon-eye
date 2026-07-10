/* 抓取活跃台风实况 → 生成 data/typhoon.json（静态分发，前端零跨域）
   数据源：浙江省台风路径实时发布系统（typhoon.slt.zj.gov.cn）
   用法：node scripts/fetch-typhoon.mjs
   失败时以非零码退出，工作流将保留上一版数据。 */

import { writeFile, mkdir } from "node:fs/promises";

const API = "https://typhoon.slt.zj.gov.cn/Api";
const HEADERS = {
  Referer: "https://typhoon.slt.zj.gov.cn/",
  "User-Agent": "typhoon-eye/0.2 (+https://github.com/Mr-Salticidae/typhoon-eye)",
};

/* 北京时间 */
function bjNow() {
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/* "500|500|450|480" 四象限取最大；空串/缺失返回 null */
function maxRadius(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.split("|").map(Number).filter((n) => n > 0);
  return v.length ? Math.max(...v) : null;
}

/* "2026-07-10 05:00:00" → "07-10 05时" */
function shortTime(t) {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2})/.exec(t || "");
  return m ? `${m[1]}-${m[2]} ${m[3]}时` : t;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* 过去路径下采样：保 ≤maxN 个点且必含首尾 */
function thin(list, maxN) {
  if (list.length <= maxN) return list;
  const step = (list.length - 1) / (maxN - 1);
  const out = [];
  for (let i = 0; i < maxN; i++) out.push(list[Math.round(i * step)]);
  return out;
}

function mapTyphoon(info) {
  const points = info.points || [];
  if (!points.length) return null;
  const nowPt = points[points.length - 1];

  const past = thin(points.slice(0, -1), 14).map((p) => ({
    t: shortTime(p.time), lat: num(p.lat), lng: num(p.lng),
    wind: num(p.power), strong: p.strong || "", phase: "past",
  }));

  /* 预报优先取"中国"（中央气象台），其首点与当前点重合需跳过 */
  const agencies = nowPt.forecast || [];
  const cn = agencies.find((a) => a.tm === "中国") || agencies[0];
  const forecast = (cn?.forecastpoints || [])
    .filter((p) => p.time !== nowPt.time)
    .map((p) => ({
      t: shortTime(p.time), lat: num(p.lat), lng: num(p.lng),
      wind: num(p.power), strong: p.strong || "", phase: "forecast",
    }));

  const lat = num(nowPt.lat), lng = num(nowPt.lng);
  const track = [
    ...past,
    { t: shortTime(nowPt.time), lat, lng, wind: num(nowPt.power), strong: nowPt.strong || "", phase: "now" },
    ...forecast,
  ].filter((p) => p.lat !== null && p.lng !== null && p.wind !== null);

  /* 预报点靠近我国近海则给出关注提示（不代发登陆结论） */
  const nearCoast = forecast.some((p) => p.lng !== null && p.lat !== null && p.lng <= 122.5 && p.lat >= 18 && p.lat <= 32);
  const summary = nearCoast
    ? "预报路径趋向我国沿海，沿海地区请密切关注当地气象部门发布的最新预警。"
    : "预报路径详见路径图，请以官方逐时发布为准。";

  return {
    name: info.name,
    enName: info.enname,
    code: info.tfid?.slice(-4) ?? info.tfid,
    level: `${nowPt.strong}（${nowPt.power}级）`,
    summary,
    nearCoast,
    now: {
      windLevel: num(nowPt.power),
      windSpeed: num(nowPt.speed),
      pressure: num(nowPt.pressure),
      moveDir: nowPt.movedirection || "—",
      moveSpeed: num(nowPt.movespeed),
      r7: maxRadius(nowPt.radius7),
      r10: maxRadius(nowPt.radius10),
      position: `中心位于北纬 ${lat?.toFixed(1)} 度、东经 ${lng?.toFixed(1)} 度`,
      time: shortTime(nowPt.time),
    },
    track,
  };
}

const year = bjNow().slice(0, 4);
const list = await getJSON(`${API}/TyphoonList/${year}`);
const active = list.filter((t) => String(t.isactive) === "1");

const typhoons = [];
for (const t of active) {
  const info = await getJSON(`${API}/TyphoonInfo/${t.tfid}`);
  const mapped = mapTyphoon(info);
  if (mapped) typhoons.push(mapped);
}

const out = {
  updatedAt: bjNow(),
  source: "浙江省台风路径实时发布系统",
  sourceUrl: "https://typhoon.slt.zj.gov.cn/",
  typhoons,
};

await mkdir("data", { recursive: true });
await writeFile("data/typhoon.json", JSON.stringify(out, null, 2) + "\n");
console.log(`ok: ${typhoons.length} active typhoon(s) — ${typhoons.map((t) => t.name).join("、") || "无"} @ ${out.updatedAt}`);

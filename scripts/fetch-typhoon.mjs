/* 抓取活跃台风实况 → 生成 data/typhoon.json（静态分发，前端零跨域）
   v0.6 多源交叉校验 + 洪涝预警：
     - 中央气象台 typhoon.nmc.cn        —— 主源（轨迹与实况优先采用）
     - 浙江省台风路径实时发布系统        —— 备源（主源缺失时出轨迹）+ 交叉校验 + 风圈补全
     - 日本气象厅 JMA（RSMC 东京）       —— 交叉校验 + 国际命名权威（西太台风由其命名）
     - 中央气象台预警发布平台            —— 暴雨/山洪/地质灾害/台风预警，关联到台风影响省份
   台风等级只反映风速，"弱级强灾"型台风（如 2610 美莎克）靠风力无法预警，
   故并列输出洪涝类预警，并保留停编台风的影响持续期。详见 README。
   命名择优：任一源先给出正式命名即采用（JMA 英文名经命名表对照中文名），
   避免单一源命名滞后导致页面迟迟显示 NAMELESS。
   用法：node scripts/fetch-typhoon.mjs
   全部源失败、或两个轨迹源均失败时以非零码退出，工作流保留上一版数据。 */

import { writeFile, mkdir, readFile } from "node:fs/promises";

const UA = "typhoon-eye/0.5 (+https://github.com/Mr-Salticidae/typhoon-eye)";

/* ---------- 通用工具 ---------- */

/* 北京时间 "YYYY-MM-DD HH:mm" */
function bjNow() {
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function getText(url, headers) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function getJSON(url, headers) {
  return JSON.parse(await getText(url, headers));
}

/* JSONP "cb((…))" → 对象 */
function parseJSONP(text) {
  return JSON.parse(text.replace(/^[^({[]*\(+/, "").replace(/\)+;?\s*$/, ""));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* "2026-07-10 05:00:00" → "07-10 05时" */
function shortTime(t) {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2})/.exec(t || "");
  return m ? `${m[1]}-${m[2]} ${m[3]}时` : t;
}

/* UTC 毫秒时间戳 → 北京时间 "MM-DD HH时" */
function shortTimeFromUTC(ms) {
  const d = new Date(ms + 8 * 3600e3);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}时`;
}

/* "202607222100"（UTC）→ UTC 毫秒 */
function utcCompactToMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

/* 两点大圆距离 km */
function distKm(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, R = 6371;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* 过去路径下采样：保 ≤maxN 个点且必含首尾 */
function thin(list, maxN) {
  if (list.length <= maxN) return list;
  const step = (list.length - 1) / (maxN - 1);
  const out = [];
  for (let i = 0; i < maxN; i++) out.push(list[Math.round(i * step)]);
  return out;
}

/* ---------- 气象换算 ---------- */

/* 最大风速 m/s → 风力等级（国标蒲福扩展） */
const LEVEL_STEPS = [
  [56.1, 17], [51.0, 16], [46.2, 15], [41.5, 14], [37.0, 13], [32.7, 12],
  [28.5, 11], [24.5, 10], [20.8, 9], [17.2, 8], [13.9, 7], [10.8, 6],
];
function msToLevel(ms) {
  if (ms === null) return null;
  for (const [min, lv] of LEVEL_STEPS) if (ms >= min) return lv;
  return 5;
}

const CAT_ZH = {
  TD: "热带低压", TS: "热带风暴", STS: "强热带风暴",
  TY: "台风", STY: "强台风", SUPERTY: "超强台风",
};
const catZh = (en) => CAT_ZH[String(en || "").toUpperCase().replace(/\s+/g, "")] || "";

/* 罗盘方位 EN → 中文（与前端 DIR_DEG 键一致） */
const DIR_ZH = {
  N: "北", NNE: "北北东", NE: "东北", ENE: "东北东", E: "东",
  ESE: "东南东", SE: "东南", SSE: "南南东", S: "南", SSW: "南南西",
  SW: "西南", WSW: "西南西", W: "西", WNW: "西北西", NW: "西北", NNW: "北北西",
};

/* 西北太平洋台风命名表（英文 → 中央气象台中文译名）。
   用途：JMA（命名权威）先于国内源命名时，据此给出中文名；
   查不到时回退显示英文名，待国内源跟进后自动覆盖。 */
const NAME_ZH = {
  DAMREY: "达维", HAIKUI: "海葵", KIROGI: "鸿雁", "YUN-YEUNG": "鸳鸯", KOINU: "小犬",
  BOLAVEN: "布拉万", SANBA: "三巴", JELAWAT: "杰拉华", EWINIAR: "艾云尼", MALIKSI: "马力斯",
  GAEMI: "格美", PRAPIROON: "派比安", MARIA: "玛莉亚", "SON-TINH": "山神", AMPIL: "安比",
  WUKONG: "悟空", JONGDARI: "云雀", SHANSHAN: "珊珊", YAGI: "摩羯", LEEPI: "丽琵",
  BEBINCA: "贝碧嘉", PULASAN: "普拉桑", SOULIK: "苏力", CIMARON: "西马仑", JEBI: "飞燕",
  KRATHON: "山陀儿", BARIJAT: "百里嘉", TRAMI: "潭美", "KONG-REY": "康妮", YINXING: "银杏",
  TORAJI: "桃芝", "MAN-YI": "万宜", USAGI: "天兔", PABUK: "帕布", WUTIP: "蝴蝶",
  SEPAT: "圣帕", MUN: "木恩", DANAS: "丹娜丝", NARI: "百合", WIPHA: "韦帕",
  FRANCISCO: "范斯高", "CO-MAY": "竹节草", KROSA: "罗莎", BAILU: "白鹿", PODUL: "杨柳",
  LINGLING: "玲玲", KAJIKI: "剑鱼", NONGFA: "蓝湖", PEIPAH: "琵琶", TAPAH: "塔巴",
  MITAG: "米娜", RAGASA: "桦加沙", NEOGURI: "浣熊", BUALOI: "博罗依", MATMO: "麦德姆",
  HALONG: "夏浪", NAKRI: "娜基莉", FENGSHEN: "风神", KALMAEGI: "海鸥", "FUNG-WONG": "凤凰",
  KOTO: "天琴", PHANFONE: "巴蓬", VONGFONG: "黄蜂", NURI: "鹦鹉", SINLAKU: "森拉克",
  HAGUPIT: "黑格比", JANGMI: "蔷薇", MEKKHALA: "米克拉", HIGOS: "海高斯", BAVI: "巴威",
  MAYSAK: "美莎克", HAISHEN: "海神", NOUL: "红霞", DOLPHIN: "白海豚", KUJIRA: "鲸鱼",
  "CHAN-HOM": "灿鸿", PEILOU: "白鹭", NANGKA: "浪卡", SAUDEL: "沙德尔", NARRA: "紫檀",
  GONI: "天鹅", ATSANI: "艾莎尼", ETAU: "艾涛", VAMCO: "环高", KROVANH: "科罗旺",
  DUJUAN: "杜鹃", SURIGAE: "舒力基", "CHOI-WAN": "彩云", KOGUMA: "小熊", CHAMPI: "蔷琵",
  "IN-FA": "烟花", CEMPAKA: "查帕卡", NEPARTAK: "尼伯特", LUPIT: "卢碧", MIRINAE: "银河",
  NIDA: "妮妲", OMAIS: "奥麦斯", CONSON: "康森", CHANTHU: "灿都", DIANMU: "电母",
  MINDULLE: "蒲公英", LIONROCK: "狮子山", KOMPASU: "圆规", NAMTHEUN: "南川", MALOU: "玛瑙",
  NYATOH: "妮亚图", RAI: "雷伊", MALAKAS: "马勒卡", MEGI: "鲇鱼", CHABA: "暹芭",
  AERE: "艾利", SONGDA: "桑达", TRASES: "翠丝", MULAN: "木兰", MEARI: "米雷",
  "MA-ON": "马鞍", TOKAGE: "蝎虎", HINNAMNOR: "轩岚诺", MUIFA: "梅花", MERBOK: "苗柏",
  NANMADOL: "南玛都", TALAS: "塔拉斯", NORU: "奥鹿", KULAP: "玫瑰", ROKE: "洛克",
  SONCA: "桑卡", NESAT: "尼莎", HAITANG: "海棠", NALGAE: "尼格", BANYAN: "榕树",
  YAMANEKO: "山猫", PAKHAR: "帕卡", SANVU: "珊瑚", MAWAR: "玛娃", GUCHOL: "古超",
  TALIM: "泰利", DOKSURI: "杜苏芮", KHANUN: "卡努", LAN: "兰恩", SAOLA: "苏拉",
  NOKAEN: "洛鞍", PENHA: "西望洋",
};

/* 是否"未命名"（热带低压阶段） */
function isNameless(name, enName) {
  const en = String(enName || "").toUpperCase();
  return !en || en === "NAMELESS" || /^热带(低压|扰动)$/.test(String(name || ""));
}

/* ---------- 源 1：中央气象台（主源） ---------- */

const CMA_HEADERS = { Referer: "http://typhoon.nmc.cn/web.html" };

async function fetchCMA() {
  const list = parseJSONP(await getText(
    "http://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default", CMA_HEADERS));
  const active = (list.typhoonList || []).filter((row) => row[7] === "start");
  const storms = [];
  for (const row of active) {
    const [id, enName, name, code] = row;
    const view = parseJSONP(await getText(
      `http://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${id}`, CMA_HEADERS));
    const points = view.typhoon?.[8] || [];
    if (!points.length) continue;

    /* 点位：[id, "YYYYMMDDHHmm"(UTC), tsMs, 强度EN, lng, lat, 气压, 风速m/s, 移向EN, 移速, 风圈, {机构预报}, 发布信息] */
    const mapPt = (p, phase) => {
      const ms = num(p[7]);
      return {
        t: shortTimeFromUTC(num(p[2]) ?? utcCompactToMs(p[1])),
        lat: num(p[5]), lng: num(p[4]),
        wind: msToLevel(ms), strong: catZh(p[3]), phase,
        _ms: ms, _pressure: num(p[6]), _dir: p[8], _speed: num(p[9]), _utc: num(p[2]),
      };
    };
    const past = thin(points.slice(0, -1), 14).map((p) => mapPt(p, "past"));
    const nowRaw = points[points.length - 1];
    const nowPt = mapPt(nowRaw, "now");

    /* 预报取北京 BABJ：[提前小时, 基准时(UTC), lng, lat, 气压, 风速m/s, 机构, 强度EN] */
    const baseMs = num(nowRaw[2]) ?? utcCompactToMs(nowRaw[1]);
    const forecast = (nowRaw[11]?.BABJ || [])
      .map((f) => ({
        t: shortTimeFromUTC(baseMs + num(f[0]) * 3600e3),
        lat: num(f[3]), lng: num(f[2]),
        wind: msToLevel(num(f[5])), strong: catZh(f[7]), phase: "forecast",
      }))
      .filter((p) => p.lat !== null && p.lng !== null && p.wind !== null);

    storms.push({
      src: "cma",
      code: String(code || "").slice(-4),
      name, enName: String(enName || "").toUpperCase(),
      named: !isNameless(name, enName),
      now: {
        lat: nowPt.lat, lng: nowPt.lng,
        windLevel: nowPt.wind, windSpeed: nowPt._ms, pressure: nowPt._pressure,
        moveDir: DIR_ZH[nowPt._dir] || nowPt._dir || "—", moveSpeed: nowPt._speed,
        r7: null, r10: null, /* CMA 风圈字段结构不稳定，统一由浙江源补全 */
        time: nowPt.t,
      },
      track: [...past, nowPt, ...forecast]
        .map(({ _ms, _pressure, _dir, _speed, _utc, ...p }) => p)
        .filter((p) => p.lat !== null && p.lng !== null && p.wind !== null),
    });
  }
  return storms;
}

/* ---------- 源 2：浙江省台风路径实时发布系统（备源 + 校验） ---------- */

const ZJ_API = "https://typhoon.slt.zj.gov.cn/Api";
const ZJ_HEADERS = { Referer: "https://typhoon.slt.zj.gov.cn/" };

/* "500|500|450|480" 四象限取最大 */
function maxRadius(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.split("|").map(Number).filter((n) => n > 0);
  return v.length ? Math.max(...v) : null;
}

async function fetchZJ() {
  const year = bjNow().slice(0, 4);
  const list = await getJSON(`${ZJ_API}/TyphoonList/${year}`, ZJ_HEADERS);
  const active = list.filter((t) => String(t.isactive) === "1");
  const storms = [];
  for (const t of active) {
    const info = await getJSON(`${ZJ_API}/TyphoonInfo/${t.tfid}`, ZJ_HEADERS);
    const points = info.points || [];
    if (!points.length) continue;
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
    storms.push({
      src: "zj",
      code: String(info.tfid || t.tfid || "").slice(-4),
      name: info.name, enName: String(info.enname || "").toUpperCase(),
      named: !isNameless(info.name, info.enname),
      now: {
        lat, lng,
        windLevel: num(nowPt.power), windSpeed: num(nowPt.speed), pressure: num(nowPt.pressure),
        moveDir: nowPt.movedirection || "—", moveSpeed: num(nowPt.movespeed),
        r7: maxRadius(nowPt.radius7), r10: maxRadius(nowPt.radius10),
        time: shortTime(nowPt.time),
      },
      track: [
        ...past,
        { t: shortTime(nowPt.time), lat, lng, wind: num(nowPt.power), strong: nowPt.strong || "", phase: "now" },
        ...forecast,
      ].filter((p) => p.lat !== null && p.lng !== null && p.wind !== null),
    });
  }
  return storms;
}

/* ---------- 源 3：日本气象厅 JMA（校验 + 命名权威） ---------- */

const JMA_BASE = "https://www.jma.go.jp/bosai/typhoon/data";

/* 命名字段在不同阶段结构不一（{jp,en} 对象或字符串），做容错提取 */
function jmaName(obj) {
  for (const k of ["typhoonName", "name"]) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
    if (v && typeof v === "object" && typeof v.en === "string" && v.en.trim()) return v.en.trim().toUpperCase();
  }
  return null;
}

async function fetchJMA() {
  const targets = await getJSON(`${JMA_BASE}/targetTc.json`);
  const storms = [];
  for (const tc of targets) {
    const spec = await getJSON(`${JMA_BASE}/${tc.tropicalCyclone}/specifications.json`);
    const title = spec.find((p) => p.part === "title") || {};
    const nowPart = spec.find((p) => p.part && p.part.en === "Analysis");
    if (!nowPart) continue;

    const [lat, lng] = nowPart.position?.deg || [null, null];
    const ms = num(nowPart.maximumWind?.sustained?.["m/s"]);
    const numStr = String(tc.typhoonNumber ?? title.typhoonNumber ?? "");
    const en = jmaName(title) || jmaName(tc);
    storms.push({
      src: "jma",
      code: /^\d{4}$/.test(numStr) ? numStr : null,
      name: en ? (NAME_ZH[en] || en) : "热带低压",
      enName: en || "NAMELESS",
      named: !!en,
      nameFromTable: !!(en && NAME_ZH[en]),
      catZh: catZh(nowPart.category?.en) || nowPart.category?.jp || "",
      now: {
        lat: num(lat), lng: num(lng),
        windLevel: msToLevel(ms), windSpeed: ms, pressure: num(nowPart.pressure),
        moveDir: nowPart.course || "—", moveSpeed: num(nowPart.speed?.["km/h"]),
        r7: null, r10: null,
        time: shortTimeFromUTC(Date.parse(nowPart.validtime?.UTC)),
      },
      track: null, /* JMA 仅用于校验与命名，不出轨迹 */
    });
  }
  return storms;
}

/* ---------- 多源汇合 ---------- */

const SRC_META = {
  cma: { label: "中央气象台", url: "http://typhoon.nmc.cn/web.html" },
  zj: { label: "浙江台风路径系统", url: "https://typhoon.slt.zj.gov.cn/" },
  jma: { label: "日本气象厅", url: "https://www.jma.go.jp/bosai/map.html#contents=typhoon" },
};

/* 同一台风跨源匹配：都已命名比编号；否则比当前中心距离（≤350km 视为同一系统） */
function sameStorm(a, b) {
  if (a.named && b.named && a.code && b.code) return a.code === b.code;
  if (a.now.lat === null || b.now.lat === null) return false;
  return distKm(a.now.lat, a.now.lng, b.now.lat, b.now.lng) <= 350;
}

function mergeStorms(bySrc) {
  const groups = [];
  for (const src of ["cma", "zj", "jma"]) {
    for (const storm of bySrc[src] || []) {
      const hit = groups.find((g) => g.some((s) => sameStorm(s, storm)));
      if (hit) hit.push(storm); else groups.push([storm]);
    }
  }
  return groups;
}

/* "07-23 14时" → 可比较的小时数（跨月按 31 天粗算，只用于求差） */
function timeHours(t) {
  const m = /^(\d{2})-(\d{2}) (\d{2})时$/.exec(t || "");
  return m ? (+m[1] * 31 + +m[2]) * 24 + +m[3] : null;
}

function buildVerification(primary, members) {
  const others = members.filter((s) => s !== primary);
  const sources = members.map((s) => ({
    id: s.src, name: SRC_META[s.src].label, time: s.now.time,
    windLevel: s.now.windLevel, role: s === primary ? "primary" : "verify",
  }));
  if (!others.length) {
    return {
      status: "single",
      detail: `目前仅${SRC_META[primary.src].label}发布该系统，其余源暂未跟踪`,
      sources,
    };
  }
  const parts = [];
  let divergent = false;
  const pHours = timeHours(primary.now.time);
  for (const o of others) {
    const d = (primary.now.lat !== null && o.now.lat !== null)
      ? Math.round(distKm(primary.now.lat, primary.now.lng, o.now.lat, o.now.lng)) : null;
    const dw = (primary.now.windLevel !== null && o.now.windLevel !== null)
      ? Math.abs(primary.now.windLevel - o.now.windLevel) : null;
    /* 各机构分析时次可能不同步，按时次差放宽定位容差（基础 100km + 移速×小时差），
       避免把"发布时间差"误判成"定位分歧" */
    const oHours = timeHours(o.now.time);
    const dt = (pHours !== null && oHours !== null) ? Math.abs(pHours - oHours) : 0;
    const tolerance = 100 + (primary.now.moveSpeed || 25) * dt;
    if ((d !== null && d > tolerance) || (dw !== null && dw >= 2)) divergent = true;
    const lag = dt > 0 ? `（时次相差 ${dt} 小时）` : "";
    parts.push(`${SRC_META[o.src].label}定位相差 ${d ?? "—"} 公里${lag}、强度${dw === 0 ? "一致" : dw !== null ? `差 ${dw} 级` : "暂缺"}`);
  }
  return {
    status: divergent ? "divergent" : "consistent",
    detail: `以${SRC_META[primary.src].label}为准：${parts.join("；")}` +
      (divergent ? "。各机构分析存在分歧，请以官方逐时发布为准" : `（${members.length} 源交叉校验一致）`),
    sources,
  };
}

function buildTyphoon(members) {
  /* 轨迹主源：中央气象台 → 浙江 */
  const primary = members.find((s) => s.src === "cma" && s.track) ||
    members.find((s) => s.src === "zj" && s.track);
  if (!primary) return null; /* 仅 JMA 跟踪且无轨迹，无法成图，暂不呈现 */

  /* 命名择优：任一源已命名即用；国内源中文名优先，JMA 命名经对照表转中文 */
  const namer = members.find((s) => s.src !== "jma" && s.named) || members.find((s) => s.named);
  const name = namer ? namer.name : primary.name;
  const enName = namer ? namer.enName : primary.enName;
  let nameNote = null;
  if (namer && namer.src === "jma" && !members.some((s) => s.src !== "jma" && s.named)) {
    nameNote = namer.nameFromTable
      ? "命名由日本气象厅（RSMC 东京）率先发布，中文名按台风命名表对照，以中央气象台后续发布为准"
      : "命名由日本气象厅（RSMC 东京）率先发布，中文译名待中央气象台确认";
  }

  /* 风圈：主源缺失时由浙江源补全 */
  const zj = members.find((s) => s.src === "zj");
  const now = { ...primary.now };
  if (now.r7 === null && zj) now.r7 = zj.now.r7;
  if (now.r10 === null && zj) now.r10 = zj.now.r10;
  now.position = `中心位于北纬 ${now.lat?.toFixed(1)} 度、东经 ${now.lng?.toFixed(1)} 度`;
  delete now.lat; delete now.lng;

  const nowTrackPt = primary.track.find((p) => p.phase === "now");
  const forecast = primary.track.filter((p) => p.phase === "forecast");
  const nearCoast = forecast.some((p) => p.lng <= 122.5 && p.lat >= 18 && p.lat <= 32);

  return {
    name, enName,
    code: primary.code,
    level: `${nowTrackPt?.strong || ""}（${now.windLevel}级）`,
    summary: nearCoast
      ? "预报路径趋向我国沿海，沿海地区请密切关注当地气象部门发布的最新预警。"
      : "预报路径详见路径图，请以官方逐时发布为准。",
    nearCoast,
    nameNote,
    trackSource: SRC_META[primary.src].label,
    verification: buildVerification(primary, members),
    now,
    track: primary.track,
  };
}

/* ---------- 灾害预警：暴雨 / 山洪 / 地质灾害 / 台风 ---------- */
/* 为什么台风工具要抓降雨预警：
   台风等级只反映风速。2026 年第 10 号台风美莎克以强热带风暴级（10 级）登陆，
   按风力推档只到黄色；但它登陆后在陆上重建眼区、于广西内陆滞留 26 小时，
   极端降雨引发六蓝、云表等水库溃坝，最终致 159 人遇难——官方称之为"弱级强灾"。
   风力单因子的预警档位在那 26 小时里会给出四档中的最低档。
   因此实况之外必须并列呈现洪涝类预警，并让预案档位同时受降雨维度驱动。 */

const ALERT_KINDS = ["暴雨", "台风", "山洪灾害", "山洪风险", "地质灾害"];
const LEVEL_ZH2EN = { 蓝: "blue", 黄: "yellow", 橙: "orange", 红: "red" };
const LEVEL_RANK = { blue: 1, yellow: 2, orange: 3, red: 4 };
const RANK_LEVEL = ["", "blue", "yellow", "orange", "red"];
const NMC_ALARM = { label: "中央气象台预警发布平台", url: "http://www.nmc.cn/publish/alarm.html" };

/* 洪涝致灾类：这几类直接反映"水"的威胁，用于抬升预案档位 */
const FLOOD_KINDS = new Set(["暴雨", "山洪灾害", "山洪风险", "地质灾害"]);

/* 省级行政区：代码前 2 位 → [名称, 中心纬度, 中心经度]。
   中心点仅用于把预警粗略关联到台风路径邻近省份（提示用途），
   不用于任何用户侧定位——风眼不请求 GPS、不推断 IP 位置。 */
const PROVINCE = {
  "11": ["北京", 40.2, 116.4], "12": ["天津", 39.3, 117.3], "13": ["河北", 38.5, 115.5],
  "14": ["山西", 37.6, 112.3], "15": ["内蒙古", 44.0, 113.9], "21": ["辽宁", 41.8, 122.6],
  "22": ["吉林", 43.7, 126.2], "23": ["黑龙江", 47.4, 128.1], "31": ["上海", 31.2, 121.5],
  "32": ["江苏", 33.0, 119.5], "33": ["浙江", 29.2, 120.2], "34": ["安徽", 31.9, 117.2],
  "35": ["福建", 26.1, 118.3], "36": ["江西", 27.6, 115.7], "37": ["山东", 36.4, 118.2],
  "41": ["河南", 33.9, 113.6], "42": ["湖北", 31.0, 112.3], "43": ["湖南", 27.6, 111.7],
  "44": ["广东", 23.4, 113.4], "45": ["广西", 23.8, 108.8], "46": ["海南", 19.2, 109.7],
  "50": ["重庆", 29.8, 107.9], "51": ["四川", 30.6, 102.9], "52": ["贵州", 26.8, 106.9],
  "53": ["云南", 25.0, 101.5], "54": ["西藏", 31.5, 88.4], "61": ["陕西", 35.2, 108.9],
  "62": ["甘肃", 37.8, 101.1], "63": ["青海", 35.7, 96.0], "64": ["宁夏", 37.3, 106.2],
  "65": ["新疆", 41.1, 85.3], "71": ["台湾", 23.7, 121.0], "81": ["香港", 22.3, 114.2],
  "82": ["澳门", 22.2, 113.5],
};

const maxLevel = (a, b) => RANK_LEVEL[Math.max(LEVEL_RANK[a] || 0, LEVEL_RANK[b] || 0)] || null;

/* 抓取某一类在效预警（分页取全量，单类上限 1200 条） */
async function fetchAlarmKind(kind, deadline) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    if (deadline && Date.now() >= deadline) break; /* 已取到的页照常返回 */
    const j = await getJSON(
      `http://www.nmc.cn/rest/findAlarm?pageNo=${page}&pageSize=200` +
      `&signaltype=${encodeURIComponent(kind)}&signallevel=&province=`,
      { Referer: "http://www.nmc.cn/" }
    );
    const p = j?.data?.page;
    if (!p || !Array.isArray(p.list) || !p.list.length) break;
    for (const a of p.list) {
      const m = /(蓝|黄|橙|红)色预警/.exec(a.title || "");
      const pv = PROVINCE[String(a.alertid || "").slice(0, 2)];
      if (!m || !pv) continue; /* 解析不出等级或省份的条目跳过，不猜 */
      out.push({
        kind, level: LEVEL_ZH2EN[m[1]], province: pv[0], lat: pv[1], lng: pv[2],
        title: a.title,
        url: a.url ? `http://www.nmc.cn${a.url}` : NMC_ALARM.url,
        issuedAt: a.issuetime || null,
      });
    }
    if (page >= Math.ceil((p.count || 0) / 200)) break;
  }
  return out;
}

/* 全量抓取 + 按省聚合。任一类失败不影响其余类，整体失败则 ok:false 降级。
   总时间预算 60s：台风实况才是主产物，预警源再慢也不能把它一起拖挂
   （最坏情况 5 类 × 6 页 × 30s 单请求超时会超过工作流 8 分钟上限）。 */
const ALERTS_BUDGET_MS = 60000;

async function fetchAlerts() {
  const deadline = Date.now() + ALERTS_BUDGET_MS;
  const all = [];
  const failed = [];
  for (const kind of ALERT_KINDS) {
    if (Date.now() >= deadline) {
      failed.push(kind);
      console.warn(`alarm ${kind} skipped: budget exhausted`);
      continue;
    }
    try {
      all.push(...await fetchAlarmKind(kind, deadline));
    } catch (e) {
      failed.push(kind);
      console.warn(`alarm ${kind} failed: ${e.message}`);
    }
  }
  if (failed.length === ALERT_KINDS.length) {
    return { ok: false, error: "全部预警类别抓取失败", ...NMC_ALARM, provinces: [], counts: {}, peak: null };
  }

  const byProv = new Map();
  const counts = {};
  for (const a of all) {
    counts[a.kind] = (counts[a.kind] || 0) + 1;
    let e = byProv.get(a.province);
    if (!e) byProv.set(a.province, e = {
      province: a.province, lat: a.lat, lng: a.lng,
      maxLevel: null, floodLevel: null, kinds: {}, count: 0, top: null,
    });
    e.count++;
    e.maxLevel = maxLevel(e.maxLevel, a.level);
    e.kinds[a.kind] = maxLevel(e.kinds[a.kind], a.level);
    if (FLOOD_KINDS.has(a.kind)) e.floodLevel = maxLevel(e.floodLevel, a.level);
    if (!e.top || LEVEL_RANK[a.level] > LEVEL_RANK[e.top.level]) {
      e.top = { kind: a.kind, level: a.level, title: a.title, url: a.url, issuedAt: a.issuedAt };
    }
  }

  const provinces = [...byProv.values()]
    .sort((x, y) => (LEVEL_RANK[y.maxLevel] - LEVEL_RANK[x.maxLevel]) || (y.count - x.count));
  const peak = provinces.length
    ? { province: provinces[0].province, ...provinces[0].top }
    : null;

  return {
    ok: true, ...NMC_ALARM,
    partial: failed.length ? failed : null,
    total: all.length, counts, peak,
    provinces: provinces.map(({ lat, lng, ...p }) => ({ ...p, lat, lng })),
  };
}

/* 把预警关联到台风。两条规则，都不涉及用户位置：
   (a) 该省气象台已发布台风预警 —— 官方口径，但预警本身不写明针对哪个台风，
       多台风并存时按"最近的那个"归属，且距离须 ≤1500km，
       否则远洋台风会误吞沿海省份的台风预警；
   (b) 省中心距该台风实况点或预报路径 ≤450km —— 几何估算，可多台风共享。 */
const LINK_RADIUS_KM = 450;
const TYPHOON_ALERT_RADIUS_KM = 1500;
const LEVEL_ZH = { blue: "蓝", yellow: "黄", orange: "橙", red: "红" };

/* 台风到某点的最小距离（实况点 + 预报路径） */
function stormDistKm(t, lat, lng) {
  const pts = (t.track || []).filter((p) => p.phase === "now" || p.phase === "forecast");
  let min = Infinity;
  for (const q of pts) min = Math.min(min, distKm(lat, lng, q.lat, q.lng));
  return min;
}

/* 一次性为所有台风计算 rainRisk（需要横向比较，故不能逐个算） */
function linkRainRisk(typhoons, alerts) {
  if (!alerts?.ok || !alerts.provinces.length || !typhoons.length) {
    for (const t of typhoons) t.rainRisk = null;
    return;
  }
  const buckets = new Map(typhoons.map((t) => [t.code, []]));

  for (const p of alerts.provinces) {
    const dists = typhoons.map((t) => ({ t, d: stormDistKm(t, p.lat, p.lng) }));
    const near = dists.filter((x) => x.d <= LINK_RADIUS_KM);
    if (near.length) {
      for (const x of near) buckets.get(x.t.code).push({ p, via: "路径邻近", d: x.d });
      continue;
    }
    /* 有台风预警但不在任何台风的邻近半径内 → 归给最近的那个 */
    if (p.kinds["台风"] != null) {
      const best = dists.reduce((a, b) => (b.d < a.d ? b : a));
      if (best.d <= TYPHOON_ALERT_RADIUS_KM) {
        buckets.get(best.t.code).push({ p, via: "台风预警", d: best.d });
      }
    }
  }

  for (const t of typhoons) {
    const hit = buckets.get(t.code);
    if (!hit.length) { t.rainRisk = null; continue; }
    hit.sort((x, y) => (LEVEL_RANK[y.p.maxLevel] - LEVEL_RANK[x.p.maxLevel]) || (x.d - y.d));
    const provinces = hit.map(({ p, via, d }) => ({
      province: p.province, maxLevel: p.maxLevel, floodLevel: p.floodLevel,
      kinds: p.kinds, count: p.count, top: p.top, via, distKm: Math.round(d),
    }));
    const floodLevel = provinces.reduce((m, p) => maxLevel(m, p.floodLevel), null);
    t.rainRisk = {
      provinces, floodLevel,
      maxLevel: provinces.reduce((m, p) => maxLevel(m, p.maxLevel), null),
      note: floodLevel
        ? `台风影响范围内有 ${provinces.length} 个省级行政区发布洪涝类预警，最高${LEVEL_ZH[floodLevel]}色。`
        : null,
    };
  }
}

/* ---------- 影响持续期（aftermath） ---------- */
/* 台风停编 ≠ 风险结束。美莎克 2026-07-07 停编，而官方遇难数字在此后六周内
   从 39 升至 159，水库溃坝洪灾的伤亡是停编 45 天后才核定的。
   停编后保留一段"影响持续期"：只要其影响省份仍有洪涝类预警在效，
   页面就不回落到"风平浪静"。 */
const AFTERMATH_DAYS = 7;

/* "YYYY-MM-DD HH:mm"（北京时间）→ UTC 毫秒 */
function bjParse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) : null;
}

/* 源短暂抖动导致台风瞬时消失时，它会在下一轮重新出现并被移出本列表，
   因此这里不做额外去抖——误报可自愈，漏报才是真风险。 */
function buildAftermath(prev, typhoons, now, alerts) {
  const nowMs = bjParse(now);
  const live = new Set(typhoons.map((t) => t.code));
  const kept = [];

  /* 1) 沿用上一版仍在窗口内、且未重新编号的条目 */
  for (const e of (prev?.recentlyEnded || [])) {
    if (live.has(e.code)) continue;
    const ms = bjParse(e.endedAt);
    if (ms == null || nowMs == null || nowMs - ms > AFTERMATH_DAYS * 864e5) continue;
    kept.push({ ...e });
  }

  /* 2) 上一版在编、这一版消失 → 新停编 */
  for (const t of (prev?.typhoons || [])) {
    if (live.has(t.code) || kept.some((e) => e.code === t.code)) continue;
    kept.push({
      code: t.code, name: t.name, enName: t.enName,
      lastLevel: t.level, endedAt: now,
      provinces: (t.rainRisk?.provinces || []).map((p) => p.province),
    });
  }

  /* 3) 刷新持续风险：影响省份此刻是否仍有洪涝类预警在效 */
  const floodByProv = new Map((alerts?.provinces || []).map((p) => [p.province, p.floodLevel]));
  for (const e of kept) {
    let lvl = null;
    for (const p of (e.provinces || [])) lvl = maxLevel(lvl, floodByProv.get(p));
    e.ongoingFloodLevel = lvl;
    const ms = bjParse(e.endedAt);
    e.daysSince = (nowMs != null && ms != null) ? Math.floor((nowMs - ms) / 864e5) : null;
  }
  return kept.sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || ""));
}

/* ---------- 主流程 ---------- */

/* 上一版数据：用于识别"本轮消失"的台风，构建影响持续期 */
let prev = null;
try { prev = JSON.parse(await readFile("data/typhoon.json", "utf8")); } catch { /* 首次运行 */ }

const FETCHERS = { cma: fetchCMA, zj: fetchZJ, jma: fetchJMA };
const bySrc = {}, sourceStatus = [];
for (const [id, fn] of Object.entries(FETCHERS)) {
  try {
    bySrc[id] = await fn();
    sourceStatus.push({ id, name: SRC_META[id].label, url: SRC_META[id].url, ok: true, count: bySrc[id].length });
  } catch (e) {
    bySrc[id] = [];
    sourceStatus.push({ id, name: SRC_META[id].label, url: SRC_META[id].url, ok: false, error: String(e.message || e) });
    console.warn(`source ${id} failed: ${e.message}`);
  }
}

const okTrackSources = sourceStatus.filter((s) => s.ok && (s.id === "cma" || s.id === "zj"));
if (!okTrackSources.length) {
  console.error("both track sources (cma, zj) failed");
  process.exit(1);
}

const typhoons = mergeStorms(bySrc).map(buildTyphoon).filter(Boolean);

/* 灾害预警与轨迹源相互独立：预警失败不阻断台风实况输出，反之亦然 */
let alerts;
try {
  alerts = await fetchAlerts();
} catch (e) {
  console.warn("alerts failed: " + (e.message || e));
  alerts = { ok: false, error: String(e.message || e), ...NMC_ALARM, provinces: [], counts: {}, peak: null };
}
linkRainRisk(typhoons, alerts);

const updatedAt = bjNow();
const recentlyEnded = buildAftermath(prev, typhoons, updatedAt, alerts);

const out = {
  updatedAt,
  source: "中央气象台 / 浙江台风路径系统 / 日本气象厅（JMA）多源交叉校验",
  sourceUrl: "http://typhoon.nmc.cn/web.html",
  sources: sourceStatus,
  typhoons,
  alerts,
  recentlyEnded,
};

await mkdir("data", { recursive: true });
await writeFile("data/typhoon.json", JSON.stringify(out, null, 2) + "\n");
console.log(`ok: ${typhoons.length} active typhoon(s) — ${typhoons.map((t) => `${t.name}[${t.verification.status}]`).join("、") || "无"} @ ${out.updatedAt}`);
console.log(`sources: ${sourceStatus.map((s) => `${s.id}=${s.ok ? "ok" : "FAIL"}`).join(" ")}`);

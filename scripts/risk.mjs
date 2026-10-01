/* 风险关联：洪涝预警 ↔ 台风、停编后的影响持续期。从 fetch-typhoon.mjs 拆出，纯函数，便于回放测试。
 *
 * 2026-10 回放全部历史快照（4685 班）发现两处漏报，均已在这里修掉：
 *  1. 预警抓取失败（alerts.ok=false，2221 班里 8 次）时，原逻辑把所有台风的洪涝档清空——
 *     8-24、9-01 两次把在编台风（沙德尔、紫檀）从红色洪涝档打回只看风力，
 *     另有 5 次把停编台风的影响期（红 / 橙）清零。现改为沿用上一班结果（最多 6 小时）。
 *  2. 停编时只取最后一班关联到的省份。科罗旺一生关联过广东、福建（最高红色），
 *     停编前一班已移出 450km 半径，影响期于是没有任何省份可查。现改为累计台风一生关联过的省份。
 * 原则同代码注释一贯的说法：误报可自愈，漏报才是真风险。
 */

export const LEVEL_RANK = { blue: 1, yellow: 2, orange: 3, red: 4 };
export const RANK_LEVEL = ["", "blue", "yellow", "orange", "red"];
export const LEVEL_ZH = { blue: "蓝", yellow: "黄", orange: "橙", red: "红" };
export const maxLevel = (a, b) => RANK_LEVEL[Math.max(LEVEL_RANK[a] || 0, LEVEL_RANK[b] || 0)] || null;

export function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* "YYYY-MM-DD HH:mm"（北京时间）→ UTC 毫秒 */
export function bjParse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) : null;
}

/* ---------- 洪涝预警 ↔ 台风 ---------- */

export const LINK_RADIUS_KM = 450;
export const TYPHOON_ALERT_RADIUS_KM = 1500;
/* 预警抓取失败时沿用上一班结果的最长时限：再久就宁可显示“没抓到”，不挂着陈旧的省份 */
export const CARRY_MAX_HOURS = 6;

/* 把预警关联到台风。两条规则，都不涉及用户位置：
   (a) 该省气象台已发布台风预警 —— 官方口径，但预警本身不写明针对哪个台风，
       多台风并存时按"最近的那个"归属，且距离须 ≤1500km，
       否则远洋台风会误吞沿海省份的台风预警；
   (b) 省中心距该台风实况点或预报路径 ≤450km —— 几何估算，可多台风共享。 */

/* 台风到某点的最小距离（实况点 + 预报路径） */
export function stormDistKm(t, lat, lng) {
  const pts = (t.track || []).filter((p) => p.phase === "now" || p.phase === "forecast");
  let min = Infinity;
  for (const q of pts) min = Math.min(min, distKm(lat, lng, q.lat, q.lng));
  return min;
}

/* 一次性为所有台风计算 rainRisk（需要横向比较，故不能逐个算）。
   now：本班时刻（北京时间字符串）；prev：上一班完整数据，预警抓取失败时从中沿用 */
export function linkRainRisk(typhoons, alerts, now, prev) {
  if (!alerts?.ok) {
    const nowMs = bjParse(now);
    const before = new Map((prev?.typhoons || []).map((t) => [t.code, t.rainRisk]));
    for (const t of typhoons) {
      const old = before.get(t.code);
      const asOfMs = bjParse(old?.asOf || prev?.updatedAt);
      const fresh = old && nowMs != null && asOfMs != null && nowMs - asOfMs <= CARRY_MAX_HOURS * 36e5;
      t.rainRisk = fresh ? { ...old, asOf: old.asOf || prev.updatedAt, stale: true } : null;
    }
    return;
  }
  if (!alerts.provinces.length || !typhoons.length) {
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
      provinces, floodLevel, asOf: now,
      maxLevel: provinces.reduce((m, p) => maxLevel(m, p.maxLevel), null),
      note: floodLevel
        ? `台风影响范围内有 ${provinces.length} 个省级行政区发布洪涝类预警，最高${LEVEL_ZH[floodLevel]}色。`
        : null,
    };
  }
}

/* 累计台风一生关联过的省份（停编后据此判断影响持续期），按省名排序、去重 */
export function carryAffected(typhoons, prev) {
  const before = new Map((prev?.typhoons || []).map((t) => [t.code, t.affected || []]));
  for (const t of typhoons) {
    const set = new Set(before.get(t.code) || []);
    for (const p of (t.rainRisk?.provinces || [])) set.add(p.province);
    t.affected = [...set].sort((a, b) => a.localeCompare(b, "zh"));
  }
}

/* ---------- 影响持续期（aftermath） ---------- */
/* 台风停编 ≠ 风险结束。美莎克 2026-07-07 停编，而官方遇难数字在此后六周内
   从 39 升至 159，水库溃坝洪灾的伤亡是停编 45 天后才核定的。
   停编后保留一段"影响持续期"：只要其影响省份仍有洪涝类预警在效，
   页面就不回落到"风平浪静"。 */
export const AFTERMATH_DAYS = 7;

/* 源短暂抖动导致台风瞬时消失时，它会在下一轮重新出现并被移出本列表，
   因此这里不做额外去抖——误报可自愈，漏报才是真风险。 */
export function buildAftermath(prev, typhoons, now, alerts) {
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

  /* 2) 上一版在编、这一版消失 → 新停编。省份取一生累计（affected），老数据没有该字段时退回最后一班 */
  for (const t of (prev?.typhoons || [])) {
    if (live.has(t.code) || kept.some((e) => e.code === t.code)) continue;
    const last = (t.rainRisk?.provinces || []).map((p) => p.province);
    kept.push({
      code: t.code, name: t.name, enName: t.enName,
      lastLevel: t.level, endedAt: now,
      provinces: [...new Set([...(t.affected || []), ...last])].sort((a, b) => a.localeCompare(b, "zh")),
      ongoingFloodLevel: t.rainRisk?.floodLevel || null,
    });
  }

  /* 3) 刷新持续风险：影响省份此刻是否仍有洪涝类预警在效。预警没抓到时保留上一班的判断，不清零 */
  const floodByProv = new Map((alerts?.provinces || []).map((p) => [p.province, p.floodLevel]));
  for (const e of kept) {
    if (alerts?.ok) {
      let lvl = null;
      for (const p of (e.provinces || [])) lvl = maxLevel(lvl, floodByProv.get(p));
      e.ongoingFloodLevel = lvl;
      delete e.ongoingStale;
    } else {
      e.ongoingFloodLevel = e.ongoingFloodLevel || null;
      if (e.ongoingFloodLevel) e.ongoingStale = true;
    }
    const ms = bjParse(e.endedAt);
    e.daysSince = (nowMs != null && ms != null) ? Math.floor((nowMs - ms) / 864e5) : null;
  }
  return kept.sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || ""));
}

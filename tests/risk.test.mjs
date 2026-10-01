/* 风险逻辑回放测试：node --test tests/
 * - 服务端 scripts/risk.mjs：洪涝预警 ↔ 台风关联、停编影响期
 * - 前端 assets/risk.js：参考防御等级、页面状态（与页面加载的是同一份文件）
 * 样例分两种：tests/fixtures/ 下是从 git 历史取出的真实快照；标「合成」的是按公开报道构造的场景。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  linkRainRisk, carryAffected, buildAftermath, CARRY_MAX_HOURS, AFTERMATH_DAYS,
} from "../scripts/risk.mjs";

const TyRisk = createRequire(import.meta.url)("../assets/risk.js");
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- 构造工具 ---------- */
/* 台风：track 只放实况点 + 一个预报点，够算距离 */
function storm(code, name, lat, lng, { wind = 10, nearCoast = true, level = "强热带风暴" } = {}) {
  return {
    code, name, enName: name, level, nearCoast,
    now: { windLevel: wind },
    track: [{ lat, lng, phase: "now" }, { lat: lat + 0.5, lng: lng - 0.5, phase: "forecast" }],
  };
}
/* 省级预警：广西南宁附近、广东广州附近、海南海口附近 */
const PROV = {
  广西: { lat: 22.8, lng: 108.3 }, 广东: { lat: 23.1, lng: 113.3 }, 福建: { lat: 26.1, lng: 119.3 },
  海南: { lat: 20.0, lng: 110.3 }, 浙江: { lat: 30.3, lng: 120.2 },
};
function alerts(list, ok = true) {
  if (!ok) return { ok: false, error: "timeout", provinces: [], counts: {}, peak: null };
  return {
    ok: true,
    provinces: list.map(([province, floodLevel, kinds = { 暴雨: floodLevel }]) => ({
      province, floodLevel, maxLevel: floodLevel, kinds, count: 1, top: null, ...PROV[province],
    })),
  };
}
/* 跑一班服务端流程（与 fetch-typhoon.mjs 主流程同序），返回这一班的输出 */
function runOnce(prev, typhoons, now, al) {
  linkRainRisk(typhoons, al, now, prev);
  carryAffected(typhoons, prev);
  return { updatedAt: now, typhoons, alerts: al, recentlyEnded: buildAftermath(prev, typhoons, now, al) };
}

/* ---------- 前端：参考等级 ---------- */
test("风力档：未趋近沿海一律蓝；10 级黄、14 级橙；风力永远推不到红", () => {
  assert.equal(TyRisk.windTier(storm("1", "a", 20, 130, { wind: 16, nearCoast: false })), "blue");
  assert.equal(TyRisk.windTier(storm("1", "a", 20, 130, { wind: 9 })), "blue");
  assert.equal(TyRisk.windTier(storm("1", "a", 20, 130, { wind: 10 })), "yellow");
  assert.equal(TyRisk.windTier(storm("1", "a", 20, 130, { wind: 14 })), "orange");
  assert.equal(TyRisk.windTier(storm("1", "a", 20, 130, { wind: 17 })), "orange");
});

test("参考等级取风力档与洪涝档的较高者，并点破“弱级强灾”", () => {
  const t = storm("1", "a", 22, 108, { wind: 6 });
  t.rainRisk = { floodLevel: "red", provinces: [] };
  assert.equal(TyRisk.suggestLevel(t), "red");
  assert.deepEqual(TyRisk.riskMismatch(t), { wind: "blue", rain: "red" });
  t.rainRisk = { floodLevel: "blue", provinces: [] };
  t.now.windLevel = 14;
  assert.equal(TyRisk.suggestLevel(t), "orange");
  assert.equal(TyRisk.riskMismatch(t), null);
});

test("页面状态：有在编台风 storm；停编且仍有洪涝预警 aftermath；否则 calm", () => {
  assert.equal(TyRisk.pageState({ typhoons: [storm("1", "a", 20, 130)], recentlyEnded: [] }), "storm");
  assert.equal(TyRisk.pageState({ typhoons: [], recentlyEnded: [{ code: "2", ongoingFloodLevel: "orange" }] }), "aftermath");
  assert.equal(TyRisk.pageState({ typhoons: [], recentlyEnded: [{ code: "2", ongoingFloodLevel: null }] }), "calm");
  assert.equal(TyRisk.pageState(null), "calm");
});

/* ---------- 服务端：关联 ---------- */
test("省中心距路径 ≤450km 关联；远处只有台风预警的省份归最近台风（≤1500km）", () => {
  const near = storm("01", "近", 21.5, 109.5);
  const far = storm("02", "远", 18, 140);
  linkRainRisk([near, far], alerts([["广西", "orange"], ["浙江", "yellow", { 台风: "yellow" }]]), "2026-07-04 08:00", null);
  assert.equal(near.rainRisk.floodLevel, "orange");
  assert.deepEqual(near.rainRisk.provinces.map((p) => p.province).sort(), ["广西", "浙江"].sort());
  assert.equal(near.rainRisk.provinces.find((p) => p.province === "浙江").via, "台风预警");
  assert.equal(far.rainRisk, null);
  assert.equal(near.rainRisk.asOf, "2026-07-04 08:00");
});

test("预警抓取失败：沿用上一班结果并标 stale；超过 6 小时不再沿用", () => {
  const t1 = storm("01", "甲", 21.5, 109.5);
  const p1 = runOnce(null, [t1], "2026-07-04 08:00", alerts([["广西", "red"]]));
  const t2 = storm("01", "甲", 21.6, 109.4);
  runOnce(p1, [t2], "2026-07-04 08:15", alerts([], false));
  assert.equal(t2.rainRisk.floodLevel, "red");
  assert.equal(t2.rainRisk.stale, true);
  assert.equal(t2.rainRisk.asOf, "2026-07-04 08:00");
  /* 连续失败：asOf 不随沿用前移，超过时限就放手 */
  const p2 = { updatedAt: "2026-07-04 08:15", typhoons: [t2] };
  const t3 = storm("01", "甲", 21.7, 109.3);
  linkRainRisk([t3], alerts([], false), `2026-07-04 ${String(8 + CARRY_MAX_HOURS).padStart(2, "0")}:01`, p2);
  assert.equal(t3.rainRisk, null);
});

test("关联省份按台风一生累计（affected）", () => {
  const p1 = runOnce(null, [storm("01", "甲", 23.5, 116.5)], "2026-09-05 08:00", alerts([["广东", "red"], ["福建", "orange"]]));
  const p2 = runOnce(p1, [storm("01", "甲", 25, 125)], "2026-09-06 08:00", alerts([["广东", "red"]]));
  assert.equal(p2.typhoons[0].rainRisk, null, "移出 450km 后本班不再关联");
  assert.deepEqual(p2.typhoons[0].affected, ["福建", "广东"].sort((a, b) => a.localeCompare(b, "zh")));
});

/* ---------- 服务端：影响持续期 ---------- */
test("科罗旺式：停编前已移出半径，影响期仍按一生关联过的省份判断", () => {
  const p1 = runOnce(null, [storm("13", "科罗旺式", 23.5, 116.5)], "2026-09-06 08:00", alerts([["广东", "red"]]));
  const p2 = runOnce(p1, [storm("13", "科罗旺式", 28, 128)], "2026-09-07 08:00", alerts([["广东", "red"]]));
  assert.equal(p2.typhoons[0].rainRisk, null);
  const p3 = runOnce(p2, [], "2026-09-07 21:00", alerts([["广东", "orange"]]));
  const e = p3.recentlyEnded.find((x) => x.code === "13");
  assert.deepEqual(e.provinces, ["广东"]);
  assert.equal(e.ongoingFloodLevel, "orange");
  assert.equal(TyRisk.pageState(p3), "aftermath");
});

test("影响期：预警抓取失败时保留上一班档位；满 7 天移出；重新出现即移出", () => {
  const p1 = runOnce(null, [storm("10", "乙", 22, 108.5)], "2026-07-04 08:00", alerts([["广西", "red"]]));
  const p2 = runOnce(p1, [], "2026-07-05 08:00", alerts([["广西", "red"]]));
  const p3 = runOnce(p2, [], "2026-07-05 08:15", alerts([], false));
  assert.equal(p3.recentlyEnded[0].ongoingFloodLevel, "red");
  assert.equal(p3.recentlyEnded[0].ongoingStale, true);
  const p4 = runOnce(p3, [], "2026-07-05 08:30", alerts([["广西", "yellow"]]));
  assert.equal(p4.recentlyEnded[0].ongoingFloodLevel, "yellow");
  assert.equal(p4.recentlyEnded[0].ongoingStale, undefined);
  const late = runOnce(p4, [], `2026-07-${String(5 + AFTERMATH_DAYS).padStart(2, "0")} 08:31`, alerts([["广西", "yellow"]]));
  assert.equal(late.recentlyEnded.length, 0);
  const back = runOnce(p4, [storm("10", "乙", 22, 108.5)], "2026-07-05 09:00", alerts([["广西", "yellow"]]));
  assert.equal(back.recentlyEnded.length, 0);
});

/* ---------- 合成：美莎克全程 ----------
 * 按公开报道构造（非真实数据）：7-03 以强热带风暴（10 级）登陆海南，7-04 经越南入广西后在内陆滞留，
 * 减弱为热带低压；广西暴雨红色预警持续；7-07 停编，影响延续数周。 */
test("合成·美莎克：风力只够黄/蓝，参考等级始终红；抓取失败不掉档；停编后停在影响持续期", () => {
  let d = runOnce(null, [storm("2610", "美莎克", 19.9, 110.5, { wind: 10 })], "2026-07-03 20:00", alerts([["海南", "orange"], ["广西", "red"]]));
  assert.equal(TyRisk.windTier(d.typhoons[0]), "yellow");
  assert.equal(TyRisk.suggestLevel(d.typhoons[0]), "red");

  d = runOnce(d, [storm("2610", "美莎克", 22.6, 108.0, { wind: 6, level: "热带低压" })], "2026-07-05 08:00", alerts([["广西", "red"]]));
  assert.equal(TyRisk.windTier(d.typhoons[0]), "blue");
  assert.equal(TyRisk.suggestLevel(d.typhoons[0]), "red");

  d = runOnce(d, [storm("2610", "美莎克", 22.7, 108.1, { wind: 6, level: "热带低压" })], "2026-07-05 08:15", alerts([], false));
  assert.equal(TyRisk.suggestLevel(d.typhoons[0]), "red", "抓取失败不得掉回风力档");

  d = runOnce(d, [], "2026-07-07 08:00", alerts([["广西", "red"]]));
  assert.equal(TyRisk.pageState(d), "aftermath");
  assert.deepEqual(d.recentlyEnded[0].provinces.sort(), ["广西", "海南"].sort());

  d = runOnce(d, [], "2026-07-07 08:15", alerts([], false));
  assert.equal(TyRisk.pageState(d), "aftermath", "停编后抓取失败也不得回落到风平浪静");
  assert.equal(TyRisk.aftermathOf(d).ongoingFloodLevel, "red");
});

/* ---------- 真实回放：2026-08-24 21:46 预警抓取失败 ----------
 * 上一班（21:24）：简拉维 / 紫檀 / 沙德尔 洪涝档红，GAENARI / 热带低压 影响期红。
 * 原逻辑在 21:46 把这些全部清零（简拉维恰好此班停编，影响期也丢了）。 */
test("真实回放 2026-08-24：抓取失败那一班，红色洪涝档与影响期全部保住", () => {
  const prev = fixture("2026-08-24_prev");
  const fail = fixture("2026-08-24_fail");
  const typhoons = clone(fail.typhoons).map((t) => { delete t.rainRisk; delete t.affected; return t; });
  const out = runOnce(prev, typhoons, fail.updatedAt, fail.alerts);

  for (const name of ["紫檀", "沙德尔"]) {
    const t = out.typhoons.find((x) => x.name === name);
    assert.equal(t.rainRisk?.floodLevel, "red", `${name} 应沿用红色洪涝档`);
    assert.equal(t.rainRisk.stale, true);
    assert.equal(TyRisk.suggestLevel(t), "red");
  }
  for (const name of ["简拉维", "GAENARI", "热带低压"]) {
    const e = out.recentlyEnded.find((x) => x.name === name);
    assert.equal(e?.ongoingFloodLevel, "red", `${name} 影响期应保持红色`);
  }
  /* 对照：原逻辑这一班的实际输出 */
  assert.ok(fail.typhoons.every((t) => !t.rainRisk), "历史数据里这一班确实全被清零");
});

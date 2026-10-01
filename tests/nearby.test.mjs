/* 「我关心的城市」计算：node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = require("../assets/nearby.js");
const CITIES = require("../assets/cities.js");
const city = (name) => { const c = CITIES.find((x) => x[0] === name); assert.ok(c, `城市表里应有${name}`); return { lat: c[2], lng: c[3] }; };

test("路径时刻按北京时间解析，12 月数据里的 1 月预报点算到下一年", () => {
  assert.equal(N.trackTime("10-03 20时", "2026-10-01 11:00"), Date.UTC(2026, 9, 3, 12));
  assert.equal(N.trackTime("01-02 08时", "2026-12-30 20:00"), Date.UTC(2027, 0, 2, 0));
  assert.equal(N.trackTime("坏数据", "2026-10-01 11:00"), null);
  assert.equal(N.timeLabel(Date.UTC(2026, 9, 3, 12)), "10 月 3 日 20 时");
});

test("距离读数：不到 100 不报数，近处到 10 公里，远处到 100 公里", () => {
  assert.equal(N.fmtKm(63), "不到 100");
  assert.equal(N.fmtKm(347), "350");
  assert.equal(N.fmtKm(3149), "3100");
});

/* 合成路径：从广州东南约 600km 处向西北直扑广州 */
const gz = { lat: 23.147, lng: 113.323 };
const approaching = [
  { t: "09-10 08时", lat: 19.5, lng: 117.5, phase: "now" },
  { t: "09-11 08时", lat: 21.5, lng: 115.2, phase: "forecast" },
  { t: "09-12 08时", lat: 23.4, lng: 113.0, phase: "forecast" },
  { t: "09-13 08时", lat: 25.0, lng: 110.8, phase: "forecast" },
];

test("逼近：找到最近时刻与距离，给出“预报何时最近”", () => {
  const r = N.closestApproach(approaching, gz.lat, gz.lng, "2026-09-10 09:00");
  assert.ok(r.nowKm > 550 && r.nowKm < 650, `当前距离 ${r.nowKm}`);
  assert.ok(r.minKm < 60, `最近距离 ${r.minKm}`);
  assert.equal(r.minIsNow, false);
  assert.ok(N.timeLabel(r.minMs).startsWith("9 月 1"), N.timeLabel(r.minMs));
  const line = N.cityLine("广州", r, 300, 120);
  assert.match(line, /^离广州约 [56]\d0 公里；预报 9 月 1[12] 日 \d+ 时前后最近，不到 100 公里（按当前 7 级风圈大小粗估，届时可能进入风圈）$/);
});

test("远离：最近点就是现在，说“正在远离”；已在风圈内要说出来", () => {
  /* 中心在广州西北约 190km、继续往西北走 */
  const away = [
    { t: "09-10 08时", lat: 24.5, lng: 112.0, phase: "now" },
    { t: "09-11 08时", lat: 26.0, lng: 110.0, phase: "forecast" },
    { t: "09-12 08时", lat: 27.5, lng: 108.0, phase: "forecast" },
  ];
  const r = N.closestApproach(away, gz.lat, gz.lng, "2026-09-10 09:00");
  assert.equal(r.minIsNow, true);
  assert.equal(N.cityLine("广州", r, 300, 120), `离广州${N.kmText(r.nowKm)}，已在 7 级风圈内；按预报路径正在远离`);
});

test("缺实况点时不硬算", () => {
  assert.equal(N.closestApproach([{ t: "09-10 08时", lat: 20, lng: 120, phase: "forecast" }], 23, 113, "2026-09-10 09:00"), null);
  assert.match(N.cityLine("广州", null, 300, null), /算不出距离/);
});

test("真实路径（2026-08-24 沙德尔）到广州：距离与插值结果自洽", () => {
  const snap = JSON.parse(readFileSync(new URL("./fixtures/2026-08-24_prev.json", import.meta.url), "utf8"));
  const t = snap.typhoons.find((x) => x.name === "沙德尔");
  const c = city("广州");
  const r = N.closestApproach(t.track, c.lat, c.lng, snap.updatedAt);
  const now = t.track.find((p) => p.phase === "now");
  assert.ok(Math.abs(r.nowKm - N.distKm(c.lat, c.lng, now.lat, now.lng)) < 1e-9);
  assert.ok(r.minKm <= r.nowKm);
  for (const p of t.track.filter((q) => q.phase === "forecast")) {
    assert.ok(r.minKm <= N.distKm(c.lat, c.lng, p.lat, p.lng) + 1e-9, "最近距离不应大于任何一个预报点的距离");
  }
});

test("城市表：沿海关键城市都在，坐标落在中国范围内，无重名", () => {
  for (const n of ["舟山", "台州", "宁德", "汕尾", "湛江", "北海", "防城港", "海口", "三亚", "文昌", "香港", "澳门", "台北", "高雄", "上海", "葫芦岛"]) city(n);
  const names = CITIES.map((c) => c[0]);
  assert.equal(new Set(names).size, names.length);
  for (const [n, , lat, lng] of CITIES) assert.ok(lat > 17 && lat < 54 && lng > 97 && lng < 135, `${n} 坐标越界`);
});

test("城市表：数据集的同音错译已修正（坐标反查抓到的）", () => {
  const prov = (n) => CITIES.find((c) => c[0] === n)?.[1];
  /* 吴川、婺源原是内蒙古武川、五原的错译——真吴川在广东湛江、真婺源在江西，选错会拿到内蒙古坐标 */
  assert.equal(prov("吴川"), undefined);
  assert.equal(prov("婺源"), undefined);
  assert.equal(prov("武川"), "内蒙古");
  assert.equal(prov("昌平"), "北京");
  assert.equal(prov("大荔"), "陕西");
  assert.equal(prov("百色"), "广西");
  assert.equal(prov("涿州"), "河北");
  assert.equal(prov("临清"), "山东");
  assert.equal(prov("葫芦岛"), "辽宁");
});

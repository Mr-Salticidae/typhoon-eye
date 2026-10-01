/* 历史回放：用当前 scripts/risk.mjs 把 git 历史里每一班 data/typhoon.json 重算一遍。
 *
 * 用法（需要完整历史，CI 里 checkout 要 fetch-depth: 0）：
 *   node scripts/replay-history.mjs ["YYYY-MM-DD HH:MM" 起始时刻，默认 2026-08-21 00:00 洪涝维度上线]
 *
 * 检查两件事：
 *  1. 一致性：预警抓取正常的班次，重算出的各台风洪涝档必须与当时生产输出一致——改风险逻辑时，
 *     正常情况下的结果不该变；不一致就打印出来，由人判断是有意改动还是改坏了。
 *  2. 漏报：预警抓取失败的班次，在编台风的洪涝档、停编台风的影响期不得比上一班低（6 小时沿用期内）；
 *     新停编台风的影响省份要包含它一生关联过的省份。
 * 退出码：有漏报 → 1；只有一致性差异 → 0 但会列出。
 */
import { execFileSync } from "node:child_process";
import { linkRainRisk, carryAffected, buildAftermath, LEVEL_RANK, CARRY_MAX_HOURS, bjParse } from "./risk.mjs";

/* 不带时刻的日期 git 会补上“当前钟点”，窗口随运行时刻漂移——写死零点，结果可复现 */
const since = process.argv[2] || "2026-08-21 00:00";
const shas = execFileSync("git", ["log", "--reverse", `--since=${since}`, "--format=%H", "--", "data/typhoon.json"], { encoding: "utf8" })
  .split("\n").filter(Boolean);

/* 一次性批量取出所有快照 */
const buf = execFileSync("git", ["cat-file", "--batch"], {
  input: shas.map((s) => `${s}:data/typhoon.json`).join("\n") + "\n", maxBuffer: 1 << 30,
});
const snaps = [];
for (let pos = 0; pos < buf.length;) {
  const nl = buf.indexOf(10, pos);
  const [, type, size] = buf.subarray(pos, nl).toString().split(" ");
  pos = nl + 1;
  if (type !== "blob") continue;
  const n = Number(size);
  try { snaps.push(JSON.parse(buf.subarray(pos, pos + n).toString("utf8"))); } catch { /* 坏快照跳过 */ }
  pos += n + 1;
}

const rank = (l) => LEVEL_RANK[l] || 0;
const stats = { 快照: 0, 预警正常: 0, 预警失败: 0, 一致性差异: 0, 漏报: 0 };
const diffs = [], misses = [];
let prev = null;

for (const snap of snaps) {
  if (!snap.alerts) continue; /* 洪涝维度上线前的旧 schema */
  stats.快照++;
  stats[snap.alerts.ok ? "预警正常" : "预警失败"]++;
  const typhoons = snap.typhoons.map((t) => { const c = structuredClone(t); delete c.rainRisk; delete c.affected; return c; });
  linkRainRisk(typhoons, snap.alerts, snap.updatedAt, prev);
  carryAffected(typhoons, prev);
  const recentlyEnded = buildAftermath(prev, typhoons, snap.updatedAt, snap.alerts);
  const cur = { updatedAt: snap.updatedAt, typhoons, alerts: snap.alerts, recentlyEnded };

  if (snap.alerts.ok) {
    for (const t of typhoons) {
      const old = snap.typhoons.find((x) => x.code === t.code);
      const a = old?.rainRisk?.floodLevel || null, b = t.rainRisk?.floodLevel || null;
      if (a !== b) { stats.一致性差异++; diffs.push(`${snap.updatedAt} ${t.name}：生产 ${a} / 重算 ${b}`); }
    }
  } else if (prev) {
    const nowMs = bjParse(snap.updatedAt);
    for (const t of typhoons) {
      const p = prev.typhoons.find((x) => x.code === t.code);
      const asOf = bjParse(p?.rainRisk?.asOf || prev.updatedAt);
      const within = asOf != null && nowMs - asOf <= CARRY_MAX_HOURS * 36e5;
      if (within && rank(t.rainRisk?.floodLevel) < rank(p?.rainRisk?.floodLevel)) {
        stats.漏报++; misses.push(`${snap.updatedAt} ${t.name}：洪涝档 ${p.rainRisk.floodLevel} → ${t.rainRisk?.floodLevel || "无"}`);
      }
    }
    for (const e of recentlyEnded) {
      const p = (prev.recentlyEnded || []).find((x) => x.code === e.code);
      if (rank(e.ongoingFloodLevel) < rank(p?.ongoingFloodLevel)) {
        stats.漏报++; misses.push(`${snap.updatedAt} ${e.name}：影响期 ${p.ongoingFloodLevel} → ${e.ongoingFloodLevel || "无"}`);
      }
    }
  }
  for (const e of recentlyEnded) {
    if (e.endedAt !== snap.updatedAt) continue;
    const t = prev?.typhoons.find((x) => x.code === e.code);
    const lost = (t?.affected || []).filter((p) => !(e.provinces || []).includes(p));
    if (lost.length) { stats.漏报++; misses.push(`${snap.updatedAt} ${e.name} 停编：影响省份漏了 ${lost.join("、")}`); }
  }
  prev = cur;
}

console.log(`回放 ${since} 起：`, stats);
if (diffs.length) console.log("一致性差异（前 20 条）：\n  " + diffs.slice(0, 20).join("\n  "));
if (misses.length) console.log("漏报：\n  " + misses.join("\n  "));
process.exit(misses.length ? 1 : 0);

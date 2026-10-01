/* 数据健康检查：给 .github/workflows/data-health.yml 用。
 *
 * 这里只判断 typhoon.json 本身多久没更新：有活跃台风（或停编台风的影响省份仍有洪涝预警）时
 * 超过 2 小时算断更，平时超过 6 小时算断更。外部定时触发（cron-job.org 用 PAT 调 watchdog）
 * 停没停要查 GitHub API，在工作流里做。
 *
 * assess() 是纯函数，便于单测；直接运行时读 data/typhoon.json，按 key=value 逐行写到 stdout，
 * 工作流把它追加进 $GITHUB_OUTPUT。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STALE_ACTIVE_MIN = 120;
export const STALE_CALM_MIN = 360;

/** "YYYY-MM-DD HH:MM"（北京时间）→ UTC 毫秒；格式不对返回 NaN */
export function bjToUtcMs(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(text || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) : NaN;
}

export function assess(data, nowMs) {
  const typhoons = Array.isArray(data?.typhoons) ? data.typhoons : [];
  const ongoing = (Array.isArray(data?.recentlyEnded) ? data.recentlyEnded : []).filter((e) => e && e.ongoingFloodLevel);
  const active = typhoons.length > 0 || ongoing.length > 0;
  const updated = bjToUtcMs(data?.updatedAt);
  const ageMin = Number.isFinite(updated) ? Math.round((nowMs - updated) / 60000) : null;
  const limit = active ? STALE_ACTIVE_MIN : STALE_CALM_MIN;
  return {
    active,
    ageMin,
    limit,
    stale: ageMin === null || ageMin > limit,
    updatedAt: String(data?.updatedAt || ""),
    names: typhoons.map((t) => t.name).filter(Boolean),
    failedSources: (Array.isArray(data?.sources) ? data.sources : []).filter((s) => s && s.ok === false).map((s) => s.name),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  let r;
  try {
    r = assess(JSON.parse(readFileSync("data/typhoon.json", "utf8")), Date.now());
  } catch (error) {
    r = { active: false, ageMin: null, limit: STALE_CALM_MIN, stale: true, updatedAt: `读取失败：${error.message}`, names: [], failedSources: [] };
  }
  console.log(`stale=${r.stale}`);
  console.log(`active=${r.active}`);
  console.log(`age_min=${r.ageMin ?? "未知"}`);
  console.log(`limit_min=${r.limit}`);
  console.log(`updated_at=${r.updatedAt}`);
  console.log(`names=${r.names.join("、") || "无"}`);
  console.log(`failed_sources=${r.failedSources.join("、") || "无"}`);
}

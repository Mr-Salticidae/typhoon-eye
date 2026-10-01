/* 风眼 · 参考防御等级与页面状态（前端）。
 * 从 app.js 拆出，好让 tests/ 用真实历史快照回放测试：浏览器里挂到 window.TyRisk，Node 里走 module.exports。
 *
 * 历史教训（2026 年第 10 号台风美莎克）：
 * 它以强热带风暴级（10 级）登陆，按风力推档只到黄色；但登陆后在陆上重建眼区、
 * 于广西内陆滞留 26 小时，极端降雨引发六蓝、云表等水库溃坝，最终致 159 人遇难。
 * 减弱为热带低压后风力档位甚至回落到蓝色——恰恰是伤亡最集中的时段。
 * 因此档位取「风力档」与「洪涝预警档」的较高者，绝不由风力单独决定；
 * 停编后只要影响省份仍有洪涝预警在效，页面就停在「影响持续期」，不回落到「风平浪静」。
 */
(function (root) {
  var LEVELS = ["blue", "yellow", "orange", "red"];
  var LEVEL_ZH = { blue: "蓝", yellow: "黄", orange: "橙", red: "红" };

  function tierRank(l) { return LEVELS.indexOf(l) + 1; }

  /* 风力档：未趋近沿海一律蓝色；最高只预选到橙色，红色须由洪涝预警、用户或官方判断 */
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

  /* 最近一条"已停编但影响省份仍有洪涝预警在效"的台风；没有则 null */
  function aftermathOf(data) {
    var list = (data && data.recentlyEnded) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].ongoingFloodLevel) return list[i];
    }
    return null;
  }

  /* storm：有在编台风；aftermath：影响持续期；calm：风平浪静 */
  function pageState(data) {
    var list = (data && data.typhoons) || [];
    return list.length ? "storm" : (aftermathOf(data) ? "aftermath" : "calm");
  }

  var api = {
    LEVELS: LEVELS, LEVEL_ZH: LEVEL_ZH, tierRank: tierRank, windTier: windTier, rainTier: rainTier,
    riskMismatch: riskMismatch, suggestLevel: suggestLevel, aftermathOf: aftermathOf, pageState: pageState,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TyRisk = api;
})(this);

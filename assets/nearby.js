/* 风眼 · 「我关心的城市」：台风离这座城多远、预报什么时候最近、现在在不在风圈里。
 * 纯计算 + 文案，浏览器挂到 window.TyNearby，Node 测试走 module.exports。
 *
 * 隐私：城市由用户从列表里手选，不读取 GPS、不推断 IP；选择只在内存里，刷新即清空——
 * B站 Toy 的所有作品同在 www.bilibilitoy.com 一个源下（iframe 带 allow-same-origin），
 * 本机存储对别的 Toy 可读，城市名属于位置信息，不往里写。
 */
(function (root) {
  function distKm(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180, R = 6371;
    var a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lng2 - lng1) * r / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* 路径点时刻 "10-03 20时"（北京时间）→ UTC 毫秒；年份取数据更新时刻，跨年时往后推一年 */
  function trackTime(t, updatedAt) {
    var m = /^(\d{2})-(\d{2}) (\d{2})时$/.exec(String(t || "").trim());
    var y = /^(\d{4})-(\d{2})/.exec(String(updatedAt || ""));
    if (!m || !y) return null;
    var year = +y[1];
    if (+m[1] < +y[2] - 6) year += 1; /* 12 月的数据里出现 1 月的预报点 */
    return Date.UTC(year, +m[1] - 1, +m[2], +m[3] - 8);
  }

  function timeLabel(ms) {
    var d = new Date(ms + 8 * 36e5); /* 按北京时间读 */
    return (d.getUTCMonth() + 1) + " 月 " + d.getUTCDate() + " 日 " + d.getUTCHours() + " 时";
  }

  /* 沿实况点 + 预报路径逐段插值，找离城市最近的位置与时刻。
     返回 { nowKm, minKm, minMs, minIsNow } ；路径缺实况点返回 null */
  function closestApproach(track, lat, lng, updatedAt) {
    var pts = (track || []).filter(function (p) { return p.phase === "now" || p.phase === "forecast"; });
    if (!pts.length || pts[0].phase !== "now") return null;
    var nowKm = distKm(lat, lng, pts[0].lat, pts[0].lng);
    var best = { km: nowKm, ms: trackTime(pts[0].t, updatedAt), seg: 0 };
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var ta = trackTime(a.t, updatedAt), tb = trackTime(b.t, updatedAt);
      for (var k = 1; k <= 24; k++) {
        var f = k / 24;
        var km = distKm(lat, lng, a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
        if (km < best.km) best = { km: km, ms: ta != null && tb != null ? ta + (tb - ta) * f : null, seg: i };
      }
    }
    return { nowKm: nowKm, minKm: best.km, minMs: best.ms, minIsNow: best.seg === 0 };
  }

  /* 距离读数：近处精确到 10 公里，远处到 100 公里，不到 100 公里不报具体数 */
  function fmtKm(km) {
    if (km < 100) return "不到 100";
    if (km < 1000) return String(Math.round(km / 10) * 10);
    return String(Math.round(km / 100) * 100);
  }

  function kmText(km) { return km < 100 ? "不到 100 公里" : "约 " + fmtKm(km) + " 公里"; }

  /* 一座城市的一句话。r7 / r10：当前 7 级、10 级风圈半径（公里，可空） */
  function cityLine(name, res, r7, r10) {
    if (!res) return name + "：路径数据不全，暂时算不出距离";
    var s = "离" + name + kmText(res.nowKm);
    if (r10 && res.nowKm <= r10) s += "，已在 10 级风圈内";
    else if (r7 && res.nowKm <= r7) s += "，已在 7 级风圈内";
    if (res.minIsNow || res.nowKm - res.minKm < 50) {
      s += res.minIsNow ? "；按预报路径正在远离" : "；按预报路径距离变化不大";
    } else {
      s += "；预报" + (res.minMs != null ? " " + timeLabel(res.minMs) + "前后" : "") + "最近，" + kmText(res.minKm);
      if (r7 && res.minKm <= r7 && !(res.nowKm <= r7)) s += "（按当前 7 级风圈大小粗估，届时可能进入风圈）";
    }
    return s;
  }

  var api = { distKm: distKm, trackTime: trackTime, timeLabel: timeLabel, closestApproach: closestApproach, fmtKm: fmtKm, kmText: kmText, cityLine: cityLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TyNearby = api;
})(this);

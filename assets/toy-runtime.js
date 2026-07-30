/* 风眼 · Toy 运行时增强
   长时间停留时每 15 分钟检查一次在线数据，有新数据则刷新页面并恢复滚动位置。

   注意：这里曾经有一段「南海诸岛九段线示意插图」，用手写经纬度在路径图角上画断续线。
   已于 2026-07-30 整体移除，请不要再加回来。原因：
   1) 走向本身是错的——原第 8、9 段把断续线北端封口从越南中部横拉到海南岛东南、
      珠江口以南，等于把海南岛、整个北部湾、西沙全划到线的外侧；标题写「南海诸岛」
      却未画任何岛礁；段数按 9 段绘制，而现行标准地图为十段线（台湾岛东侧另有一段）。
   2) 更根本的是：涉及国界线与南海断续线的地图，须依自然资源部标准画法，公开发布
      通常还需送审取得审图号。标注「示意」不免责，自绘断续线无论怎么调坐标都仍属
      问题地图。若日后确需展示，唯一合规做法是引用自然资源部标准地图服务
      （bzdt.ch.mnr.gov.cn）提供的官方南海诸岛插图，并按其要求标注审图号。

   小地图底图（basemap.js / Natural Earth）只含陆地轮廓、不含任何国界线，可以继续用。 */
(function () {
  "use strict";

  var LIVE_DATA_URL = "https://mr-salticidae.github.io/typhoon-eye/data/typhoon.json";
  var REFRESH_INTERVAL = 15 * 60 * 1000;
  var LAST_CHECK_KEY = "typhoon-eye:last-online-check";
  var SCROLL_KEY = "typhoon-eye:restore-scroll";
  var refreshTimer = null;
  var refreshing = false;

  function now() { return Date.now ? Date.now() : new Date().getTime(); }

  function readNumber(storage, key) {
    try {
      var value = Number(storage.getItem(key));
      return isFinite(value) ? value : 0;
    } catch (e) { return 0; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, String(value)); } catch (e) { /* Toy 无痕环境静默降级 */ }
  }

  function displayedUpdatedAt() {
    var node = document.getElementById("tyUpdated");
    return node ? node.textContent.replace(/（(?:缓存|演示)）/g, "").trim() : "";
  }

  function validData(data) {
    return !!data && typeof data.updatedAt === "string" && Array.isArray(data.typhoons);
  }

  function fetchLatest() {
    /* app.js 暴露的多镜像取数逻辑优先；不可用时回退单源请求 */
    if (typeof window.__typhoonEyeFetchLatest === "function") {
      return window.__typhoonEyeFetchLatest();
    }
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);
    var options = { cache: "no-store" };
    if (controller) options.signal = controller.signal;

    return fetch(LIVE_DATA_URL + "?toy_check=" + now(), options)
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!validData(data)) throw new Error("invalid data");
        return data;
      })
      .then(function (data) {
        clearTimeout(timeout);
        return data;
      }, function (error) {
        clearTimeout(timeout);
        throw error;
      });
  }

  function scheduleNextRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    var last = readNumber(sessionStorage, LAST_CHECK_KEY);
    var elapsed = last ? now() - last : 0;
    var delay = Math.max(1000, REFRESH_INTERVAL - elapsed);
    refreshTimer = setTimeout(function () { checkForUpdate("timer"); }, delay);
  }

  function checkForUpdate(reason) {
    if (refreshing || document.visibilityState === "hidden") {
      scheduleNextRefresh();
      return;
    }
    refreshing = true;
    fetchLatest()
      .then(function (data) {
        writeStorage(sessionStorage, LAST_CHECK_KEY, now());
        var shown = displayedUpdatedAt();
        if (shown && data.updatedAt !== shown) {
          writeStorage(sessionStorage, SCROLL_KEY, window.pageYOffset || document.documentElement.scrollTop || 0);
          window.location.reload();
          return;
        }
      })
      .catch(function () {
        /* 网络失败保留当前可靠快照；online/visibilitychange 会补查 */
      })
      .then(function () {
        refreshing = false;
        scheduleNextRefresh();
      });
  }

  function restoreScroll() {
    var y = readNumber(sessionStorage, SCROLL_KEY);
    if (!y) return;
    try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) { /* ignore */ }
    setTimeout(function () { window.scrollTo(0, y); }, 0);
  }

  function startRefreshLoop() {
    restoreScroll();
    /* app.js 已在首次打开时请求在线数据，这里从本次打开开始计时。 */
    writeStorage(sessionStorage, LAST_CHECK_KEY, now());
    scheduleNextRefresh();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      var last = readNumber(sessionStorage, LAST_CHECK_KEY);
      if (!last || now() - last >= REFRESH_INTERVAL) checkForUpdate("resume");
      else scheduleNextRefresh();
    });
    window.addEventListener("online", function () { checkForUpdate("online"); });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) checkForUpdate("pageshow");
    });
  }

  /* 兜底：历史版本可能把插图留在缓存的 DOM 里，命中就清掉。 */
  function removeLegacyInset() {
    var stale = document.getElementById("southChinaSeaInset");
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      startRefreshLoop();
      removeLegacyInset();
    });
  } else {
    startRefreshLoop();
    removeLegacyInset();
  }
})();

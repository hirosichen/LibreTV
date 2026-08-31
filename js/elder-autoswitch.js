/* 播放失敗自動換源（播放頁專用）
   長輩不會知道要自己按「切換資源」。偵測三種失敗：
   1. 播放器丟出錯誤（showError 被呼叫）
   2. 播放網址根本不是串流檔 —— 有些採集源給的是 /share/ 分享頁而非 m3u8（實測會靜默卡死）
   3. 靜默卡死 —— 過了 14 秒 currentTime 還是 0
   switchToResource 會整頁跳轉，所以「已試過的來源」必須存在 sessionStorage，
   否則換頁後歸零會在同幾個壞來源之間繞圈。 */
(function () {
    'use strict';
    if (!/player/.test(location.pathname)) return;

    var MAX_TRIES = 4;
    var STALL_SECONDS = 14;
    var switching = false, done = false;

    var qs = new URLSearchParams(location.search);
    var TITLE = qs.get('title') || '';
    var KEY = 'elderTried:' + TITLE;

    function tried() {
        try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
    }
    function addTried(k) {
        var t = tried();
        if (t.indexOf(k) === -1) t.push(k);
        try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
    }
    function clearTried() { try { sessionStorage.removeItem(KEY); } catch (e) {} }

    function notice(html) {
        var el = document.getElementById('elderNotice');
        if (!el) {
            el = document.createElement('div');
            el.id = 'elderNotice';
            el.className = 'elder-notice';
            document.body.appendChild(el);
        }
        el.innerHTML = html;
        el.style.display = 'block';
    }
    function hideNotice() {
        var el = document.getElementById('elderNotice');
        if (el) el.style.display = 'none';
    }
    function giveUp(why) {
        done = true;
        notice('<div style="font-size:32px;margin-bottom:14px">😔 這部片目前播不了</div>' +
               '<div style="margin-bottom:22px">' + why + '</div>' +
               '<button onclick="sessionStorage.clear();location.href=\'/\'" ' +
               'style="background:#ffd400;color:#000;font-weight:700;font-size:26px;padding:16px 34px;border-radius:10px;min-height:56px">' +
               '回首頁挑別部</button>');
    }

    function currentSource() { return qs.get('source') || ''; }

    async function findAlternatives() {
        if (!TITLE || typeof searchByAPIAndKeyWord !== 'function') return [];
        var skip = tried().concat([currentSource()]);
        var keys = (typeof selectedAPIs !== 'undefined' ? selectedAPIs : [])
            .filter(function (k) { return skip.indexOf(k) === -1; });
        var out = [];
        await Promise.all(keys.map(async function (k) {
            try {
                var res = await searchByAPIAndKeyWord(k, TITLE);
                if (!res || !res.length) return;
                var hit = res.find(function (r) { return (r.vod_name || '') === TITLE; }) || res[0];
                if (hit && hit.vod_id) out.push({ key: k, id: hit.vod_id });
            } catch (e) { /* 單一來源失敗不影響其他 */ }
        }));
        return out;
    }

    async function autoSwitch() {
        if (switching || done) return;
        switching = true;
        addTried(currentSource());
        if (tried().length > MAX_TRIES) { giveUp('已經試過 ' + tried().length + ' 個來源都失敗'); switching = false; return; }

        notice('<div style="font-size:30px;margin-bottom:10px">⏳ 這個來源播不了</div>' +
               '<div>正在自動換第 ' + (tried().length + 1) + ' 個來源，請稍等…</div>');

        var alts = await findAlternatives();
        if (!alts.length) { giveUp('找不到其他可用的來源'); switching = false; return; }

        addTried(alts[0].key);
        switching = false;
        if (typeof switchToResource === 'function') switchToResource(alts[0].key, alts[0].id);
    }

    // 1) 播放網址根本不是串流檔 → 立刻換，不用等 14 秒
    function urlLooksPlayable() {
        var u = (qs.get('url') || '').toLowerCase();
        return /\.(m3u8|m3u|mp4|mkv|flv|ts)(\?|$)/.test(u);
    }

    // 2) 接管 showError
    var _showError = window.showError;
    window.showError = function () {
        autoSwitch();
        if (typeof _showError === 'function') return _showError.apply(this, arguments);
    };

    // 3) 靜默卡死看門狗；播成功就清掉已試清單
    function watchdog() {
        setTimeout(function () {
            if (done || switching) return;
            var v = document.querySelector('video');
            if (!v) return;
            if (v.currentTime > 2) { clearTried(); hideNotice(); return; }
            if (v.readyState < 3) autoSwitch(); else hideNotice();
        }, STALL_SECONDS * 1000);
    }

    // 換源是整頁跳轉，新頁面沒有使用者互動紀錄 → 瀏覽器會擋自動播放。
    // 影片明明載好了卻停著，長輩不會知道要按播放，所以給一個大按鈕。
    var autoplayHandled = false;
    function ensurePlaying() {
        if (autoplayHandled) return;
        var v = document.querySelector('video');
        if (!v || v.readyState < 3 || !v.paused) return;
        autoplayHandled = true;
        var p = v.play();
        if (p && p.catch) p.catch(function () {
            notice('<div style="font-size:30px;margin-bottom:18px">影片已經準備好了</div>' +
                   '<button id="elderBigPlay" style="background:#ffd400;color:#000;font-weight:700;' +
                   'font-size:34px;padding:20px 48px;border-radius:12px;min-height:72px">▶ 開始播放</button>');
            var b = document.getElementById('elderBigPlay');
            if (b) b.onclick = function () { v.play(); hideNotice(); };
        });
    }

    function start() {
        if (!urlLooksPlayable()) {
            notice('<div style="font-size:30px;margin-bottom:10px">⏳ 這個來源播不了</div><div>正在自動換一個來源，請稍等…</div>');
            setTimeout(autoSwitch, 1200);
            return;
        }
        watchdog();
        // 播放順利就清掉紀錄，下次重新開始算
        var iv = setInterval(function () {
            ensurePlaying();
            var v = document.querySelector('video');
            if (v && v.currentTime > 2) { clearTried(); hideNotice(); clearInterval(iv); }
        }, 2000);
        setTimeout(function () { clearInterval(iv); }, 120000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();

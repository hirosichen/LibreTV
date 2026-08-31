/* 播放失敗自動換源（播放頁專用）
   長輩不會知道要自己按「切換資源」。這裡偵測兩種失敗：
   1. 播放器丟出錯誤（showError 被呼叫）
   2. 靜默卡死 —— 例如採集源給的是 /share/ 分享頁而非 m3u8，
      播放器不報錯但 currentTime 永遠是 0（實測過會發生）
   偵測到就自動換下一個來源，最多試 3 個，全失敗才顯示明確訊息。 */
(function () {
    'use strict';
    if (!/player/.test(location.pathname)) return;

    var MAX_TRIES = 3;
    var STALL_SECONDS = 14;
    var tried = [];
    var switching = false;
    var done = false;

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

    function currentSource() {
        return new URLSearchParams(location.search).get('source') || '';
    }

    // 找出其他來源同名影片的候選
    async function findAlternatives() {
        var title = (typeof currentVideoTitle !== 'undefined' && currentVideoTitle) || '';
        if (!title || typeof searchByAPIAndKeyWord !== 'function') return [];
        var keys = (typeof selectedAPIs !== 'undefined' ? selectedAPIs : []).filter(function (k) {
            return k !== currentSource() && tried.indexOf(k) === -1;
        });
        var out = [];
        await Promise.all(keys.map(async function (k) {
            try {
                var res = await searchByAPIAndKeyWord(k, title);
                if (!res || !res.length) return;
                var exact = res.find(function (r) { return (r.vod_name || '') === title; }) || res[0];
                if (exact && exact.vod_id) out.push({ key: k, id: exact.vod_id });
            } catch (e) { /* 忽略單一來源失敗 */ }
        }));
        return out;
    }

    async function autoSwitch(reason) {
        if (switching || done) return;
        switching = true;
        if (tried.length >= MAX_TRIES) {
            done = true;
            notice('<div style="font-size:32px;margin-bottom:14px">😔 這部片目前播不了</div>' +
                   '<div style="margin-bottom:22px">已經試過 ' + (tried.length + 1) + ' 個來源都失敗了</div>' +
                   '<button onclick="location.href=\'/\'" style="background:#ffd400;color:#000;font-weight:700;font-size:26px;padding:16px 34px;border-radius:10px">回首頁挑別部</button>');
            switching = false;
            return;
        }
        notice('<div style="font-size:30px;margin-bottom:10px">⏳ 這個來源播不了</div><div>正在自動換一個來源，請稍等…</div>');
        tried.push(currentSource());
        var alts = await findAlternatives();
        if (!alts.length) {
            done = true;
            notice('<div style="font-size:32px;margin-bottom:14px">😔 這部片目前播不了</div>' +
                   '<div style="margin-bottom:22px">找不到其他可用的來源</div>' +
                   '<button onclick="location.href=\'/\'" style="background:#ffd400;color:#000;font-weight:700;font-size:26px;padding:16px 34px;border-radius:10px">回首頁挑別部</button>');
            switching = false;
            return;
        }
        var pick = alts[0];
        tried.push(pick.key);
        if (typeof switchToResource === 'function') {
            switching = false;
            switchToResource(pick.key, pick.id);
            setTimeout(function () { hideNotice(); watchdog(); }, 3000);
        } else {
            switching = false;
        }
    }

    // 1) 接管 showError
    var _showError = window.showError;
    window.showError = function (msg) {
        autoSwitch('error: ' + msg);
        if (typeof _showError === 'function') return _showError.apply(this, arguments);
    };

    // 2) 靜默卡死看門狗
    var timer = null;
    function watchdog() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            if (done || switching) return;
            var v = document.querySelector('video');
            if (!v) return;
            if (v.currentTime < 0.5 && v.readyState < 3) autoSwitch('stalled');
            else hideNotice();
        }, STALL_SECONDS * 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchdog);
    else watchdog();
})();

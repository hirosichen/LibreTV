/* 長輩模式：放大介面、收起進階設定、方向鍵（遙控器）空間導航
   開關：localStorage.elderMode = 'off' 關閉；預設開啟
   主控台可用 ElderMode.off() / ElderMode.on() */
(function () {
    'use strict';
    var KEY = 'elderMode';
    var isOn = function () { return localStorage.getItem(KEY) !== 'off'; };
    var root = document.documentElement;

    function apply() { root.classList.toggle('elder', isOn()); }
    apply();

    window.ElderMode = {
        on: function () { localStorage.removeItem(KEY); location.reload(); },
        off: function () { localStorage.setItem(KEY, 'off'); location.reload(); },
        isOn: isOn
    };

    // ── 收起進階設定 ─────────────────────────────────────────
    var ADVANCED = ['数据源设置', '資料來源設定', '自定义API', '自訂API', '一般功能'];
    function markAdvanced() {
        var labels = document.querySelectorAll('#settingsPanel label, #settingsPanel .text-sm');
        labels.forEach(function (el) {
            var t = (el.textContent || '').trim();
            if (ADVANCED.indexOf(t) === -1) return;
            var block = el.closest('div');
            // 往上找到該區塊（含底線標題的那層的父容器）
            if (block && block.parentElement && block.parentElement.id !== 'settingsPanel') {
                block = block.parentElement;
            }
            if (block && block.id !== 'settingsPanel') block.classList.add('elder-advanced');
        });
    }

    function addToggleUI() {
        var panel = document.getElementById('settingsPanel');
        if (!panel || document.getElementById('elderToggleBox')) return;
        var box = document.createElement('div');
        box.id = 'elderToggleBox';
        box.style.cssText = 'margin:0 0 18px;padding:14px;border:2px solid #ffd400;border-radius:10px';
        box.innerHTML =
            '<div style="font-weight:700;margin-bottom:10px">長輩模式：' +
            (isOn() ? '已開啟' : '已關閉') + '</div>' +
            '<button id="elderToggleBtn" style="width:100%;background:#ffd400;color:#000;font-weight:700;border-radius:8px;min-height:56px">' +
            (isOn() ? '切換回一般模式' : '開啟長輩模式') + '</button>' +
            '<button id="elderAdvBtn" style="width:100%;margin-top:10px;background:#333;color:#fff;border-radius:8px;min-height:48px">顯示/隱藏進階設定</button>';
        panel.insertBefore(box, panel.firstChild);
        box.querySelector('#elderToggleBtn').onclick = function () { isOn() ? window.ElderMode.off() : window.ElderMode.on(); };
        box.querySelector('#elderAdvBtn').onclick = function () { root.classList.toggle('elder-show-advanced'); };
    }

    // ── 方向鍵空間導航（桌機鍵盤 / 電視遙控器共用）────────────
    var FOCUSABLE = 'button,a[href],input,select,textarea,[onclick],[tabindex]';

    function visible(el) {
        if (el.disabled) return false;
        var r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return false;
        var cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
    }

    function openModal() {
        var m = document.getElementById('modal');
        return (m && getComputedStyle(m).display !== 'none') ? m : null;
    }

    function candidates() {
        var scope = openModal() || document.body;
        return Array.prototype.filter.call(scope.querySelectorAll(FOCUSABLE), visible);
    }

    function setFocus(el) {
        document.querySelectorAll('.elder-focus').forEach(function (e) { e.classList.remove('elder-focus'); });
        if (!el.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
            el.setAttribute('tabindex', '-1');
        }
        el.classList.add('elder-focus');
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function move(dir) {
        var list = candidates();
        if (!list.length) return;
        var cur = document.activeElement;
        if (!cur || cur === document.body || list.indexOf(cur) === -1) { setFocus(list[0]); return; }
        var cr = cur.getBoundingClientRect();
        var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
        var best = null, bestScore = Infinity;
        list.forEach(function (el) {
            if (el === cur) return;
            var r = el.getBoundingClientRect();
            var dx = (r.left + r.width / 2) - cx, dy = (r.top + r.height / 2) - cy;
            var main, cross;
            if (dir === 'left')  { if (dx > -8) return; main = -dx; cross = Math.abs(dy); }
            else if (dir === 'right') { if (dx < 8) return; main = dx; cross = Math.abs(dy); }
            else if (dir === 'up')    { if (dy > -8) return; main = -dy; cross = Math.abs(dx); }
            else                      { if (dy < 8) return; main = dy; cross = Math.abs(dx); }
            var score = main + cross * 2;
            if (score < bestScore) { bestScore = score; best = el; }
        });
        if (best) setFocus(best);
    }

    var DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

    document.addEventListener('keydown', function (e) {
        if (!isOn()) return;
        var ae = document.activeElement;
        var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
                     !/^(checkbox|radio|button|submit)$/.test(ae.type || '');

        // 播放頁只在彈窗開啟時接管方向鍵，否則交給播放器（快轉/音量）
        var onPlayer = /player/.test(location.pathname);
        if (onPlayer && !openModal()) return;

        if (DIRS[e.key]) {
            if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // 讓游標移動
            e.preventDefault();
            move(DIRS[e.key]);
            return;
        }
        if (e.key === 'Enter' && ae && ae !== document.body) {
            if (typing) return;
            if (!/^(BUTTON|A)$/.test(ae.tagName) && ae.getAttribute('onclick')) {
                e.preventDefault();
                ae.click();
            }
            return;
        }
        if (e.key === 'Escape' || e.key === 'Backspace') {
            if (typing) return;
            var m = openModal();
            if (m) { e.preventDefault(); if (window.closeModal) window.closeModal(); }
        }
    });

    function init() { markAdvanced(); addToggleUI(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // 設定面板是動態渲染的，內容變了要重標
    var mo = new MutationObserver(function () { markAdvanced(); addToggleUI(); });
    function observe() { var p = document.getElementById('settingsPanel'); if (p) mo.observe(p, { childList: true, subtree: true }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();

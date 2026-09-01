// 繁體顯示層：把頁面上簡體文字即時轉為繁體（台灣用字/用語）
// 只改「顯示的文字節點」，不動 value / onclick / URL 等資料，避免影響搜尋與播放邏輯
(function () {
    'use strict';
    if (!window.ZhConv) return;
    if (localStorage.getItem('zhTwDisabled') === 'true') return;

    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
    var HAN = /[一-鿿]/;
    var ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
    var s2tw = window.ZhConv.s2tw;

    function convText(node) {
        var t = node.nodeValue;
        if (!t || !HAN.test(t)) return;
        var c = s2tw(t);
        if (c !== t) node.nodeValue = c;
    }

    function convAttrs(el) {
        for (var i = 0; i < ATTRS.length; i++) {
            var a = ATTRS[i];
            if (!el.hasAttribute(a)) continue;
            var v = el.getAttribute(a);
            if (!v || !HAN.test(v)) continue;
            var c = s2tw(v);
            if (c !== v) el.setAttribute(a, c);
        }
    }

    function walk(node) {
        if (node.nodeType === 3) { convText(node); return; }
        if (node.nodeType !== 1) return;
        if (SKIP_TAGS[node.tagName] || node.isContentEditable) return;
        if (node.hasAttribute && node.hasAttribute('data-nozh')) return;   // 標了就整棵子樹不轉
        convAttrs(node);
        for (var n = node.firstChild; n; n = n.nextSibling) walk(n);
    }

    function run() {
        if (document.title && HAN.test(document.title)) {
            var t = s2tw(document.title);
            if (t !== document.title) document.title = t;
        }
        walk(document.body);
    }

    // 首次轉換
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }

    // 後續動態渲染（搜尋結果、豆瓣推薦、彈窗等）
    var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.type === 'characterData') { convText(r.target); continue; }
            for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        }
    });

    function observe() {
        if (!document.body) return;
        observer.observe(document.body, {
            childList: true, subtree: true, characterData: true
        });
    }
    if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe);

    window.ZhTW = {
        disable: function () { localStorage.setItem('zhTwDisabled', 'true'); location.reload(); },
        enable: function () { localStorage.removeItem('zhTwDisabled'); location.reload(); }
    };
})();

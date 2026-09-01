/* 片名別名解析：台灣片名 <-> 大陸片名
 *
 * 採集源的資料庫用的是大陸譯名（《明天過後》在庫裡叫《后天》、
 *《捍衛戰士》叫《壮志凌云》），單純的繁簡字轉換救不了，因為這是「譯名不同」不是「字不同」。
 * 兩個方向分別處理：
 *   搜尋方向（台 -> 陸）：查維基百科的重定向別名 + 地區詞轉換，拿到大陸片名再搜一次。
 *   顯示方向（陸 -> 台）：採集源自己的 vod_sub 欄位就帶著「玩命关头(台)」這種標記，
 *                        直接解析，不必連外、零延遲。
 */
(function () {
    'use strict';

    var API = 'https://zh.wikipedia.org/w/api.php';
    var CACHE_PREFIX = 'ta:';
    var CACHE_TTL = 30 * 24 * 3600 * 1000;   // 查到別名：快取 30 天
    var CACHE_TTL_EMPTY = 24 * 3600 * 1000;  // 查無別名：只快取 1 天（維基隨時可能補上條目）
    var CACHE_MAX = 300;
    var TIMEOUT = 8000;
    var inflight = {};

    function t2s(s) { return window.ZhConv ? window.ZhConv.t2s(s) : s; }
    function s2t(s) { return window.ZhConv ? window.ZhConv.s2tw(s) : s; }

    // ---------- 快取 ----------
    function cacheGet(k) {
        try {
            var raw = localStorage.getItem(CACHE_PREFIX + k);
            if (!raw) return null;
            var o = JSON.parse(raw);
            var ttl = (o && o.v && o.v.length) ? CACHE_TTL : CACHE_TTL_EMPTY;
            if (!o || Date.now() - o.t > ttl) { localStorage.removeItem(CACHE_PREFIX + k); return null; }
            return o.v;
        } catch (e) { return null; }
    }
    function cacheSet(k, v) {
        try {
            localStorage.setItem(CACHE_PREFIX + k, JSON.stringify({ t: Date.now(), v: v }));
            // 超量時清掉最舊的一批，避免長期累積把 localStorage 塞爆
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var kk = localStorage.key(i);
                if (kk && kk.indexOf(CACHE_PREFIX) === 0) keys.push(kk);
            }
            if (keys.length > CACHE_MAX) {
                keys.map(function (kk) {
                    var t = 0;
                    try { t = JSON.parse(localStorage.getItem(kk)).t || 0; } catch (e) {}
                    return { k: kk, t: t };
                }).sort(function (a, b) { return a.t - b.t; })
                  .slice(0, keys.length - CACHE_MAX)
                  .forEach(function (o) { localStorage.removeItem(o.k); });
            }
        } catch (e) { /* 隱私模式或空間滿了都不影響功能 */ }
    }

    // ---------- 維基百科 ----------
    function wiki(params) {
        params.format = 'json';
        params.origin = '*';           // 匿名 CORS，維基官方支援
        var qs = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
        return fetch(API + '?' + qs, { signal: ctrl.signal })
            .then(function (r) {
                clearTimeout(timer);
                if (!r.ok) throw new Error('wiki ' + r.status);   // 429 / 5xx：查詢失敗，不是查無此片
                return r.json();
            }, function (e) { clearTimeout(timer); throw e; });
    }

    function stripParen(t) {
        return String(t || '').replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim();
    }
    function hasHan(t) { return /[一-鿿]/.test(t); }

    // 條目的所有重定向別名（《刺激1995》-> 肖申克的救赎 / 月黑高飛 / 地狱诺言 ...）
    function viaRedirects(title) {
        return wiki({
            action: 'query', redirects: 1, prop: 'redirects',
            rdlimit: 'max', rdnamespace: 0, titles: title
        }).then(function (d) {
            var out = [], pages = (d && d.query && d.query.pages) || {};
            for (var id in pages) {
                var p = pages[id];
                if ('missing' in p) continue;
                out.push(p.title);
                (p.redirects || []).forEach(function (r) { out.push(r.title); });
            }
            return out;
        });
    }

    // 地區詞轉換後的顯示名。有些片子沒有獨立的重定向頁，
    // 大陸名是靠條目內的 NoteTA 規則轉出來的（《明天過後》-> 后天 就是這種）。
    function viaVariant(title) {
        return wiki({
            action: 'parse', prop: 'displaytitle', redirects: 1,
            variant: 'zh-cn', page: title
        }).then(function (d) {
            if (!d || !d.parse || !d.parse.displaytitle) return [];
            return [String(d.parse.displaytitle).replace(/<[^>]+>/g, '')];
        }, function () { return []; });
    }

    function lookup(title) {
        // 地區詞轉換出來的名字放最前面：那是條目自己宣告的大陸譯名，
        // 比重定向別名可靠（重定向裡混著角色名、原聲帶、系列名等雜訊）。
        return Promise.all([viaVariant(title), viaRedirects(title)])
            .then(function (rs) { return rs[0].concat(rs[1]); });
    }

    function normalize(names, query) {
        var seen = {}, out = [], qs = t2s(query);
        names.forEach(function (n) {
            n = stripParen(String(n || '').replace(/[《》「」]/g, ''));
            if (!n || n.length < 2 || !hasHan(n)) return;   // 純英文片名採集源搜不到，單字太容易誤中
            n = t2s(n);
            if (n === qs || seen[n]) return;
            seen[n] = 1;
            out.push(n);
        });
        return out.slice(0, 5);
    }

    /* 台灣片名 -> 大陸片名候選（已轉簡體，最可靠的排前面）。查不到就回空陣列。 */
    function resolve(query) {
        query = String(query || '').trim();
        if (!query || !hasHan(query)) return Promise.resolve([]);

        var cached = cacheGet(query);
        if (cached) return Promise.resolve(cached);
        if (inflight[query]) return inflight[query];     // 同一詞併發時只打一次

        var task = lookup(query).then(function (names) {
            var out = normalize(names, query);
            // 完全沒有別名時補查「XXX (電影)」：
            // 有些片名在維基是指到系列頁而不是電影條目（例如《神鬼認證》）。
            if (out.length) return out;
            return lookup(query + ' (電影)').then(function (more) {
                return normalize(more, query);
            }, function () { return []; });
        }).then(function (out) {
            cacheSet(query, out);          // 只在查詢成功時才快取
            return out;
        }).catch(function () {
            return [];                     // 連不上／被限流：這次放棄，但不寫快取，下次還會再試
        });
        inflight[query] = task;
        task.then(function () { delete inflight[query]; }, function () { delete inflight[query]; });
        return task;
    }

    /* 從採集源的 vod_sub 取台灣譯名：「狂野时速(港) / 玩命关头(台)」-> 玩命關頭 */
    function twName(item) {
        if (!item) return '';
        var sub = String(item.vod_sub || '');
        if (!sub) return '';
        // 括號要排除在片名之外，否則「明日之后(港) / 明日过后(台)」會整串吃進來
        var m = sub.match(/([^\/|｜,，（()）]{1,30}?)\s*[（(](?:台|臺|台湾|台灣|臺灣)[)）]/);
        if (!m) return '';
        var name = m[1].trim();
        if (!name || !hasHan(name)) return '';
        name = s2t(name);
        // 和原名字面相同就不用另外顯示（只差繁簡的情況交給顯示層轉換即可）
        return t2s(name) === t2s(String(item.vod_name || '')) ? '' : name;
    }

    /* 片名對照表（大陸片名 -> 台灣片名）。搜尋時解析到就記下來，
       詳情頁與播放頁沿用，不必再解析一次；上限 200 筆，超過丟最舊的。 */
    var MAP_KEY = 'twTitles';
    function loadMap() {
        try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function remember(name, tw) {
        if (!name || !tw) return;
        try {
            var m = loadMap();
            if (m[name] === tw) return;
            m[name] = tw;
            var ks = Object.keys(m);
            if (ks.length > 200) ks.slice(0, ks.length - 200).forEach(function (k) { delete m[k]; });
            localStorage.setItem(MAP_KEY, JSON.stringify(m));
        } catch (e) {}
    }
    function recall(name) { return loadMap()[name] || ''; }

    window.TitleAlias = {
        resolve: resolve, twName: twName, remember: remember, recall: recall, _lookup: lookup
    };
})();

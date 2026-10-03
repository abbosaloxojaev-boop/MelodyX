// Deterministic end-to-end test for MelodyX.
// Builds _test.html = index.html (external resources stripped, fetch stubbed)
// + an interaction driver, runs it in headless Chrome and reports pass/fail.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');

// ---------- stub the iTunes API so the run is deterministic ----------
// NOTE: headless + --virtual-time-budget does not advance the CSS animation
// clock, so transitions would freeze mid-way and computed colours would be
// read while still animating. Kill them for the duration of the test.
const freezeMotion = `
<style>
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
</style>
`;
const fetchStub = `
<script>
(function () {
    var CATALOGUE = [
        { trackId: 101, trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours',
          artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://x/101.m4a', trackTimeMillis: 200040, primaryGenreName: 'Pop' },
        { trackId: 102, trackName: 'Oshiq', artistName: 'Yangi Ozod', collectionName: 'Single',
          artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://x/102.m4a', trackTimeMillis: 180000, primaryGenreName: 'Pop' },
        { trackId: 103, trackName: 'Zivert', artistName: 'Zivert', collectionName: 'Life',
          artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://x/103.m4a', trackTimeMillis: 210000, primaryGenreName: 'Pop' },
        { trackId: 104, trackName: 'Fiction', artistName: 'Konsta', collectionName: 'X',
          artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://x/104.m4a', trackTimeMillis: 190000, primaryGenreName: 'Pop' },
        { trackId: 105, trackName: 'No Preview', artistName: 'Nobody', collectionName: 'Y',
          artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: '', trackTimeMillis: 100000, primaryGenreName: 'Pop' }
    ];
    window.__fetchCount = 0;
    window.fetch = function (url) {
        window.__fetchCount++;
        var term = '';
        try { term = new URL(String(url)).searchParams.get('term') || ''; } catch (e) {}
        var limit = 5;
        try { limit = parseInt(new URL(String(url)).searchParams.get('limit'), 10) || 5; } catch (e) {}
        // mimic the real API: a different slice per country
        var country = 0;
        try { country = ['UZ','KZ','US','RU','GB','TR'].indexOf(new URL(String(url)).searchParams.get('country')); } catch (e) {}
        if (country < 0) country = 0;
        var results = [];
        for (var i = 0; i < Math.min(limit, CATALOGUE.length - country); i++) {
            var row = CATALOGUE[(country + i) % CATALOGUE.length];
            results.push({
                trackId: row.trackId + country * 1000,
                trackName: row.trackName + (country ? ' (' + country + ')' : ''),
                artistName: row.artistName,
                collectionName: row.collectionName,
                artworkUrl100: row.artworkUrl100,
                previewUrl: row.previewUrl,
                trackTimeMillis: row.trackTimeMillis,
                primaryGenreName: row.primaryGenreName
            });
        }
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ resultCount: results.length, results: results }); } });
    };
    HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event('pause')); };
    HTMLMediaElement.prototype.load = function () {};
})();
</script>
`;

// strip external resources so nothing can stall the page
let test = html
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/g, '')
    .replace(/<link rel="icon"[^>]*>/g, '');

const driver = `
<div id="__report" style="position:fixed;left:0;top:0;width:0;height:0;overflow:hidden"></div>
<script>
(function () {
    var results = [];
    var fatal = [];
    function check(name, pass, detail) {
        results.push({ name: name, pass: !!pass, detail: detail == null ? '' : String(detail) });
    }
    function q(s) { return document.querySelector(s); }
    function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
    function txt(s) { var el = q(s); return el ? el.textContent.trim() : ''; }
    function navLabel(v) {
        var l = q('.nav-link[data-view="' + (v || 'home') + '"]');
        return l ? l.querySelector('span[data-i18n]').textContent.trim() : '';
    }
    function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
    function getStore(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
    function flush(tag) {
        var el = q('#__report');
        if (!el) return;
        el.textContent = 'BEGIN_REPORT ' + (tag || '') + '\\n'
            + fatal.map(function (f) { return 'FATAL|' + f; }).join('\\n')
            + results.map(function (r) {
                return (r.pass ? 'PASS|' : 'FAIL|') + r.name + (r.detail ? ' :: ' + r.detail : '');
            }).join('\\n') + '\\nEND_REPORT';
    }
    window.addEventListener('error', function (e) { fatal.push('JS ERROR: ' + e.message + ' @' + e.lineno); flush('error'); });
    window.addEventListener('unhandledrejection', function (e) {
        fatal.push('UNHANDLED REJECTION: ' + ((e.reason && e.reason.message) || e.reason)); flush('reject');
    });

    try { if (location.hash === '#phase1') localStorage.clear(); } catch (e) {}

    function scenario1() {
        // ---------- boot ----------
        check('no JS error during boot', fatal.length === 0, fatal.join(' ; '));
        check('html[lang] set', !!document.documentElement.lang, document.documentElement.lang);
        check('html[data-theme] valid', /^(dark|light)$/.test(document.documentElement.dataset.theme), document.documentElement.dataset.theme);
        check('active lang button exists', !!q('.lang.active'), txt('.lang.active'));
        check('nav label translated', navLabel() === 'Bosh sahifa', navLabel());
        check('placeholder translated', q('#searchInput').placeholder === 'Qo\\u2018shiq yoki artist qidiring...', q('#searchInput').placeholder);
        check('search button translated', txt('#searchBtn') === 'Qidirish', txt('#searchBtn'));
        check('theme button aria-label translated', q('#themeBtn').getAttribute('aria-label') === 'Mavzuni almashtirish', q('#themeBtn').getAttribute('aria-label'));

        // ---------- API + rendering ----------
        check('API was called', window.__fetchCount > 0, window.__fetchCount + ' requests');
        var pop = qa('#popularSongs .song');
        check('popular songs rendered', pop.length > 0, pop.length + ' cards');
        check('cards have artwork', !!q('#popularSongs .song img') && q('#popularSongs .song img').getAttribute('src').indexOf('600x600') > 0,
              q('#popularSongs .song img') && q('#popularSongs .song img').getAttribute('src'));
        check('cards have favourite button', !!q('#popularSongs .song .song-fav'));
        check('cards have play button', !!q('#popularSongs .song .song-play'));
        check('songs without preview are excluded', !Array.prototype.some.call(pop, function (c) {
            return c.textContent.indexOf('No Preview') >= 0;
        }));
    }

    function scenario2() {
        // ---------- light / dark theme (independent of the starting mode) ----------
        function bg(el) { return getComputedStyle(el).backgroundColor; }
        function bgImg(el) { return getComputedStyle(el).backgroundImage; }
        function fg(el) { return getComputedStyle(el).color; }
        var TRANSITION_MS = 450; // body/.sidebar/... animate background-colour

        var t0 = document.documentElement.dataset.theme;
        q('#themeBtn').click();
        var t1 = document.documentElement.dataset.theme;
        check('theme toggles to the other mode', t1 !== t0 && /^(dark|light)$/.test(t1), t0 + ' -> ' + t1);

        var light = t1 === 'light';
        return tick(TRANSITION_MS).then(function () {
        var html = document.documentElement;
        var diag = 'attr=' + html.getAttribute('data-theme') +
                   ' --bg=' + getComputedStyle(html).getPropertyValue('--bg').trim() +
                   ' bodyBg=' + getComputedStyle(document.body).backgroundColor;
        check('body background follows the theme', bg(document.body) === (light ? 'rgb(242, 243, 246)' : 'rgb(7, 7, 7)'), bg(document.body) + ' | ' + diag);
        check('body text colour follows the theme', fg(document.body) === (light ? 'rgb(16, 17, 20)' : 'rgb(255, 255, 255)'), fg(document.body));
        check('sidebar background follows the theme', bg(q('#sidebar')) === (light ? 'rgb(255, 255, 255)' : 'rgb(11, 11, 11)'), bg(q('#sidebar')));
        check('card background follows the theme', bg(q('#popularSongs .song')) === (light ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)'), bg(q('#popularSongs .song')));
        check('search box background follows the theme', bg(q('.search-box')) === (light ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)'), bg(q('.search-box')));
        check('hero gradient is themed', bgImg(q('.hero')).indexOf('gradient') > 0, bgImg(q('.hero')).slice(0, 34));
        check('player stays translucent', bg(q('#player')).indexOf('rgba') === 0, bg(q('#player')));
        check('theme-color meta follows the theme', q('#themeColorMeta').content.toLowerCase() === (light ? '#f2f3f6' : '#070707'), q('#themeColorMeta').content);
        check('theme icon matches the theme', txt('#themeIcon') === (light ? '\\u2600' : '\\u263e'), txt('#themeIcon'));
        check('theme persisted', localStorage.getItem('melodyTheme') === '"' + t1 + '"', localStorage.getItem('melodyTheme'));
        check('aria-pressed matches the theme', q('#themeBtn').getAttribute('aria-pressed') === (light ? 'true' : 'false'), q('#themeBtn').getAttribute('aria-pressed'));

        q('#themeBtn').click();
        check('theme toggles back', document.documentElement.dataset.theme === t0, document.documentElement.dataset.theme);
        check('theme persisted on the way back', localStorage.getItem('melodyTheme') === '"' + t0 + '"', localStorage.getItem('melodyTheme'));
        return tick(TRANSITION_MS);
        }).then(function () {
        check('colours restored after toggling back', bg(document.body) === (t0 === 'light' ? 'rgb(242, 243, 246)' : 'rgb(7, 7, 7)'), bg(document.body));
        });
    }


    function scenario3() {
        // ---------- i18n: uz / ru / en ----------
        var expect = {
            uz: { home: 'Bosh sahifa', myMusic: 'Mening musiqam', fav: 'Sevimlilar', hist: 'Tarix', search: 'Qidirish',
                  favEmpty: 'Sevimlilar', histEmpty: 'Hali tarix yo‘q' },
            ru: { home: 'Главная', myMusic: 'Моя музыка', fav: 'Избранное', hist: 'История', search: 'Поиск',
                  favEmpty: 'В избранном', histEmpty: 'История пока пуста' },
            en: { home: 'Home', myMusic: 'My Music', fav: 'Favorites', hist: 'History', search: 'Search',
                  favEmpty: 'No favorites', histEmpty: 'No history yet' }
        };
        qa('.lang').forEach(function (btn) {
            var lang = btn.dataset.lang;
            var e = expect[lang];
            btn.click();
            check('i18n ' + lang + ' html[lang]', document.documentElement.lang === lang, document.documentElement.lang);
            check('i18n ' + lang + ' home', navLabel('home') === e.home, navLabel('home'));
            check('i18n ' + lang + ' myMusic', navLabel('myMusic') === e.myMusic, navLabel('myMusic'));
            check('i18n ' + lang + ' favorites', navLabel('favorites') === e.fav, navLabel('favorites'));
            check('i18n ' + lang + ' history', navLabel('history') === e.hist, navLabel('history'));
            check('i18n ' + lang + ' search button', txt('#searchBtn') === e.search, txt('#searchBtn'));
            check('i18n ' + lang + ' placeholder set', q('#searchInput').placeholder.length > 5, q('#searchInput').placeholder);
            check('i18n ' + lang + ' section title', q('[data-i18n="popular"]').textContent.length > 3, q('[data-i18n="popular"]').textContent);
            check('i18n ' + lang + ' inactive panel empty state re-localised',
                  q('#favoriteSongs .state').textContent.indexOf(e.favEmpty) >= 0, q('#favoriteSongs .state').textContent.trim());
            check('i18n ' + lang + ' history empty state re-localised',
                  q('#historySongs .state').textContent.indexOf(e.histEmpty) >= 0, q('#historySongs .state').textContent.trim());
        });

        // regression: a language switch must not wipe what the player is showing
        q('.nav-link[data-view="home"]').click();
        var card = q('#popularSongs .song');
        card.click();
        var playing = txt('#playerTitle');
        var playingArtist = txt('#playerArtist');
        check('player shows the clicked song before switching', playing === card.querySelector('h3').textContent.trim(), playing);
        qa('.lang').forEach(function (btn) { btn.click(); });
        check('player title survives every language switch', txt('#playerTitle') === playing,
              txt('#playerTitle') + ' vs ' + playing);
        check('player artist survives every language switch', txt('#playerArtist') === playingArtist, txt('#playerArtist'));
        check('playing card stays marked across switches', !!q('#popularSongs .song.is-playing'));
        q('.lang[data-lang="uz"]').click();
        check('language persisted', ['"uz"', '"ru"', '"en"'].indexOf(localStorage.getItem('melodyLanguage')) >= 0,
              localStorage.getItem('melodyLanguage'));
        var leftovers = qa('.nav-link span[data-i18n]').map(function (e) { return e.textContent.trim(); });
        check('4 nav items, no stale text', leftovers.length === 4, leftovers.join(' / '));
    }


    function scenario4() {
        // ---------- routing ----------
        ['home', 'myMusic', 'favorites', 'history'].forEach(function (v) {
            q('.nav-link[data-view="' + v + '"]').click();
            var panel = q('.panel[data-panel="' + v + '"]');
            check('route ' + v + ' -> panel visible', !panel.hidden);
            check('route ' + v + ' -> single visible panel', qa('.panel').filter(function (p) { return !p.hidden; }).length === 1);
            check('route ' + v + ' -> nav active', q('.nav-link[data-view="' + v + '"]').classList.contains('active'));
            check('route ' + v + ' -> aria-current set', q('.nav-link[data-view="' + v + '"]').getAttribute('aria-current') === 'page');
        });
        check('view persisted', localStorage.getItem('melodyView') === '"history"', localStorage.getItem('melodyView'));
    }

    function scenario5() {
        // ---------- playback -> history (the feature that did not work) ----------
        q('.nav-link[data-view="home"]').click();
        var card = q('#popularSongs .song');
        var expectedTitle = card.querySelector('h3').textContent.trim();
        var expectedArtist = card.querySelector('p').textContent.trim();
        card.click();

        check('player title is the clicked song', txt('#playerTitle') === expectedTitle, txt('#playerTitle') + ' / expected ' + expectedTitle);
        check('player artist shows song + album', txt('#playerArtist').indexOf(expectedArtist) === 0, txt('#playerArtist'));
        check('player cover set', (q('#playerImage').getAttribute('src') || '').indexOf('600x600') > 0, q('#playerImage').getAttribute('src'));
        check('card marked as playing', !!q('#popularSongs .song.is-playing'));
        check('play button shows pause', txt('#playIcon') === '\\u275a\\u275a', txt('#playIcon'));
        check('audio src set', (q('#audio').getAttribute('src') || '').indexOf('.m4a') > 0, q('#audio').getAttribute('src'));

        return tick().then(function () {
            // history is written from the play() promise, so wait a tick
            check('history badge visible', !q('#historyBadge').hidden, txt('#historyBadge'));
            var hist = getStore('melodyHistory') || [];
            check('history persisted', hist.length === 1, hist.length + ' entries');
            check('history entry has timestamp', hist.length === 1 && typeof hist[0].playedAt === 'number', hist[0] && hist[0].playedAt);
            check('history entry has full song data', hist.length === 1 && hist[0].song && hist[0].song.title === expectedTitle,
                  hist[0] && hist[0].song && hist[0].song.title);
            check('lastTrack persisted', !!localStorage.getItem('melodyLastTrack'),
                  (getStore('melodyLastTrack') || {}).title);

            // play a second song
            qa('#popularSongs .song')[1].click();
            return tick();
        }).then(function () {
            var hist = getStore('melodyHistory') || [];
            // skip/next also count as plays, and repeats are de-duplicated
            check('history grew past the 2 clicked tracks', hist.length >= 2, hist.length + ' entries');
            check('history de-duplicates by track id',
                  new Set(hist.map(function (e) { return e.song.id; })).size === hist.length,
                  hist.length + ' entries / ' + new Set(hist.map(function (e) { return e.song.id; })).size + ' unique');
            check('newest entry first', hist.length >= 2 && hist[0].playedAt >= hist[1].playedAt);

            // next / prev walk the queue
            var before = txt('#playerTitle');
            q('#nextBtn').click();
            var afterNext = txt('#playerTitle');
            check('next changes track', afterNext !== before, before + ' -> ' + afterNext);
            q('#prevBtn').click();
            check('prev goes back', txt('#playerTitle') === before, txt('#playerTitle'));
            return tick();
        }).then(function () {
            var stored = (getStore('melodyHistory') || []).length;
            // history view
            q('.nav-link[data-view="history"]').click();
            var hCards = qa('#historySongs .song');
            check('history view lists every entry', hCards.length === stored, hCards.length + ' cards / ' + stored + ' stored');
            var timeText = hCards[0] ? hCards[0].querySelector('.song-time').textContent : '';
            check('history entry shows relative time', /\\u0437\\u0430\\u043c\\u043f\\u044f|just now|hozda/.test(timeText), timeText);
            check('history subtitle matches the entry count', q('#historySubtitle').textContent.indexOf(String(stored)) > 0,
                  q('#historySubtitle').textContent);

            // favourites from the history view
            q('#historySongs .song .song-fav').click();
            var favs = getStore('melodyFavorites') || [];
            check('favourite persisted', favs.length === 1, favs.length + ' saved');
            check('favourite badge visible', !q('#favBadge').hidden, txt('#favBadge'));
            check('heart filled after click', q('#historySongs .song .song-fav').textContent.trim() === '\\u2665',
                  q('#historySongs .song .song-fav').textContent);

            // favourites view
            q('.nav-link[data-view="favorites"]').click();
            check('favorites view lists the song', qa('#favoriteSongs .song').length === 1, qa('#favoriteSongs .song').length);
            check('favorites subtitle shows count', q('#favoritesSubtitle').textContent.indexOf('1') > 0, q('#favoritesSubtitle').textContent);
            check('favourite survives navigation', q('#favoriteSongs .song-fav').getAttribute('aria-pressed') === 'true');

            // my music view
            q('.nav-link[data-view="myMusic"]').click();
            check('myMusic shows unique recent plays', qa('#myMusicRecent .song').length === stored,
                  qa('#myMusicRecent .song').length + ' / ' + stored);
            check('myMusic shows favourites', qa('#myMusicFavorites .song').length === 1, qa('#myMusicFavorites .song').length);

            // play from the favourites view
            q('.nav-link[data-view="favorites"]').click();
            q('#favoriteSongs .song').click();
            check('playing from favorites works', txt('#playerTitle').length > 0, txt('#playerTitle'));

            // un-favourite
            q('#favoriteSongs .song .song-fav').click();
            check('un-favourite persisted', (getStore('melodyFavorites') || []).length === 0);
            check('favorites empty state shown', !!q('#favoriteSongs .state'), q('#favoriteSongs .state').textContent.trim());
            check('favourite badge hidden again', q('#favBadge').hidden);
        });
    }


    function scenario6() {
        // ---------- volume / mute / seek ----------
        q('#volume').value = '0.42';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        check('volume persisted', localStorage.getItem('melodyVolume') === '0.42', localStorage.getItem('melodyVolume'));
        check('audio volume applied', Math.abs(q('#audio').volume - 0.42) < 0.001, String(q('#audio').volume));
        q('#volume').value = '0.9';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        check('volume icon is loud', txt('#volumeIcon') === '\\ud83d\\udd0a', txt('#volumeIcon'));

        q('#volume').value = '0.42';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        check('mid volume icon', txt('#volumeIcon') === '\\ud83d\\udd09', txt('#volumeIcon'));
        check('audio volume applied at 0.42', Math.abs(q('#audio').volume - 0.42) < 0.001, String(q('#audio').volume));

        q('#volume').value = '0.1';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        check('quiet volume icon', txt('#volumeIcon') === '\\ud83d\\udd08', txt('#volumeIcon'));

        q('#muteBtn').click();
        check('mute persisted', localStorage.getItem('melodyMuted') === 'true', localStorage.getItem('melodyMuted'));
        check('audio muted', q('#audio').volume === 0, String(q('#audio').volume));
        check('mute icon shows muted', txt('#volumeIcon') === '\\ud83d\\udd07', txt('#volumeIcon'));
        check('mute aria-label switches', q('#muteBtn').getAttribute('aria-label').length > 3, q('#muteBtn').getAttribute('aria-label'));
        q('#muteBtn').click();
        check('unmute persisted', localStorage.getItem('melodyMuted') === 'false', localStorage.getItem('melodyMuted'));

        q('#volume').value = '0';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        check('zero volume icon is muted speaker', txt('#volumeIcon') === '\\ud83d\\udd07', txt('#volumeIcon'));
        q('#volume').value = '0.8';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));

        check('progress bar starts at 0', q('#progress').value === '0', q('#progress').value);
        check('time labels are 0:00', txt('#currentTime') === '0:00' && txt('#durationTime') === '0:00',
              txt('#currentTime') + '/' + txt('#durationTime'));
    }

    function scenario7() {
        // ---------- search ----------
        q('#searchInput').value = 'shining';
        q('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        check('search section revealed', !q('#searchSection').hidden);
        check('search title shows the query', q('#searchTitle').textContent.indexOf('shining') >= 0, txt('#searchTitle'));
        return new Promise(function (resolve) {
            setTimeout(function () {
                var res = qa('#searchSongs .song');
                check('search results rendered', res.length > 0, res.length + ' results');
                check('search subtitle shows count', /\\d/.test(q('#searchSubtitle').textContent), q('#searchSubtitle').textContent);
                check('search button re-enabled', !q('#searchBtn').disabled);
                check('search button label restored', txt('#searchBtn').length > 0, txt('#searchBtn'));
                resolve();
            }, 60);
        });
    }

    function scenario8() {
        // ---------- layout / responsive ----------
        check('sidebar is fixed', getComputedStyle(q('#sidebar')).position === 'fixed', getComputedStyle(q('#sidebar')).position);
        check('player is fixed', getComputedStyle(q('#player')).position === 'fixed');
        check('player height published as a CSS var',
              getComputedStyle(document.documentElement).getPropertyValue('--player-h').trim().length > 0,
              getComputedStyle(document.documentElement).getPropertyValue('--player-h'));
        check('body reserves space for the player',
              parseFloat(getComputedStyle(document.body).paddingBottom) > 40,
              getComputedStyle(document.body).paddingBottom);
        check('menu button hidden on desktop', getComputedStyle(q('#menuBtn')).display === 'none', getComputedStyle(q('#menuBtn')).display);
        check('sidebar visible on desktop', getComputedStyle(q('#sidebar')).transform.indexOf('matrix') === 0 || getComputedStyle(q('#sidebar')).transform === 'none',
              getComputedStyle(q('#sidebar')).transform);
        check('main offset by the sidebar', parseFloat(getComputedStyle(q('main')).marginLeft) > 200, getComputedStyle(q('main')).marginLeft);
        check('no horizontal overflow', document.documentElement.scrollWidth <= window.innerWidth + 1,
              document.documentElement.scrollWidth + ' <= ' + window.innerWidth);
        check('grid is multi-column', getComputedStyle(q('#popularSongs')).gridTemplateColumns.split(' ').length >= 4,
              getComputedStyle(q('#popularSongs')).gridTemplateColumns);

        // mobile sidebar
        q('#menuBtn').click();
        check('mobile menu opens', q('#sidebar').classList.contains('open'));
        check('backdrop becomes visible', !q('#sidebarBackdrop').hidden);
        check('backdrop fades in', q('#sidebarBackdrop').classList.contains('show'));
        check('aria-expanded true', q('#menuBtn').getAttribute('aria-expanded') === 'true');
        var closeLabel = q('#menuBtn').getAttribute('aria-label');
        check('aria-label changes to a close label', closeLabel.length > 3 && closeLabel !== 'Open menu', closeLabel);
        q('#sidebarBackdrop').click();
        check('backdrop click closes', !q('#sidebar').classList.contains('open'));
        check('aria-expanded false', q('#menuBtn').getAttribute('aria-expanded') === 'false');
        q('#menuBtn').click();
        q('.nav-link[data-view="home"]').click();
        check('navigating closes the drawer', !q('#sidebar').classList.contains('open'));
    }

    function scenario9() {
        // ---------- keyboard shortcuts ----------
        var before = txt('#playIcon');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        var after = txt('#playIcon');
        check('space toggles playback', after !== before, before + ' -> ' + after);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        check('M mutes', localStorage.getItem('melodyMuted') === 'true', localStorage.getItem('melodyMuted'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        var v = parseFloat(q('#volume').value);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        check('ArrowUp raises volume', parseFloat(q('#volume').value) > v, v + ' -> ' + q('#volume').value);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        check('ArrowDown lowers volume', Math.abs(parseFloat(q('#volume').value) - v) < 0.001, q('#volume').value);
        // typing in the search field must not trigger shortcuts
        q('#searchInput').focus();
        q('#searchInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        check('shortcuts ignored while typing', localStorage.getItem('melodyMuted') === 'false', localStorage.getItem('melodyMuted'));
        q('#searchInput').blur();
    }

    function scenario10() {
        // ---------- clear history ----------
        q('.nav-link[data-view="history"]').click();
        var before = qa('#historySongs .song').length;
        check('history has entries before clearing', before > 0, before + ' entries');
        var realConfirm = window.confirm;
        window.confirm = function () { return true; };
        q('#clearHistoryBtn').click();
        window.confirm = realConfirm;
        check('history cleared', (getStore('melodyHistory') || []).length === 0);
        check('history empty state shown', !!q('#historySongs .state'), q('#historySongs .state').textContent.trim());
        check('history badge hidden', q('#historyBadge').hidden);
        check('toast shown', qa('#toasts .toast').length > 0,
              qa('#toasts .toast').map(function (t) { return t.textContent; }).join(','));

        // leave a fingerprint behind for the reload phase
        var s = q('#popularSongs .song');
        q('.nav-link[data-view="home"]').click();
        q('#popularSongs .song').click();
        q('#searchInput').value = 'ozoda';
        q('#searchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        q('.lang[data-lang="ru"]').click();
        q('#volume').value = '0.33';
        q('#volume').dispatchEvent(new Event('input', { bubbles: true }));
        if (document.documentElement.dataset.theme !== 'dark') q('#themeBtn').click();
        return tick(80).then(function () {
            window.__fingerprint = {
                lang: document.documentElement.lang,
                theme: document.documentElement.dataset.theme,
                view: q('.nav-link.active').dataset.view,
                volume: q('#volume').value,
                history: (getStore('melodyHistory') || []).length,
                playerTitle: txt('#playerTitle')
            };
            // phases 2/3 load a fresh page in the same profile -> localStorage survives
            try { localStorage.setItem('__fingerprint', JSON.stringify(window.__fingerprint)); } catch (e) {}
            check('fingerprint captured', window.__fingerprint.lang === 'ru' && window.__fingerprint.theme === 'dark',
                  JSON.stringify(window.__fingerprint));
        });
    }

    function run() {
        scenario1();
        return scenario2()
            .then(function () { scenario3(); scenario4(); return scenario5(); })
            .then(scenario6)
            .then(scenario7)
            .then(function () { scenario8(); scenario9(); return scenario10(); })
            .then(function () {
                check('no JS errors for the whole run', fatal.length === 0, fatal.join(' ; '));
                flush('phase1');
            })
            .catch(function (err) {
                fatal.push('DRIVER THREW: ' + ((err && err.message) || err));
                flush('phase1-throw');
            });
    }

    function boot() {
        var tries = 0;
        (function wait() {
            if (qa('#popularSongs .song').length > 0 || tries++ > 60) return run();
            setTimeout(wait, 25);
        })();
    }

    if (document.readyState === 'complete') setTimeout(boot, 0);
    else window.addEventListener('load', function () { setTimeout(boot, 0); });
})();
</script>
`;

// NOTE: function replacers - a string replacement would mangle "$$" / "$'" in the source
const baseHtml = html
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/g, '')
    .replace(/<link rel="icon"[^>]*>/g, '');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(require('os').tmpdir(), 'melodyx-test-profile');

// Each phase gets its OWN page and only phase 1 wipes localStorage, so phases
// 2 and 3 can verify that the state really survives a reload.
function runPhase(width, height, driverScript, hash) {
    let page = baseHtml
        .replace('</head>', () => freezeMotion + fetchStub + driverScript + '</head>')
        .replace('<script src="script.js"></script>', () => '<script>\n' + js + '\n</script>');
    fs.writeFileSync(path.join(dir, '_test_run.html'), page);
    return execFileSync(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--window-size=' + width + ',' + height,
        '--user-data-dir=' + profile,
        '--virtual-time-budget=9000', '--dump-dom',
        'file:///' + path.join(dir, '_test_run.html').replace(/\\/g, '/') + (hash || '')
    ], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

function report(dom) {
    const m = dom.match(/BEGIN_REPORT[^\n]*\n([\s\S]*?)\nEND_REPORT/);
    if (!m) {
        const el = dom.match(/id="__report"[^>]*>([\s\S]{0,300})/);
        return { lines: [], failed: ['no report; #__report = ' + (el ? el[1].slice(0, 200) : 'NOT FOUND')] };
    }
    const lines = m[1].split('\n').filter(Boolean);
    return { lines: lines, failed: lines.filter(l => !l.startsWith('PASS|')) };
}

const r1 = report(runPhase(1440, 900, driver, '#phase1'));
if (!r1) {
    console.log('!! phase 1 produced no report');
    process.exit(1);
}
let failed = r1.failed.length;
r1.lines.forEach(function (line) {
    const pass = line.startsWith('PASS|');
    if (!pass) failed++;
    console.log((pass ? '  ok   ' : '  FAIL ') + line.slice(5));
});
console.log('\nphase 1 (1440x900): ' + (failed ? failed + ' FAILED of ' + r1.lines.length : 'ALL ' + r1.lines.length + ' PASSED'));

// ---------- phase 2: reload with the same profile -> state must be restored ----------
const reloadDriver = `
(function () {
    var NL = String.fromCharCode(10);
    var out = [];
    function check(n, p, d) { out.push((p ? 'PASS|' : 'FAIL|') + n + (d == null ? '' : ' :: ' + d)); }
    function q(s) { return document.querySelector(s); }
    function txt(s) { var e = q(s); return e ? e.textContent.trim() : ''; }
    function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
    function gs(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

    function wait() {
        if (qa_len() > 0 || tries++ > 60) return start();
        setTimeout(wait, 25);
    }
    function qa_len() { return document.querySelectorAll('#popularSongs .song').length; }
    var tries = 0;

    function start() {
        var fp = gs('__fingerprint');
        check('fingerprint survived', !!fp, JSON.stringify(fp));
        if (!fp) { done(); return; }
        check('language restored after reload', document.documentElement.lang === fp.lang, document.documentElement.lang + ' vs ' + fp.lang);
        check('theme restored after reload', document.documentElement.dataset.theme === fp.theme, document.documentElement.dataset.theme + ' vs ' + fp.theme);
        check('active lang button matches', txt('.lang.active') === fp.lang.toUpperCase(), txt('.lang.active'));
        check('volume restored after reload', Math.abs(parseFloat(q('#volume').value) - parseFloat(fp.volume)) < 0.001, q('#volume').value + ' vs ' + fp.volume);
        check('active view restored', q('.nav-link.active').dataset.view === fp.view, q('.nav-link.active').dataset.view + ' vs ' + fp.view);
        check('history restored after reload', (gs('melodyHistory') || []).length === fp.history, (gs('melodyHistory') || []).length + ' vs ' + fp.history);
        check('last track restored in the player', txt('#playerTitle') === fp.playerTitle, txt('#playerTitle') + ' vs ' + fp.playerTitle);
        check('search section starts collapsed', q('#searchSection').hidden === true, String(q('#searchSection').hidden));
        check('ui text is Russian after reload', txt('.nav-link[data-view="home"] span[data-i18n]') === 'Главная',
              txt('.nav-link[data-view="home"] span[data-i18n]'));
        check('no playback autostart on load', q('#audio').getAttribute('src') === null, String(q('#audio').getAttribute('src')));
        q('.nav-link[data-view="history"]').click();
        check('restored history renders cards', document.querySelectorAll('#historySongs .song').length === fp.history,
              document.querySelectorAll('#historySongs .song').length);
        q('.nav-link[data-view="favorites"]').click();
        check('favorites empty state re-localised after reload',
              q('#favoriteSongs .state').textContent.indexOf('В избранном') >= 0, q('#favoriteSongs .state').textContent.trim());
        done();
    }
    function done() {
        document.getElementById('__report').textContent = 'BEGIN_REPORT reload' + NL + out.join(NL) + NL + 'END_REPORT';
    }


    window.addEventListener('load', function () { setTimeout(wait, 0); });
})();
`;

// phase 1 stores the fingerprint in localStorage; phase 2 is a fresh page load
// in the same browser profile, so it can compare against it
const r2 = report(runPhase(1440, 900, reloadDriver));
console.log('\n--- phase 2: reload / persistence ---');
let failed2 = 0;
if (!r2) { console.log('  FAIL reload run produced no report'); failed2 = 1; }
else {
    r2.lines.forEach(function (line) {
        const pass = line.startsWith('PASS|');
        if (!pass) failed2++;
        console.log((pass ? '  ok   ' : '  FAIL ') + line.slice(5));
    });
}

// ---------- phase 3: mobile viewport ----------
const mobileDriver = `
(function () {
    var NL = String.fromCharCode(10);
    var out = [];
    function check(n, p, d) { out.push((p ? 'PASS|' : 'FAIL|') + n + (d == null ? '' : ' :: ' + d)); }
    function q(s) { return document.querySelector(s); }
    function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
    function cs(el, p) { return getComputedStyle(el)[p]; }
    function done() { document.getElementById('__report').textContent = 'BEGIN_REPORT mobile' + NL + out.join(NL) + NL + 'END_REPORT'; }
    var tries = 0;
    function wait() {
        if (qa('#popularSongs .song').length > 0 || tries++ > 60) return run();
        setTimeout(wait, 25);
    }
    function run() {
        var w = window.innerWidth;
        check('viewport is mobile sized', w <= 500, w + 'px');
        check('hamburger button visible on mobile', cs(q('#menuBtn'), 'display') !== 'none', cs(q('#menuBtn'), 'display'));
        check('sidebar is off-canvas', q('#sidebar').getBoundingClientRect().right <= 1, q('#sidebar').getBoundingClientRect().right + 'px');
        check('main takes the full width', parseFloat(cs(q('main'), 'marginLeft')) === 0, cs(q('main'), 'marginLeft'));
        check('player spans the full width', q('#player').getBoundingClientRect().left <= 1, q('#player').getBoundingClientRect().left + 'px');
        check('search box wraps to its own row', q('.search-box').getBoundingClientRect().width > w * 0.8,
              Math.round(q('.search-box').getBoundingClientRect().width) + '/' + w);
        check('grid drops to 2 columns', cs(q('#popularSongs'), 'gridTemplateColumns').split(' ').length === 2,
              cs(q('#popularSongs'), 'gridTemplateColumns'));
        check('player is two rows on mobile', q('#player').getBoundingClientRect().height > 80,
              Math.round(q('#player').getBoundingClientRect().height) + 'px');
        check('body padding matches the player height',
              Math.abs(parseFloat(cs(document.body, 'paddingBottom')) - q('#player').getBoundingClientRect().height) < 3,
              cs(document.body, 'paddingBottom') + ' vs ' + q('#player').getBoundingClientRect().height);
        check('NO horizontal overflow on mobile', document.documentElement.scrollWidth <= w + 1,
              document.documentElement.scrollWidth + ' <= ' + w);
        // every element must fit inside the viewport
        var wide = qa('body *').filter(function (el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > w + 1 || r.left < -1);
        }).map(function (el) { return el.tagName + '.' + (el.className || '').toString().split(' ')[0]; });
        check('no element overflows the viewport', wide.length === 0, wide.slice(0, 6).join(', '));
        // touch fallback: card controls must be visible without hover
        var play = q('#popularSongs .song .song-play');
        check('play button visible without hover', parseFloat(cs(play, 'opacity')) > 0.5, cs(play, 'opacity'));
        check('favourite button visible without hover', parseFloat(cs(q('#popularSongs .song .song-fav'), 'opacity')) > 0.5,
              cs(q('#popularSongs .song .song-fav'), 'opacity'));
        // drawer
        q('#menuBtn').click();
        check('drawer opens on mobile', q('#sidebar').classList.contains('open'));
        check('drawer fully on screen', q('#sidebar').getBoundingClientRect().left >= -1, q('#sidebar').getBoundingClientRect().left + 'px');
        check('backdrop covers the screen', q('#sidebarBackdrop').getBoundingClientRect().width >= w - 1);
        q('#sidebarBackdrop').click();
        check('drawer closes via backdrop', !q('#sidebar').classList.contains('open'));
        done();
    }
    window.addEventListener('load', function () { setTimeout(wait, 0); });
})();
`;

const r3 = report(runPhase(390, 844, mobileDriver));
console.log('\n--- phase 3: mobile 390x844 ---');
let failed3 = 0;
if (!r3) { console.log('  FAIL mobile run produced no report'); failed3 = 1; }
else {
    r3.lines.forEach(function (line) {
        const pass = line.startsWith('PASS|');
        if (!pass) failed3++;
        console.log((pass ? '  ok   ' : '  FAIL ') + line.slice(5));
    });
}

const total = failed + failed2 + failed3;
console.log('\n=== ' + (total ? total + ' CHECK(S) FAILED' : 'ALL PHASES PASSED') + ' ===');
process.exit(total ? 1 : 0);


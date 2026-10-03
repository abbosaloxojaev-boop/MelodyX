// Renders MelodyX to PNGs (dark + light, desktop + mobile) using a stubbed API.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');
const shots = path.join(dir, 'shots');
fs.mkdirSync(shots, { recursive: true });

// deterministic catalogue so screenshots are stable offline
const stub = `
<script>
(function () {
    var NAMES = [
        ['Blinding Lights', 'The Weeknd', 'After Hours'],
        ['Oshiq', 'Yangi Ozod', 'Oshiq'],
        ['Zivert', 'Zivert', 'Life'],
        ['Konsta - Fiction', 'Konsta', 'Fiction'],
        ['Billie Eilish - Bad Guy', 'Billie Eilish', 'When We All Fall Asleep'],
        ['Miyagi - Kompaniya', 'Miyagi', 'Kompaniya'],
        ['Doston Xolmatov - Yoz', 'Doston Xolmatov', 'Yoz'],
        ['Imagine Dragons - Radioactive', 'Imagine Dragons', 'Night Visions'],
        ['LISA - Money', 'LISA', 'Lalisa'],
        ['Tarkan - Simdi', 'Tarkan', 'Dudu'],
        ['Ed Sheeran - Shape', 'Ed Sheeran', 'Divide'],
        ['MONATIK - Kletki', 'MONATIK', 'Kletki']
    ];
    var seed = 0;
    window.fetch = function (url) {
        var u = new URL(String(url));
        var country = ['UZ','KZ','US','RU','GB','TR'].indexOf(u.searchParams.get('country'));
        if (country < 0) country = 0;
        var limit = parseInt(u.searchParams.get('limit'), 10) || 5;
        var results = [];
        for (var i = 0; i < Math.min(limit, NAMES.length); i++) {
            var idx = (seed + country + i) % NAMES.length;
            var n = NAMES[idx];
            results.push({
                trackId: 1000 + seed * 100 + country * 10 + i,
                trackName: n[0], artistName: n[1], collectionName: n[2],
                artworkUrl100: 'https://picsum.photos/seed/mx' + idx + '/300/300',
                previewUrl: 'https://example.com/' + idx + '.m4a',
                trackTimeMillis: 150000 + i * 17000,
                primaryGenreName: 'Pop', releaseDate: '2024-01-0' + (i + 1)
            });
        }
        seed++;
        return Promise.resolve({ ok: true, status: 200, json: function () {
            return Promise.resolve({ resultCount: results.length, results: results });
        }});
    };
    HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event('pause')); };
})();
</script>
`;

const preload = `
<script>
window.addEventListener('load', function () {
    // pretend the user interacted: favourite two songs and play one
    setTimeout(function () {
        var cards = document.querySelectorAll('#popularSongs .song');
        if (cards[0]) cards[0].click();
        if (cards[1]) cards[1].querySelector('.song-fav').click();
        if (cards[3]) cards[3].querySelector('.song-fav').click();
        var st = document.createElement('style');
        st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.appendChild(st);
    }, 400);
});
</script>
`;

const page = html
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/g, '')
    .replace(/<link rel="icon"[^>]*>/g, '')
    .replace('</head>', () => stub + preload + '</head>')
    .replace('<script src="script.js"></script>', () => '<script>\n' + js + '\n</script>');
fs.writeFileSync(path.join(dir, '_shot.html'), page);

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(require('os').tmpdir(), 'melodyx-shot-profile');

function shot(name, width, height, setup) {
    let p = page;
    if (setup) p = p.replace('</body>', () => '<script>' + setup + '</script></body>');
    const file = '_shot_' + name + '.html';
    fs.writeFileSync(path.join(dir, file), p);
    execFileSync(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=' + width + ',' + height,
        '--user-data-dir=' + profile,
        '--virtual-time-budget=6000',
        '--screenshot=' + path.join(shots, name + '.png'),
        'file:///' + path.join(dir, file).replace(/\\/g, '/')
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    fs.unlinkSync(path.join(dir, file));
    console.log('  ' + name + '.png  ' + width + 'x' + height);
}

console.log('rendering screenshots...');
shot('01-desktop-dark', 1440, 900);
shot('02-desktop-light', 1440, 900, "localStorage.setItem('melodyTheme','\\\"light\\\"');location.reload();");
shot('03-desktop-russian', 1440, 900, "localStorage.setItem('melodyLanguage','\\\"ru\\\"');location.reload();");
shot('04-desktop-history', 1440, 900,
    "localStorage.setItem('melodyView','\\\"history\\\"');location.reload();");
shot('05-tablet', 820, 1000);
shot('06-mobile-dark', 390, 844);
shot('07-mobile-light', 390, 844, "localStorage.setItem('melodyTheme','\\\"light\\\"');location.reload();");
shot('08-mobile-menu', 390, 844,
    "localStorage.setItem('melodyTheme','\\\"light\\\"');location.reload();setTimeout(function(){document.getElementById('menuBtn').click();},1500);");
fs.unlinkSync(path.join(dir, '_shot.html'));
console.log('done -> ' + shots);

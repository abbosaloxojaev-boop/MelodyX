// Cross-checks index.html <-> script.js:
//  - every $('#id') in JS exists in the HTML
//  - every data-i18n / data-i18n-aria / data-placeholder key exists in all 3 locales
//  - every t('key') in JS exists in all 3 locales
const fs = require('fs');
const dir = __dirname;
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const js = fs.readFileSync(dir + '/script.js', 'utf8');
const css = fs.readFileSync(dir + '/style.css', 'utf8');

let problems = 0;
const fail = (m) => { problems++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

// ---------- 1. ids referenced in JS ----------
const jsIds = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'/g)].map(m => m[1]));
const htmlIds = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
const missingIds = [...jsIds].filter(i => !htmlIds.has(i));
console.log('\n1) JS id references (' + jsIds.size + ')');
missingIds.length ? missingIds.forEach(i => fail("missing #" + i + " in HTML")) : ok('all present in HTML');

// ---------- 2. classes referenced in JS ----------
const jsClasses = new Set([...js.matchAll(/class="([a-z0-9 -]+)"/g)].flatMap(m => m[1].split(/\s+/)));
const dynamicClasses = ['song', 'song-cover', 'song-play', 'song-fav', 'is-playing', 'state', 'state-icon',
  'retry-btn', 'skeleton', 'sk', 'toast', 'show', 'open', 'active', 'error', 'out'];
const htmlClasses = new Set([...(html + css).matchAll(/\.([a-zA-Z][A-Za-z0-9_-]*)/g)].map(m => m[1]));
const missingClasses = dynamicClasses.filter(c => !htmlClasses.has(c));
console.log('\n2) runtime-generated classes');
missingClasses.length ? missingClasses.forEach(c => fail('.' + c + ' has no CSS')) : ok('all styled');

// ---------- 3. translation keys ----------
const dictBlock = js.slice(js.indexOf('var translations = {'), js.indexOf('/* --------------------------------------------------------\n       3.'));
const localeStart = {};
for (const loc of ['uz', 'ru', 'en']) {
  const i = dictBlock.indexOf('\n        ' + loc + ': {');
  localeStart[loc] = i;
}
const localeEnd = {};
['uz', 'ru', 'en'].forEach((loc, i, arr) => {
  const next = i + 1 < arr.length ? dictBlock.indexOf('\n        ' + arr[i + 1] + ': {') : dictBlock.length;
  localeEnd[loc] = next;
});
const keysOf = (loc) => {
  const body = dictBlock.slice(localeStart[loc], localeEnd[loc]);
  return new Set([...body.matchAll(/^\s{12}([A-Za-z0-9_]+):/gm)].map(m => m[1]));
};
const dicts = { uz: keysOf('uz'), ru: keysOf('ru'), en: keysOf('en') };

console.log('\n3) translation key coverage');
console.log('  key counts: uz=' + dicts.uz.size + ' ru=' + dicts.ru.size + ' en=' + dicts.en.size);
['uz', 'ru', 'en'].forEach(loc => {
  ['uz', 'ru', 'en'].forEach(other => {
    const miss = [...dicts[other]].filter(k => !dicts[loc].has(k));
    if (miss.length) fail(loc + ' missing: ' + miss.join(', '));
  });
});
if (!problems) ok('all 3 locales have identical key sets');

// keys used in HTML
const htmlKeys = new Set([
  ...[...html.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/data-i18n-aria="([A-Za-z0-9_]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/data-placeholder="([A-Za-z0-9_]+)"/g)].map(m => m[1])
]);
const htmlMissing = [...htmlKeys].filter(k => !dicts.en.has(k));
console.log('  HTML uses ' + htmlKeys.size + ' i18n keys');
htmlMissing.length ? htmlMissing.forEach(k => fail('HTML key not in dict: ' + k)) : ok('all HTML i18n keys exist');

// keys used in JS
const jsKeys = new Set([...js.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map(m => m[1]));
const jsMissing = [...jsKeys].filter(k => !dicts.en.has(k));
console.log('  JS uses ' + jsKeys.size + ' i18n keys');
jsMissing.length ? jsMissing.forEach(k => fail('JS key not in dict: ' + k)) : ok('all JS i18n keys exist');

// ---------- 4. light theme completeness ----------
console.log('\n4) light theme');
const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('/* ---------- SIDEBAR'));
const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf(':root[data-theme="light"]'));
const varsOf = (b) => new Set([...b.matchAll(/^\s{4}(--[a-z0-9-]+):/gm)].map(m => m[1]));
const darkVars = varsOf(darkBlock), lightVars = varsOf(lightBlock);
const varsMissing = [...darkVars].filter(v => !lightVars.has(v));
varsMissing.length ? varsMissing.forEach(v => fail('light theme missing ' + v)) : ok('light theme defines all ' + darkVars.size + ' tokens');

// hardcoded near-black/white colours left outside the theme blocks
const body = css.slice(css.indexOf('/* ---------- SIDEBAR'), css.indexOf('/* =========================================================\n   RESPONSIVE'));
const leaked = [...body.matchAll(/#(0{3,7}|f{3,7}|1[0-9a-f]{5})\b/gi)].map(m => m[0]);
const uniqueLeak = [...new Set(leaked)];
console.log('  hardcoded dark colours outside theme tokens: ' + uniqueLeak.join(', ') + '  (disc/artwork gradients are intentional)');

// ---------- 5. responsive ----------
console.log('\n5) responsive');
const bp = [...css.matchAll(/@media \((max-width|max-height): *(\d+)px/g)].map(m => m[1] + ':' + m[2]);
console.log('  breakpoints: ' + bp.join(', '));
bp.length >= 5 ? ok(bp.length + ' breakpoints') : fail('too few breakpoints');
/* touch fallback for hover-revealed controls? */
(/@media\s*\(hover:\s*none\)/.test(css) || /@media\s*\(pointer:\s*coarse\)/.test(css))
  ? ok('touch-device rule for card controls') : fail('no touch-device rule');

// ---------- 6. localStorage keys ----------
console.log('\n6) persistence');
const storeKeys = [...js.matchAll(/^\s{8}([a-zA-Z]+): 'melody[A-Za-z]+'/gm)].map(m => m[1]);
// STORE.x used anywhere: store(STORE.x,...), store(STORE.x), localStorage.x
const usedKeys = [...new Set(
  [...js.matchAll(/STORE\.([a-zA-Z]+)/g), ...js.matchAll(/localStorage\.[a-z]+\(\s*STORE\.([a-zA-Z]+)/g)]
    .map(m => m[1])
)];
console.log('  STORE keys: ' + storeKeys.join(', '));
const orphans = storeKeys.filter(k => !usedKeys.includes(k));
orphans.length ? fail('declared but unused: ' + orphans.join(', ')) : ok('all ' + storeKeys.length + ' keys are read and/or written');
storeKeys.forEach(k => {
  const reads = (js.match(new RegExp('read\\(STORE\\.' + k + '[,\\)]', 'g')) || []).length;
  const writes = (js.match(new RegExp('write\\(STORE\\.' + k + '\\b', 'g')) || []).length;
  if (reads + writes === 0) fail('STORE.' + k + ' never touched');
  else console.log('       ' + k + ': ' + reads + ' read, ' + writes + ' write');
});
// no legacy direct localStorage access outside the storage layer
const raw = (js.match(/localStorage\.(setItem|getItem)\(\s*STORE\./g) || []).length;
raw ? fail(raw + ' direct localStorage calls to STORE.* bypass the helpers') : ok('no direct localStorage access to STORE keys');

console.log('\n' + (problems ? '=== ' + problems + ' PROBLEM(S) ===' : '=== ALL CHECKS PASSED ==='));
process.exit(problems ? 1 : 0);

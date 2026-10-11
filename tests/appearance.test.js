'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const artwork = require('../public/assets/artwork');
const source = fs.readFileSync(path.join(__dirname, '../public/assets/appearance.js'), 'utf8');

function harness({ saved = null, dark = false, blocked = false } = {}) {
  const windowEvents = {}, documentEvents = {}, mediaEvents = {}, changes = {};
  const storage = new Map(saved === null ? [] : [['studystream:appearance', saved]]);
  const select = { value: '', addEventListener: (name, fn) => { changes[name] = fn; } };
  let mounted = false, color;
  const media = { matches: dark, addEventListener: (name, fn) => { mediaEvents[name] = fn; } };
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => ({ setAttribute: (_, value) => { color = value; } }),
    querySelectorAll: () => mounted ? [select] : [],
    addEventListener: (name, fn) => { documentEvents[name] = fn; },
  };
  const window = { matchMedia: () => media, addEventListener: (name, fn) => { windowEvents[name] = fn; } };
  const localStorage = {
    getItem: key => { if (blocked) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw new Error('Storage unavailable'); storage.set(key, value); },
  };
  vm.runInNewContext(source, { document, window, localStorage });
  return {
    document, storage, select, color: () => color,
    mount: () => { mounted = true; documentEvents.DOMContentLoaded(); },
    choose: mode => { select.value = mode; changes.change(); },
    os: value => { media.matches = value; mediaEvents.change(); },
    fromOtherTab: value => { storage.set('studystream:appearance', value); windowEvents.storage({ key: 'studystream:appearance' }); },
  };
}

test('appearance resolves before body/styles, defaults to System and follows OS changes', () => {
  const view = harness({ dark: true });
  assert.equal(view.document.documentElement.dataset.theme, 'dark');
  assert.equal(view.document.documentElement.dataset.appearance, 'system');
  assert.equal(view.storage.size, 0, 'default preference is not persisted');
  view.mount(); assert.equal(view.select.value, 'system');
  view.os(false); assert.equal(view.document.documentElement.dataset.theme, 'light');
  assert.equal(view.color(), '#fffdf8');
});
test('explicit Light/Dark persistence, reload, System reset and cross-tab synchronization', () => {
  const view = harness({ dark: false }); view.mount(); view.choose('dark');
  assert.equal(view.storage.get('studystream:appearance'), 'dark');
  view.os(true); view.os(false); assert.equal(view.document.documentElement.dataset.theme, 'dark');
  assert.equal(harness({ saved: 'dark', dark: false }).document.documentElement.dataset.theme, 'dark');
  view.choose('light'); view.os(true); assert.equal(view.document.documentElement.dataset.theme, 'light');
  view.choose('system'); assert.equal(view.document.documentElement.dataset.theme, 'dark');
  view.os(false); assert.equal(view.document.documentElement.dataset.theme, 'light');
  view.fromOtherTab('dark'); assert.equal(view.select.value, 'dark'); assert.equal(view.document.documentElement.dataset.theme, 'dark');
  assert.deepEqual([...view.storage.keys()], ['studystream:appearance']);
});
test('invalid or blocked preference storage fails gracefully without affecting browsing', () => {
  assert.equal(harness({ saved: 'bad-value', dark: true }).document.documentElement.dataset.theme, 'dark');
  const view = harness({ blocked: true }); view.mount(); view.choose('dark');
  assert.equal(view.document.documentElement.dataset.theme, 'dark');
  view.choose('system'); view.os(false); assert.equal(view.document.documentElement.dataset.theme, 'light');
});
test('subject identity is deterministic, readable by label and independent of grade/theme', () => {
  for (const [id, label, palette, asset] of [[13, 'Math & Mechanics', 'purple', 'math'], [17, 'Physics', 'teal', 'physics'], [14, 'Biology', 'gold', 'biology'], [16, 'Chemistry', 'pink', 'chemistry']]) assert.deepEqual(artwork.forSubject(id, label), { palette, asset });
  assert.deepEqual(artwork.forSubject(10, 'English'), artwork.forSubject(10, 'English'));
  assert.equal(artwork.forSubject(10, 'English').asset, 'books');
  assert.deepEqual(artwork.forSubject(15, 'Geology'), { palette: 'gold', asset: 'earth' });
  assert.equal(artwork.thumbnail('https://infinityschool.net/thumbnail.png'), 'https://infinityschool.net/thumbnail.png');
  for (const value of ['', undefined, 'javascript:alert(1)', 'http://example.test/a.jpg', 'https://u:p@example.test/a.jpg']) assert.equal(artwork.thumbnail(value), '');
});
test('all screens initialize appearance before styles; motion and compatibility namespaces preserved', () => {
  for (const file of ['app.html', 'login.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
    assert.ok(html.indexOf('/assets/appearance.js') < html.indexOf('/assets/site.css'));
    assert.match(html, /data-appearance-select/); assert.ok(!html.includes('Course Search'));
  }
  const css = fs.readFileSync(path.join(__dirname, '../public/assets/site.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/); assert.doesNotMatch(css, /backdrop-filter|animation:.*infinite|radial-gradient/);
  const app = fs.readFileSync(path.join(__dirname, '../public/assets/app.js'), 'utf8');
  assert.match(app, /courseSearch:favorites:v1/); assert.match(app, /courseSearch:grade:v2/);
  assert.match(app, /PLAYBACK_REQUESTS\.fetch/); assert.match(app, /PLAYBACK_SETTINGS=await settings\.json/);
  assert.doesNotMatch(source, /referrer|\/api\/|cookie|password/i);
});
test('grid composition replaces the hero and retains single navigation/search/filter controls', () => {
  const html=fs.readFileSync(path.join(__dirname,'../public/app.html'),'utf8');
  for(const id of ['q','gradeTabs','favoritesOnly','infinityConnect','browseMenuBtn','browseDialog','subject','teacher','type','access','sort','expandAll','collapseAll'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} is not duplicated`);
  assert.doesNotMatch(html,/class="grade-hero|class="v2-search-card/);
  assert.match(html,/<dialog class="browse-dialog"/);
  const css=fs.readFileSync(path.join(__dirname,'../public/assets/site.css'),'utf8');
  assert.match(css,/grid-template-columns: repeat\(auto-fill/);
  assert.match(css,/\.lesson-expanded \{[^}]*grid-column: 1\/-1/);
  assert.doesNotMatch(css,/\.grade-hero|\.hero-stats|\.v2-search-card/);
});

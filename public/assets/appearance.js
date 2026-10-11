'use strict';
// Loaded synchronously before the stylesheet on every screen: no wrong-theme flash.
(() => {
  const key = 'studystream:appearance';
  const modes = ['system', 'light', 'dark'];
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  function read() {
    try { const saved = localStorage.getItem(key); return modes.includes(saved) ? saved : 'system'; }
    catch { return 'system'; }
  }
  function apply() {
    const theme = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17171d' : '#fffdf8');
    document.querySelectorAll('[data-appearance-select]').forEach(select => { select.value = mode; });
  }
  mode = read(); apply();
  system.addEventListener('change', () => { if (mode === 'system') apply(); });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { mode = read(); apply(); } });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-appearance-select]').forEach(select => select.addEventListener('change', () => {
      mode = modes.includes(select.value) ? select.value : 'system';
      try { localStorage.setItem(key, mode); } catch { /* A blocked storage area must not prevent changing appearance. */ }
      apply();
    }));
  });
})();

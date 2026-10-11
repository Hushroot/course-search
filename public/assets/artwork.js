'use strict';
// Decorative subject identity only. Never derives artwork from private playback URLs.
const StudyStreamArtwork = (() => {
  function forSubject(id, label = '') {
    const name = String(label).toLowerCase();
    if (/math|mechanic|account|calculus/.test(name)) return { palette: 'purple', asset: 'math' };
    if (/physics|wave/.test(name)) return { palette: 'teal', asset: 'physics' };
    if (/bio|plant/.test(name)) return { palette: 'gold', asset: 'biology' };
    if (/geolog|earth/.test(name)) return { palette: 'gold', asset: 'earth' };
    if (/chem/.test(name)) return { palette: 'pink', asset: 'chemistry' };
    let hash = 0;
    for (const character of String(id ?? '')) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return { palette: ['purple', 'teal', 'gold', 'pink'][hash % 4], asset: 'books' };
  }
  function thumbnail(value) {
    try { const url = new URL(String(value || '')); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  return { forSubject, thumbnail };
})();
if (typeof module !== 'undefined') module.exports = StudyStreamArtwork;

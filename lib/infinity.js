
'use strict';
const BASE = 'https://infinityschool.net';
const failure = (code, message, status = 502) => Object.assign(new Error(message), { code, status });
const decode = value => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
function requestSignal(external) {
  const timeout = AbortSignal.timeout(20000);
  if (!external) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, timeout]);
  // Compatibility with early Node 20 releases.
  const controller = new AbortController();
  const abort = () => { controller.abort(); external.removeEventListener('abort', abort); timeout.removeEventListener('abort', abort); };
  if (external.aborted) abort();
  else { external.addEventListener('abort', abort, { once: true }); timeout.addEventListener('abort', abort, { once: true }); }
  return controller.signal;
}

// Provider-origin-only cookie jar. Cookies never reach the Course Search browser.
class CookieJar {
  constructor(cookies = []) { this.cookies = cookies.map(c => ({ ...c })); }
  update(headers, requestUrl) {
    const url = new URL(requestUrl);
    for (const header of headers.getSetCookie()) {
      const parts = header.split(';').map(x => x.trim());
      const first = parts.shift();
      const split = first.indexOf('=');
      if (split < 1) continue;
      const lastSlash = url.pathname.lastIndexOf('/');
      const item = { name: first.slice(0, split), value: first.slice(split + 1), domain: url.hostname, hostOnly: true, path: lastSlash > 0 ? url.pathname.slice(0, lastSlash) : '/', secure: false };
      let maxAge;
      for (const part of parts) {
        const i = part.indexOf('=');
        const key = (i < 0 ? part : part.slice(0, i)).toLowerCase();
        const value = i < 0 ? '' : part.slice(i + 1);
        if (key === 'domain') { item.domain = value.toLowerCase().replace(/^\./, ''); item.hostOnly = false; }
        if (key === 'path' && value.startsWith('/')) item.path = value;
        if (key === 'secure') item.secure = true;
        if (key === 'expires' && Number.isFinite(Date.parse(value))) item.expires = Date.parse(value);
        if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
      }
      if (item.domain !== new URL(BASE).hostname) continue;
      if (item.name.length > 256 || item.value.length > 16384 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(item.name) || /[\r\n\x00-\x20\x7f;]/.test(item.value)) continue;
      if (maxAge !== undefined) item.expires = Date.now() + maxAge * 1000;
      this.cookies = this.cookies.filter(c => !(c.name === item.name && c.domain === item.domain && c.path === item.path));
      if (item.expires === undefined || item.expires > Date.now()) this.cookies.push(item);
    }
    if (this.cookies.length > 100 || Buffer.byteLength(JSON.stringify(this.cookies)) > 32768) throw failure('PROVIDER_FORMAT', 'Infinity returned unexpected session data.');
  }
  header(requestUrl) {
    const u = new URL(requestUrl);
    if (u.origin !== BASE) throw failure('PROVIDER_REDIRECT', 'Infinity redirected outside its expected origin.');
    return this.cookies.filter(c => (c.expires === undefined || c.expires > Date.now()) && c.domain === u.hostname && (!c.secure || u.protocol === 'https:') && (u.pathname === c.path || u.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'))).sort((a, b) => b.path.length - a.path.length).map(c => `${c.name}=${c.value}`).join('; ');
  }
}
async function request(jar, route, options = {}) {
  let url = new URL(route, BASE);
  let method = options.method || 'GET';
  let body = options.body;
  const signal = requestSignal(options.signal);
  for (let hop = 0; hop < 6; hop++) {
    if (url.origin !== BASE || url.username || url.password) throw failure('PROVIDER_REDIRECT', 'Infinity redirected outside its expected origin.');
    let response;
    try {
      response = await fetch(url.href, { method, body, signal, redirect: 'manual', headers: {
        Accept: options.ajax ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml',
        ...(options.ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: `${BASE}/login` } : {}),
        Cookie: jar.header(url.href),
      } });
    } catch { throw failure('PROVIDER_UNAVAILABLE', 'Infinity could not be reached. Please try again later.'); }
    jar.update(response.headers, url.href);
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'));
      throw Object.assign(failure('PROVIDER_RATE_LIMIT', 'Infinity is limiting requests. Please wait before trying again.', 429), { retryAfter: Number.isFinite(wait) && wait > 0 ? Math.min(86400, Math.ceil(wait)) : 60 });
    }
    if (response.status >= 500) throw failure('PROVIDER_UNAVAILABLE', 'Infinity is temporarily unavailable. Please try later.');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw failure('PROVIDER_FORMAT', 'Infinity returned an unexpected redirect.');
      url = new URL(location, url);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
      await response.body?.cancel();
      continue;
    }
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    try {
      if (reader) for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw failure('PROVIDER_FORMAT', 'Infinity returned an unexpectedly large response.'); }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error.code === 'PROVIDER_FORMAT') throw error;
      throw failure('PROVIDER_UNAVAILABLE', 'Infinity interrupted the response. Please try again later.');
    }
    return { status: response.status, text: Buffer.concat(chunks).toString('utf8'), url: url.href, type: response.headers.get('content-type') || '' };
  }
  throw failure('PROVIDER_REDIRECT', 'Infinity returned too many redirects.');
}
function challenge(text, stage) {
  const lower = text.toLowerCase();
  if (/captcha|cf-chl-|challenge-platform|two.factor|verification code|verify your|otp|رمز التحقق/.test(lower)) throw Object.assign(failure('PROVIDER_CHALLENGE', 'Infinity requires verification. Complete it with the provider; this site cannot bypass it.', 409), { stage });
  if (/device limit|device restriction|another device|maximum devices|browser is not authorized|unauthorized browser|use the allowed browser|غير مصرح|المتصفح المسموح|الأجهزة|جهاز آخر/.test(lower)) throw failure('PROVIDER_DEVICE', 'Infinity restricted this device or connection. Contact the provider.', 409);
}

// A provider can include dormant challenge JavaScript on an otherwise usable
// login page. Keep checking visible markup for actual challenge forms/messages;
// only ignore script contents when a regular login form and CSRF input exist.
function checkLoginPageChallenge(page) {
  const withoutScripts = page.text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const hasForm = /<form\b/i.test(withoutScripts);
  const hasToken = /<input\b[^>]*\bname\s*=\s*["']_token["']/i.test(withoutScripts);
  const looksLikeLogin = page.status === 200 && page.type.includes('text/html') && hasForm && hasToken;
  challenge(looksLikeLogin ? withoutScripts : page.text, 'login_page');
}

function tokenFromPage(text) {
  const fields = [...text.matchAll(/<input\b[^>]*>/gi)];
  for (const [tag] of fields) {
    if (/\bname\s*=\s*["']_token["']/i.test(tag)) {
      const value = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1];
      if (value && value.length <= 512) return decode(value);
    }
  }
  throw failure('PROVIDER_FORMAT', 'Infinity login form changed or is unavailable.');
}
function isLoginPage(response) { return new URL(response.url).pathname === '/login' || /<form\b[^>]*action=["'][^"']*\/login["']/i.test(response.text); }
async function login(email, password, visitorId, signal) {
  const jar = new CookieJar();
  const page = await request(jar, '/login', { signal });
  checkLoginPageChallenge(page);
  if (page.status !== 200 || !page.type.includes('text/html')) throw failure('PROVIDER_FORMAT', 'Infinity login page is unavailable.');
  const token = tokenFromPage(page.text);
  let form = new URLSearchParams({ _token: token, email, password, visitor_id: visitorId });
  let result;
  try { result = await request(jar, '/login', { method: 'POST', body: form.toString(), signal }); }
  finally { form = null; password = null; }
  const htmlWithoutScripts = result.text.replace(
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  ''
);

console.log('[Infinity submission diagnosis]', {
  status: result.status,
  path: new URL(result.url).pathname,
  contentType: result.type,

  challengeMarkers: [
    'captcha',
    'cf-chl-',
    'challenge-platform',
    'verification code',
    'otp'
  ].filter(marker =>
    result.text.toLowerCase().includes(marker)
  ),

  challengeOutsideScripts:
    /captcha|cf-chl-|challenge-platform|verification code|otp/i
      .test(htmlWithoutScripts),

  loginFormPresent:
    /<form\b/i.test(htmlWithoutScripts),

  dashboardPresent:
    /student_dashboard/i.test(htmlWithoutScripts)
});
  challenge(result.text, 'login_submission');
  if (result.status === 419) throw failure('PROVIDER_TOKEN', 'Infinity rejected the login security token. Please try again.', 409);
  if ([401, 422].includes(result.status) || isLoginPage(result)) throw failure('INVALID_CREDENTIALS', 'Infinity did not accept the login. Check your credentials or sign in with the provider to review any restriction.', 401);
  if (result.status !== 200) throw failure('PROVIDER_ACCESS', 'Infinity denied this login connection.', 403);
  const validation = await request(jar, '/student_dashboard/home', { signal });
  challenge(validation.text, 'account_validation');
  // Conservative positive evidence, not just a redirect or newly issued cookie.
  if (validation.status !== 200 || isLoginPage(validation)) throw failure('INVALID_CREDENTIALS', 'Infinity authentication could not be confirmed.', 401);
  if (!validation.type.includes('text/html') || !/student_dashboard/i.test(validation.text) || !/(?:href|action)\s*=\s*["'][^"']*\/logout\b/i.test(validation.text)) throw failure('AUTH_UNVERIFIED', 'Infinity returned an unfamiliar account page. Connection was not saved.');
  return jar.cookies;
}
function playbackUrl(raw, hosts, embed = false) {
  if (typeof raw !== 'string' || raw.length > 16384) return null;
  if (raw.trim().startsWith('<')) {
    raw = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    embed = true;
  }
  if (!raw) return null;
  try {
    const url = new URL(decode(raw), BASE);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (embed || url.hostname === 'iframe.mediadelivery.net') {
      if (url.hostname !== 'iframe.mediadelivery.net' || !/^\/embed\/\d{1,12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname)) return null;
      return { kind: 'embed', url: url.href };
    }
    if (!hosts.has(url.hostname)) return null;
    return { kind: 'video', url: url.href };
  } catch { return null; }
}
function extractPlayback(data, hosts) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('PROVIDER_FORMAT', 'Infinity returned an unexpected video response.');
  const v = data.video && typeof data.video === 'object' ? data.video : {};
  for (const raw of [v.download_link, v.download_url, v.url, data.download_link, data.download_url, v.embed_url, v.iframe_url, v.player_url, v.embed, v.iframe, data.embed_url, data.iframe, data.view]) {
    const parsed = playbackUrl(raw, hosts); if (parsed) return parsed;
  }
  throw failure('NO_PLAYBACK_SOURCE', 'Infinity did not return a supported authorized video source.');
}
async function playback(cookies, id, hosts, signal) {
  const jar = new CookieJar(cookies);
  const result = await request(jar, `/student_dashboard/topics/get-video/${id}?order=1&order_topic=1&count_completed_files=0&count_files=1`, { ajax: true, signal });
  challenge(result.text, 'login_submission');
  if (isLoginPage(result) || result.status === 401 || result.status === 419) throw failure('RECONNECT_REQUIRED', 'Your Infinity session expired. Reconnect your account.', 409);
  if (result.status === 403) throw failure('VIDEO_DENIED', 'Your Infinity account is not permitted to watch this video.', 403);
  if (result.status === 404) throw failure('VIDEO_UNAVAILABLE', 'Infinity no longer has this video available.', 404);
  if (result.status !== 200 || !result.type.includes('application/json')) throw failure('PROVIDER_FORMAT', 'Infinity returned an unexpected video response.');
  let data; try { data = JSON.parse(result.text); } catch { throw failure('PROVIDER_FORMAT', 'Infinity returned invalid video data.'); }
  const negative = value => value === false || value === 0 || value === 'false' || value === '0';
  const affirmative = value => value === true || value === 1 || value === 'true' || value === '1';
  const nested = data.video && typeof data.video === 'object' ? data.video : {};
  const message = [data.message, data.view, data.error, nested.message].filter(value => typeof value === 'string').join(' ');
  if ([401,419].includes(Number(data.status || data.code)) || negative(data.authenticated) || /session expired|not logged in|login required/i.test(message)) throw failure('RECONNECT_REQUIRED', 'Your Infinity session expired. Reconnect your account.', 409);
  if (affirmative(data.denied) || affirmative(nested.denied) || negative(data.authorized) || negative(nested.authorized) || negative(data.success) || Number(data.status || data.code) === 403 || /access denied|not authorized|not permitted|permission|subscribe|subscription required|غير مسموح|غير مشترك/i.test(message)) throw failure('VIDEO_DENIED', 'Your Infinity account is not permitted to watch this video.', 403);
  return { source: extractPlayback(data, hosts), cookies: jar.cookies };
}
module.exports = { CookieJar, request, login, playback, tokenFromPage, extractPlayback, playbackUrl, failure };

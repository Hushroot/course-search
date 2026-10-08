'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const BUNDLED_COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const BUNDLED_LABELS_FILE = path.join(DATA_DIR, 'labels.json');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const STATE_DIR = process.env.STATE_DIR ? path.resolve(process.env.STATE_DIR) : DATA_DIR;
const CODES_FILE = path.join(STATE_DIR, 'access-codes.json');
const LABELS_FILE = path.join(STATE_DIR, 'labels.json');
const COURSES_FILE = path.join(STATE_DIR, 'courses.json');
const INFINITY_AUTH_FILE = path.join(STATE_DIR, 'infinity-auth.json');
const SCAN_STATE_FILE = path.join(STATE_DIR, 'scan-state.json');
const PLAYBACK_GUIDE_FILE = path.join(STATE_DIR, 'playback-guide.json');
const PLAYBACK_SETTINGS_FILE = path.join(STATE_DIR, 'playback-settings.json');

fs.mkdirSync(STATE_DIR, { recursive: true });
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]\n');
if (!fs.existsSync(LABELS_FILE)) {
  if (fs.existsSync(BUNDLED_LABELS_FILE)) fs.copyFileSync(BUNDLED_LABELS_FILE, LABELS_FILE);
  else fs.writeFileSync(LABELS_FILE, '{\n  \"subjects\": {},\n  \"teachers\": {}\n}\n');
}

function readJsonFile(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function atomicWriteJson(filePath, value, mode) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  fs.renameSync(tmp, filePath);
  if (mode) { try { fs.chmodSync(filePath, mode); } catch {} }
}
// Editable student playback/Colab help. Content is plain text, never executable HTML.
const DEFAULT_PLAYBACK_GUIDE = {
  enabled: true,
  title: 'Video not playing? Try these steps',
  introduction: 'First use Watch or Refresh video link. If you have a video URL you are permitted to download, you can use Google Colab to save it for offline viewing.',
  steps: '1. Press Refresh video link once, then try Watch again.\n2. If you see 403 Forbidden or an expired token, use the official course player or ask the course provider for access.\n3. For a video you own or are explicitly allowed to download, open Google Colab and create a new notebook.\n4. Paste the example Python code below into a cell. Replace VIDEO_URL with your authorized direct download URL, then run the cell.\n5. Find the resulting file in the Colab Files sidebar. Download it to your device if your permissions allow.',
  code: 'import requests\n\n# Use a direct MP4 URL you are authorized to download.\nvideo_url = "PASTE_YOUR_AUTHORIZED_VIDEO_URL_HERE"\noutput_filename = "course_video.mp4"\n\nwith requests.get(video_url, stream=True, timeout=60) as response:\n    response.raise_for_status()\n    with open(output_filename, "wb") as output:\n        for chunk in response.iter_content(chunk_size=1024 * 1024):\n            if chunk:\n                output.write(chunk)\nprint("Saved:", output_filename)',
  updatedAt: null,
};
function readPlaybackGuide() {
  const saved = readJsonFile(PLAYBACK_GUIDE_FILE, null);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_PLAYBACK_GUIDE };
  return { ...DEFAULT_PLAYBACK_GUIDE, ...saved };
}
function savePlaybackGuide(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid guide settings.'), { status: 400 });
  const fields = { title: 140, introduction: 1500, steps: 12000, code: 16000 };
  const out = { enabled: body.enabled === true };
  for (const [key, max] of Object.entries(fields)) {
    if (typeof body[key] !== 'string' || body[key].length > max) {
      throw Object.assign(new Error(`Invalid ${key}: expected text of at most ${max} characters.`), { status: 400 });
    }
    out[key] = body[key].trim();
  }
  if (!out.title) throw Object.assign(new Error('Guide title cannot be empty.'), { status: 400 });
  out.updatedAt = nowIso();
  atomicWriteJson(PLAYBACK_GUIDE_FILE, out);
  return out;
}

function mergeBundledCoursesIntoState() {
  const bundled = readJsonFile(BUNDLED_COURSES_FILE, []);
  if (!Array.isArray(bundled)) return;
  if (!fs.existsSync(COURSES_FILE)) {
    atomicWriteJson(COURSES_FILE, bundled);
    return;
  }
  const state = readJsonFile(COURSES_FILE, []);
  if (!Array.isArray(state)) {
    atomicWriteJson(COURSES_FILE, bundled);
    return;
  }
  const stateIds = new Set(state.map(x => String(x && x.id)).filter(Boolean));
  const missing = bundled.filter(x => x && x.id !== null && x.id !== undefined && !stateIds.has(String(x.id)));
  if (missing.length) atomicWriteJson(COURSES_FILE, [...state, ...missing]);
}
mergeBundledCoursesIntoState();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'production';

const AUTO_SCAN_ENABLED = String(process.env.AUTO_SCAN_ENABLED ?? 'true').toLowerCase() !== 'false';
const AUTO_SCAN_INTERVAL_HOURS = Math.min(168, Math.max(1, Number(process.env.AUTO_SCAN_INTERVAL_HOURS || 24) || 24));
const AUTO_SCAN_INTERVAL_MS = AUTO_SCAN_INTERVAL_HOURS * 60 * 60 * 1000;
const AUTO_SCAN_MAX_MISSES = Math.min(10000, Math.max(1, Math.floor(Number(process.env.AUTO_SCAN_MAX_MISSES || 1000) || 1000)));
const AUTO_SCAN_BATCH_SIZE = Math.min(100, Math.max(1, Math.floor(Number(process.env.AUTO_SCAN_BATCH_SIZE || 25) || 25)));
// Each video worker fires get-file + get-video together. Five workers ~= ten concurrent HTTP requests.
const AUTO_SCAN_WORKERS = Math.min(10, Math.max(1, Math.floor(Number(process.env.AUTO_SCAN_WORKERS || 5) || 5)));
const AUTO_SCAN_ERROR_RETRY_MS = 60 * 60 * 1000;

if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.startsWith('replace-with-')) {
  console.error('ADMIN_PASSWORD must be set to a unique password with at least 12 characters.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith('replace-with-')) {
  console.error('SESSION_SECRET must be set to a random secret with at least 32 characters.');
  process.exit(1);
}


// Browser-controlled referrers cannot be spoofed by a setting. The configured
// origin is a deployment diagnostic; playback uses the real page origin.
const PLAYBACK_POLICIES = new Set(['origin', 'strict-origin-when-cross-origin', 'no-referrer']);

// Bunny Stream's official iframe player is an authorized embed, not a raw MP4 proxy.
// Accept either a URL or the iframe snippet supplied by the video owner.
function normalizeBunnyEmbed(value) {
  let raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 8192) throw Object.assign(new Error('Embed input is too long.'), { status: 400 });
  if (raw.startsWith('<')) {
    const match = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!match) throw Object.assign(new Error('Paste a Bunny iframe or a Bunny embed URL.'), { status: 400 });
    raw = match[1].replace(/&amp;/gi, '&');
  }
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('Invalid Bunny embed URL.'), { status: 400 }); }
  if (url.protocol !== 'https:' || url.hostname !== 'iframe.mediadelivery.net' || url.port || url.username || url.password || url.hash ||
      !/^\/embed\/\d{1,12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname)) {
    throw Object.assign(new Error('Only official https://iframe.mediadelivery.net/embed/{library}/{video-guid} links are allowed.'), { status: 400 });
  }
  return url.toString();
}
function explicitBunnyEmbed(videoJson, fileJson) {
  const video = safeDict(videoJson, 'video');
  const file = safeDict(fileJson, 'file');
  for (const candidate of [video.embed_url, video.iframe_url, video.player_url, video.embed, file.embed_url, file.iframe_url,
      videoJson && videoJson.embed_url, fileJson && fileJson.embed_url]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try { return normalizeBunnyEmbed(candidate); } catch {}
  }
  return null;
}
function getVideoForAdmin(videoId) {
  const id = Number(videoId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Enter a valid numeric Video ID.'), { status: 400 });
  const courses = readJsonFile(COURSES_FILE, []);
  const row = Array.isArray(courses) ? courses.find(x => x && Number(x.id) === id) : null;
  if (!row) throw Object.assign(new Error('Video ID not found in the library.'), { status: 404 });
  return row;
}
function setVideoEmbed(videoId, value) {
  const existing = getVideoForAdmin(videoId);
  const embedUrl = normalizeBunnyEmbed(value);
  const courses = readJsonFile(COURSES_FILE, []);
  const i = courses.findIndex(x => x && Number(x.id) === Number(existing.id));
  // A blank value removes the manual override. Subsequent API refreshes may repopulate it.
  courses[i] = { ...courses[i], embedUrl, embedManual: Boolean(embedUrl), embedUpdatedAt: nowIso() };
  atomicWriteJson(COURSES_FILE, courses);
  return courses[i];
}
function normalizeSiteOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 300) throw Object.assign(new Error('Site URL is too long.'), { status: 400 });
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('Enter a valid HTTPS website URL.'), { status: 400 }); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Object.assign(new Error('Use an HTTPS site origin only (example: https://your-site.up.railway.app).'), { status: 400 });
  }
  return url.origin;
}
function readPlaybackSettings() {
  const value = readJsonFile(PLAYBACK_SETTINGS_FILE, {});
  return {
    siteOrigin: typeof value.siteOrigin === 'string' ? value.siteOrigin : '',
    referrerPolicy: PLAYBACK_POLICIES.has(value.referrerPolicy) ? value.referrerPolicy : 'origin',
    updatedAt: value.updatedAt || null,
  };
}
function savePlaybackSettings(body) {
  const settings = {
    siteOrigin: normalizeSiteOrigin(body.siteOrigin),
    referrerPolicy: String(body.referrerPolicy || 'origin'),
    updatedAt: nowIso(),
  };
  if (!PLAYBACK_POLICIES.has(settings.referrerPolicy)) {
    throw Object.assign(new Error('Invalid referrer policy.'), { status: 400 });
  }
  atomicWriteJson(PLAYBACK_SETTINGS_FILE, settings, 0o600);
  return settings;
}

// A user may only refresh an existing resource, never enumerate arbitrary IDs.
// Requests are limited per session/IP and per ID to protect the upstream.
const videoRefreshCooldown = new Map();
const videoRefreshPending = new Map();
const REFRESH_COOLDOWN_MS = 90 * 1000;
async function refreshExistingVideo(videoId) {
  const id = Number(videoId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid video ID.'), { status: 400 });
  const courses = readJsonFile(COURSES_FILE, []);
  if (!Array.isArray(courses) || !courses.some(x => x && Number(x.id) === id)) {
    throw Object.assign(new Error('This video is not in the course library.'), { status: 404 });
  }
  if (videoRefreshPending.has(id)) return videoRefreshPending.get(id);
  const last = videoRefreshCooldown.get(id) || 0;
  const wait = REFRESH_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) throw Object.assign(new Error(`Recently refreshed. Try again in ${Math.ceil(wait / 1000)} seconds.`), { status: 429 });
  videoRefreshCooldown.set(id, Date.now());
  const promise = (async () => {
    const previous = courses.find(x => x && Number(x.id) === id);
    const fresh = await fetchVideoForScan(id);
    if (fresh.kind !== 'hit') throw Object.assign(new Error('The provider returned no usable data for this Video ID.'), { status: 404 });
    upsertCourseRecords([fresh.record]);
    const updated = readJsonFile(COURSES_FILE, []).find(x => x && Number(x.id) === id);
    const newLink = fresh.record.download || null;
    return {
      ok: true, action: 'updated', record: updated,
      linkUpdated: Boolean((newLink && newLink !== previous.download) || (updated.embedUrl && updated.embedUrl !== previous.embedUrl)),
      linkReturned: Boolean(newLink || updated.embedUrl),
    };
  })();
  videoRefreshPending.set(id, promise);
  try { return await promise; }
  catch (err) { videoRefreshCooldown.delete(id); throw err; }
  finally { videoRefreshPending.delete(id); }
}
setInterval(() => {
  const cutoff = Date.now() - REFRESH_COOLDOWN_MS;
  for (const [id, time] of videoRefreshCooldown) if (time < cutoff) videoRefreshCooldown.delete(id);
}, 5 * 60 * 1000).unref();

function nowIso() { return new Date().toISOString(); }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function hmac(value, purpose = 'generic') {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${purpose}:${value}`).digest('base64url');
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, 'session')}`;
}
function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body, 'session'))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}
function codeDigest(code) { return hmac(normalizeCode(code), 'access-code'); }
function adminDigest(value) { return hmac(String(value || ''), 'admin-password'); }
const EXPECTED_ADMIN_DIGEST = adminDigest(ADMIN_PASSWORD);

function readCodes() {
  try {
    const data = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function writeCodes(codes) {
  const tmp = `${CODES_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(codes, null, 2));
  fs.renameSync(tmp, CODES_FILE);
}

function readLabels() {
  try {
    const data = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
    return {
      subjects: data && typeof data.subjects === 'object' && !Array.isArray(data.subjects) ? data.subjects : {},
      teachers: data && typeof data.teachers === 'object' && !Array.isArray(data.teachers) ? data.teachers : {},
    };
  } catch {
    return { subjects: {}, teachers: {} };
  }
}
function writeLabels(labels) {
  const tmp = `${LABELS_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(labels, null, 2)}\n`);
  fs.renameSync(tmp, LABELS_FILE);
}
function cleanLabelMap(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey).trim().slice(0, 40);
    const name = String(rawValue ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (key && name) out[key] = name;
  }
  return out;
}
function courseLabelStats() {
  let courses = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(COURSES_FILE, 'utf8'));
    courses = Array.isArray(parsed) ? parsed : [];
  } catch {}
  const subjects = new Map();
  const teachers = new Map();
  for (const row of courses) {
    if (row.subject !== null && row.subject !== undefined && row.subject !== '') {
      const id = String(row.subject).trim();
      if (!subjects.has(id)) subjects.set(id, { id, count: 0, exampleLesson: row.lesson || row.video || '' });
      const item = subjects.get(id);
      item.count += 1;
      if (!item.exampleLesson && row.lesson) item.exampleLesson = row.lesson;
    }
    if (row.teacher !== null && row.teacher !== undefined && row.teacher !== '') {
      const id = String(row.teacher).trim();
      if (!teachers.has(id)) teachers.set(id, { id, count: 0, exampleLesson: row.lesson || row.video || '', subjectIds: [] });
      const item = teachers.get(id);
      item.count += 1;
      if (!item.exampleLesson && row.lesson) item.exampleLesson = row.lesson;
      if (row.subject !== null && row.subject !== undefined && row.subject !== '') {
        const subjectId = String(row.subject).trim();
        if (!item.subjectIds.includes(subjectId)) item.subjectIds.push(subjectId);
      }
    }
  }
  const sort = values => [...values].sort((a,b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return { subjects: sort(subjects.values()), teachers: sort(teachers.values()) };
}
function publicCode(code) {
  const { digest, ...safe } = code;
  return safe;
}
function codeSessionValid(code) {
  if (!code || code.enabled === false) return false;
  if (code.expiresAt && Date.now() >= new Date(code.expiresAt).getTime()) return false;
  return true;
}
function codeCanLogin(code) {
  if (!codeSessionValid(code)) return false;
  if (Number.isFinite(code.maxUses) && code.maxUses > 0 && Number(code.uses || 0) >= code.maxUses) return false;
  return true;
}

function parseCookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}
function userSession(req) {
  const token = verifySession(parseCookies(req).cs_session);
  if (!token || token.role !== 'user' || !token.codeId) return null;
  const code = readCodes().find(c => c.id === token.codeId);
  if (!codeSessionValid(code)) return null;
  return { token, code };
}
function adminSession(req) {
  const token = verifySession(parseCookies(req).cs_admin);
  return token && token.role === 'admin' ? token : null;
}
function anyAccess(req) {
  const admin = adminSession(req);
  if (admin) return { role: 'admin', token: admin };
  const user = userSession(req);
  if (user) return { role: 'user', ...user };
  return null;
}

function cookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (COOKIE_SECURE) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  return parts.join('; ');
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; media-src 'self' https:; frame-src https://iframe.mediadelivery.net; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function json(res, status, body, extraHeaders = {}) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  securityHeaders(res);
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
function sendFile(res, filePath, contentType, cache = 'no-store') {
  securityHeaders(res);
  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Cache-Control': cache });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}
function readJsonBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch { return false; }
}
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown');
}

const attempts = new Map();
function rateLimit(req, bucket, max = 8, windowMs = 10 * 60 * 1000) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  let item = attempts.get(key);
  if (!item || now - item.start >= windowMs) item = { start: now, count: 0 };
  item.count += 1;
  attempts.set(key, item);
  const blocked = item.count > max;
  return { blocked, retryAfter: Math.max(1, Math.ceil((windowMs - (now - item.start)) / 1000)) };
}
function clearLimit(req, bucket) { attempts.delete(`${bucket}:${clientIp(req)}`); }
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of attempts) if (v.start < cutoff) attempts.delete(k);
}, 10 * 60 * 1000).unref();

function generateAccessCode() {
  const raw = crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12).padEnd(12, 'X');
  return `CS-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}
function validExpiry(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

const INFINITY_BASE = 'https://infinityschool.net';
const INFINITY_TIMEOUT_MS = 20 * 1000;
const DENIAL_MARKERS = [
  'غير مصرح',
  'المتصفح غير مصرح',
  'يرجى استخدام المتصفح المسموح',
  'not authorized',
  'browser is not authorized',
  'unauthorized browser',
  'use the allowed browser',
];

function readInfinityAuth() {
  const saved = readJsonFile(INFINITY_AUTH_FILE, {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}
function infinityCookie() {
  return String(process.env.INFINITY_COOKIE || readInfinityAuth().cookie || '').trim();
}
function infinityAuthStatus() {
  const saved = readInfinityAuth();
  const fromEnv = Boolean(String(process.env.INFINITY_COOKIE || '').trim());
  return {
    configured: Boolean(infinityCookie()),
    source: fromEnv ? 'environment' : (saved.cookie ? 'admin' : null),
    updatedAt: fromEnv ? null : (saved.updatedAt || null),
  };
}
function saveInfinityCookie(value) {
  const cookieValue = String(value || '').trim();
  if (!cookieValue) throw Object.assign(new Error('Paste the full Infinity School Cookie header.'), { status: 400 });
  if (cookieValue.length > 16 * 1024) throw Object.assign(new Error('Cookie header is too large.'), { status: 400 });
  atomicWriteJson(INFINITY_AUTH_FILE, { cookie: cookieValue, updatedAt: nowIso() }, 0o600);
}
function safeDict(obj, key) {
  const value = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj[key] : null;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function cleanText(value, max = 800) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
function validHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}
function absoluteInfinityUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try { return new URL(value, INFINITY_BASE).toString(); } catch { return null; }
}
function isDeniedPayload(payload, text = '') {
  const body = payload && typeof payload === 'object' ? String(payload.view || payload.message || '') : String(text || '');
  const lower = body.toLowerCase();
  return DENIAL_MARKERS.some(marker => lower.includes(marker.toLowerCase()));
}
function explicitDownloadLink(videoJson, fileJson) {
  const video = safeDict(videoJson, 'video');
  const file = safeDict(fileJson, 'file');
  const candidates = [
    video.download_link, video.download_url, video.url, video.source,
    videoJson && videoJson.download_link, videoJson && videoJson.download_url,
    file.download_link, file.download_url,
  ];
  for (const candidate of candidates) if (validHttpUrl(candidate)) return absoluteInfinityUrl(candidate);
  return null;
}
async function infinityRequest(url) {
  const cookieValue = infinityCookie();
  if (!cookieValue) throw Object.assign(new Error('Infinity cookie is not configured. Add it in the admin panel first.'), { status: 400 });
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(INFINITY_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/html,*/*',
          'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${INFINITY_BASE}/student_dashboard/home`,
          'Cookie': cookieValue,
        },
      });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 400 * (2 ** attempt)));
        continue;
      }
      return { status: response.status, url: response.url, json: data, text: data ? null : text, contentType };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 400 * (2 ** attempt)));
        continue;
      }
    }
  }
  throw Object.assign(new Error(`Infinity request failed: ${lastError ? lastError.message : 'unknown error'}`), { status: 502 });
}
function parseInfinityRecord(videoId, fileResponse, videoResponse) {
  const fileJson = fileResponse.json;
  const videoJson = videoResponse.json;
  const file = safeDict(fileJson, 'file');
  const lesson = safeDict(file, 'lesson');
  const topic = safeDict(file, 'lesson_topic');
  const video = safeDict(videoJson, 'video');
  const denied = isDeniedPayload(videoJson, videoResponse.text);
  const download = denied ? null : explicitDownloadLink(videoJson, fileJson);
  const lessonId = lesson.id ?? file.lesson_id ?? null;
  const topicId = topic.id ?? file.lesson_topic_id ?? file.topic_id ?? null;
  return {
    id: Number(videoId),
    video: cleanText(video.file_name || video.name || file.file_name || file.name, 300),
    topicId,
    topic: cleanText(topic.name || topic.title, 300),
    lessonId,
    lesson: cleanText(lesson.name || lesson.title, 300),
    teacher: lesson.teacher_id ?? null,
    subject: lesson.subject_id ?? null,
    section: lesson.class_section_id ?? null,
    free: lesson.is_lesson_free ?? null,
    denied,
    type: cleanText(file.type_detail || file.type || video.type_detail || video.type, 120),
    download,
    embedUrl: denied ? null : explicitBunnyEmbed(videoJson, fileJson),
    path: cleanText(file.video_path || video.video_path || video.path, 1000),
    thumb: absoluteInfinityUrl(topic.thumbnail || file.thumbnail || lesson.thumbnail),
    lessonThumb: absoluteInfinityUrl(lesson.thumbnail),
    description: cleanText(lesson.description, 800),
    topicDescription: cleanText(topic.description, 800),
    duration: file.duration ?? video.duration ?? null,
    price: file.file_price ?? file.price ?? null,
    fetchedAt: nowIso(),
  };
}
function usefulCourseRecord(row) {
  return Boolean(row && (row.video || row.lessonId !== null && row.lessonId !== undefined || row.topicId !== null && row.topicId !== undefined || row.download));
}
function mergeNonEmpty(oldRow, newRow) {
  const merged = { ...(oldRow || {}) };
  for (const [key, value] of Object.entries(newRow || {})) {
    // Admin-supplied Bunny embeds survive daily scans and user-triggered refreshes.
    if (key === 'embedUrl' && oldRow?.embedManual) continue;
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
    else if (!(key in merged)) merged[key] = value;
  }
  return merged;
}
function upsertCourseRecord(record) {
  const courses = readJsonFile(COURSES_FILE, []);
  if (!Array.isArray(courses)) throw Object.assign(new Error('Course database is invalid.'), { status: 500 });
  const idx = courses.findIndex(x => x && String(x.id) === String(record.id));
  const action = idx >= 0 ? 'updated' : 'added';
  if (idx >= 0) courses[idx] = mergeNonEmpty(courses[idx], record);
  else courses.push(record);
  courses.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  atomicWriteJson(COURSES_FILE, courses);
  return { action, record: idx >= 0 ? courses.find(x => String(x.id) === String(record.id)) : record, total: courses.length };
}
async function fetchAndStoreVideo(videoId) {
  const id = Number(videoId);
  if (!Number.isInteger(id) || id < 1 || id > 999999999) throw Object.assign(new Error('Video ID must be a positive whole number.'), { status: 400 });
  const [fileResponse, videoResponse] = await Promise.all([
    infinityRequest(`${INFINITY_BASE}/student_dashboard/topics/get-file/${id}`),
    infinityRequest(`${INFINITY_BASE}/student_dashboard/topics/get-video/${id}?order=1&order_topic=1&count_completed_files=0&count_files=1`),
  ]);
  if ([401, 403].includes(fileResponse.status) || [401, 403].includes(videoResponse.status)) {
    throw Object.assign(new Error('Infinity rejected the saved cookie. Update it in the admin panel and try again.'), { status: 502 });
  }
  const record = parseInfinityRecord(id, fileResponse, videoResponse);
  if (!usefulCourseRecord(record)) {
    throw Object.assign(new Error(`Video ID ${id} returned no usable course data.`), { status: 404 });
  }
  const stored = upsertCourseRecord(record);
  return { ...stored, http: { file: fileResponse.status, video: videoResponse.status } };
}


function defaultScanState() {
  return {
    running: false,
    trigger: null,
    lastStatus: 'never',
    lastError: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastStartId: null,
    lastCheckedId: null,
    lastHitId: null,
    lastHitsFound: 0,
    lastCheckedCount: 0,
    lastMissStreak: 0,
    nextDueAt: null,
  };
}
function readScanState() {
  const saved = readJsonFile(SCAN_STATE_FILE, {});
  return { ...defaultScanState(), ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) };
}
function writeScanState(patch) {
  const state = { ...readScanState(), ...patch };
  atomicWriteJson(SCAN_STATE_FILE, state);
  return state;
}
function highestStoredVideoId() {
  const courses = readJsonFile(COURSES_FILE, []);
  if (!Array.isArray(courses) || !courses.length) return 0;
  let max = 0;
  for (const row of courses) {
    const id = Number(row && row.id);
    if (Number.isInteger(id) && id > max) max = id;
  }
  return max;
}
function upsertCourseRecords(records) {
  if (!Array.isArray(records) || !records.length) return { added: 0, updated: 0, total: readJsonFile(COURSES_FILE, []).length || 0 };
  const courses = readJsonFile(COURSES_FILE, []);
  if (!Array.isArray(courses)) throw Object.assign(new Error('Course database is invalid.'), { status: 500 });
  const index = new Map(courses.map((row, i) => [String(row && row.id), i]));
  let added = 0;
  let updated = 0;
  for (const record of records) {
    const key = String(record.id);
    if (index.has(key)) {
      const i = index.get(key);
      courses[i] = mergeNonEmpty(courses[i], record);
      updated += 1;
    } else {
      index.set(key, courses.length);
      courses.push(record);
      added += 1;
    }
  }
  courses.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  atomicWriteJson(COURSES_FILE, courses);
  return { added, updated, total: courses.length };
}
function isRedirectStatus(status) {
  return Number(status) >= 300 && Number(status) < 400;
}
function isTransientInfinityStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}
function isAuthFailureResponse(response) {
  if (!response) return false;
  if ([401, 403].includes(Number(response.status)) || isRedirectStatus(response.status)) return true;
  const contentType = String(response.contentType || '').toLowerCase();
  const text = String(response.text || '').toLowerCase();
  if (contentType.includes('text/html') && /login|sign[ -]?in|تسجيل الدخول|تسجيل دخول/.test(text)) return true;
  return false;
}
async function fetchVideoForScan(videoId) {
  const id = Number(videoId);
  const [fileResponse, videoResponse] = await Promise.all([
    infinityRequest(`${INFINITY_BASE}/student_dashboard/topics/get-file/${id}`),
    infinityRequest(`${INFINITY_BASE}/student_dashboard/topics/get-video/${id}?order=1&order_topic=1&count_completed_files=0&count_files=1`),
  ]);

  if (isAuthFailureResponse(fileResponse) || isAuthFailureResponse(videoResponse)) {
    throw Object.assign(new Error('Infinity rejected or redirected the saved cookie. Update the cookie in the admin panel.'), { status: 502, scanFatal: true });
  }
  if (isTransientInfinityStatus(fileResponse.status) || isTransientInfinityStatus(videoResponse.status)) {
    throw Object.assign(new Error(`Infinity returned a temporary error (${fileResponse.status}/${videoResponse.status}). The scan stopped without counting it as a miss.`), { status: 502, scanFatal: true });
  }

  const record = parseInfinityRecord(id, fileResponse, videoResponse);
  if (usefulCourseRecord(record)) {
    return { kind: 'hit', id, record, http: { file: fileResponse.status, video: videoResponse.status } };
  }

  // If the response is explicit denial markup and contains no useful metadata, treat it as auth/browser failure,
  // not as one of the 1000 real empty IDs.
  if (isDeniedPayload(fileResponse.json, fileResponse.text) || isDeniedPayload(videoResponse.json, videoResponse.text)) {
    throw Object.assign(new Error('Infinity denied the scanner request. Refresh the saved cookie/browser session.'), { status: 502, scanFatal: true });
  }

  return { kind: 'miss', id, http: { file: fileResponse.status, video: videoResponse.status } };
}
async function mapWithConcurrency(values, limit, fn) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= values.length) return;
      try {
        results[i] = { ok: true, value: await fn(values[i]) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const scanRuntime = {
  running: false,
  stopRequested: false,
  promise: null,
};

function scanStatus() {
  const state = readScanState();
  const highestId = highestStoredVideoId();
  const refTime = state.lastStatus === 'error' ? state.lastStartedAt : (state.lastCompletedAt || state.lastStartedAt);
  const dueMs = state.lastStatus === 'error' ? AUTO_SCAN_ERROR_RETRY_MS : AUTO_SCAN_INTERVAL_MS;
  const nextDueAt = refTime ? new Date(new Date(refTime).getTime() + dueMs).toISOString() : null;
  return {
    ...state,
    running: scanRuntime.running,
    stopRequested: scanRuntime.stopRequested,
    highestStoredId: highestId,
    nextStartId: highestId + 1,
    nextDueAt,
    config: {
      enabled: AUTO_SCAN_ENABLED,
      intervalHours: AUTO_SCAN_INTERVAL_HOURS,
      maxConsecutiveMisses: AUTO_SCAN_MAX_MISSES,
      batchSize: AUTO_SCAN_BATCH_SIZE,
      workers: AUTO_SCAN_WORKERS,
    },
  };
}
function scanIsDue() {
  if (!AUTO_SCAN_ENABLED || scanRuntime.running) return false;
  const state = readScanState();
  const ref = state.lastStatus === 'error' ? state.lastStartedAt : (state.lastCompletedAt || state.lastStartedAt);
  if (!ref) return true;
  const refMs = new Date(ref).getTime();
  if (!Number.isFinite(refMs)) return true;
  const waitMs = state.lastStatus === 'error' ? AUTO_SCAN_ERROR_RETRY_MS : AUTO_SCAN_INTERVAL_MS;
  return Date.now() - refMs >= waitMs;
}
async function runVideoScan(trigger = 'scheduled') {
  if (scanRuntime.running) return scanStatus();
  if (!infinityCookie()) {
    const now = nowIso();
    return writeScanState({
      running: false,
      trigger,
      lastStatus: 'error',
      lastError: 'Infinity cookie is not configured. Save it in the admin panel.',
      lastStartedAt: now,
      lastCompletedAt: null,
    });
  }

  scanRuntime.running = true;
  scanRuntime.stopRequested = false;
  const startId = highestStoredVideoId() + 1;
  let nextId = startId;
  let checked = 0;
  let hits = 0;
  let missStreak = 0;
  let lastCheckedId = startId - 1;
  let lastHitId = null;
  const startedAt = nowIso();

  writeScanState({
    running: true,
    trigger,
    lastStatus: 'running',
    lastError: null,
    lastStartedAt: startedAt,
    lastCompletedAt: null,
    lastStartId: startId,
    lastCheckedId,
    lastHitId: null,
    lastHitsFound: 0,
    lastCheckedCount: 0,
    lastMissStreak: 0,
  });
  console.log(`[auto-scan] ${trigger} scan starting at Video ID ${startId}`);

  try {
    while (missStreak < AUTO_SCAN_MAX_MISSES && !scanRuntime.stopRequested) {
      const batchIds = Array.from({ length: AUTO_SCAN_BATCH_SIZE }, (_, i) => nextId + i);
      const results = await mapWithConcurrency(batchIds, AUTO_SCAN_WORKERS, fetchVideoForScan);
      const hitsToSave = [];
      let fatalError = null;

      for (let i = 0; i < batchIds.length; i += 1) {
        if (scanRuntime.stopRequested || missStreak >= AUTO_SCAN_MAX_MISSES) break;
        const videoId = batchIds[i];
        const result = results[i];
        lastCheckedId = videoId;

        if (!result || !result.ok) {
          fatalError = result && result.error ? result.error : new Error(`Video ID ${videoId} failed.`);
          break;
        }

        checked += 1;
        if (result.value.kind === 'hit') {
          missStreak = 0;
          hits += 1;
          lastHitId = videoId;
          hitsToSave.push(result.value.record);
          console.log(`[auto-scan] hit ${videoId} | ${result.value.record.video || 'resource found'}`);
        } else {
          missStreak += 1;
          if (missStreak === 1 || missStreak % 100 === 0 || missStreak === AUTO_SCAN_MAX_MISSES) {
            console.log(`[auto-scan] miss ${videoId} | streak ${missStreak}/${AUTO_SCAN_MAX_MISSES}`);
          }
        }
      }

      if (hitsToSave.length) upsertCourseRecords(hitsToSave);
      writeScanState({
        running: true,
        trigger,
        lastStatus: 'running',
        lastCheckedId,
        lastHitId,
        lastHitsFound: hits,
        lastCheckedCount: checked,
        lastMissStreak: missStreak,
      });

      if (fatalError) throw fatalError;
      nextId = batchIds[batchIds.length - 1] + 1;
    }

    const stopped = scanRuntime.stopRequested;
    const completedAt = nowIso();
    const finalState = writeScanState({
      running: false,
      trigger,
      lastStatus: stopped ? 'stopped' : 'completed',
      lastError: null,
      lastCompletedAt: completedAt,
      lastCheckedId,
      lastHitId,
      lastHitsFound: hits,
      lastCheckedCount: checked,
      lastMissStreak: missStreak,
    });
    console.log(`[auto-scan] ${stopped ? 'stopped' : 'completed'} | checked ${checked} | hits ${hits} | final miss streak ${missStreak}`);
    return finalState;
  } catch (error) {
    const failedAt = nowIso();
    console.error('[auto-scan] failed:', error);
    return writeScanState({
      running: false,
      trigger,
      lastStatus: 'error',
      lastError: error && error.message ? error.message : 'Scan failed.',
      lastCompletedAt: failedAt,
      lastCheckedId,
      lastHitId,
      lastHitsFound: hits,
      lastCheckedCount: checked,
      lastMissStreak: missStreak,
    });
  } finally {
    scanRuntime.running = false;
    scanRuntime.stopRequested = false;
    scanRuntime.promise = null;
  }
}
function startVideoScan(trigger = 'manual') {
  if (scanRuntime.running) return false;
  scanRuntime.promise = runVideoScan(trigger).catch(error => console.error('[auto-scan] unhandled:', error));
  return true;
}
function checkScheduledScan() {
  if (scanIsDue()) startVideoScan('scheduled');
}

const routes = {
  login: path.join(PUBLIC, 'login.html'),
  app: path.join(PUBLIC, 'app.html'),
  admin: path.join(PUBLIC, 'admin.html'),
  css: path.join(PUBLIC, 'assets', 'site.css'),
  appJs: path.join(PUBLIC, 'assets', 'app.js'),
  loginJs: path.join(PUBLIC, 'assets', 'login.js'),
  adminJs: path.join(PUBLIC, 'assets', 'admin.js'),
};

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') return json(res, 200, { ok: true });

    if (req.method === 'GET' && pathname === '/assets/site.css') return sendFile(res, routes.css, 'text/css; charset=utf-8', 'no-store');
    if (req.method === 'GET' && pathname === '/assets/app.js') return sendFile(res, routes.appJs, 'text/javascript; charset=utf-8', 'no-store');
    if (req.method === 'GET' && pathname === '/assets/login.js') return sendFile(res, routes.loginJs, 'text/javascript; charset=utf-8', 'no-store');
    if (req.method === 'GET' && pathname === '/assets/admin.js') return sendFile(res, routes.adminJs, 'text/javascript; charset=utf-8', 'no-store');

    if (req.method === 'GET' && (pathname === '/' || pathname === '/login')) {
      if (anyAccess(req)) return redirect(res, '/app');
      return sendFile(res, routes.login, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const rl = rateLimit(req, 'access-login', 8);
      if (rl.blocked) return json(res, 429, { error: 'Too many attempts. Try again later.' }, { 'Retry-After': rl.retryAfter });
      const body = await readJsonBody(req);
      const entered = normalizeCode(body.code);
      if (!entered) return json(res, 400, { error: 'Enter an access code.' });
      const digest = codeDigest(entered);
      const codes = readCodes();
      const code = codes.find(c => safeEqual(c.digest || '', digest));
      if (!code || !codeCanLogin(code)) return json(res, 401, { error: 'That code is invalid, expired, disabled, or has no uses left.' });
      code.uses = Number(code.uses || 0) + 1;
      code.lastUsedAt = nowIso();
      writeCodes(codes);
      clearLimit(req, 'access-login');
      const token = signSession({ role: 'user', codeId: code.id, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('cs_session', token, { maxAge: 7 * 24 * 60 * 60 }) });
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('cs_session', '', { maxAge: 0 }) });
    }

    if (req.method === 'GET' && pathname === '/app') {
      if (!anyAccess(req)) return redirect(res, '/');
      return sendFile(res, routes.app, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const access = anyAccess(req);
      if (!access) return json(res, 401, { authenticated: false });
      if (access.role === 'admin') return json(res, 200, { authenticated: true, role: 'admin', label: 'Administrator' });
      return json(res, 200, { authenticated: true, role: 'user', label: access.code.label || `Code ••••${access.code.hint || ''}` });
    }

    if (req.method === 'GET' && pathname === '/api/courses') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      return sendFile(res, COURSES_FILE, 'application/json; charset=utf-8');
    }


    if (req.method === 'GET' && pathname === '/api/courses/version') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      let version = 'missing';
      try {
        const stat = fs.statSync(COURSES_FILE);
        version = `${Math.floor(stat.mtimeMs)}-${stat.size}`;
      } catch {}
      return json(res, 200, { version, scanRunning: scanRuntime.running });
    }

    if (req.method === 'GET' && pathname === '/api/playback/guide') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      const guide = readPlaybackGuide();
      return json(res, 200, guide.enabled ? guide : { enabled: false });
    }

    if (req.method === 'GET' && pathname === '/api/playback/settings') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      const settings = readPlaybackSettings();
      return json(res, 200, { ...settings, actualOrigin: null });
    }

    if (req.method === 'POST' && pathname === '/api/videos/refresh') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' });
      const rl = rateLimit(req, 'student-video-refresh', 8, 60 * 1000);
      if (rl.blocked) return json(res, 429, { error: 'Too many refresh attempts. Try again in a minute.' }, { 'Retry-After': rl.retryAfter });
      const body = await readJsonBody(req);
      const result = await refreshExistingVideo(body.videoId);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/labels') {
      if (!anyAccess(req)) return json(res, 401, { error: 'Authentication required.' });
      return json(res, 200, readLabels());
    }

    if (req.method === 'GET' && pathname === '/admin') {
      return sendFile(res, routes.admin, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && pathname === '/api/admin/session') {
      return json(res, 200, { authenticated: Boolean(adminSession(req)) });
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const rl = rateLimit(req, 'admin-login', 6);
      if (rl.blocked) return json(res, 429, { error: 'Too many attempts. Try again later.' }, { 'Retry-After': rl.retryAfter });
      const body = await readJsonBody(req);
      const enteredDigest = adminDigest(body.password || '');
      if (!safeEqual(enteredDigest, EXPECTED_ADMIN_DIGEST)) return json(res, 401, { error: 'Wrong admin password.' });
      clearLimit(req, 'admin-login');
      const token = signSession({ role: 'admin', iat: Date.now(), exp: Date.now() + 8 * 60 * 60 * 1000 });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('cs_admin', token, { maxAge: 8 * 60 * 60 }) });
    }

    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('cs_admin', '', { maxAge: 0 }) });
    }

    if (pathname.startsWith('/api/admin/') && !adminSession(req)) {
      return json(res, 401, { error: 'Admin authentication required.' });
    }
    if (pathname.startsWith('/api/admin/') && ['POST','PATCH','DELETE','PUT'].includes(req.method) && !sameOrigin(req)) {
      return json(res, 403, { error: 'Cross-site request blocked.' });
    }

    if (req.method === 'GET' && pathname === '/api/admin/labels') {
      const labels = readLabels();
      return json(res, 200, { ...labels, stats: courseLabelStats() });
    }

    if (req.method === 'PUT' && pathname === '/api/admin/labels') {
      const body = await readJsonBody(req, 128 * 1024);
      const labels = {
        subjects: cleanLabelMap(body.subjects),
        teachers: cleanLabelMap(body.teachers),
      };
      writeLabels(labels);
      return json(res, 200, { ok: true, ...labels, stats: courseLabelStats() });
    }

    if (req.method === 'GET' && pathname === '/api/admin/playback/guide') {
      return json(res, 200, readPlaybackGuide());
    }
    if (req.method === 'PUT' && pathname === '/api/admin/playback/guide') {
      const body = await readJsonBody(req, 36 * 1024);
      return json(res, 200, savePlaybackGuide(body));
    }

    if (req.method === 'GET' && pathname === '/api/admin/playback/settings') {
      return json(res, 200, readPlaybackSettings());
    }
    if (req.method === 'PUT' && pathname === '/api/admin/playback/settings') {
      const body = await readJsonBody(req);
      return json(res, 200, savePlaybackSettings(body));
    }

    if (req.method === 'GET' && pathname === '/api/admin/videos/embed') {
      const row = getVideoForAdmin(url.searchParams.get('videoId'));
      return json(res, 200, { videoId: row.id, videoName: row.video || row.topic || '', embedUrl: row.embedUrl || '', embedManual: Boolean(row.embedManual) });
    }
    if (req.method === 'PUT' && pathname === '/api/admin/videos/embed') {
      const body = await readJsonBody(req, 16 * 1024);
      const row = setVideoEmbed(body.videoId, body.embedUrl);
      return json(res, 200, { ok: true, videoId: row.id, videoName: row.video || row.topic || '', embedUrl: row.embedUrl || '', embedManual: Boolean(row.embedManual) });
    }

    if (req.method === 'GET' && pathname === '/api/admin/infinity/status') {
      return json(res, 200, infinityAuthStatus());
    }

    if (req.method === 'PUT' && pathname === '/api/admin/infinity/cookie') {
      if (process.env.INFINITY_COOKIE) {
        return json(res, 409, { error: 'INFINITY_COOKIE is set in the server environment. Remove it there before managing the cookie from this panel.' });
      }
      const body = await readJsonBody(req, 20 * 1024);
      saveInfinityCookie(body.cookie);
      return json(res, 200, { ok: true, ...infinityAuthStatus() });
    }

    if (req.method === 'POST' && pathname === '/api/admin/videos/fetch') {
      const rl = rateLimit(req, 'admin-video-fetch', 30, 60 * 1000);
      if (rl.blocked) return json(res, 429, { error: 'Too many fetch requests. Wait a minute and try again.' }, { 'Retry-After': rl.retryAfter });
      const body = await readJsonBody(req);
      const result = await fetchAndStoreVideo(body.videoId);
      return json(res, result.action === 'added' ? 201 : 200, { ok: true, ...result });
    }


    if (req.method === 'GET' && pathname === '/api/admin/scan/status') {
      return json(res, 200, scanStatus());
    }

    if (req.method === 'POST' && pathname === '/api/admin/scan/run') {
      if (scanRuntime.running) return json(res, 409, { error: 'A scan is already running.', ...scanStatus() });
      const started = startVideoScan('manual');
      return json(res, 202, { ok: started, ...scanStatus() });
    }

    if (req.method === 'POST' && pathname === '/api/admin/scan/stop') {
      if (!scanRuntime.running) return json(res, 409, { error: 'No scan is currently running.', ...scanStatus() });
      scanRuntime.stopRequested = true;
      return json(res, 202, { ok: true, message: 'Stop requested. The current batch will finish first.', ...scanStatus() });
    }

    if (req.method === 'GET' && pathname === '/api/admin/codes') {
      const codes = readCodes().map(publicCode).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(res, 200, { codes });
    }

    if (req.method === 'POST' && pathname === '/api/admin/codes') {
      const body = await readJsonBody(req);
      const custom = body.code ? normalizeCode(body.code) : '';
      const plaintext = custom || generateAccessCode();
      if (!/^[A-Z0-9_-]{6,64}$/.test(plaintext)) {
        return json(res, 400, { error: 'Code must be 6–64 characters and use letters, numbers, hyphens, or underscores.' });
      }
      const maxUses = body.maxUses === '' || body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
      if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000)) {
        return json(res, 400, { error: 'Max uses must be blank or a positive whole number.' });
      }
      const expiresAt = validExpiry(body.expiresAt);
      if (expiresAt === undefined) return json(res, 400, { error: 'Invalid expiry date.' });
      const codes = readCodes();
      const digest = codeDigest(plaintext);
      if (codes.some(c => safeEqual(c.digest || '', digest))) return json(res, 409, { error: 'That access code already exists.' });
      const item = {
        id: crypto.randomUUID(),
        label: String(body.label || '').trim().slice(0, 80) || 'Access code',
        digest,
        hint: plaintext.slice(-4),
        enabled: true,
        uses: 0,
        maxUses,
        expiresAt,
        createdAt: nowIso(),
        lastUsedAt: null,
      };
      codes.push(item);
      writeCodes(codes);
      return json(res, 201, { code: plaintext, record: publicCode(item) });
    }

    const toggleMatch = pathname.match(/^\/api\/admin\/codes\/([^/]+)\/toggle$/);
    if (req.method === 'POST' && toggleMatch) {
      const id = decodeURIComponent(toggleMatch[1]);
      const codes = readCodes();
      const item = codes.find(c => c.id === id);
      if (!item) return json(res, 404, { error: 'Code not found.' });
      item.enabled = !item.enabled;
      writeCodes(codes);
      return json(res, 200, { record: publicCode(item) });
    }

    const resetMatch = pathname.match(/^\/api\/admin\/codes\/([^/]+)\/reset-uses$/);
    if (req.method === 'POST' && resetMatch) {
      const id = decodeURIComponent(resetMatch[1]);
      const codes = readCodes();
      const item = codes.find(c => c.id === id);
      if (!item) return json(res, 404, { error: 'Code not found.' });
      item.uses = 0;
      item.lastUsedAt = null;
      writeCodes(codes);
      return json(res, 200, { record: publicCode(item) });
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/codes\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const id = decodeURIComponent(deleteMatch[1]);
      const codes = readCodes();
      const idx = codes.findIndex(c => c.id === id);
      if (idx < 0) return json(res, 404, { error: 'Code not found.' });
      codes.splice(idx, 1);
      writeCodes(codes);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return json(res, err.status || 500, { error: err.status ? err.message : 'Server error.' });
    res.end();
  }
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Secure Course Search running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`[auto-scan] ${AUTO_SCAN_ENABLED ? 'enabled' : 'disabled'} | every ${AUTO_SCAN_INTERVAL_HOURS}h | stop after ${AUTO_SCAN_MAX_MISSES} consecutive misses`);
  if (AUTO_SCAN_ENABLED) {
    setTimeout(checkScheduledScan, 15 * 1000).unref();
    setInterval(checkScheduledScan, 60 * 1000).unref();
  }
});

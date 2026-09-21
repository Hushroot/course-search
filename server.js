'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
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

fs.mkdirSync(STATE_DIR, { recursive: true });
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]\n');
if (!fs.existsSync(LABELS_FILE)) {
  if (fs.existsSync(BUNDLED_LABELS_FILE)) fs.copyFileSync(BUNDLED_LABELS_FILE, LABELS_FILE);
  else fs.writeFileSync(LABELS_FILE, '{\n  \"subjects\": {},\n  \"teachers\": {}\n}\n');
}

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'production';

if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.startsWith('replace-with-')) {
  console.error('ADMIN_PASSWORD must be set to a unique password with at least 12 characters.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith('replace-with-')) {
  console.error('SESSION_SECRET must be set to a random secret with at least 32 characters.');
  process.exit(1);
}

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
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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
});

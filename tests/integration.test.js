'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AuthStore } = require('../lib/auth-store');
const root = path.resolve(__dirname, '..');
const key = crypto.randomBytes(32).toString('base64');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('mocked provider: isolated viewer login, playback, lifecycle and admin regressions', async t => {
  const state = fs.mkdtempSync('/tmp/opencode/course-v110-');
  const port = 33000 + crypto.randomInt(10000);
  const base = `http://127.0.0.1:${port}`;
  const events = []; let logs = '';
  fs.writeFileSync(path.join(state, 'infinity-auth.json'), JSON.stringify({ cookie: 'test-admin-cookie', updatedAt: '2026-01-01' }), { mode: 0o600 });
  const env = { ...process.env, PORT: String(port), STATE_DIR: state, ADMIN_PASSWORD: 'test-admin-password-long', SESSION_SECRET: 'test-session-secret-long-enough-to-use-123456', INFINITY_AUTH_KEY: key, COOKIE_SECURE: 'false', APP_ORIGIN: base, TRUST_PROXY: 'true', NODE_ENV: 'test', AUTO_SCAN_ENABLED: 'false', INFINITY_COOKIE: '' };
  let server;
  function start() {
    server = spawn(process.execPath, ['--require', './tests/provider-mock.cjs', 'server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    server.on('message', value => events.push(value));
    server.stdout.on('data', x => logs += x); server.stderr.on('data', x => logs += x);
  }
  async function stop() { if (server && server.exitCode === null) { const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; } }
  t.after(async () => { await stop(); fs.rmSync(state, { recursive: true, force: true }); });
  async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await pause(50); } throw new Error('Server unavailable: ' + logs); }
  async function request(route, viewer, body, extra = {}) {
    const headers = { ...(viewer ? { Cookie: viewer.cookie, 'X-CSRF-Token': viewer.csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra };
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    return { status: response.status, data, headers: response.headers };
  }
  async function viewerLogin() {
    const login = await request('/api/login', null, { code: 'TESTSTUDENT77' }); assert.equal(login.status, 200);
    const viewer = { cookie: login.headers.get('set-cookie').split(';')[0] };
    const session = await request('/api/session', viewer); viewer.csrf = session.data.csrfToken;
    viewer.sid = JSON.parse(Buffer.from(decodeURIComponent(viewer.cookie.split('=')[1]).split('.')[0], 'base64url')).sid;
    return viewer;
  }
  const connect = (viewer, email) => request('/api/infinity/connect', viewer, { email: `${email}@example.test`, password: 'synthetic-password', visitorId: 'a'.repeat(64) });
  start(); await ready();
  const adminLogin = await request('/api/admin/login', null, { password: env.ADMIN_PASSWORD }); assert.equal(adminLogin.status, 200);
  const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
  admin.csrf = (await request('/api/session', admin)).data.csrfToken;
  assert.equal((await request('/api/admin/codes', admin, { label: 'Student test', code: 'TESTSTUDENT77' })).status, 201);
  const alice = await viewerLogin(), bob = await viewerLogin();

  await t.test('unique sessions for one access code; unauthenticated and cross-site rejection', async () => {
    assert.notEqual(alice.sid, bob.sid); assert.match(alice.sid, /^[a-f0-9]{64}$/);
    for (const route of ['/api/infinity/connect','/api/infinity/disconnect','/api/videos/playback','/api/videos/refresh']) assert.equal((await request(route, null, {})).status, 401);
    assert.equal((await request('/api/infinity/connect', alice, {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/infinity/disconnect', alice, {}, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await request('/api/logout', alice, {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  });
  await t.test('legacy admin migration encrypted and student catalog never exposes playback sources', async () => {
    const legacy = fs.readFileSync(path.join(state, 'infinity-auth.json'), 'utf8'); assert.ok(!legacy.includes('test-admin-cookie'));
    assert.equal(new AuthStore(path.join(state, 'private-auth'), key).read('admin').cookie, 'test-admin-cookie');
    const result = await request('/api/courses', alice); assert.equal(result.status, 200);
    const videos = result.data.filter(x => x.isVideo); assert.ok(videos.length > 2000);
    for (const row of videos) for (const field of ['download','path','embedUrl']) assert.equal(row[field], undefined);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
  await t.test('no admin-cookie fallback, missing resource rejected before upstream', async () => {
    assert.equal((await request('/api/videos/playback', alice, { videoId: 13112 })).data.code, 'RECONNECT_REQUIRED');
    assert.equal((await request('/api/videos/playback', alice, { videoId: 99999999 })).status, 404);
    assert.equal(events.filter(e => e.route.includes('get-video')).length, 0);
  });
  await t.test('initial cookies, CSRF form, updated cookies, positive protected-page validation', async () => {
    const connected = await Promise.all([connect(alice, 'alice'), connect(bob, 'bob')]);
    assert.ok(connected.every(result => result.status === 200));
    const submissions = events.filter(e => e.method === 'POST'); assert.ok(submissions.every(e => e.cookie.includes('initial=one')));
    const checks = events.filter(e => e.route === '/student_dashboard/home'); assert.ok(checks.length >= 4);
    assert.ok(checks.every(e => e.cookie.includes('initial=two') && !e.cookie.includes('discard=')));
    assert.equal((await request('/api/infinity/status', alice)).data.connected, true);
    const invalid = await viewerLogin(); assert.equal((await connect(invalid, 'noproof')).data.code, 'AUTH_UNVERIFIED'); assert.equal((await request('/api/infinity/status', invalid)).data.connected, false);
  });
  const originalCourses = fs.readFileSync(path.join(state, 'courses.json'), 'utf8');
  await t.test('concurrent viewers, cookie rotation, every Watch and refresh are fresh; no database writes', async () => {
    const [a, b] = await Promise.all([request('/api/videos/playback', alice, { videoId: 13112 }), request('/api/videos/playback', bob, { videoId: 13112 })]);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.match(a.data.url, /alice\.mp4/); assert.match(b.data.url, /bob\.mp4/);
    assert.equal(a.headers.get('cache-control'), 'no-store'); assert.deepEqual(Object.keys(a.data).sort(), ['kind','url','videoId']);
    const again = await request('/api/videos/refresh', alice, { videoId: 13112 }); assert.equal(again.status, 200); assert.equal(again.data.url, a.data.url);
    const playbackEvents = events.filter(e => e.route.includes('get-video')); assert.equal(playbackEvents.length, 3);
    assert.ok(playbackEvents.every(e => e.cookie.includes('session=account') && !e.cookie.includes('test-admin-cookie') && e.ajax === 'XMLHttpRequest' && e.accept === 'application/json, text/plain, */*'));
    assert.notEqual(playbackEvents[0].cookie, playbackEvents[2].cookie);
    assert.ok(playbackEvents.every(e => e.search === '?order=1&order_topic=1&count_completed_files=0&count_files=1'));
    assert.equal(fs.readFileSync(path.join(state, 'courses.json'), 'utf8'), originalCourses);
  });
  await t.test('encrypted records, restrictive permissions, tampering and swapped identities fail closed', async () => {
    for (const name of fs.readdirSync(path.join(state, 'private-auth'))) {
      const file = path.join(state, 'private-auth', name); const text = fs.readFileSync(file, 'utf8');
      for (const secret of ['synthetic-password','test-admin-cookie','session=','account','alice@example']) assert.ok(!text.includes(secret));
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.equal(fs.statSync(path.join(state, 'private-auth')).mode & 0o777, 0o700);
    const file = path.join(state, 'private-auth', alice.sid + '.json'); const original = fs.readFileSync(file);
    fs.copyFileSync(path.join(state, 'private-auth', bob.sid + '.json'), file);
    assert.equal((await request('/api/infinity/status', alice)).status, 503);
    fs.writeFileSync(file, original);
    const tampered = JSON.parse(original); tampered.tag = Buffer.alloc(16).toString('base64'); fs.writeFileSync(file, JSON.stringify(tampered));
    assert.equal((await request('/api/videos/playback', alice, { videoId: 13112 })).status, 503);
    fs.writeFileSync(file, original);
  });
  await t.test('invalid credentials, challenges, device limits, token rejection, foreign redirects and login rate limits', async () => {
    for (const [email, code] of [['invalid','INVALID_CREDENTIALS'],['challenge','PROVIDER_CHALLENGE'],['device','PROVIDER_DEVICE'],['token','PROVIDER_TOKEN'],['outside','PROVIDER_REDIRECT'],['rate','PROVIDER_RATE_LIMIT']]) {
      // Distinct synthetic IPs exercise provider classifications independently of local limits.
      const viewer = await viewerLogin();
      const result = await request('/api/infinity/connect', viewer, { email: email+'@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': email });
      assert.equal(result.data.code, code); assert.equal((await request('/api/infinity/status', viewer)).data.connected, false);
    }
    const viewer = await viewerLogin();
    for (let i=0;i<5;i++) await request('/api/infinity/connect', viewer, { email: 'invalid@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': 'limit'+i });
    const limited = await request('/api/infinity/connect', viewer, {}, { 'X-Real-IP': 'limit-last' }); assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
  });
  await t.test('expiry, authorization denial and provider errors never expose response HTML', async () => {
    for (const [email, code] of [['expired','RECONNECT_REQUIRED'],['denied','VIDEO_DENIED'],['unavailable','PROVIDER_UNAVAILABLE'],['malformed','PROVIDER_FORMAT']]) {
      const viewer = await viewerLogin();
      assert.equal((await request('/api/infinity/connect', viewer, { email: email+'@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': email+'-login' })).status, 200);
      const result = await request('/api/videos/playback', viewer, { videoId: 13112 }); assert.equal(result.data.code, code);
      assert.ok(!JSON.stringify(result.data).includes('<script>'));
      if (email === 'expired') assert.equal((await request('/api/infinity/status', viewer)).data.connected, false);
    }
    const store = new AuthStore(path.join(state, 'private-auth'), key); const record = store.read(bob.sid); store.write(bob.sid, { ...record, connectedUntil: Date.now()-1 });
    assert.equal((await request('/api/videos/playback', bob, { videoId: 13112 })).data.code, 'RECONNECT_REQUIRED'); assert.equal(store.read(bob.sid).jar, undefined);
  });
  await t.test('disconnect during login and playback cannot recreate authentication or return links', async () => {
    const viewer = await viewerLogin();
    const pending = request('/api/infinity/connect', viewer, { email: 'slow@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': 'slow-login' });
    await pause(80); assert.equal((await request('/api/infinity/disconnect', viewer, {})).status, 200);
    assert.equal((await pending).data.code, 'CONNECTION_CHANGED'); assert.equal((await request('/api/infinity/status', viewer)).data.connected, false);
    assert.equal((await request('/api/infinity/connect', viewer, { email: 'slow@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': 'slow-login-2' })).status, 200);
    const watch = request('/api/videos/playback', viewer, { videoId: 13112 });
    await pause(80); assert.equal((await request('/api/infinity/disconnect', viewer, {})).status, 200);
    const result = await watch; assert.notEqual(result.status, 200); assert.equal(result.data.url, undefined);
    assert.equal(new AuthStore(path.join(state, 'private-auth'), key).read(viewer.sid).jar, undefined);
    assert.equal((await request('/api/infinity/connect', viewer, { email: 'slow@example.test', password: 'synthetic-password', visitorId: 'a'.repeat(64) }, { 'X-Real-IP': 'slow-login-3' })).status, 200);
    const beforeLogout = request('/api/videos/playback', viewer, { videoId: 13112 });
    await pause(80); assert.equal((await request('/api/logout', viewer, {})).status, 200);
    assert.equal((await beforeLogout).data.url, undefined);
    assert.equal((await request('/api/session', viewer)).status, 401);
    assert.equal(new AuthStore(path.join(state, 'private-auth'), key).read(viewer.sid).jar, undefined);
  });
  await t.test('playback rate limit and logout revocation survive restart; migration is idempotent', async () => {
    const viewer = await viewerLogin();
    for (let i=0;i<30;i++) await request('/api/videos/playback', viewer, { videoId: 13112 }, { 'X-Real-IP': 'play-limit-'+i });
    assert.equal((await request('/api/videos/playback', viewer, { videoId: 13112 }, { 'X-Real-IP': 'play-limit-last' })).status, 429);
    assert.equal((await request('/api/logout', alice, {})).status, 200);
    assert.equal((await request('/api/session', alice)).status, 401);
    assert.equal(new AuthStore(path.join(state, 'private-auth'), key).read(alice.sid).jar, undefined);
    await stop(); start(); await ready(); assert.equal((await request('/api/session', alice)).status, 401);
    assert.equal((await request('/api/admin/infinity/status', admin)).data.configured, true);
    const both = await viewerLogin();
    assert.equal((await request('/api/logout', both, {}, { Cookie: both.cookie+'; '+admin.cookie })).status, 200);
    assert.equal((await request('/api/session', both)).status, 401);
    assert.equal((await request('/api/admin/session', admin)).data.authenticated, true);
  });
  await t.test('admin metadata path stays separate; editable guide, embeds and labels preserved', async () => {
    assert.equal((await request('/api/admin/videos/fetch', admin, { videoId: 13112 })).status, 200);
    assert.equal(events.filter(e=>e.route.includes('get-file')).at(-1).cookie, 'test-admin-cookie');
    const student = await viewerLogin(); assert.equal((await request('/api/admin/labels', student)).status, 401);
    const guide = { enabled: true, title: 'Custom help', introduction: 'Authorized use only', steps: '1. Reconnect', code: 'print("Hello")' };
    const put = await fetch(base+'/api/admin/playback/guide',{method:'PUT',headers:{Cookie:admin.cookie,'Content-Type':'application/json'},body:JSON.stringify(guide)}); assert.equal(put.status,200);
    assert.equal((await request('/api/playback/guide',student)).data.title,'Custom help');
    const embed = 'https://iframe.mediadelivery.net/embed/386/54864774-bc13-417a-862f-70e2a044d030';
    const assigned=await fetch(base+'/api/admin/videos/embed',{method:'PUT',headers:{Cookie:admin.cookie,'Content-Type':'application/json'},body:JSON.stringify({videoId:13112,embedUrl:embed})}); assert.equal(assigned.status,200);
    const rows=(await request('/api/courses',student)).data; assert.equal(rows.find(x=>x.id===13112).embedUrl,undefined);
  });
  for (const secret of ['synthetic-password','csrf&initial','test-admin-cookie','token=synthetic','private provider response']) assert.ok(!logs.includes(secret));
});

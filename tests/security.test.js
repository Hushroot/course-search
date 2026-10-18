'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AuthStore } = require('../lib/auth-store');
const { CookieJar, tokenFromPage, extractPlayback, request, login, playback } = require('../lib/infinity');
const { PlaybackRequestState } = require('../public/assets/playback-state');
const hosts = new Set(['cdn.example.test']);
const embed = 'https://iframe.mediadelivery.net/embed/386/54864774-bc13-417a-862f-70e2a044d030';

test('security-token parsing accepts form attribute order/entities and rejects absent token', () => {
  assert.equal(tokenFromPage('<input value="one&amp;two" type="hidden" name="_token">'), 'one&two');
  assert.equal(tokenFromPage("<input name='_token' value='valid'>"), 'valid');
  assert.throws(() => tokenFromPage('<meta name="csrf-token" content="not-the-form">'), { code: 'PROVIDER_FORMAT' });
});
test('cookie jar handles multiple Set-Cookie, expiration, path precedence and domain isolation', () => {
  const jar = new CookieJar();
  const headers = new Headers();
  for (const c of ['root=a; Path=/; Secure', 'scoped=b; Path=/student_dashboard; Secure', 'root=c; Path=/; Secure', 'expires=d; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/', 'bad=e; Domain=evil.example; Path=/', 'parent=f; Domain=net; Path=/']) headers.append('Set-Cookie', c);
  jar.update(headers, 'https://infinityschool.net/login');
  assert.equal(jar.header('https://infinityschool.net/student_dashboard/home'), 'scoped=b; root=c; expires=d');
  assert.equal(jar.header('https://infinityschool.net/student_dashboard_evil'), 'root=c; expires=d');
  jar.update(new Headers([['Set-Cookie', 'root=; Path=/; Max-Age=0; Expires=Wed, 01 Jan 2031 00:00:00 GMT']]), 'https://infinityschool.net/login');
  assert.equal(jar.header('https://infinityschool.net/login'), 'expires=d');
  assert.throws(() => jar.header('https://evil.example'), { code: 'PROVIDER_REDIRECT' });
});
test('all supported video fields and official iframe extraction, without executing HTML', () => {
  const url = 'https://cdn.example.test/video.mp4?token=current&other=1';
  for (const field of ['download_link','download_url','url']) assert.deepEqual(extractPlayback({video:{[field]:url}}, hosts), {kind:'video',url});
  for (const field of ['download_link','download_url']) assert.equal(extractPlayback({[field]:url},hosts).url,url);
  assert.deepEqual(extractPlayback({video:{embed:`<iframe src="${embed}?a=1&amp;b=2"></iframe><script>throw 'never run'</script>`}}, hosts), {kind:'embed',url:embed+'?a=1&b=2'});
  assert.equal(extractPlayback({view:`<iframe src='${embed}'></iframe>`},hosts).kind,'embed');
  for(const unsafe of ['javascript:alert(1)','http://cdn.example.test/a.mp4','https://cdn.example.test.evil/a.mp4','https://u:p@cdn.example.test/a.mp4','https://cdn.example.test:444/a.mp4','https://cdn.example.test/a.mp4#x','https://127.0.0.1/a.mp4','https://iframe.mediadelivery.net/evil','<iframe src="https://evil.example/embed"></iframe>']) assert.throws(()=>extractPlayback({video:{download_url:unsafe}},hosts),{code:'NO_PLAYBACK_SOURCE'});
});
test('authenticated encryption, key checks, cleanup and identity binding', t => {
  const dir=fs.mkdtempSync('/tmp/opencode/auth-unit-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const key of [undefined,'','replace-me',crypto.randomBytes(31).toString('base64')])assert.throws(()=>new AuthStore(dir,key),/INFINITY_AUTH_KEY/);
  const key=crypto.randomBytes(32).toString('base64'),store=new AuthStore(dir,key),id='a'.repeat(64),other='b'.repeat(64);
  store.write(id,{exp:Date.now()+60000,generation:2,jar:[{name:'session',value:'synthetic-cookie'}],connectedUntil:Date.now()-1});
  const original=fs.readFileSync(store.file(id),'utf8');assert.ok(!original.includes('synthetic-cookie'));
  fs.copyFileSync(store.file(id),store.file(other));assert.throws(()=>store.read(other),{code:'AUTH_STORAGE_INVALID'});
  assert.throws(()=>new AuthStore(dir,crypto.randomBytes(32).toString('base64')).read(id),{code:'AUTH_STORAGE_INVALID'});
  store.cleanup();assert.equal(store.read(id).jar,undefined);assert.equal(store.read(id).generation,3);
  store.write(id,{exp:Date.now()-1,generation:0});store.cleanup();assert.equal(store.read(id),null);
  assert.ok(fs.existsSync(store.file(other)),'unauthenticatable data preserved');
  assert.throws(()=>store.file('../../outside'),/identity/);
});
test('migration fails safely with missing key, wrong key or malformed legacy file', t => {
  const root=path.resolve(__dirname,'..');
  const dir=fs.mkdtempSync('/tmp/opencode/migration-unit-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const legacy=path.join(dir,'infinity-auth.json');
  const env={...process.env,STATE_DIR:dir,ADMIN_PASSWORD:'test-admin-password-long',SESSION_SECRET:'test-session-secret-long-enough-to-use-123456',AUTO_SCAN_ENABLED:'false',NODE_ENV:'test',INFINITY_AUTH_KEY:''};
  fs.writeFileSync(legacy,'{"cookie":"synthetic-legacy-cookie"}');
  const run=()=>spawnSync(process.execPath,['server.js'],{cwd:root,env,encoding:'utf8',timeout:3000});
  assert.equal(run().status,1);assert.equal(fs.readFileSync(legacy,'utf8'),'{"cookie":"synthetic-legacy-cookie"}');
  const good=crypto.randomBytes(32).toString('base64');new AuthStore(path.join(dir,'private-auth'),good).write('admin',{cookie:'synthetic-legacy-cookie'});
  env.INFINITY_AUTH_KEY=crypto.randomBytes(32).toString('base64');const wrong=run();assert.equal(wrong.status,1);assert.ok(!wrong.stderr.includes('synthetic-legacy-cookie'));assert.ok(fs.readFileSync(legacy,'utf8').includes('synthetic-legacy-cookie'));
  env.INFINITY_AUTH_KEY=good;fs.writeFileSync(legacy,'{invalid');assert.equal(run().status,1);assert.equal(fs.readFileSync(legacy,'utf8'),'{invalid');
});
test('upstream network failures, rate limits, login format changes, challenges and denial payloads', async t => {
  const original=global.fetch;t.after(()=>{global.fetch=original});
  global.fetch=async()=>{throw new Error('private transport diagnostic')};
  await assert.rejects(request(new CookieJar(),'/login'),{code:'PROVIDER_UNAVAILABLE'});
  global.fetch=async()=>new Response('private',{status:429});await assert.rejects(request(new CookieJar(),'/login'),{code:'PROVIDER_RATE_LIMIT'});
  global.fetch=async()=>new Response('<html>changed</html>',{headers:{'Content-Type':'text/html'}});await assert.rejects(login('test@example.test','synthetic-password','a'.repeat(64)),{code:'PROVIDER_FORMAT'});
  for(const [data,code] of [[{status:401,video:{download_url:'https://cdn.example.test/v.mp4'}},'RECONNECT_REQUIRED'],[{authorized:false,video:{download_url:'https://cdn.example.test/v.mp4'}},'VIDEO_DENIED'],[{view:'يرجى استخدام المتصفح المسموح'},'PROVIDER_DEVICE'],[{message:'verification code required'},'PROVIDER_CHALLENGE']]){
    global.fetch=async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    await assert.rejects(playback([],123,hosts),{code});
  }
  let calls=0;
  global.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.example/steal'}})};
  await assert.rejects(request(new CookieJar(),'/login'),{code:'PROVIDER_REDIRECT'});assert.equal(calls,1);
  global.fetch=async()=>new Response('x'.repeat(2*1024*1024+1));await assert.rejects(request(new CookieJar(),'/login'),{code:'PROVIDER_FORMAT'});
});
test('playback ignores generic lesson wording but preserves explicit provider denial', async t => {
  const original=global.fetch; t.after(()=>{global.fetch=original});
  const url='https://cdn.example.test/video.mp4';
  const successful=[
    {message:'Students can subscribe for course updates',video:{download_url:url}},
    {view:'<div>Permissions and subscription information for this lesson</div>',video:{download_url:url}},
    {message:'How to manage permission and subscribe settings',video:{download_url:url}},
    {message:'This course discusses access denied errors',video:{download_url:url}}
  ];
  for(const data of successful){
    global.fetch=async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    const result=await playback([],123,hosts);
    assert.deepEqual(result.source,{kind:'video',url});
  }
  for(const data of [
    {message:'Access denied: this lesson is restricted',video:{download_url:url}},
    {authorized:false,video:{download_url:url}},
    {denied:true,video:{download_url:url}},
    {success:false,video:{download_url:url}},
    {status:403,video:{download_url:url}}
  ]){
    global.fetch=async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    await assert.rejects(playback([],123,hosts),{code:'VIDEO_DENIED'});
  }
  global.fetch=async()=>new Response('forbidden',{status:403});
  await assert.rejects(playback([],123,hosts),{code:'VIDEO_DENIED'});
});

test('player generations reject old selections, close/reopen of same ID, logout and stale reconnect continuations', () => {
  const state=new PlaybackRequestState();
  const first=state.begin();const second=state.begin();assert.equal(first.signal.aborted,true);assert.equal(state.current(first),false);assert.equal(state.current(second),true);
  state.cancel();assert.equal(state.current(second),false);
  const reopened=state.begin();assert.equal(state.current(first),false);assert.equal(state.current(reopened),true);
  const reconnectGeneration=state.generation;state.cancel();assert.notEqual(state.generation,reconnectGeneration);
});

test('cookie deletion at Unix epoch is honored for new and restored jars', () => {
  const jar = new CookieJar();
  jar.update(new Headers([['Set-Cookie', 'session=old; Path=/; Secure']]), 'https://infinityschool.net/login');
  jar.update(new Headers([['Set-Cookie', 'session=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure']]), 'https://infinityschool.net/login');
  assert.equal(jar.header('https://infinityschool.net/student_dashboard/home'), '');
  assert.equal(jar.cookies.length, 0);
  const restored = new CookieJar([{name:'session',value:'old',domain:'infinityschool.net',path:'/',secure:true,expires:0}]);
  assert.equal(restored.header('https://infinityschool.net/student_dashboard/home'), '');
});

const busyResponse = (retryAfter = '0') => new Response(JSON.stringify({code:'REQUEST_BUSY'}), {status:429,headers:{'Retry-After':retryAfter,'Content-Type':'application/json'}});
test('playback sends one request and never retries busy or rate limited responses', async () => {
  const state = new PlaybackRequestState(); const selected = state.begin(); let calls = 0;
  const success=await state.fetch(selected,'/test',{},async()=>{calls++;return new Response('{}')});
  assert.equal(success.status,200);assert.equal(calls,1);
  calls=0;
  const limited=await state.fetch(selected,'/test',{},async()=>{calls++;return new Response(JSON.stringify({code:'RATE_LIMIT'}),{status:429})});
  assert.equal(limited.status,429);assert.equal(calls,1);
  calls=0;
  const busy=await state.fetch(selected,'/test',{},async()=>{calls++;return busyResponse('1')});
  assert.equal(busy.status,429);assert.equal(calls,1);
});
test('closing/replacing the player cancels an in-flight playback response', async () => {
  const state=new PlaybackRequestState();const selected=state.begin();let resolveFetch;let calls=0;
  const pending=state.fetch(selected,'/test',{},async()=>{calls++;return new Promise(resolve=>{resolveFetch=resolve})});
  state.begin();
  resolveFetch(new Response('{}'));
  await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

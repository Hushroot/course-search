'use strict';
// Optional browser verification. Playwright is a separate TEST tool, not an app dependency.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const state = fs.mkdtempSync('/tmp/opencode/browser-course-');
  const port = 43000 + crypto.randomInt(10000), base = `http://127.0.0.1:${port}`;
  const events = [], errors = []; let server, browser;
  try {
    server = spawn(process.execPath, ['--require','./tests/provider-mock.cjs','server.js'], { cwd: root, env: { ...process.env, STATE_DIR: state, PORT:String(port), ADMIN_PASSWORD:'browser-admin-password',SESSION_SECRET:'browser-session-secret-at-least-32-characters',INFINITY_AUTH_KEY:crypto.randomBytes(32).toString('base64'),INFINITY_COOKIE:'',APP_ORIGIN:base,COOKIE_SECURE:'false',NODE_ENV:'test',AUTO_SCAN_ENABLED:'false' }, stdio:['ignore','pipe','pipe','ipc'] });
    server.on('message', event => events.push(event));
    for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await wait(50)}
    const admin=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'browser-admin-password'})});
    assert.equal(admin.status,200);
    const code=await fetch(base+'/api/admin/codes',{method:'POST',headers:{'Content-Type':'application/json',Cookie:admin.headers.get('set-cookie').split(';')[0]},body:JSON.stringify({code:'BROWSERSTUDENT',label:'Browser test'})});assert.equal(code.status,201);
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1280,height:850}});
    // Never contact a live media CDN, even though the mock returns realistic URLs.
    await context.route('https://**/*',route=>route.abort());
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.fill('#code','BROWSERSTUDENT');await page.click('button[type="submit"]');await page.waitForURL('**/app');
    await page.click('#browseAllBtn');await page.fill('#q','13112');await page.click('[data-watch="13112"]');
    await page.waitForSelector('#infinityDialog[open]');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'infinityEmail');
    await page.fill('#infinityEmail','alice@example.test');await page.fill('#infinityPassword','synthetic-password');await page.click('#infinitySubmit');
    assert.equal(await page.inputValue('#infinityPassword'),'');
    await page.waitForFunction(()=>!document.querySelector('#infinityDialog').open&&document.querySelector('#watchVideo').getAttribute('src')?.includes('alice.mp4'));
    assert.equal(await page.textContent('#infinityState'),'Infinity connected');
    const secondContext=await browser.newContext();await secondContext.route('https://**/*',route=>route.abort());
    const secondPage=await secondContext.newPage();await secondPage.goto(base);await secondPage.fill('#code','BROWSERSTUDENT');await secondPage.click('button[type="submit"]');await secondPage.waitForURL('**/app');await secondPage.click('#browseAllBtn');
    assert.equal(await secondPage.textContent('#infinityState'),'Not connected');
    await secondPage.fill('#q','13112');await secondPage.click('[data-watch="13112"]');await secondPage.fill('#infinityEmail','bob@example.test');await secondPage.fill('#infinityPassword','synthetic-password');await secondPage.click('#infinitySubmit');await secondPage.waitForFunction(()=>document.querySelector('#watchVideo').getAttribute('src')?.includes('bob.mp4'));
    assert.ok((await page.getAttribute('#watchVideo','src')).includes('alice.mp4'));await secondContext.close();
    const count=()=>events.filter(e=>e.route.includes('get-video')).length;
    const first=count();
    await page.click('#watchRefresh');await page.waitForFunction(()=>!document.querySelector('#watchRefresh').disabled);assert.equal(count(),first+1);
    await page.click('#watchHelpToggle');await page.waitForSelector('#watchHelpPanel:not(.hidden)');assert.ok((await page.textContent('#watchHelpTitle')).length>0);
    await page.click('#watchClose');assert.equal(await page.evaluate(()=>document.activeElement.dataset.watch),'13112');assert.equal(await page.getAttribute('#watchVideo','src'),null);
    await page.click('[data-watch="13112"]');await page.waitForFunction(()=>!document.querySelector('#watchRefresh').disabled);assert.equal(count(),first+2);
    const popupPromise=page.waitForEvent('popup');await page.click('#watchOpenExternal');const popup=await popupPromise;await page.waitForFunction(()=>!document.querySelector('#watchRefresh').disabled);assert.equal(count(),first+3);await popup.close();
    await page.click('#watchClose');await page.click('#infinityDisconnect');await page.waitForFunction(()=>document.querySelector('#infinityState').textContent==='Not connected');
    // Real-browser connect continuation must resume only the still-selected player.
    await page.click('[data-watch="13112"]');await page.fill('#infinityEmail','slow@example.test');await page.fill('#infinityPassword','synthetic-password');await page.click('#infinitySubmit');
    await page.waitForFunction(()=>!document.querySelector('#infinityDialog').open);
    await page.click('#watchClose');await wait(400);assert.equal(await page.getAttribute('#watchVideo','src'),null);assert.ok(await page.locator('#watchOverlay').evaluate(el=>el.classList.contains('hidden')));
    await page.click('[data-watch="13112"]');await page.waitForFunction(()=>!document.querySelector('#watchRefresh').disabled);await page.click('#watchClose');
    // Closing/reopening or switching while the old provider call runs must recover
    // automatically, without allowing the old response to populate the new player.
    for (const selected of [13112,9000]) {
      const before=count();
      await page.evaluate(()=>openWatch(13112));
      for(let i=0;i<100&&count()===before;i++)await wait(5);
      assert.equal(count(),before+1,'first provider request must be in flight');
      await page.evaluate(id=>{closeWatch();openWatch(id)},selected);
      await page.waitForFunction(id=>WATCH_ID===id&&!document.querySelector('#watchRefresh').disabled&&document.querySelector('#watchVideo').getAttribute('src')?.includes('slow.mp4'),selected);
      // Media is deliberately blocked by this test; that error is expected.
      assert.doesNotMatch(await page.textContent('#watchError'), /request is already running/i);
      assert.equal(count(),before+2,'busy response retries exactly one new provider request');
      await page.click('#watchClose');
    }
    await page.click('#infinityConnect');await page.fill('#infinityEmail','expired@example.test');await page.fill('#infinityPassword','synthetic-password');await page.click('#infinitySubmit');await page.waitForFunction(()=>!document.querySelector('#infinityDialog').open);
    await page.click('[data-watch="13112"]');await page.waitForSelector('#infinityDialog[open]');await page.fill('#infinityEmail','alice@example.test');await page.fill('#infinityPassword','synthetic-password');await page.click('#infinitySubmit');await page.waitForFunction(()=>document.querySelector('#watchVideo').getAttribute('src')?.includes('alice.mp4'));
    await page.click('#watchClose');
    // Mobile layout, keyboard cancellation/focus restoration, and no overflow.
    await page.setViewportSize({width:390,height:844});await page.click('#infinityConnect');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'infinityConnect');assert.equal(await page.inputValue('#infinityPassword'),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page should not overflow horizontally');
    await page.click('#profileBtn');await page.click('#logoutBtn');await page.waitForURL(base+'/');
    assert.deepEqual(errors,[]);
    console.log('PASS: mocked Chromium flow: connection/resume, repeated Watch/Refresh/Open, guide, focus, close/reopen and switch races, reconnect, mobile and logout. No live login or media tested.');
  } finally {
    await browser?.close();
    if(server&&server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited}
    fs.rmSync(state,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});

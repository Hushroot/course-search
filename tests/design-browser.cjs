'use strict';
// Visual/regression checks use real catalog metadata and synthetic authentication only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const state = fs.mkdtempSync('/tmp/opencode/studystream-design-');
  const port = 43000 + crypto.randomInt(10000), base = `http://127.0.0.1:${port}`;
  const settingsFile = path.join(state, 'playback-settings.json');
  const settings = JSON.stringify({ siteOrigin: '', referrerPolicy: 'no-referrer', updatedAt: '2026-10-12T00:00:00.000Z' });
  fs.writeFileSync(settingsFile, settings);
  const shots = process.env.STUDYSTREAM_SCREENSHOT_DIR;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let server, browser; const errors = [];
  try {
    server = spawn(process.execPath, ['--require', './tests/provider-mock.cjs', 'server.js'], { cwd: root, env: { ...process.env, STATE_DIR: state, PORT: String(port), ADMIN_PASSWORD: 'design-test-admin-password', SESSION_SECRET: 'design-test-session-secret-at-least-32-characters', INFINITY_AUTH_KEY: crypto.randomBytes(32).toString('base64'), INFINITY_COOKIE: '', APP_ORIGIN: base, COOKIE_SECURE: 'false', NODE_ENV: 'test', AUTO_SCAN_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await wait(50); }
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'design-test-admin-password' }) });
    assert.equal(login.status, 200);
    const code = await fetch(base + '/api/admin/codes', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify({ code: 'DESIGNSTUDENT', label: 'Design review' }) }); assert.equal(code.status, 201);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: 'light', reducedMotion: 'reduce' });
    await context.route('https://**/*', route => route.abort()); // No live provider images/media in tests/screenshots.
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const appearance = () => page.locator('[data-appearance-select]');
    const theme = () => page.getAttribute('html', 'data-theme');
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level horizontal overflow');
    async function openBrowseMenu(){if(await page.locator('#browseMenuBtn').isVisible())await page.click('#browseMenuBtn')}
    async function closeBrowseMenu(){if(await page.locator('#browseDialog').evaluate(el=>el.open))await page.keyboard.press('Escape')}
    async function screenshot(name) {
      if (!shots) return;
      // Explicitly reject screenshotting filled credential fields or visible private source text.
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('input[type="password"],#infinityEmail,#code,#customCode,#newCode')].every(el => !(el.value || el.textContent || '').trim())));
      assert.ok(!await page.locator('body').innerText().then(text => /token=synthetic|account\d+|synthetic-password/.test(text)));
      await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false, animations: 'disabled' });
    }
    await page.goto(base); assert.equal(await theme(), 'light'); assert.equal(await appearance().inputValue(), 'system');
    await screenshot('login-light-desktop');
    await appearance().selectOption('dark'); assert.equal(await theme(), 'dark'); await screenshot('login-dark-desktop');
    await appearance().focus(); await page.keyboard.press('ArrowUp'); assert.equal(await theme(), 'light');
    await appearance().selectOption('dark');
    await page.reload(); assert.equal(await theme(), 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); assert.equal(await theme(), 'dark');
    await appearance().selectOption('system'); assert.equal(await theme(), 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await theme(), 'dark');
    await appearance().selectOption('light');
    await page.fill('#code', 'DESIGNSTUDENT'); await page.click('#loginBtn'); await page.waitForURL('**/app');
    await page.click('#gradeChoiceGrid [data-grade="g10"]');
    await page.click('#profileBtn'); await page.click('#browseAllMenuBtn'); await page.waitForSelector('.v2-lesson');
    assert.equal(await theme(), 'light');
    assert.equal(await page.getAttribute('#siteReferrerPolicy', 'content'), 'no-referrer');
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings);
    await page.waitForFunction(() => [...document.querySelectorAll('.lesson-thumbnail')].filter(img => img.getBoundingClientRect().top < window.innerHeight).every(img => img.complete));
    await page.locator('.lesson-cover').first().evaluate(el=>{const image=document.createElement('img');image.className='lesson-thumbnail';image.src='https://example.test/missing-thumbnail.jpg';el.appendChild(image)});
    await page.waitForFunction(()=>!document.querySelector('.lesson-cover .lesson-thumbnail'));
    assert.ok(await page.locator('.lesson-art').first().isVisible(),'failed thumbnail reveals deterministic illustration');
    await screenshot('library-light-desktop');
    assert.equal(await page.locator('.grade-hero,.v2-search-card').count(),0,'old hero/filter card removed');
    assert.ok(await page.locator('#q').evaluate(el=>Boolean(el.closest('header'))),'search is in compact header');
    const desktopGrid=await page.locator('.v2-lesson').evaluateAll(cards=>cards.slice(0,4).map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}}));
    assert.equal(new Set(desktopGrid.map(r=>r.y)).size,1,'four cards share the first desktop row');
    assert.ok(desktopGrid[3].x>desktopGrid[0].x);
    assert.ok(desktopGrid[0].y<400,'cards visible without a hero-sized scroll');
    assert.ok(await page.locator('.lesson-cover').first().evaluate(el=>el.getBoundingClientRect().width>220),'substantial cover');
    // Opening a card keeps its row/focus stable; panels span beneath that row.
    await page.locator('.v2-lesson summary').first().focus(); await page.keyboard.press('Enter');
    const openPanel=page.locator('.lesson-expanded:not([hidden])').first(); await openPanel.waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'lesson-card-0');
    assert.ok(await openPanel.evaluate(el=>Math.abs(el.getBoundingClientRect().width-document.querySelector('#results').getBoundingClientRect().width)<2));
    const rowAfter=await page.locator('.v2-lesson').evaluateAll(cards=>cards.slice(0,4).map(card=>card.getBoundingClientRect().y));
    assert.deepEqual(rowAfter,desktopGrid.map(r=>r.y),'expansion does not squeeze/reposition its row');
    for(const mode of ['light','dark']){await appearance().selectOption(mode);await screenshot('grid-expanded-'+mode+'-desktop')}
    await appearance().selectOption('light');
    await openPanel.locator('[data-close-lesson]').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'lesson-card-0');
    assert.equal(await page.locator('.v2-lesson[open]').count(),0);
    await page.click('#expandAll');
    assert.equal(await page.locator('.lesson-expanded:not([hidden])').count(),30,'Expand visible keeps all thirty visible lesson groups');
    await page.click('#collapseAll');assert.equal(await page.locator('.lesson-expanded:not([hidden])').count(),0);
    for(const [width,columns] of [[1280,3],[1920,4]]){
      await page.setViewportSize({width,height:1050});
      assert.equal(await page.locator('#results').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),columns);
      await noOverflow();
    }
    await page.setViewportSize({width:1440,height:1050});
    await page.locator('.v2-lesson summary').first().focus();await page.keyboard.press('Enter');
    for(const width of [768,320,1440]){
      await page.setViewportSize({width,height:1050});
      await page.waitForFunction(()=>{const card=document.querySelector('.v2-lesson');const panel=document.getElementById(card.querySelector('summary').getAttribute('aria-controls'));return !panel.hidden&&Math.abs(panel.getBoundingClientRect().width-document.querySelector('#results').getBoundingClientRect().width)<2});
      assert.equal(await page.evaluate(()=>document.activeElement.id),'lesson-card-0','resize does not lose card focus');
      await noOverflow();
    }
    await page.click('#collapseAll');
    await appearance().selectOption('dark'); await screenshot('library-dark-desktop');
    await page.reload(); await page.waitForSelector('.v2-lesson'); assert.equal(await theme(), 'dark');
    // Grades, filters, grouping and favorites keep their original interactions.
    await page.click('#gradeTabs [data-grade="g11"]'); assert.match(await page.textContent('#brandGrade'), /Grade 11/);
    const gradeKey = await page.evaluate(() => localStorage.getItem('courseSearch:grade:v2')); assert.equal(gradeKey, 'g11');
    await page.click('#profileBtn'); await page.click('#browseAllMenuBtn');
    await page.locator('.favorite-btn').first().click();
    await page.waitForSelector('.v2-toast.show'); await screenshot('success-dark-desktop');
    await page.click('#favoritesOnly'); assert.equal(await page.getAttribute('#favoritesOnly', 'aria-pressed'), 'true'); assert.equal(await page.locator('.v2-lesson').count(), 1);
    await page.reload(); await page.waitForSelector('.v2-lesson'); assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('courseSearch:favorites:v1')).length === 1));
    await page.click('#profileBtn'); await page.click('#browseAllMenuBtn');
    await page.selectOption('#subject', '13'); assert.equal(await page.locator('.v2-lesson:not([data-art="purple"])').count(), 0);
    const matchingTeacher=await page.locator('.v2-lesson .lesson-meta span').first().textContent();
    const teacherValue=await page.locator('#teacher option').evaluateAll((options,name)=>options.find(option=>option.textContent===name)?.value,matchingTeacher);
    await page.selectOption('#teacher',teacherValue); await page.selectOption('#access','link');
    assert.match(await page.textContent('#filterState'),/3 active filters/);
    assert.ok(await page.locator('.v2-lesson').count()>0,'combined subject/teacher/access filters');
    assert.ok((await page.locator('.v2-lesson .lesson-meta span:first-child').allTextContents()).every(name=>name===matchingTeacher));
    await page.click('#reset');
    for (const id of ['teacher', 'type', 'access', 'sort']) { const values = await page.locator('#' + id + ' option').evaluateAll(items => items.map(item => item.value)); if (values.length > 1) { await page.selectOption('#' + id, values[1]); await page.click('#reset'); } }
    await page.fill('#q', '13112'); await page.waitForSelector('[data-watch="13112"]');
    await page.click('#collapseAll'); assert.equal(await page.locator('.v2-lesson[open]').count(), 0);
    await page.locator('.v2-lesson summary').first().focus(); await page.keyboard.press('Enter'); assert.ok(await page.locator('.v2-lesson[open]').count() > 0);
    await page.click('#expandAll');
    assert.equal(await page.locator('.lesson-expanded:not([hidden])').count(),await page.locator('.v2-lesson').count());
    for (const mode of ['light', 'dark']) { await appearance().selectOption(mode); await screenshot('expanded-' + mode + '-desktop'); }
    await page.click('[data-watch="13112"]'); await page.waitForSelector('#infinityDialog[open]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'infinityEmail');
    for (const mode of ['light', 'dark']) { await page.evaluate(value => { const select = document.querySelector('[data-appearance-select]'); select.value = value; select.dispatchEvent(new Event('change')); }, mode); await screenshot('connection-' + mode + '-desktop'); }
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'watchClose');
    await page.click('#watchHelpToggle'); await page.waitForSelector('#watchHelpPanel:not(.hidden)');
    for (const mode of ['light', 'dark']) { await page.evaluate(value => { const select = document.querySelector('[data-appearance-select]'); select.value = value; select.dispatchEvent(new Event('change')); }, mode); await screenshot('player-help-' + mode + '-desktop'); }
    // HTMLVideoElement does not reflect the legacy referrerPolicy expando into
    // its attribute; the existing page meta controls actual media requests.
    assert.equal(await page.locator('#watchVideo').evaluate(el => el.referrerPolicy), 'no-referrer'); assert.equal(await page.getAttribute('#watchFrame', 'referrerpolicy'), 'no-referrer');
    assert.equal(await page.getAttribute('#siteReferrerPolicy', 'content'), 'no-referrer');
    await page.keyboard.press('Escape');
    // Long-title and error fixtures are browser-only; real source catalog is never overwritten.
    await page.locator('.v2-lesson h3').first().evaluate(el => { el.textContent = (el.textContent+' · الرياضيات والمراجعة — ').repeat(8); }); await noOverflow();
    assert.equal(await page.locator('.v2-lesson h3').first().evaluate(el=>getComputedStyle(el).webkitLineClamp),'none','full long title remains available');
    await screenshot('long-title-dark-desktop');
    await page.fill('#q', 'this-search-definitely-has-no-result'); await page.waitForSelector('#empty:not(.hidden)'); await noOverflow();
    await screenshot('empty-dark-desktop'); await page.click('#emptyReset');
    let acceptRoute;
    const intercepted = new Promise(resolve => { acceptRoute = resolve; });
    await page.route('**/api/courses', route => { acceptRoute(route); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const pendingCatalog = await intercepted;
    for (const mode of ['light', 'dark']) { await appearance().selectOption(mode); await screenshot('loading-' + mode + '-desktop'); }
    await pendingCatalog.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' });
    await page.waitForFunction(() => document.querySelector('#loading').textContent.includes('Could not load'));
    for (const mode of ['light', 'dark']) { await appearance().selectOption(mode); await screenshot('error-' + mode + '-desktop'); }
    await page.unroute('**/api/courses'); await page.reload(); await page.waitForSelector('.v2-lesson');
    // Inspect phones/tablets in both appearances, including connection and expanded rows.
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const mode of ['light', 'dark']) {
        await appearance().selectOption(mode); await page.fill('#q', ''); await page.waitForTimeout(100); await noOverflow();
        const size = width === 768 ? 'tablet' : width === 320 ? 'small-mobile' : 'mobile';
        await page.evaluate(() => window.scrollTo(0, 0)); await screenshot('library-' + mode + '-' + size);
        const columns=await page.locator('#results').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
        assert.equal(columns,width===768?2:1);
        if(width===320){
          const title=page.locator('.v2-lesson h3').first();
          const original=await title.textContent();
          await title.evaluate(el=>{el.textContent=(el.textContent+' — اللغة العربية / Mathematics ').repeat(6)});
          await noOverflow();await screenshot('long-title-'+mode+'-small-mobile');
          await title.evaluate((el,text)=>{el.textContent=text},original);
        }
        await openBrowseMenu(); await screenshot('menu-'+mode+'-'+size);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'browseMenuClose');
        assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).overflow),'hidden');
        await page.keyboard.press('Shift+Tab'); assert.ok(await page.locator('#browseDialog').evaluate(el=>el.contains(document.activeElement)),'native modal traps focus');
        if(width===320&&mode==='light'){
          await page.click('#gradeTabs [data-grade="g10"]');assert.match(await page.textContent('#brandGrade'),/Grade 10/);
          await page.click('#gradeTabs [data-grade="g11"]');assert.match(await page.textContent('#brandGrade'),/Grade 11/);
          await page.click('#favoritesOnly');assert.equal(await page.locator('.v2-lesson').count(),1);
          await page.click('#favoritesOnly');assert.ok(await page.locator('.v2-lesson').count()>1);
        }
        await closeBrowseMenu(); assert.equal(await page.evaluate(()=>document.activeElement.id),'browseMenuBtn');
        if(width===320){await page.click('#filterTrigger');assert.equal(await page.getAttribute('#filterTrigger','aria-expanded'),'true');await page.selectOption('#access','link');await noOverflow();await page.selectOption('#access','');await page.click('#filterTrigger')}
        await page.locator('.v2-lesson summary').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
        await screenshot('lessons-' + mode + '-' + size);
        await page.fill('#q', '13112'); await page.waitForSelector('[data-watch="13112"]'); await noOverflow();
        await page.locator('.v2-lesson summary').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
        await screenshot('expanded-' + mode + '-' + size);
        if (width === 390) { await page.click('[data-watch="13112"]'); await page.waitForSelector('#infinityDialog[open]'); await screenshot('connection-' + mode + '-mobile'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1050 }); await page.click('#infinityConnect'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'infinityConnect');
    assert.equal(await page.locator('.toolbar-btn').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.keyboard.press('Control+k'); assert.equal(await page.evaluate(() => document.activeElement.id), 'q');
    assert.ok(await page.locator('#q').evaluate(el => getComputedStyle(el.parentElement).outlineStyle !== 'none'));
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings);
    await page.click('#profileBtn'); await page.click('#logoutBtn'); await page.waitForURL(base + '/');
    assert.equal(await theme(), 'dark');
    // Same browser preference carries through admin login and actual admin controls.
    await page.goto(base + '/admin'); assert.equal(await theme(), 'dark');
    await page.fill('#password', 'design-test-admin-password'); await page.click('#adminLoginBtn'); await page.waitForSelector('#adminPanel:not(.hidden)');
    await page.waitForFunction(() => document.querySelector('#playbackReferrerPolicy').value === 'no-referrer');
    for (const mode of ['light', 'dark']) { await appearance().selectOption(mode); await screenshot('admin-' + mode + '-desktop'); }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mode of ['light', 'dark']) { await appearance().selectOption(mode); await noOverflow(); await screenshot('admin-' + mode + '-mobile'); }
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings); assert.equal(await page.inputValue('#playbackReferrerPolicy'), 'no-referrer');
    assert.deepEqual(errors, []);
    console.log('PASS: Classroom four-column desktop grid, two-column tablet/one-column phones down to 320px, full-row resource panels, Browse menu keyboard/focus/scroll lock, combined filters, Light/Dark/System, catalog controls, dialogs, reduced motion and unchanged saved no-referrer. No live provider playback tested.');
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    fs.rmSync(state, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

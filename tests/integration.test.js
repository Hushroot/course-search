'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'course-v18-'));
const port = 33000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const preload = path.join(temp, 'stub.cjs');
writeFileSync(preload, `
const originalFetch=global.fetch;
global.fetch=async (url,options)=>{
  if(!String(url).startsWith('https://infinityschool.net/'))return originalFetch(url,options);
  const id=Number(String(url).match(/\\/(\\d+)(?:\\?|$)/)?.[1]);
  const isFile=String(url).includes('get-file/');
  const body=isFile?{file:{id, file_name:'Sample Video',lesson:{id:700,name:'Example Lesson',teacher_id:3,subject_id:2,class_section_id:7},lesson_topic:{id:9,name:'Example Topic'}}}:{video:{name:'Sample Video',download_url:'https://cdn.example.org/video-'+id+'.mp4?token=fresh'}};
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
};
`);
let server;
async function request(route, opts = {}) {
  const r = await fetch(base + route, { ...opts, redirect:'manual' });
  let data = null; try { data = await r.clone().json(); } catch {}
  return {status:r.status, data, headers:r.headers};
}
function auth(cookie, method='GET', body) {
  return { method, headers: {Cookie:cookie, ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {}) };
}
async function waitReady() {
  for(let i=0;i<80;i++){
    try { if((await request('/health')).status===200)return; }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('server did not start');
}
test('playback origin settings and self-service video refresh', async t => {
  t.after(()=>{server?.kill();rmSync(temp,{recursive:true,force:true})});
  server=spawn(process.execPath,['--require',preload,'server.js'],{
    cwd:root,
    env:{...process.env, PORT:String(port), STATE_DIR:temp, ADMIN_PASSWORD:'test-admin-password-long',SESSION_SECRET:'test-session-secret-long-enough-to-use-123456',COOKIE_SECURE:'false',NODE_ENV:'test',AUTO_SCAN_ENABLED:'false',INFINITY_COOKIE:'test-cookie'},
    stdio:['ignore','pipe','pipe'],
  });
  let err='';server.stderr.on('data',x=>err+=x);
  await waitReady().catch(e=>{throw new Error(e.message+' '+err)});
  const noSession=await request('/api/videos/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:13112})});
  assert.equal(noSession.status,401);
  const login=await request('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-admin-password-long'})});
  assert.equal(login.status,200);
  const adminCookie=login.headers.get('set-cookie').split(';')[0];
  const site=await request('/app',auth(adminCookie));
  assert.equal(site.status,200);
  assert.equal(site.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(site.headers.get('content-security-policy'), /frame-src https:\/\/iframe\.mediadelivery\.net/);
  const unauthorized=await request('/api/admin/playback/settings');
  assert.equal(unauthorized.status,401);
  const badOrigin=await request('/api/admin/playback/settings',auth(adminCookie,'PUT',{siteOrigin:'https://evil.example.com/path',referrerPolicy:'origin'}));
  assert.equal(badOrigin.status,400);
  const saved=await request('/api/admin/playback/settings',auth(adminCookie,'PUT',{siteOrigin:'https://course-search-production-2aa6.up.railway.app',referrerPolicy:'origin'}));
  assert.equal(saved.status,200);
  assert.equal(saved.data.siteOrigin,'https://course-search-production-2aa6.up.railway.app');
  const studentConfig=await request('/api/playback/settings',auth(adminCookie));
  assert.equal(studentConfig.data.referrerPolicy,'origin');
  assert.equal(studentConfig.data.siteOrigin,saved.data.siteOrigin);
  const crossSite=await request('/api/videos/refresh',{method:'POST',headers:{Cookie:adminCookie,Origin:'https://evil.example.com','Content-Type':'application/json'},body:JSON.stringify({videoId:13112})});
  assert.equal(crossSite.status,403);
  const missing=await request('/api/videos/refresh',auth(adminCookie,'POST',{videoId:99999999}));
  assert.equal(missing.status,404);
  const fresh=await request('/api/videos/refresh',auth(adminCookie,'POST',{videoId:13112}));
  assert.equal(fresh.status,200);
  assert.equal(fresh.data.record.id,13112);
  assert.equal(fresh.data.record.download,'https://cdn.example.org/video-13112.mp4?token=fresh');
  assert.equal(fresh.data.linkReturned,true);
  assert.equal(fresh.data.linkUpdated,true);
  const second=await request('/api/videos/refresh',auth(adminCookie,'POST',{videoId:13112}));
  assert.equal(second.status,429);
  const created=await request('/api/admin/codes',auth(adminCookie,'POST',{label:'Student test',code:'TESTSTUDENT77'}));
  assert.equal(created.status,201);
  const studentLogin=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:created.data.code})});
  assert.equal(studentLogin.status,200);
  const studentCookie=studentLogin.headers.get('set-cookie').split(';')[0];
  const studentRefresh=await request('/api/videos/refresh',auth(studentCookie,'POST',{videoId:9000}));
  assert.equal(studentRefresh.status,200);
  assert.equal(studentRefresh.data.record.id,9000);
  // Only admins may assign official Bunny Stream embeds to existing course IDs.
  const bunny='https://iframe.mediadelivery.net/embed/386/54864774-bc13-417a-862f-70e2a044d030?autoplay=false&loop=false&muted=false&preload=true';
  const iframe='<div style="position:relative"><iframe src="'+bunny.replace(/&/g,'&amp;')+'" allowfullscreen></iframe></div>';
  const noAdminEmbed=await request('/api/admin/videos/embed?videoId=13112');
  assert.equal(noAdminEmbed.status,401);
  const noAdminWrite=await request('/api/admin/videos/embed',auth(studentCookie,'PUT',{videoId:13112,embedUrl:bunny}));
  assert.equal(noAdminWrite.status,401);
  const notInLibrary=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:99999999,embedUrl:bunny}));
  assert.equal(notInLibrary.status,404);
  const badEmbed=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:13112,embedUrl:'https://evil.example.com/embed/386/54864774-bc13-417a-862f-70e2a044d030'}));
  assert.equal(badEmbed.status,400);
  const scriptEmbed=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:13112,embedUrl:'javascript:alert(1)'}));
  assert.equal(scriptEmbed.status,400);
  const savedEmbed=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:13112,embedUrl:iframe}));
  assert.equal(savedEmbed.status,200);
  assert.equal(savedEmbed.data.embedUrl,bunny);
  assert.equal(savedEmbed.data.embedManual,true);
  const readEmbed=await request('/api/admin/videos/embed?videoId=13112',auth(adminCookie));
  assert.equal(readEmbed.data.embedUrl,bunny);
  const protectedCourses=await request('/api/courses',auth(studentCookie));
  assert.equal(protectedCourses.status,200);
  assert.equal(protectedCourses.data.find(x=>x.id===13112).embedUrl,bunny);
  // An upstream metadata refresh must preserve the admin's manual iframe assignment.
  const metadataUpdate=await request('/api/admin/videos/fetch',auth(adminCookie,'POST',{videoId:13112}));
  assert.equal(metadataUpdate.status,200);
  assert.equal(metadataUpdate.data.record.embedUrl,bunny);
  const clearEmbed=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:13112,embedUrl:''}));
  assert.equal(clearEmbed.status,200);
  assert.equal(clearEmbed.data.embedUrl,'');
  assert.equal(clearEmbed.data.embedManual,false);
  const reapplyEmbed=await request('/api/admin/videos/embed',auth(adminCookie,'PUT',{videoId:13112,embedUrl:bunny}));
  assert.equal(reapplyEmbed.status,200);
  const persisted=JSON.parse(readFileSync(path.join(temp,'courses.json'),'utf8'));
  assert.equal(persisted.find(x=>x.id===13112).download,fresh.data.record.download);
  assert.equal(persisted.find(x=>x.id===13112).embedUrl,bunny);
  assert.equal(JSON.parse(readFileSync(path.join(temp,'playback-settings.json'),'utf8')).siteOrigin,saved.data.siteOrigin);
  // Student-facing playback help is authenticated and admin-editable.
  assert.equal((await request('/api/playback/guide')).status,401);
  assert.equal((await request('/api/admin/playback/guide')).status,401);
  const defaultGuide=await request('/api/playback/guide',auth(studentCookie));
  assert.equal(defaultGuide.status,200);
  assert.equal(defaultGuide.data.enabled,true);
  assert.match(defaultGuide.data.title,/Video not playing/);
  const edited={enabled:true,title:'Custom video help',introduction:'Authorized use only',steps:'1. Try player\n2. Ask for help',code:'print("Hello")'};
  const studentWrite=await request('/api/admin/playback/guide',auth(studentCookie,'PUT',edited));
  assert.equal(studentWrite.status,401);
  const crossOriginWrite=await request('/api/admin/playback/guide',{method:'PUT',headers:{Cookie:adminCookie,Origin:'https://bad.example.com','Content-Type':'application/json'},body:JSON.stringify(edited)});
  assert.equal(crossOriginWrite.status,403);
  const oversized=await request('/api/admin/playback/guide',auth(adminCookie,'PUT',{...edited,title:'x'.repeat(141)}));
  assert.equal(oversized.status,400);
  const savedGuide=await request('/api/admin/playback/guide',auth(adminCookie,'PUT',edited));
  assert.equal(savedGuide.status,200);
  const studentGuide=await request('/api/playback/guide',auth(studentCookie));
  assert.equal(studentGuide.data.title,'Custom video help');
  assert.equal(studentGuide.data.code,'print("Hello")');
  const persistedGuide=JSON.parse(readFileSync(path.join(temp,'playback-guide.json'),'utf8'));
  assert.equal(persistedGuide.steps,edited.steps);
  const disabled=await request('/api/admin/playback/guide',auth(adminCookie,'PUT',{...edited,enabled:false}));
  assert.equal(disabled.status,200);
  const hidden=await request('/api/playback/guide',auth(studentCookie));
  assert.deepEqual(hidden.data,{enabled:false});
  const stillAdmin=await request('/api/admin/playback/guide',auth(adminCookie));
  assert.equal(stillAdmin.data.title,edited.title);
});

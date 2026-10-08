'use strict';
const $=s=>document.querySelector(s);
let CODES=[];
let LABEL_INFO={subjects:{},teachers:{},stats:{subjects:[],teachers:[]}};
let INFINITY_STATUS={configured:false,source:null,updatedAt:null};
let SCAN_STATUS={running:false,lastStatus:'never',config:{maxConsecutiveMisses:1000}};
let PLAYBACK_SETTINGS={siteOrigin:'',referrerPolicy:'origin'};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function expired(c){return Boolean(c.expiresAt&&Date.now()>=new Date(c.expiresAt).getTime())}
function exhausted(c){return Number.isFinite(c.maxUses)&&c.maxUses>0&&Number(c.uses||0)>=c.maxUses}
function active(c){return c.enabled!==false&&!expired(c)&&!exhausted(c)}
function fmt(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString()}
async function api(url,opts={}){const r=await fetch(url,{cache:'no-store',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});let j={};try{j=await r.json()}catch{}if(r.status===401){showLogin();throw new Error(j.error||'Admin session expired.')}if(!r.ok)throw new Error(j.error||'Request failed.');return j}
function showLogin(){$('#adminLogin').classList.remove('hidden');$('#adminPanel').classList.add('hidden')}
function showPanel(){$('#adminLogin').classList.add('hidden');$('#adminPanel').classList.remove('hidden')}
function render(){
  $('#statTotal').textContent=CODES.length.toLocaleString();$('#statActive').textContent=CODES.filter(active).length.toLocaleString();$('#statUses').textContent=CODES.reduce((n,c)=>n+Number(c.uses||0),0).toLocaleString();$('#statOff').textContent=CODES.filter(c=>!active(c)).length.toLocaleString();
  $('#codeRows').innerHTML=CODES.length?CODES.map(c=>{const isActive=active(c);let status='Active';if(c.enabled===false)status='Revoked';else if(expired(c))status='Expired';else if(exhausted(c))status='Used up';const max=c.maxUses?` / ${c.maxUses}`:' / ∞';return `<tr><td><strong>${esc(c.label||'Access code')}</strong><div class="muted">Created ${esc(fmt(c.createdAt))}</div></td><td><code>••••${esc(c.hint||'')}</code></td><td><span class="status ${isActive?'':'off'}"><span class="dot"></span>${esc(status)}</span></td><td>${Number(c.uses||0)}${esc(max)}</td><td>${esc(fmt(c.expiresAt))}</td><td>${esc(fmt(c.lastUsedAt))}</td><td><div class="row-actions"><button class="btn small ghost" data-action="toggle" data-id="${esc(c.id)}">${c.enabled===false?'Enable':'Revoke'}</button><button class="btn small ghost" data-action="reset" data-id="${esc(c.id)}">Reset uses</button><button class="btn small danger ghost" data-action="delete" data-id="${esc(c.id)}">Delete</button></div></td></tr>`}).join(''):'<tr><td colspan="7" class="muted">No access codes yet.</td></tr>';
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>rowAction(b.dataset.action,b.dataset.id)));
}
function labelInputRow(kind,item){
  const value=(LABEL_INFO[kind]||{})[String(item.id)]||'';
  const fallback=kind==='subjects'?`Subject ${item.id}`:`Teacher ${item.id}`;
  const subjectText=kind==='teachers'&&Array.isArray(item.subjectIds)&&item.subjectIds.length
    ?item.subjectIds.map(id=>LABEL_INFO.subjects?.[String(id)]||`Subject ${id}`).join(', ')
    :'';
  const meta=[`${Number(item.count||0).toLocaleString()} items`,subjectText,item.exampleLesson||''].filter(Boolean).map(esc).join(' · ');
  return `<label class="label-map-row ${value?'':'unnamed'}">
    <div class="label-map-id"><span>ID</span><strong>${esc(item.id)}</strong></div>
    <div class="label-map-main"><input class="input label-name-input" data-label-kind="${kind}" data-label-id="${esc(item.id)}" value="${esc(value)}" placeholder="${esc(fallback)}"><div class="label-map-meta">${meta}</div></div>
  </label>`;
}
function renderLabels(){
  const stats=LABEL_INFO.stats||{subjects:[],teachers:[]};
  const sortForNaming=(kind,list)=>[...(list||[])].sort((a,b)=>{
    const an=Boolean(LABEL_INFO[kind]?.[String(a.id)]),bn=Boolean(LABEL_INFO[kind]?.[String(b.id)]);
    if(an!==bn)return an?1:-1;
    return String(a.id).localeCompare(String(b.id),undefined,{numeric:true});
  });
  $('#subjectLabelRows').innerHTML=sortForNaming('subjects',stats.subjects).map(x=>labelInputRow('subjects',x)).join('');
  $('#teacherLabelRows').innerHTML=sortForNaming('teachers',stats.teachers).map(x=>labelInputRow('teachers',x)).join('');
  const namedSubjects=(stats.subjects||[]).filter(x=>LABEL_INFO.subjects?.[String(x.id)]).length;
  const namedTeachers=(stats.teachers||[]).filter(x=>LABEL_INFO.teachers?.[String(x.id)]).length;
  $('#subjectNameCount').textContent=`${namedSubjects}/${(stats.subjects||[]).length} named`;
  $('#teacherNameCount').textContent=`${namedTeachers}/${(stats.teachers||[]).length} named`;
}
async function loadCodes(){const j=await api('/api/admin/codes');CODES=j.codes||[];render()}
async function loadLabels(){LABEL_INFO=await api('/api/admin/labels');renderLabels()}
function renderInfinityStatus(){
  const el=$('#infinityStatus');
  if(!el)return;
  if(!INFINITY_STATUS.configured){el.className='infinity-status off';el.textContent='Cookie needed';return}
  el.className='infinity-status on';
  const source=INFINITY_STATUS.source==='environment'?'Railway variable':'Admin saved';
  el.textContent=`Connected · ${source}`;
}
async function loadInfinityStatus(){INFINITY_STATUS=await api('/api/admin/infinity/status');renderInfinityStatus()}
function renderScanStatus(){
  const s=SCAN_STATUS||{};const cfg=s.config||{};const badge=$('#scanStatusBadge');if(!badge)return;
  let text='Idle',klass='infinity-status';
  if(s.running){text='Scanning';klass+=' on'}else if(s.lastStatus==='completed'){text='Up to date';klass+=' on'}else if(s.lastStatus==='error'){text='Scan error';klass+=' off'}else if(s.lastStatus==='stopped'){text='Stopped';klass+=' off'}else if(cfg.enabled===false){text='Disabled';klass+=' off'}else{klass+=' off'}
  badge.className=klass;badge.textContent=text;
  $('#scanHighest').textContent=s.highestStoredId??'—';$('#scanCheckedId').textContent=s.lastCheckedId??'—';$('#scanHits').textContent=Number(s.lastHitsFound||0).toLocaleString();$('#scanMisses').textContent=`${Number(s.lastMissStreak||0).toLocaleString()} / ${Number(cfg.maxConsecutiveMisses||1000).toLocaleString()}`;
  const bits=[];if(s.running)bits.push(`Started ${fmt(s.lastStartedAt)}`);else if(s.lastCompletedAt)bits.push(`Last finished ${fmt(s.lastCompletedAt)}`);else if(s.lastStartedAt)bits.push(`Last attempt ${fmt(s.lastStartedAt)}`);if(s.nextDueAt&&cfg.enabled!==false)bits.push(`Next due ${fmt(s.nextDueAt)}`);if(s.lastCheckedCount)bits.push(`${Number(s.lastCheckedCount).toLocaleString()} IDs checked`);if(s.lastError)bits.push(`Error: ${s.lastError}`);$('#scanMeta').textContent=bits.join(' · ')||`Daily scan starts at Video #${s.nextStartId||'—'}.`;
  $('#runScanBtn').disabled=Boolean(s.running)||!INFINITY_STATUS.configured;$('#stopScanBtn').disabled=!s.running;
}
async function loadScanStatus(){SCAN_STATUS=await api('/api/admin/scan/status');renderScanStatus()}
async function loadPlaybackSettings(){
  PLAYBACK_SETTINGS=await api('/api/admin/playback/settings');
  $('#playbackSiteOrigin').value=PLAYBACK_SETTINGS.siteOrigin||'';
  $('#playbackReferrerPolicy').value=PLAYBACK_SETTINGS.referrerPolicy||'origin';
  $('#playbackStatus').textContent=PLAYBACK_SETTINGS.siteOrigin?'Configured':'Use current domain';
  $('#playbackStatus').className='infinity-status on';
}
async function loadPlaybackGuide(){
  const guide=await api('/api/admin/playback/guide');
  $('#guideEnabled').checked=guide.enabled!==false;
  $('#guideTitle').value=guide.title||'';
  $('#guideIntro').value=guide.introduction||'';
  $('#guideSteps').value=guide.steps||'';
  $('#guideCode').value=guide.code||'';
  $('#guideStatus').textContent=guide.enabled===false?'Hidden':'Published';
  $('#guideStatus').className='infinity-status '+(guide.enabled===false?'off':'on');
  $('#guideSaved').textContent='';$('#guideError').textContent='';
}
async function loadAdminData(){await Promise.all([loadCodes(),loadLabels(),loadInfinityStatus(),loadScanStatus(),loadPlaybackSettings(),loadPlaybackGuide()]);renderScanStatus()}
async function saveLabels(){
  const btn=$('#saveLabels');btn.disabled=true;$('#labelsError').textContent='';$('#labelsSaved').textContent='';
  try{
    const body={subjects:{},teachers:{}};
    document.querySelectorAll('.label-name-input').forEach(input=>{const v=input.value.trim();if(v)body[input.dataset.labelKind][input.dataset.labelId]=v});
    LABEL_INFO=await api('/api/admin/labels',{method:'PUT',body:JSON.stringify(body)});
    renderLabels();$('#labelsSaved').textContent='Saved. Search results and filters use these names immediately.';
    setTimeout(()=>{if($('#labelsSaved'))$('#labelsSaved').textContent=''},3000);
  }catch(e){$('#labelsError').textContent=e.message}finally{btn.disabled=false}
}
async function rowAction(action,id){$('#tableError').textContent='';try{if(action==='delete'){if(!confirm('Delete this access code permanently?'))return;await api(`/api/admin/codes/${encodeURIComponent(id)}`,{method:'DELETE'});}else if(action==='toggle'){await api(`/api/admin/codes/${encodeURIComponent(id)}/toggle`,{method:'POST',body:'{}'});}else if(action==='reset'){if(!confirm('Reset this code\'s login counter to zero?'))return;await api(`/api/admin/codes/${encodeURIComponent(id)}/reset-uses`,{method:'POST',body:'{}'});}await loadCodes()}catch(e){$('#tableError').textContent=e.message}}

$('#adminLoginForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#adminLoginBtn');btn.disabled=true;$('#adminLoginError').textContent='';try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});$('#password').value='';showPanel();await loadAdminData()}catch(err){$('#adminLoginError').textContent=err.message}finally{btn.disabled=false}});
$('#createForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#createBtn');btn.disabled=true;$('#createError').textContent='';try{const body={label:$('#label').value,maxUses:$('#maxUses').value||null,expiresAt:$('#expiresAt').value?new Date($('#expiresAt').value).toISOString():null,code:$('#customCode').value||null};const j=await api('/api/admin/codes',{method:'POST',body:JSON.stringify(body)});$('#newCode').textContent=j.code;$('#newCodeBox').classList.add('show');$('#customCode').value='';await loadCodes()}catch(err){$('#createError').textContent=err.message}finally{btn.disabled=false}});
$('#copyCode').addEventListener('click',async()=>{await navigator.clipboard?.writeText($('#newCode').textContent);$('#copyCode').textContent='Copied';setTimeout(()=>$('#copyCode').textContent='Copy',1000)});
$('#playbackSettingsForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('#savePlaybackSettings');btn.disabled=true;
  $('#playbackError').textContent='';$('#playbackSaved').textContent='';
  try{
    PLAYBACK_SETTINGS=await api('/api/admin/playback/settings',{method:'PUT',body:JSON.stringify({
      siteOrigin:$('#playbackSiteOrigin').value.trim(),
      referrerPolicy:$('#playbackReferrerPolicy').value,
    })});
    await loadPlaybackSettings();
    $('#playbackSaved').textContent='Saved to persistent storage. Students get the new setting on their next visit.';
  }catch(err){$('#playbackError').textContent=err.message}
  finally{btn.disabled=false}
});
$('#loadBunnyEmbed').addEventListener('click',async()=>{
  const id=Number($('#bunnyVideoId').value);
  $('#bunnyEmbedError').textContent='';$('#bunnyEmbedSaved').textContent='';
  if(!Number.isSafeInteger(id)||id<1){$('#bunnyEmbedError').textContent='Enter a numeric Video ID first.';return}
  try{
    const j=await api('/api/admin/videos/embed?videoId='+encodeURIComponent(id));
    $('#bunnyEmbedUrl').value=j.embedUrl||'';
    $('#bunnyEmbedSaved').textContent=(j.videoName||'Video')+(j.embedUrl?' · embed loaded':' · no embed assigned');
  }catch(err){$('#bunnyEmbedError').textContent=err.message}
});
$('#bunnyEmbedForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('#saveBunnyEmbed');btn.disabled=true;
  $('#bunnyEmbedError').textContent='';$('#bunnyEmbedSaved').textContent='';
  try{
    const j=await api('/api/admin/videos/embed',{method:'PUT',body:JSON.stringify({videoId:Number($('#bunnyVideoId').value),embedUrl:$('#bunnyEmbedUrl').value.trim()})});
    $('#bunnyEmbedUrl').value=j.embedUrl||'';
    $('#bunnyEmbedSaved').textContent=j.embedUrl?'Saved for '+(j.videoName||('Video #'+j.videoId))+' · available in student player':'Manual embed cleared.';
  }catch(err){$('#bunnyEmbedError').textContent=err.message}
  finally{btn.disabled=false}
});
$('#playbackGuideForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('#saveGuideBtn');btn.disabled=true;
  $('#guideError').textContent='';$('#guideSaved').textContent='';
  try{
    const guide=await api('/api/admin/playback/guide',{method:'PUT',body:JSON.stringify({
      enabled:$('#guideEnabled').checked,
      title:$('#guideTitle').value,
      introduction:$('#guideIntro').value,
      steps:$('#guideSteps').value,
      code:$('#guideCode').value,
    })});
    $('#guideStatus').textContent=guide.enabled?'Published':'Hidden';
    $('#guideStatus').className='infinity-status '+(guide.enabled?'on':'off');
    $('#guideSaved').textContent='Saved. Students will see the updated guide next time they open it.';
  }catch(err){$('#guideError').textContent=err.message}
  finally{btn.disabled=false}
});
$('#reloadGuideBtn').addEventListener('click',()=>loadPlaybackGuide().catch(e=>$('#guideError').textContent=e.message));
$('#saveLabels').addEventListener('click',saveLabels);
$('#cookieForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('#saveCookieBtn');btn.disabled=true;$('#cookieError').textContent='';$('#cookieSaved').textContent='';
  try{
    const value=$('#infinityCookie').value.trim();
    if(!value)throw new Error('Paste the full Infinity Cookie header first.');
    INFINITY_STATUS=await api('/api/admin/infinity/cookie',{method:'PUT',body:JSON.stringify({cookie:value})});
    $('#infinityCookie').value='';renderInfinityStatus();await loadScanStatus();$('#cookieSaved').textContent='Cookie saved. Manual and daily scans are ready.';
    setTimeout(()=>{if($('#cookieSaved'))$('#cookieSaved').textContent=''},3500);
  }catch(err){$('#cookieError').textContent=err.message}finally{btn.disabled=false}
});
$('#videoFetchForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('#fetchVideoBtn');btn.disabled=true;$('#videoFetchError').textContent='';$('#videoFetchResult').innerHTML='';
  try{
    const videoId=Number($('#videoId').value);
    if(!Number.isInteger(videoId)||videoId<1)throw new Error('Enter a valid Video ID.');
    btn.textContent='Fetching…';
    const j=await api('/api/admin/videos/fetch',{method:'POST',body:JSON.stringify({videoId})});
    const r=j.record||{};
    const action=j.action==='updated'?'Updated':'Added';
    $('#videoFetchResult').innerHTML=`<strong>${esc(action)} Video #${esc(r.id)}</strong><span>${esc(r.video||'Untitled video')}</span><span>Lesson ${esc(r.lessonId??'—')} · ${esc(r.lesson||'Unknown lesson')}</span><span>${esc(j.total||0)} total searchable items</span>`;
    await loadLabels();
  }catch(err){$('#videoFetchError').textContent=err.message}finally{btn.disabled=false;btn.textContent='Fetch & save video'}
});
$('#runScanBtn').addEventListener('click',async()=>{
  $('#scanError').textContent='';const btn=$('#runScanBtn');btn.disabled=true;
  try{SCAN_STATUS=await api('/api/admin/scan/run',{method:'POST',body:'{}'});renderScanStatus()}catch(err){$('#scanError').textContent=err.message;await loadScanStatus().catch(()=>{})}
});
$('#stopScanBtn').addEventListener('click',async()=>{
  $('#scanError').textContent='';const btn=$('#stopScanBtn');btn.disabled=true;
  try{SCAN_STATUS=await api('/api/admin/scan/stop',{method:'POST',body:'{}'});renderScanStatus()}catch(err){$('#scanError').textContent=err.message;await loadScanStatus().catch(()=>{})}
});
setInterval(()=>{if(!$('#adminPanel').classList.contains('hidden'))loadScanStatus().catch(()=>{})},5000);
$('#adminLogout').addEventListener('click',async()=>{await fetch('/api/admin/logout',{method:'POST'});showLogin()});

(async()=>{try{const r=await fetch('/api/admin/session',{cache:'no-store'});const j=await r.json();if(j.authenticated){showPanel();await loadAdminData()}else showLogin()}catch{showLogin()}})();

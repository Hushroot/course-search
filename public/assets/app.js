'use strict';

let DATA=[];
let LESSONS=new Map();
let LABELS={subjects:{},teachers:{}};
let DATA_VERSION=null;
let SESSION=null;
let PLAYBACK_SETTINGS={siteOrigin:'',referrerPolicy:'origin'};
let WATCH_ID=null;
let WATCH_LAST_FOCUS=null;
let WATCH_GUIDE=null;
let WATCH_VIEW_GENERATION=0;
let WATCH_URL=null;
let WATCH_RAW_URL=null;
let WATCH_QUALITY='auto';
const PLAYBACK_REQUESTS=new PlaybackRequestState();
let INFINITY_CONNECTED=false;
let CONNECT_CONTROLLER=null;
let CONNECT_LAST_FOCUS=null;
let PENDING_WATCH=null;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=v=>String(v??'').toLowerCase().normalize('NFKD');
const truth=v=>v===true||v===1||v==='1'||String(v).toLowerCase()==='true';
const cleanId=v=>v===null||v===undefined?'':String(v).trim();

const GRADES={
  g10:{label:'Grade 10',short:'G10',sections:['6'],kicker:'Foundation year'},
  g11:{label:'Grade 11',short:'G11',sections:['7'],kicker:'Momentum year'},
  g12:{label:'Grade 12',short:'G12',sections:['8','9'],kicker:'Finals year'},
  all:{label:'Full library',short:'ALL',sections:null,kicker:'Every program'}
};

const state={grade:'g10',q:'',subject:'',teacher:'',type:'',access:'',sort:'newest',favoritesOnly:false,limit:30};
const FAVORITES_KEY='courseSearch:favorites:v1';
const GRADE_KEY='courseSearch:grade:v2';
let favorites=new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]'));

function displaySubject(v){const id=String(v??'');return LABELS.subjects?.[id]||`Subject ${id||'—'}`}
function displayTeacher(v){const id=String(v??'');return LABELS.teachers?.[id]||`Teacher ${id||'—'}`}
function lessonKey(x){const id=cleanId(x.lessonId);return id?`lesson:${id}`:`ungrouped:${x.id}`}
function gradeRows(){const g=GRADES[state.grade];return !g.sections?DATA:DATA.filter(x=>g.sections.includes(String(x.section)))}
function currentGrade(){return GRADES[state.grade]||GRADES.g10}
function unique(rows,key){return [...new Set(rows.map(x=>x[key]).filter(v=>v!==null&&v!==undefined&&v!==''))]}
function saveFavorites(){localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]))}
function isFavorite(key){return favorites.has(key)}
function toast(message,type='ok'){
  const root=$('#toastStack');
  const item=document.createElement('div');
  item.className=`v2-toast ${type}`;
  item.textContent=message;
  root.appendChild(item);
  requestAnimationFrame(()=>item.classList.add('show'));
  setTimeout(()=>{item.classList.remove('show');setTimeout(()=>item.remove(),220)},2200);
}

function icon(name){
  const icons={
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    video:'<path d="M8 5v14l11-7Z"/>',
    pdf:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M8.5 16h7M8.5 12h5"/>',
    quiz:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-.9.6-1.5 1.1-1.5 2.2M12 17h.01"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    external:'<path d="M14 5h5v5M10 14l9-9"/><path d="M19 13v6H5V5h6"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;
}

function resourceKind(x){
  const hay=norm(`${x.type||''} ${x.video||''} ${x.topic||''} ${x.path||''}`);
  if(hay.includes('.pdf')||hay.includes('pdf'))return 'pdf';
  if(hay.includes('quiz')||hay.includes('test')||hay.includes('exam'))return 'quiz';
  if(hay.match(/\.(jpg|jpeg|png|webp|gif)\b/)||hay.includes('image'))return 'image';
  if(hay.includes('video')||hay.includes('youtube')||hay.includes('session')||hay.includes('lecture')||hay.includes('vid'))return 'video';
  if(hay.includes('link'))return 'link';
  return x.download?'link':'file';
}

function groupGrade(group){
  const sections=new Set(group.all.map(x=>String(x.section)));
  if([...sections].some(x=>GRADES.g10.sections.includes(x)))return 'g10';
  if([...sections].some(x=>GRADES.g11.sections.includes(x)))return 'g11';
  if([...sections].some(x=>GRADES.g12.sections.includes(x)))return 'g12';
  return 'all';
}

function gradeGroups(){
  const rows=gradeRows();
  const allowed=new Set(rows.map(x=>lessonKey(x)));
  return [...LESSONS.entries()].filter(([key])=>allowed.has(key));
}

function rowMatches(x,terms){
  if(terms.length&&!terms.every(t=>x._search.includes(t)))return false;
  if(state.subject&&String(x.subject)!==state.subject)return false;
  if(state.teacher&&String(x.teacher)!==state.teacher)return false;
  if(state.type&&String(x.type)!==state.type)return false;
  if(state.access==='free'&&!truth(x.free))return false;
  if(state.access==='paid'&&truth(x.free))return false;
  if(state.access==='link'&&!(x.hasLink??Boolean(x.download)))return false;
  return true;
}

function filteredGroups(){
  const terms=norm(state.q).trim().split(/\s+/).filter(Boolean);
  const groups=[];
  for(const [key,allRows] of gradeGroups()){
    if(state.favoritesOnly&&!isFavorite(key))continue;
    const all=allRows.filter(x=>state.grade==='all'||currentGrade().sections.includes(String(x.section)));
    const matched=all.filter(x=>rowMatches(x,terms));
    if(matched.length)groups.push({key,all,matched});
  }
  groups.sort((a,b)=>{
    if(state.sort==='relevance'&&terms.length&&a.matched.length!==b.matched.length)return b.matched.length-a.matched.length;
    if(state.sort==='resources'&&a.all.length!==b.all.length)return b.all.length-a.all.length;
    if(state.sort==='az')return String(a.all[0]?.lesson||'').localeCompare(String(b.all[0]?.lesson||''),undefined,{numeric:true});
    const ai=Number(a.all[0]?.lessonId),bi=Number(b.all[0]?.lessonId);
    if(Number.isFinite(ai)&&Number.isFinite(bi))return state.sort==='oldest'?ai-bi:bi-ai;
    return b.key.localeCompare(a.key,undefined,{numeric:true});
  });
  return groups;
}

function subjectIcon(name){
  const n=norm(name);
  if(n.includes('math')||n.includes('mechanic'))return '∑';
  if(n.includes('physics'))return '⚡';
  if(n.includes('chem'))return '⚗';
  if(n.includes('bio'))return '◉';
  if(n.includes('geolog'))return '◆';
  if(n.includes('english'))return 'A';
  if(n.includes('french'))return 'F';
  if(n.includes('german'))return 'G';
  if(n.includes('arabic'))return 'ع';
  return '•';
}

function rebuildFilters(){
  const rows=gradeRows();
  const defs=[['subject',unique(rows,'subject'),'subject'],['teacher',unique(rows,'teacher'),'teacher'],['type',unique(rows,'type'),'type']];
  for(const [id,values,kind] of defs){
    const el=$('#'+id);
    const old=state[id];
    el.innerHTML=`<option value="">${id==='subject'?'All subjects':id==='teacher'?'All teachers':'All resource types'}</option>`;
    values.sort((a,b)=>{
      const aa=kind==='subject'?displaySubject(a):kind==='teacher'?displayTeacher(a):String(a);
      const bb=kind==='subject'?displaySubject(b):kind==='teacher'?displayTeacher(b):String(b);
      return aa.localeCompare(bb,undefined,{numeric:true});
    }).forEach(v=>{
      const o=document.createElement('option');o.value=String(v);o.textContent=kind==='subject'?displaySubject(v):kind==='teacher'?displayTeacher(v):String(v);el.appendChild(o);
    });
    if([...el.options].some(o=>o.value===old))el.value=old;else state[id]='';
  }
  renderQuickSubjects();
}

function renderQuickSubjects(){
  const focusedSubject=document.activeElement?.closest('#quickSubjects [data-subject]')?.dataset.subject;
  const rows=gradeRows();
  const counts=new Map();
  rows.forEach(x=>{const id=String(x.subject??'');if(id)counts.set(id,(counts.get(id)||0)+1)});
  const items=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7);
  $('#quickSubjects').innerHTML=`<button class="subject-chip ${state.subject?'':'active'}" data-subject="" type="button" aria-pressed="${!state.subject}">All subjects</button>`+items.map(([id,count])=>`<button class="subject-chip ${state.subject===id?'active':''}" data-subject="${esc(id)}" data-art="${StudyStreamArtwork.forSubject(id,displaySubject(id)).palette}" aria-pressed="${state.subject===id}" type="button"><span>${esc(subjectIcon(displaySubject(id)))}</span>${esc(displaySubject(id))}<small>${count}</small></button>`).join('');
  $$('#quickSubjects [data-subject]').forEach(btn=>btn.onclick=()=>{state.subject=btn.dataset.subject;$('#subject').value=state.subject;state.limit=30;renderQuickSubjects();render()});
  if(focusedSubject!==undefined)$$('#quickSubjects [data-subject]').find(btn=>btn.dataset.subject===focusedSubject)?.focus({preventScroll:true});
}

function renderGradeGate(){
  const rows=DATA;
  $('#gradeChoiceGrid').innerHTML=['g10','g11','g12'].map(key=>{
    const g=GRADES[key];
    const gradeRows=rows.filter(x=>g.sections.includes(String(x.section)));
    const lessonCount=new Set(gradeRows.map(lessonKey)).size;
    return `<button class="grade-choice ${key}" type="button" data-grade="${key}"><span class="grade-choice-num">${g.short}</span><div><strong>${g.label}</strong><span>${g.kicker}</span><small>${lessonCount.toLocaleString()} lessons · ${gradeRows.length.toLocaleString()} resources</small></div><b>${icon('arrow')}</b></button>`;
  }).join('');
  $$('#gradeChoiceGrid [data-grade]').forEach(btn=>btn.onclick=()=>{setGrade(btn.dataset.grade,true);closeGradeGate()});
}
function openGradeGate(){const gate=$('#gradeGate');gate.classList.add('open');gate.setAttribute('aria-hidden','false')}
function closeGradeGate(){const gate=$('#gradeGate');gate.classList.remove('open');gate.setAttribute('aria-hidden','true')}

function setGrade(grade,persist=true){
  if(!GRADES[grade])grade='g10';
  state.grade=grade;
  state.subject='';state.teacher='';state.type='';state.access='';state.favoritesOnly=false;state.limit=30;
  if(persist&&grade!=='all')localStorage.setItem(GRADE_KEY,grade);
  document.body.dataset.grade=grade;
  const g=currentGrade();
  const libraryLabel=grade==='all'?'Full library':`${g.label} library`;
  $('#brandGrade').textContent=libraryLabel;
  $('#resultKicker').textContent=libraryLabel;
  $$('#gradeTabs [data-grade]').forEach(b=>{b.classList.toggle('active',b.dataset.grade===grade);b.setAttribute('aria-pressed',String(b.dataset.grade===grade))});
  $('#browseAllMenuBtn').classList.toggle('active',grade==='all');
  $('#browseAllMenuBtn').setAttribute('aria-pressed',String(grade==='all'));
  $('#gradeTabs').classList.toggle('all-mode',grade==='all');
  rebuildFilters();
  syncControls();
  render();
}

function activeFilterCount(){return ['subject','teacher','type','access'].filter(k=>state[k]).length+(state.favoritesOnly?1:0)}
function syncControls(){
  $('#subject').value=state.subject;$('#teacher').value=state.teacher;$('#type').value=state.type;$('#access').value=state.access;$('#sort').value=state.sort;
  $('#favoritesOnly').classList.toggle('active',state.favoritesOnly);
  $('#favoritesOnly').setAttribute('aria-pressed',String(state.favoritesOnly));
  const n=activeFilterCount();$('#activeFilterCount').textContent=n;$('#activeFilterCount').classList.toggle('hidden',!n);
  $('#filterState').textContent=[state.q?'Search active':'',n?`${n} active filter${n===1?'':'s'}`:'',state.sort!=='newest'?$('#sort option:checked').textContent:''].filter(Boolean).join(' · ')||'All lessons';
  ['subject','teacher','type','access','sort'].forEach(id=>$('#'+id).classList.toggle('filter-active',id==='sort'?state.sort!=='newest':Boolean(state[id])));
  $('#clear').classList.toggle('hidden',!state.q);
}

function safeExternalUrl(raw){
  try{const u=new URL(String(raw||''));return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}
}
function isVideoResource(x){
  if(x.isVideo!==undefined)return x.isVideo;
  if(x.embedUrl)return true;
  const url=String(x.download||x.path||'').toLowerCase().split('?')[0];
  return resourceKind(x)==='video'||/\.(mp4|webm|m3u8|mov|m4v)$/.test(url);
}
function safeBunnyEmbed(raw){
  try{
    const u=new URL(String(raw||''));
    return u.protocol==='https:'&&u.hostname==='iframe.mediadelivery.net'&&/^\/embed\/\d+\/[0-9a-f-]{36}\/?$/i.test(u.pathname)?u.href:'';
  }catch{return ''}
}
function playbackReferrerPolicy(){
  return ['origin','strict-origin-when-cross-origin','no-referrer'].includes(PLAYBACK_SETTINGS.referrerPolicy)?PLAYBACK_SETTINGS.referrerPolicy:'origin';
}
function setWatchError(message){
  const el=$('#watchError');el.textContent=message||'';el.classList.toggle('hidden',!message);
}
function updateWatchSource(x){
  const video=$('#watchVideo');
  const frame=$('#watchFrame');
  const qualityWrap=$('#watchQualityWrap');
  const qualitySelect=$('#watchQuality');
  const embed=safeBunnyEmbed(x?.embedUrl);
  const url=safeExternalUrl(x?.download);
  video.pause();video.removeAttribute('src');video.load();
  // Remove the iframe src whenever it is hidden so the Bunny player stops playing.
  frame.removeAttribute('src');
  frame.referrerPolicy=playbackReferrerPolicy();
  frame.classList.toggle('hidden',!embed);
  video.referrerPolicy=playbackReferrerPolicy();
  const source=embed||url;
  $('#watchOpenExternal').classList.toggle('hidden',!source);
  if(embed){
    WATCH_URL=null;WATCH_RAW_URL=null;WATCH_QUALITY='auto';
    qualityWrap?.classList.add('hidden');
    frame.src=embed;
  }else if(url){
    WATCH_RAW_URL=url;
    WATCH_URL=url;
    const match=url.match(/(?:play_|_|-)(\d+p)\.mp4/i);
    WATCH_QUALITY=match?match[1].toLowerCase():'auto';
    if(qualitySelect)qualitySelect.value=WATCH_QUALITY;
    qualityWrap?.classList.remove('hidden');
    video.src=url;
    video.load();
  }else{
    WATCH_URL=null;WATCH_RAW_URL=null;WATCH_QUALITY='auto';
    qualityWrap?.classList.add('hidden');
    if(qualitySelect)qualitySelect.value='auto';
  }
  video.classList.toggle('hidden',Boolean(embed)||!url);
  $('#watchPlaceholder').classList.toggle('hidden',Boolean(source));
}
function switchWatchQuality(targetQuality){
  const video=$('#watchVideo');
  if(!WATCH_URL||!video)return;
  let newUrl=WATCH_URL;
  if(targetQuality==='auto'){
    newUrl=WATCH_RAW_URL||WATCH_URL;
  }else if(/play_\d+p\.mp4/i.test(WATCH_URL)){
    newUrl=WATCH_URL.replace(/play_\d+p\.mp4/i,`play_${targetQuality}.mp4`);
  }else if(/(?:_|-)\d+p\.mp4/i.test(WATCH_URL)){
    newUrl=WATCH_URL.replace(/([_-])\d+p\.mp4/i,`$1${targetQuality}.mp4`);
  }else if(/playlist\.m3u8/i.test(WATCH_URL)){
    newUrl=WATCH_URL.replace(/playlist\.m3u8/i,`play_${targetQuality}.mp4`);
  }else if(/\.b-cdn\.net\/[^/?#]+\/[^/?#]+\.mp4/i.test(WATCH_URL)){
    newUrl=WATCH_URL.replace(/(\.b-cdn\.net\/[^/?#]+\/)[^/?#]+\.mp4/i,`$1play_${targetQuality}.mp4`);
  }else if(/\.b-cdn\.net\/[^/?#]+\.mp4/i.test(WATCH_URL)){
    newUrl=WATCH_URL.replace(/(\.b-cdn\.net\/)[^/?#]+\.mp4/i,`$1play_${targetQuality}.mp4`);
  }
  if(!newUrl||newUrl===video.getAttribute('src'))return;
  const prevTime=video.currentTime||0;
  const isPlaying=!video.paused;
  WATCH_URL=newUrl;
  WATCH_QUALITY=targetQuality;
  const restore=()=>{
    video.removeEventListener('loadedmetadata',restore);
    try{
      if(prevTime>0&&Number.isFinite(prevTime)){
        video.currentTime=Math.min(prevTime,video.duration||prevTime);
      }
      if(isPlaying){
        video.play().catch(()=>{});
      }
    }catch{}
  };
  video.addEventListener('loadedmetadata',restore);
  video.src=newUrl;
  video.load();
}
async function loadWatchGuide(){
  const generation=WATCH_VIEW_GENERATION;
  const section=$('#watchHelpSection');
  section.classList.add('hidden');
  try{
    const response=await fetch('/api/playback/guide',{cache:'no-store'});
    if(!response.ok)return;
    const guide=await response.json();
    if(generation!==WATCH_VIEW_GENERATION||WATCH_ID===null)return;
    if(!guide.enabled)return;
    WATCH_GUIDE=guide;
    $('#watchHelpTitle').textContent=guide.title||'Playback help';
    $('#watchHelpIntro').textContent=guide.introduction||'';
    $('#watchHelpSteps').textContent=guide.steps||'';
    $('#watchHelpCode').textContent=guide.code||'';
    $('#watchHelpCodeWrap').classList.toggle('hidden',!guide.code);
    section.classList.remove('hidden');
  }catch{}
}
function toggleWatchGuide(force){
  const panel=$('#watchHelpPanel');
  const opening=typeof force==='boolean'?force:panel.classList.contains('hidden');
  panel.classList.toggle('hidden',!opening);
  $('#watchHelpToggle').setAttribute('aria-expanded',String(opening));
}
function openWatch(videoId,externalWindow=null){
  const x=DATA.find(r=>String(r.id)===String(videoId));
  if(!x)return toast('Video not found in this library.','error');
  WATCH_ID=Number(x.id);WATCH_LAST_FOCUS=document.activeElement;
  WATCH_VIEW_GENERATION++;
  PLAYBACK_REQUESTS.cancel();
  WATCH_GUIDE=null;toggleWatchGuide(false);
  $('#watchTitle').textContent=x.video||x.topic||'Course video';
  $('#watchSubtitle').textContent=[x.lesson,x.topic].filter(Boolean).join(' · ')||'Course video';
  $('#watchId').textContent=`Video ID #${x.id}`;
  setWatchError('Loading an authorized video link…');updateWatchSource(null);
  const configured=PLAYBACK_SETTINGS.siteOrigin;
  if(configured&&configured!==location.origin){
    setWatchError(`This site is running on ${location.origin}, but admin configured ${configured}. The browser sends its real origin, not the configured one. If playback fails, ask the admin to check the allowed CDN domains.`);
  }
  $('#watchOverlay').classList.remove('hidden');
  $('#watchOverlay').setAttribute('aria-hidden','false');
  document.body.classList.add('watch-open');
  $('#watchClose').focus();
  refreshVideo(videoId,null,externalWindow);
  loadWatchGuide();
}
function closeWatch(){
  WATCH_VIEW_GENERATION++;
  PLAYBACK_REQUESTS.cancel();PENDING_WATCH=null;
  const video=$('#watchVideo');video.pause();video.removeAttribute('src');video.load();
  $('#watchFrame').removeAttribute('src');
  $('#watchQualityWrap')?.classList.add('hidden');
  $('#watchOverlay').classList.add('hidden');$('#watchOverlay').setAttribute('aria-hidden','true');
  document.body.classList.remove('watch-open');WATCH_ID=null;
  WATCH_LAST_FOCUS?.focus?.();
}
function privateHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':SESSION?.csrfToken||''}}
function setInfinityConnected(connected){
  INFINITY_CONNECTED=connected;
  $('#infinityState').textContent=connected?'Infinity connected':'Not connected';
  $('#infinityConnect').textContent=connected?'Reconnect Infinity account':'Connect Infinity account';
  $('#infinityDisconnect').classList.toggle('hidden',!connected);
}
function showInfinityDialog(reason=''){
  if(typeof reason!=='string')reason='';
  if($('#infinityDialog').open)return;
  CONNECT_LAST_FOCUS=document.activeElement;
  $('#infinityDialogTitle').textContent=(reason||INFINITY_CONNECTED)?'Reconnect Infinity account':'Connect Infinity account';
  $('#infinityError').textContent=reason;$('#infinityLoading').textContent='';
  $('#infinityDialog').showModal();$('#infinityEmail').focus();
}
function closeInfinityDialog(){
  CONNECT_CONTROLLER?.abort();CONNECT_CONTROLLER=null;
  $('#infinityPassword').value='';$('#infinityDialog').close();
  CONNECT_LAST_FOCUS?.focus?.();
}
// Match the currently inspected provider algorithm, using only the REAL viewer browser.
async function viewerVisitorId(){
  let vendor=null,audio=null;
  try{const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');vendor=ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null}catch{}
  let context;
  try{
    context=new(window.AudioContext||window.webkitAudioContext)();
    const oscillator=context.createOscillator(),analyser=context.createAnalyser();
    oscillator.connect(analyser);analyser.connect(context.destination);oscillator.start();
    const data=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(data);
    oscillator.stop();audio=data.join(',');
  }catch{}finally{await context?.close().catch(()=>{})}
  const data={hardwareConcurrency:navigator.hardwareConcurrency||'unknown',deviceMemory:navigator.deviceMemory||'unknown',screenResolution:`${screen.width}x${screen.height}`,platform:navigator.platform,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,webglVendor:vendor,audioContextHash:audio,hasTouchSupport:'maxTouchPoints'in navigator?navigator.maxTouchPoints>0:false};
  if(!crypto.subtle)throw new Error('A secure HTTPS connection is required to collect Infinity’s device information.');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function refreshVideo(videoId,button,externalWindow=null){
  if(WATCH_ID!==Number(videoId)){openWatch(videoId);externalWindow?.close();return}
  const request=PLAYBACK_REQUESTS.begin();
  $('#watchRefresh').disabled=true;$('#watchOpenExternal').disabled=true;if($('#watchQuality'))$('#watchQuality').disabled=true;
  updateWatchSource(null);setWatchError('Loading an authorized video link…');
  try{
    if(!INFINITY_CONNECTED){PENDING_WATCH={id:Number(videoId),generation:request.generation};externalWindow?.close();setWatchError('Connect your Infinity account to watch this video.');showInfinityDialog();return}
    const response=await PLAYBACK_REQUESTS.fetch(request,'/api/videos/playback',{method:'POST',cache:'no-store',credentials:'same-origin',headers:privateHeaders(),body:JSON.stringify({videoId:Number(videoId)})});
    const data=await response.json().catch(()=>({}));
    if(!PLAYBACK_REQUESTS.current(request)||WATCH_ID!==Number(videoId)){externalWindow?.close();return}
    if(response.status===401&&data.code==='COURSE_AUTH_REQUIRED'){location.href='/';return}
    if(['RECONNECT_REQUIRED','PROVIDER_DEVICE','PROVIDER_CHALLENGE'].includes(data.code)){
      setInfinityConnected(false);$('#infinityState').textContent='Reconnect needed';PENDING_WATCH={id:Number(videoId),generation:request.generation};externalWindow?.close();showInfinityDialog(data.error);setWatchError(data.error);return;
    }
    if(!response.ok)throw new Error(data.error||'Unable to retrieve the video.');
    updateWatchSource(data.kind==='embed'?{embedUrl:data.url}:{download:data.url});setWatchError('');
    if(externalWindow){externalWindow.location.replace(data.url)}
  }catch(err){externalWindow?.close();if(PLAYBACK_REQUESTS.current(request))setWatchError(err.message||'Unable to retrieve the video.')}
  finally{if(PLAYBACK_REQUESTS.current(request)){$('#watchRefresh').disabled=false;$('#watchOpenExternal').disabled=false;if($('#watchQuality'))$('#watchQuality').disabled=false}}
}

function resourceRow(x,index,matchedIds){
  const kind=resourceKind(x);
  const match=matchedIds.has(String(x.id));
  const url=safeBunnyEmbed(x.embedUrl)||safeExternalUrl(x.download);
  const video=isVideoResource(x);
  return `<article class="v2-resource ${match?'matched':''}" data-art="${StudyStreamArtwork.forSubject(x.subject,displaySubject(x.subject)).palette}">
    <div class="resource-kind ${kind}">${icon(kind)}</div>
    <div class="resource-copy"><strong>${esc(x.video||x.topic||'Untitled resource')}</strong><div><span>#${esc(x.id)}</span>${x.topic?`<span>${esc(x.topic)}</span>`:''}${x.type?`<span>${esc(x.type)}</span>`:''}${match?'<em>match</em>':''}</div></div>
    <div class="resource-buttons">
      ${video?`<button class="resource-action resource-watch" data-watch="${esc(x.id)}" type="button">${icon('video')}<span>Watch</span></button>`:''}
      ${video?`<button class="resource-action" data-video-open="${esc(x.id)}" type="button"><span>Open</span>${icon('external')}</button>`:url?`<a class="resource-action" href="${esc(url)}" target="_blank" rel="noopener" referrerpolicy="${esc(playbackReferrerPolicy())}"><span>Open</span>${icon('external')}</a>`:'<span class="resource-unavailable">No direct link</span>'}
      ${video?`<button class="resource-retry" data-refresh="${esc(x.id)}" type="button" aria-label="Refresh video link for resource ${esc(x.id)}" title="Request an updated video link">↻</button>`:''}
    </div>
  </article>`;
}

function groupBlock(group,index,autoOpen){
  const all=group.all.slice().sort((a,b)=>Number(a.topicId??1e15)-Number(b.topicId??1e15)||Number(a.id??0)-Number(b.id??0));
  const x=all[0]||{};
  const lessonId=cleanId(x.lessonId)||'—';
  const lessonName=x.lesson||`Lesson ${lessonId}`;
  const matchedIds=new Set(group.matched.map(r=>String(r.id)));
  const topics=unique(all,'topic');
  const links=all.filter(r=>r.hasLink??Boolean(r.download)).length;
  const kinds={};all.forEach(r=>{const k=resourceKind(r);kinds[k]=(kinds[k]||0)+1});
  const grade=groupGrade(group);
  const g=GRADES[grade];
  const fav=isFavorite(group.key);
  const matchNote=group.matched.length!==all.length?`<span class="match-badge">${group.matched.length} matched</span>`:'';
  const kindText=Object.entries(kinds).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,n])=>`${n} ${n===1?k:k==='quiz'?'quizzes':k+'s'}`).join(' · ');
  const artwork=StudyStreamArtwork.forSubject(x.subject,displaySubject(x.subject));
  const thumbnail=all.map(row=>StudyStreamArtwork.thumbnail(row.lessonThumb)||StudyStreamArtwork.thumbnail(row.thumb)).find(Boolean);
  return `<details class="v2-lesson" data-key="${esc(group.key)}" data-art="${artwork.palette}" ${autoOpen?'open':''}>
    <summary id="lesson-card-${index}" aria-controls="lesson-resources-${index}" aria-expanded="${autoOpen}">
      <div class="lesson-cover"><img class="lesson-art" src="/assets/art/${artwork.asset}.svg" alt="" aria-hidden="true"><span class="lesson-cover-label" aria-hidden="true">${esc(displaySubject(x.subject))}</span>${thumbnail?`<img class="lesson-thumbnail" src="${esc(thumbnail)}" alt="" loading="lazy" decoding="async">`:''}<div class="lesson-id-pill"><small>LESSON</small><strong>${esc(lessonId)}</strong></div></div>
      <div class="lesson-main-copy"><div class="lesson-topline"><span class="grade-mini ${grade}">${esc(g.short)}</span><span class="subject-mini">${esc(displaySubject(x.subject))}</span>${matchNote}</div><h3>${esc(lessonName)}</h3><div class="lesson-meta"><span>${esc(displayTeacher(x.teacher))}</span><span>${topics.length} topic${topics.length===1?'':'s'}</span><span>${all.length} resource${all.length===1?'':'s'}</span><span>${links} direct link${links===1?'':'s'}</span></div></div>
      <div class="lesson-side"><span class="inspect-resources">${autoOpen?'Resources open':'Inspect resources'}</span><button class="favorite-btn ${fav?'active':''}" data-favorite="${esc(group.key)}" type="button" aria-pressed="${fav}" aria-label="${fav?'Remove from favorites':'Add to favorites'}: ${esc(lessonName)}" title="${fav?'Remove from favorites':'Add to favorites'}">${icon('star')}</button><div class="lesson-chevron-v2"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div></div>
    </summary>
   </details>
    <section class="lesson-expanded" id="lesson-resources-${index}" data-panel-key="${esc(group.key)}" data-art="${artwork.palette}" aria-labelledby="lesson-heading-${index}" ${autoOpen?'':'hidden'}>
      <div class="lesson-expanded-head"><div><span class="subject-mini">${esc(displaySubject(x.subject))} · ${esc(displayTeacher(x.teacher))} · Lesson ${esc(lessonId)}</span><h3 id="lesson-heading-${index}">${esc(lessonName)}</h3><strong>${esc(kindText||'Course resources')}</strong><span>All resources grouped under Lesson ID ${esc(lessonId)}.</span></div><button class="toolbar-btn" data-close-lesson="${index}" type="button">Close resources ×</button></div>
      <div class="v2-resource-list">${all.map((r,i)=>resourceRow(r,i,matchedIds)).join('')}</div>
    </section>`;
}

function bindDynamicActions(){
  $$('.favorite-btn').forEach(btn=>btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    const key=btn.dataset.favorite;
    if(favorites.has(key)){favorites.delete(key);toast('Removed from favorites','neutral')}else{favorites.add(key);toast('Saved to favorites')}
    saveFavorites();render();($$('.favorite-btn').find(el=>el.dataset.favorite===key)||(mobileBrowse.matches?$('#browseMenuBtn'):$('#favoritesOnly'))).focus({preventScroll:true});
  }));
  $$('.v2-lesson').forEach(card=>card.addEventListener('toggle',layoutLessonPanels));
  $$('[data-close-lesson]').forEach(button=>button.onclick=()=>{const summary=$('#lesson-card-'+button.dataset.closeLesson);summary.parentElement.open=false;layoutLessonPanels();summary.focus({preventScroll:true})});
}
function layoutLessonPanels(){
  const root=$('#results');
  const cards=$$('.v2-lesson');
  const columns=Math.max(1,getComputedStyle(root).gridTemplateColumns.split(' ').length);
  const focused=document.activeElement;
  cards.forEach((card,index)=>{
    const summary=card.querySelector('summary');
    const panel=document.getElementById(summary.getAttribute('aria-controls'));
    panel.hidden=!card.open;
    summary.setAttribute('aria-expanded',String(card.open));
    card.querySelector('.inspect-resources').textContent=card.open?'Resources open':'Inspect resources';
    const rowEnd=cards[Math.min(cards.length-1,Math.floor(index/columns)*columns+columns-1)];
    // Move only resource panels, never cards: opening leaves summary focus/scroll intact.
    const nextCard=cards[cards.indexOf(rowEnd)+1]||null;
    if(panel.nextElementSibling!==nextCard)root.insertBefore(panel,nextCard);
  });
  if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
}
new ResizeObserver(()=>layoutLessonPanels()).observe($('#results'));
let renderedFilterSignature='';
document.addEventListener('error',event=>{if(event.target.matches?.('.lesson-thumbnail'))event.target.remove()},true);

function render(){
  if(!DATA.length)return;
  const groups=filteredGroups();
  const shown=groups.slice(0,state.limit);
  const matchedRows=groups.reduce((n,g)=>n+g.matched.length,0);
  $('#matchCount').textContent=groups.length.toLocaleString();
  $('#groupCountLabel').textContent=groups.length===1?'lesson group':'lesson groups';
  const gradeTotal=gradeRows().length;
  const searchNote=state.q?` · ${matchedRows.toLocaleString()} matching resources`:'';
  $('#summary').textContent=`${gradeTotal.toLocaleString()} resources in this view${searchNote}`;
  const autoOpen=Boolean(state.q.trim())&&groups.length<=8;
  const signature=JSON.stringify([state.grade,state.q,state.subject,state.teacher,state.type,state.access,state.sort,state.favoritesOnly]);
  const previous=new Map($$('.v2-lesson').map(card=>[card.dataset.key,card.open]));
  $('#results').innerHTML=shown.map((g,i)=>groupBlock(g,i,signature===renderedFilterSignature&&previous.has(g.key)?previous.get(g.key):autoOpen&&i<8)).join('');
  renderedFilterSignature=signature;
  $('#empty').classList.toggle('hidden',groups.length!==0);
  $('#loadWrap').classList.toggle('hidden',groups.length<=state.limit);
  syncControls();
  renderQuickSubjects();
  bindDynamicActions();
  layoutLessonPanels();
}

function resetFilters(keepGrade=true){
  state.q='';state.subject='';state.teacher='';state.type='';state.access='';state.sort='newest';state.favoritesOnly=false;state.limit=30;
  $('#q').value='';rebuildFilters();syncControls();render();
}

async function boot(){
  try{
    const [sessionRes,dataRes,labelsRes,versionRes]=await Promise.all([
      fetch('/api/session',{cache:'no-store'}),fetch('/api/courses',{cache:'no-store'}),fetch('/api/labels',{cache:'no-store'}),fetch('/api/courses/version',{cache:'no-store'})
    ]);
    if([sessionRes,dataRes,labelsRes,versionRes].some(r=>r.status===401)){location.href='/';return}
    if([sessionRes,dataRes,labelsRes,versionRes].some(r=>!r.ok))throw new Error('Could not load the private library.');
    SESSION=await sessionRes.json();DATA=await dataRes.json();LABELS=await labelsRes.json();DATA_VERSION=(await versionRes.json()).version||null;
    setInfinityConnected(Boolean(SESSION.infinityConnected));
    try{const settings=await fetch('/api/playback/settings',{cache:'no-store'});if(settings.ok)PLAYBACK_SETTINGS=await settings.json()}catch{}
    $('#siteReferrerPolicy').content=playbackReferrerPolicy();
    for(const x of DATA){
      x.subjectName=displaySubject(x.subject);x.teacherName=displayTeacher(x.teacher);
      x._search=norm([x.id,x.topicId,x.lessonId,x.video,x.topic,x.lesson,x.teacher,x.subject,x.subjectName,x.teacherName,x.section,x.type,x.description,x.topicDescription].join(' '));
      const key=lessonKey(x);if(!LESSONS.has(key))LESSONS.set(key,[]);LESSONS.get(key).push(x);
    }
    $('#sessionLabel').textContent=SESSION.label||'Private access';
    if(SESSION.role==='admin'){$('#adminLink').classList.remove('hidden');$('#adminMenuLink').classList.remove('hidden')}
    renderGradeGate();
    const saved=localStorage.getItem(GRADE_KEY);
    setGrade(GRADES[saved]?saved:'g10',false);
    $('#loading').classList.add('hidden');$('#resultsArea').classList.remove('hidden');
    if(!GRADES[saved])openGradeGate();
  }catch(e){$('#loading').innerHTML=`<span>${esc(e.message)}</span>`}
}

$('#results').addEventListener('click',e=>{
  const watch=e.target.closest('[data-watch]');
  if(watch){openWatch(watch.dataset.watch);return}
  const external=e.target.closest('[data-video-open]');
  if(external){openWatch(external.dataset.videoOpen,newPlaybackWindow());return}
  const refresh=e.target.closest('[data-refresh]');
  if(refresh){refreshVideo(refresh.dataset.refresh,refresh)}
});
$('#watchHelpToggle').addEventListener('click',()=>toggleWatchGuide());
$('#watchHelpCopy').addEventListener('click',async()=>{
  const btn=$('#watchHelpCopy');
  try{await navigator.clipboard.writeText($('#watchHelpCode').textContent);btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy code',1400)}
  catch{toast('Could not copy automatically. Select the code and copy it manually.','error')}
});
$('#watchClose').addEventListener('click',closeWatch);
$('#watchQuality')?.addEventListener('change',e=>switchWatchQuality(e.target.value));
function newPlaybackWindow(){const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;return popup}
$('#watchOpenExternal').addEventListener('click',()=>{if(WATCH_ID!==null)refreshVideo(WATCH_ID,null,newPlaybackWindow())});
$('#infinityConnect').addEventListener('click',showInfinityDialog);
$('#infinityCancel').addEventListener('click',()=>{PENDING_WATCH=null;closeInfinityDialog()});
$('#infinityDialog').addEventListener('cancel',e=>{e.preventDefault();if(!CONNECT_CONTROLLER){PENDING_WATCH=null;closeInfinityDialog()}});
$('#infinityForm').addEventListener('submit',async e=>{
  e.preventDefault();if(CONNECT_CONTROLLER)return;
  const controller=new AbortController();CONNECT_CONTROLLER=controller;
  let password=$('#infinityPassword').value;$('#infinityPassword').value='';
  const email=$('#infinityEmail').value.trim();
  for(const id of ['infinitySubmit','infinityCancel','infinityEmail','infinityPassword','infinityDisconnect'])$('#'+id).disabled=true;
  $('#infinityError').textContent='';$('#infinityLoading').textContent='Connecting to Infinity…';
  try{
    const visitorId=await viewerVisitorId();
    let payload=JSON.stringify({email,password,visitorId});password=null;
    let response;
    try{response=await fetch('/api/infinity/connect',{method:'POST',cache:'no-store',credentials:'same-origin',headers:privateHeaders(),signal:controller.signal,body:payload})}finally{payload=null}
    const data=await response.json().catch(()=>({}));
    if(controller!==CONNECT_CONTROLLER)return;
    if(!response.ok){
      if(response.status===429){
        const seconds=Number(response.headers.get('Retry-After'));
        const wait=Number.isFinite(seconds)&&seconds>0?` Wait at least ${Math.ceil(seconds/60)} minute(s) before retrying.`:' Wait before retrying.';
        throw new Error((data.error||'Too many requests.')+wait);
      }
      if(data.code==='PROVIDER_CHALLENGE'){
        const stages={login_page:'while opening the Infinity login page',login_submission:'after submitting the login form',account_validation:'while checking the logged-in account'};
        const where=stages[data.stage]||'during sign-in';
        throw new Error(`Infinity verification was detected ${where}. Sign in on Infinity directly and complete any provider-required verification. If normal login works, contact the administrator: the integration may be misclassifying the provider response. Repeated retries will trigger rate limiting.`);
      }
      throw new Error(data.error||'Unable to connect to Infinity.');
    }
    setInfinityConnected(true);CONNECT_CONTROLLER=null;closeInfinityDialog();toast('Infinity account connected.');
    const pending=PENDING_WATCH;PENDING_WATCH=null;
    if(pending&&WATCH_ID===pending.id&&PLAYBACK_REQUESTS.generation===pending.generation)refreshVideo(pending.id);
  }catch(error){if(controller===CONNECT_CONTROLLER){setInfinityConnected(false);$('#infinityError').textContent=error.message||'Connection failed.'}}
  finally{
    password=null;$('#infinityPassword').value='';
    if(CONNECT_CONTROLLER===controller)CONNECT_CONTROLLER=null;
    $('#infinityLoading').textContent='';
    for(const id of ['infinitySubmit','infinityCancel','infinityEmail','infinityPassword','infinityDisconnect'])$('#'+id).disabled=false;
  }
});
$('#infinityDisconnect').addEventListener('click',async()=>{
  PLAYBACK_REQUESTS.cancel();PENDING_WATCH=null;updateWatchSource(null);
  $('#infinityDisconnect').disabled=true;$('#infinityConnect').disabled=true;
  try{
    const response=await fetch('/api/infinity/disconnect',{method:'POST',cache:'no-store',headers:privateHeaders()});
    if(!response.ok)throw new Error('Unable to disconnect. Please try again.');
    setInfinityConnected(false);if(WATCH_ID!==null)setWatchError('Infinity disconnected. Reconnect to watch.');toast('Infinity account disconnected.');
  }catch(error){toast(error.message,'error')}
  finally{$('#infinityDisconnect').disabled=false;$('#infinityConnect').disabled=false;$('#watchRefresh').disabled=false}
});
$('#watchOverlay').addEventListener('click',e=>{if(e.target===$('#watchOverlay'))closeWatch()});
$('#watchRefresh').addEventListener('click',()=>{if(WATCH_ID!==null)refreshVideo(WATCH_ID,$('#watchRefresh'))});
$('#watchVideo').addEventListener('error',()=>{
  if(WATCH_ID!==null)setWatchError('This video could not be loaded. Its link may have expired, or the CDN may reject this domain, token, or session. Press Refresh video link to fetch its Video ID again.');
});

let searchTimer;
const mobileBrowse=window.matchMedia('(max-width: 850px)');
function closeBrowseMenu(){
  if(!$('#browseDialog').open)return;
  $('#browseDialog').close();
  document.body.classList.remove('browse-menu-open');
  $('#browseMenuBtn').setAttribute('aria-expanded','false');
  $('#browseMenuBtn').focus({preventScroll:true});
}
function positionBrowseNavigation(){
  const focused=document.activeElement;
  const restore=$('#browseSidebar').contains(focused);
  if(!mobileBrowse.matches)closeBrowseMenu();
  (mobileBrowse.matches?$('#mobileSidebarSlot'):$('#sidebarSlot')).appendChild($('#browseSidebar'));
  if(restore&&!mobileBrowse.matches)focused.focus({preventScroll:true});
}
mobileBrowse.addEventListener('change',positionBrowseNavigation);
positionBrowseNavigation();
$('#browseMenuBtn').onclick=()=>{
  $('#browseDialog').showModal();
  document.body.classList.add('browse-menu-open');
  $('#browseMenuBtn').setAttribute('aria-expanded','true');
  $('#browseMenuClose').focus();
};
$('#browseMenuClose').onclick=closeBrowseMenu;
$('#browseDialog').addEventListener('cancel',event=>{event.preventDefault();closeBrowseMenu()});
$('#browseDialog').addEventListener('click',event=>{if(event.target===$('#browseDialog'))closeBrowseMenu()});
$('#browseDialog').addEventListener('keydown',event=>{
  if(event.key!=='Tab'||$('#infinityDialog').open)return;
  const controls=[...$('#browseDialog').querySelectorAll('button,a[href],select,input')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
});
$('#q').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value;state.limit=30;render()},70)});
$('#clear').onclick=()=>{state.q='';$('#q').value='';state.limit=30;render();$('#q').focus()};
['subject','teacher','type','access','sort'].forEach(id=>$('#'+id).addEventListener('change',e=>{state[id]=e.target.value;state.limit=30;render()}));
$('#favoritesOnly').onclick=()=>{state.favoritesOnly=!state.favoritesOnly;state.limit=30;render()};
$('#reset').onclick=()=>resetFilters();$('#emptyReset').onclick=()=>resetFilters();
$('#loadMore').onclick=()=>{state.limit+=30;render()};
$('#expandAll').onclick=()=>{$$('.v2-lesson').forEach(d=>d.open=true);layoutLessonPanels()};
$('#collapseAll').onclick=()=>{$$('.v2-lesson').forEach(d=>d.open=false);layoutLessonPanels()};
$('#filterTrigger').onclick=()=>{const p=$('#filterPanel');const open=p.classList.toggle('collapsed')===false;$('#filterTrigger').setAttribute('aria-expanded',String(open))};
$$('#gradeTabs [data-grade]').forEach(btn=>btn.onclick=()=>setGrade(btn.dataset.grade));
$('#browseAllBtn').onclick=()=>{setGrade('all',false);closeGradeGate()};
$('#changeGradeBtn').onclick=()=>{closeBrowseMenu();openGradeGate()};
$('#browseAllMenuBtn').onclick=()=>setGrade('all',false);
$('#profileBtn').onclick=e=>{e.stopPropagation();const m=$('#profileMenu');m.classList.toggle('hidden');$('#profileBtn').setAttribute('aria-expanded',String(!m.classList.contains('hidden')))};
document.addEventListener('click',e=>{if(!e.target.closest('.v2-top-actions'))$('#profileMenu').classList.add('hidden')});
$('#logoutBtn').onclick=async()=>{
  PLAYBACK_REQUESTS.cancel();PENDING_WATCH=null;updateWatchSource(null);
  const response=await fetch(SESSION?.role==='admin'?'/api/admin/logout':'/api/logout',{method:'POST',headers:privateHeaders()});
  if(response.ok)location.href='/';else toast('Logout failed. Please try again.','error');
};
document.addEventListener('keydown',e=>{
  if($('#browseDialog').open)return;
  if($('#watchOverlay').classList.contains('hidden')&&(e.key==='/'||(e.ctrlKey&&e.key.toLowerCase()==='k'))&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();$('#q').focus()}
  if($('#infinityDialog').open)return;
  if(e.key==='Escape'&&!$('#watchOverlay').classList.contains('hidden')){closeWatch();return}
  if(e.key==='Tab'&&!$('#watchOverlay').classList.contains('hidden')){
    const focusable=[...$('#watchOverlay').querySelectorAll('button,a[href],video,iframe,select,[tabindex="0"]')].filter(el=>!el.disabled&&!el.closest('.hidden'));
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  }
  if(e.key==='Escape'&&$('#gradeGate').classList.contains('open')&&localStorage.getItem(GRADE_KEY))closeGradeGate();
});
setInterval(async()=>{
  try{const r=await fetch('/api/courses/version',{cache:'no-store'});if(r.status===401){location.href='/';return}if(!r.ok)return;const j=await r.json();if(DATA_VERSION&&j.version&&j.version!==DATA_VERSION&&!j.scanRunning){toast('New lessons found. Refreshing…');setTimeout(()=>location.reload(),700)}}catch{}
},60*1000);

boot();

'use strict';

let DATA=[];
let LESSONS=new Map();
let LABELS={subjects:{},teachers:{}};
let DATA_VERSION=null;
let SESSION=null;

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=v=>String(v??'').toLowerCase().normalize('NFKD');
const truth=v=>v===true||v===1||v==='1'||String(v).toLowerCase()==='true';
const cleanId=v=>v===null||v===undefined?'':String(v).trim();

const GRADES={
  g10:{label:'Grade 10',short:'G10',sections:['6'],kicker:'Foundation year',title:'Build the base. Find anything fast.',text:'Your Grade 10 subjects, teachers, lessons, videos, PDFs, and practice resources in one focused space.',accent:'#5ee6ff',accent2:'#60a5fa'},
  g11:{label:'Grade 11',short:'G11',sections:['7'],kicker:'Momentum year',title:'Level up without losing the thread.',text:'A cleaner Grade 11 workspace for deeper STEM concepts, language courses, revision resources, and everything in between.',accent:'#b794ff',accent2:'#f472b6'},
  g12:{label:'Grade 12',short:'G12',sections:['8','9'],kicker:'Finals year',title:'Lock in. Your final-year library is here.',text:'Grade 12 lessons, revisions, classified questions, videos, PDFs, and final prep—organized to get you to the right thing fast.',accent:'#ffd166',accent2:'#ff7a59'},
  all:{label:'Full library',short:'ALL',sections:null,kicker:'Every program',title:'Everything. One search.',text:'Browse every grade and special program in the private library, including resources outside the main G10–G12 sections.',accent:'#e7ff5b',accent2:'#77e4ad'}
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
  if(hay.includes('link'))return 'link';
  if(hay.includes('video')||hay.includes('session')||hay.includes('lecture')||hay.includes('vid'))return 'video';
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
  if(state.access==='link'&&!x.download)return false;
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
  const rows=gradeRows();
  const counts=new Map();
  rows.forEach(x=>{const id=String(x.subject??'');if(id)counts.set(id,(counts.get(id)||0)+1)});
  const items=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7);
  $('#quickSubjects').innerHTML=`<button class="subject-chip ${state.subject?'':'active'}" data-subject="" type="button">All subjects</button>`+items.map(([id,count])=>`<button class="subject-chip ${state.subject===id?'active':''}" data-subject="${esc(id)}" type="button"><span>${esc(subjectIcon(displaySubject(id)))}</span>${esc(displaySubject(id))}<small>${count}</small></button>`).join('');
  $$('#quickSubjects [data-subject]').forEach(btn=>btn.onclick=()=>{state.subject=btn.dataset.subject;$('#subject').value=state.subject;state.limit=30;renderQuickSubjects();render()});
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
  document.documentElement.style.setProperty('--grade-accent',g.accent);
  document.documentElement.style.setProperty('--grade-accent-2',g.accent2);
  $('#brandGrade').textContent=`${g.label} library`;
  $('#heroGradeBadge').textContent=g.short;
  $('#heroKicker').textContent=g.kicker;
  $('#heroTitle').textContent=g.title;
  $('#heroText').textContent=g.text;
  $('#resultKicker').textContent=`${g.label} library`;
  $$('#gradeTabs [data-grade]').forEach(b=>b.classList.toggle('active',b.dataset.grade===grade));
  $('#gradeTabs').classList.toggle('all-mode',grade==='all');
  rebuildFilters();
  updateStats();
  syncControls();
  render();
}

function updateStats(){
  const rows=gradeRows();
  $('#statLessons').textContent=new Set(rows.map(lessonKey)).size.toLocaleString();
  $('#statResources').textContent=rows.length.toLocaleString();
  $('#statSubjects').textContent=unique(rows,'subject').length.toLocaleString();
  $('#statTeachers').textContent=unique(rows,'teacher').length.toLocaleString();
}

function activeFilterCount(){return ['subject','teacher','type','access'].filter(k=>state[k]).length+(state.favoritesOnly?1:0)}
function syncControls(){
  $('#subject').value=state.subject;$('#teacher').value=state.teacher;$('#type').value=state.type;$('#access').value=state.access;$('#sort').value=state.sort;
  $('#favoritesOnly').classList.toggle('active',state.favoritesOnly);
  const n=activeFilterCount();$('#activeFilterCount').textContent=n;$('#activeFilterCount').classList.toggle('hidden',!n);
  $('#clear').classList.toggle('hidden',!state.q);
}

function resourceRow(x,index,matchedIds){
  const kind=resourceKind(x);
  const match=matchedIds.has(String(x.id));
  return `<article class="v2-resource ${match?'matched':''}">
    <div class="resource-kind ${kind}">${icon(kind)}</div>
    <div class="resource-copy"><strong>${esc(x.video||x.topic||'Untitled resource')}</strong><div><span>#${esc(x.id)}</span>${x.topic?`<span>${esc(x.topic)}</span>`:''}${x.type?`<span>${esc(x.type)}</span>`:''}${match?'<em>match</em>':''}</div></div>
    ${x.download?`<a class="resource-action" href="${esc(x.download)}" target="_blank" rel="noopener noreferrer"><span>Open</span>${icon('external')}</a>`:`<span class="resource-unavailable">No direct link</span>`}
  </article>`;
}

function groupBlock(group,index,autoOpen){
  const all=group.all.slice().sort((a,b)=>Number(a.topicId??1e15)-Number(b.topicId??1e15)||Number(a.id??0)-Number(b.id??0));
  const x=all[0]||{};
  const lessonId=cleanId(x.lessonId)||'—';
  const lessonName=x.lesson||`Lesson ${lessonId}`;
  const matchedIds=new Set(group.matched.map(r=>String(r.id)));
  const topics=unique(all,'topic');
  const links=all.filter(r=>r.download).length;
  const kinds={};all.forEach(r=>{const k=resourceKind(r);kinds[k]=(kinds[k]||0)+1});
  const grade=groupGrade(group);
  const g=GRADES[grade];
  const fav=isFavorite(group.key);
  const matchNote=group.matched.length!==all.length?`<span class="match-badge">${group.matched.length} matched</span>`:'';
  const kindText=Object.entries(kinds).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,n])=>`${n} ${k}`).join(' · ');
  return `<details class="v2-lesson" data-key="${esc(group.key)}" ${autoOpen?'open':''}>
    <summary>
      <div class="lesson-id-pill"><small>LESSON</small><strong>${esc(lessonId)}</strong></div>
      <div class="lesson-main-copy"><div class="lesson-topline"><span class="grade-mini ${grade}">${esc(g.short)}</span><span class="subject-mini">${esc(displaySubject(x.subject))}</span>${matchNote}</div><h3>${esc(lessonName)}</h3><div class="lesson-meta"><span>${esc(displayTeacher(x.teacher))}</span><span>${topics.length} topic${topics.length===1?'':'s'}</span><span>${all.length} resource${all.length===1?'':'s'}</span><span>${links} direct link${links===1?'':'s'}</span></div></div>
      <div class="lesson-side"><div class="resource-count-v2"><strong>${all.length}</strong><span>resources</span></div><button class="favorite-btn ${fav?'active':''}" data-favorite="${esc(group.key)}" type="button" title="${fav?'Remove from favorites':'Add to favorites'}">${icon('star')}</button><div class="lesson-chevron-v2"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div></div>
    </summary>
    <div class="lesson-expanded">
      <div class="lesson-expanded-head"><div><strong>${esc(kindText||'Course resources')}</strong><span>All resources grouped under Lesson ID ${esc(lessonId)}.</span></div><span class="lesson-id-copy">ID ${esc(lessonId)}</span></div>
      <div class="v2-resource-list">${all.map((r,i)=>resourceRow(r,i,matchedIds)).join('')}</div>
    </div>
  </details>`;
}

function bindDynamicActions(){
  $$('.favorite-btn').forEach(btn=>btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    const key=btn.dataset.favorite;
    if(favorites.has(key)){favorites.delete(key);toast('Removed from favorites','neutral')}else{favorites.add(key);toast('Saved to favorites')}
    saveFavorites();render();
  }));
}

function render(){
  if(!DATA.length)return;
  const groups=filteredGroups();
  const shown=groups.slice(0,state.limit);
  const matchedRows=groups.reduce((n,g)=>n+g.matched.length,0);
  $('#matchCount').textContent=groups.length.toLocaleString();
  const gradeTotal=gradeRows().length;
  const searchNote=state.q?` · ${matchedRows.toLocaleString()} matching resources`:'';
  $('#summary').textContent=`${gradeTotal.toLocaleString()} resources in this view${searchNote}`;
  const autoOpen=Boolean(state.q.trim())&&groups.length<=8;
  $('#results').innerHTML=shown.map((g,i)=>groupBlock(g,i,autoOpen&&i<8)).join('');
  $('#empty').classList.toggle('hidden',groups.length!==0);
  $('#loadWrap').classList.toggle('hidden',groups.length<=state.limit);
  syncControls();
  renderQuickSubjects();
  bindDynamicActions();
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

let searchTimer;
$('#q').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value;state.limit=30;render()},70)});
$('#clear').onclick=()=>{state.q='';$('#q').value='';state.limit=30;render();$('#q').focus()};
['subject','teacher','type','access','sort'].forEach(id=>$('#'+id).addEventListener('change',e=>{state[id]=e.target.value;state.limit=30;render()}));
$('#favoritesOnly').onclick=()=>{state.favoritesOnly=!state.favoritesOnly;state.limit=30;render()};
$('#reset').onclick=()=>resetFilters();$('#emptyReset').onclick=()=>resetFilters();
$('#loadMore').onclick=()=>{state.limit+=30;render()};
$('#expandAll').onclick=()=>$$('.v2-lesson').forEach(d=>d.open=true);
$('#collapseAll').onclick=()=>$$('.v2-lesson').forEach(d=>d.open=false);
$('#filterTrigger').onclick=()=>{const p=$('#filterPanel');const open=p.classList.toggle('collapsed')===false;$('#filterTrigger').setAttribute('aria-expanded',String(open))};
$$('#gradeTabs [data-grade]').forEach(btn=>btn.onclick=()=>setGrade(btn.dataset.grade));
$('#browseAllBtn').onclick=()=>{setGrade('all',false);closeGradeGate()};
$('#changeGradeBtn').onclick=()=>{openGradeGate();$('#profileMenu').classList.add('hidden')};
$('#browseAllMenuBtn').onclick=()=>{setGrade('all',false);$('#profileMenu').classList.add('hidden')};
$('#profileBtn').onclick=e=>{e.stopPropagation();const m=$('#profileMenu');m.classList.toggle('hidden');$('#profileBtn').setAttribute('aria-expanded',String(!m.classList.contains('hidden')))};
document.addEventListener('click',e=>{if(!e.target.closest('.v2-top-actions'))$('#profileMenu').classList.add('hidden')});
$('#logoutBtn').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/'};
document.addEventListener('keydown',e=>{
  if((e.key==='/'||(e.ctrlKey&&e.key.toLowerCase()==='k'))&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();$('#q').focus()}
  if(e.key==='Escape'&&$('#gradeGate').classList.contains('open')&&localStorage.getItem(GRADE_KEY))closeGradeGate();
});
setInterval(async()=>{
  try{const r=await fetch('/api/courses/version',{cache:'no-store'});if(r.status===401){location.href='/';return}if(!r.ok)return;const j=await r.json();if(DATA_VERSION&&j.version&&j.version!==DATA_VERSION&&!j.scanRunning){toast('New lessons found. Refreshing…');setTimeout(()=>location.reload(),700)}}catch{}
},60*1000);

boot();

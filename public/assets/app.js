'use strict';

let DATA=[];
let LESSONS=new Map();
let LABELS={subjects:{},teachers:{}};
const $=s=>document.querySelector(s);
const state={q:'',subject:'',teacher:'',section:'',type:'',access:'',limit:40};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=v=>String(v??'').toLowerCase().normalize('NFKD');
const truth=v=>v===true||v===1||v==='1'||String(v).toLowerCase()==='true';
const label=v=>v===null||v===undefined||v===''?'—':v;

function cleanLessonId(v){
  if(v===null||v===undefined)return '';
  return String(v).trim();
}
function lessonKey(x){
  const id=cleanLessonId(x.lessonId);
  return id?`lesson:${id}`:`ungrouped:${x.id}`;
}

function displaySubject(v){const id=String(v??'');return LABELS.subjects?.[id]||`Subject ${id}`}
function displayTeacher(v){const id=String(v??'');return LABELS.teachers?.[id]||`Teacher ${id}`}
function setupSelect(selector,values,kind,prefix){
  const el=$(selector);
  [...new Set(values.filter(v=>v!==null&&v!==undefined&&v!==''))]
    .sort((a,b)=>{
      const aa=kind==='subject'?displaySubject(a):kind==='teacher'?displayTeacher(a):String(a);
      const bb=kind==='subject'?displaySubject(b):kind==='teacher'?displayTeacher(b):String(b);
      return aa.localeCompare(bb,undefined,{numeric:true});
    })
    .forEach(v=>{const o=document.createElement('option');o.value=v;const name=kind==='subject'?displaySubject(v):kind==='teacher'?displayTeacher(v):String(v);o.textContent=kind==='subject'||kind==='teacher'?`${name} (#${v})`:`${prefix}${prefix?' ':''}${v}`;el.appendChild(o)});
}

function rowMatches(x,terms){
  if(terms.length&&!terms.every(t=>x._search.includes(t)))return false;
  if(state.subject&&String(x.subject)!==state.subject)return false;
  if(state.teacher&&String(x.teacher)!==state.teacher)return false;
  if(state.section&&String(x.section)!==state.section)return false;
  if(state.type&&String(x.type)!==state.type)return false;
  if(state.access==='free'&&!truth(x.free))return false;
  if(state.access==='paid'&&truth(x.free))return false;
  if(state.access==='denied'&&!truth(x.denied))return false;
  if(state.access==='allowed'&&truth(x.denied))return false;
  if(state.access==='link'&&!x.download)return false;
  return true;
}

function filteredGroups(){
  const terms=norm(state.q).trim().split(/\s+/).filter(Boolean);
  const groups=[];
  for(const [key,all] of LESSONS){
    const matched=all.filter(x=>rowMatches(x,terms));
    if(matched.length)groups.push({key,all,matched});
  }
  groups.sort((a,b)=>{
    if(terms.length && a.matched.length!==b.matched.length)return b.matched.length-a.matched.length;
    const ai=Number(a.all[0]?.lessonId),bi=Number(b.all[0]?.lessonId);
    if(Number.isFinite(ai)&&Number.isFinite(bi))return ai-bi;
    return a.key.localeCompare(b.key,undefined,{numeric:true});
  });
  return groups;
}

function uniqueValues(rows,key){
  return [...new Set(rows.map(x=>x[key]).filter(v=>v!==null&&v!==undefined&&v!==''))];
}

function resourceRow(x,i,matchedIds){
  const link=x.download||'';
  const isMatch=matchedIds?.has(String(x.id));
  return `<div class="resource-row${isMatch?' matched-resource':''}">
    <div class="resource-num">${i+1}</div>
    <div class="resource-main">
      <div class="resource-name">${esc(x.video||x.topic||'Untitled item')}</div>
      <div class="resource-meta">
        ${x.topic?`<span>${esc(x.topic)}</span>`:''}
        <span>Video #${esc(label(x.id))}</span>
        ${x.topicId!==null&&x.topicId!==undefined?`<span>Topic #${esc(x.topicId)}</span>`:''}
        ${x.type?`<span>${esc(x.type)}</span>`:''}
        ${isMatch?'<span class="matched-label">match</span>':''}
      </div>
    </div>
    ${link?`<a class="btn small primary resource-open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>`:'<span class="no-link">No direct link</span>'}
  </div>`;
}

function groupBlock(group,index,autoOpen){
  const all=group.all.slice().sort((a,b)=>{
    const ta=Number(a.topicId??Number.MAX_SAFE_INTEGER),tb=Number(b.topicId??Number.MAX_SAFE_INTEGER);
    if(ta!==tb)return ta-tb;
    return Number(a.id??0)-Number(b.id??0);
  });
  const x=all[0];
  const lessonId=cleanLessonId(x.lessonId)||'No ID';
  const lessonName=x.lesson||`Lesson ${lessonId}`;
  const matchedIds=new Set(group.matched.map(r=>String(r.id)));
  const topics=uniqueValues(all,'topic');
  const types=uniqueValues(all,'type');
  const linkCount=all.filter(r=>r.download).length;
  const matchText=group.matched.length===all.length?'':` · ${group.matched.length} matched`;
  return `<details class="lesson-group" data-key="${esc(group.key)}" ${autoOpen?'open':''}>
    <summary class="lesson-summary">
      <div class="lesson-chevron" aria-hidden="true">›</div>
      <div class="lesson-id-box"><span>LESSON ID</span><strong>${esc(lessonId)}</strong></div>
      <div class="lesson-summary-main">
        <div class="lesson-title-row">
          <h3>${esc(lessonName)}</h3>
          <span class="video-total">${all.length} video${all.length===1?'':'s'}${esc(matchText)}</span>
        </div>
        <div class="lesson-subline">
          <span>${esc(displaySubject(x.subject))} <small>#${esc(label(x.subject))}</small></span><span>${esc(displayTeacher(x.teacher))} <small>#${esc(label(x.teacher))}</small></span><span>Section ${esc(label(x.section))}</span>
          ${topics.length?`<span>${topics.length} topic${topics.length===1?'':'s'}</span>`:''}
          ${types.length?`<span>${esc(types.join(' / '))}</span>`:''}
          <span>${linkCount} direct link${linkCount===1?'':'s'}</span>
        </div>
      </div>
    </summary>
    <div class="lesson-children">
      <div class="lesson-children-head">
        <strong>Videos in Lesson ID ${esc(lessonId)}</strong>
        <span>All ${all.length} item${all.length===1?'':'s'} with this exact lesson ID are grouped here.</span>
      </div>
      <div class="resource-list">${all.map((r,i)=>resourceRow(r,i,matchedIds)).join('')}</div>
    </div>
  </details>`;
}

function render(){
  const groups=filteredGroups();
  const shown=groups.slice(0,state.limit);
  const matchedRows=groups.reduce((n,g)=>n+g.matched.length,0);
  $('#matchCount').textContent=groups.length.toLocaleString();
  $('#showing').textContent=shown.length.toLocaleString();
  $('#summary').textContent=`${LESSONS.size.toLocaleString()} lesson groups · ${DATA.length.toLocaleString()} total videos${matchedRows!==DATA.length?` · ${matchedRows.toLocaleString()} matching videos`:''}`;
  const autoOpen=groups.length<=8 || Boolean(state.q.trim());
  $('#results').innerHTML=shown.map((g,i)=>groupBlock(g,i,autoOpen && i<12)).join('');
  $('#empty').classList.toggle('hidden',groups.length!==0);
  $('#loadWrap').classList.toggle('hidden',groups.length<=state.limit);
}

function setAllDetails(open){
  document.querySelectorAll('.lesson-group').forEach(d=>d.open=open);
}

async function boot(){
  try{
    const [sessionRes,dataRes,labelsRes]=await Promise.all([fetch('/api/session',{cache:'no-store'}),fetch('/api/courses',{cache:'no-store'}),fetch('/api/labels',{cache:'no-store'})]);
    if(sessionRes.status===401||dataRes.status===401||labelsRes.status===401){location.href='/';return}
    if(!sessionRes.ok||!dataRes.ok||!labelsRes.ok)throw new Error('Could not load the private library.');
    const session=await sessionRes.json();
    DATA=await dataRes.json();
    LABELS=await labelsRes.json();
    for(const x of DATA){
      x.subjectName=displaySubject(x.subject);
      x.teacherName=displayTeacher(x.teacher);
      x._search=norm([x.id,x.topicId,x.lessonId,x.video,x.topic,x.lesson,x.teacher,x.subject,x.subjectName,x.teacherName,x.section,x.type,x.description,x.topicDescription].join(' '));
      const key=lessonKey(x);
      if(!LESSONS.has(key))LESSONS.set(key,[]);
      LESSONS.get(key).push(x);
    }
    $('#sessionLabel').textContent=session.label||'Private access';
    if(session.role==='admin')$('#adminLink').classList.remove('hidden');
    setupSelect('#subject',DATA.map(x=>x.subject),'subject','Subject');
    setupSelect('#teacher',DATA.map(x=>x.teacher),'teacher','Teacher');
    setupSelect('#section',DATA.map(x=>x.section),'','Section');
    setupSelect('#type',DATA.map(x=>x.type),'','');
    $('#loading').classList.add('hidden');
    $('#resultsArea').classList.remove('hidden');
    render();
  }catch(e){$('#loading').textContent=e.message}
}

let t;
$('#q').addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>{state.q=e.target.value;state.limit=40;render()},80)});
$('#clear').onclick=()=>{$('#q').value='';state.q='';state.limit=40;render();$('#q').focus()};
['subject','teacher','section','type','access'].forEach(id=>$('#'+id).addEventListener('change',e=>{state[id]=e.target.value;state.limit=40;render()}));
$('#reset').onclick=()=>{Object.assign(state,{q:'',subject:'',teacher:'',section:'',type:'',access:'',limit:40});$('#q').value='';['subject','teacher','section','type','access'].forEach(id=>$('#'+id).value='');render()};
$('#loadMore').onclick=()=>{state.limit+=40;render()};
$('#expandAll').onclick=()=>setAllDetails(true);
$('#collapseAll').onclick=()=>setAllDetails(false);
$('#logoutBtn').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/'};
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==$('#q')){e.preventDefault();$('#q').focus()}});
boot();

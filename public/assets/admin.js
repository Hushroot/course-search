'use strict';
const $=s=>document.querySelector(s);
let CODES=[];
let LABEL_INFO={subjects:{},teachers:{},stats:{subjects:[],teachers:[]}};
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
async function loadAdminData(){await Promise.all([loadCodes(),loadLabels()])}
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
$('#saveLabels').addEventListener('click',saveLabels);
$('#adminLogout').addEventListener('click',async()=>{await fetch('/api/admin/logout',{method:'POST'});showLogin()});

(async()=>{try{const r=await fetch('/api/admin/session',{cache:'no-store'});const j=await r.json();if(j.authenticated){showPanel();await loadAdminData()}else showLogin()}catch{showLogin()}})();

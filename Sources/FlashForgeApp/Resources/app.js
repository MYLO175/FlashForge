'use strict';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════════════════════ */
const STORE_KEY      = 'flashforge_v2';
const STATS_KEY      = 'flashforge_stats';
const CARD_STATS_KEY = 'flashforge_card_stats';
const SETTINGS_KEY   = 'flashforge_settings';

let S          = { view:'home', folderId:null, setId:null, folders:[], study:null };
let STATS      = {};
let CARD_STATS = {};
let SETTINGS   = {
  theme:      'system',
  accent:     'indigo',
  cardFont:   'normal',
  lastBackup: null,
  masteryThreshold: 70,
  masteryWindow: 5,
  keys: { flip:' ', yes:'y', no:'n', undo:'u' },
  formatKeys: {
    bold: { key:'b', code:'KeyB', meta:true, alt:false, shift:false, ctrl:false },
    italic: { key:'i', code:'KeyI', meta:true, alt:false, shift:false, ctrl:false },
    superscript: { key:'=', code:'Equal', meta:true, alt:true, shift:true, ctrl:false },
    subscript: { key:'=', code:'Equal', meta:true, alt:true, shift:false, ctrl:false }
  }
};

const ACCENT_MAP = {
  indigo:  { primary:'#4f46e5', dark:'#3730a3', light:'#eef2ff', mid:'#c7d2fe' },
  purple:  { primary:'#7c3aed', dark:'#6d28d9', light:'#f5f3ff', mid:'#ddd6fe' },
  rose:    { primary:'#e11d48', dark:'#be123c', light:'#fff1f2', mid:'#fecdd3' },
  emerald: { primary:'#059669', dark:'#047857', light:'#ecfdf5', mid:'#6ee7b7' },
  sky:     { primary:'#0284c7', dark:'#0369a1', light:'#f0f9ff', mid:'#bae6fd' },
  amber:   { primary:'#d97706', dark:'#b45309', light:'#fffbeb', mid:'#fde68a' },
};

/* ═══════════════════════════════════════════════════════════
   PERSISTENCE
   • Text data (cards, sets, folders)  → localStorage
   • Images (base64 data URLs)         → IndexedDB  (no size limit)
   Old format had images in localStorage — auto-migrated on first load.
═══════════════════════════════════════════════════════════ */
const IDB_NAME  = 'flashforge_images';
const IDB_STORE = 'imgs';
let _idb = null;

function _openIDB(){
  if(_idb) return Promise.resolve(_idb);
  return new Promise((res,rej)=>{
    const req=indexedDB.open(IDB_NAME,1);
    req.onupgradeneeded=e=>e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess=e=>{_idb=e.target.result;res(_idb);};
    req.onerror=()=>rej(req.error);
  });
}
async function _idbPut(key,val){const db=await _openIDB();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(val,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
async function _idbDel(key){const db=await _openIDB();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).delete(key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
async function _idbAll(){
  const db=await _openIDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(IDB_STORE,'readonly');
    const out={};let keys,vals;
    tx.objectStore(IDB_STORE).getAllKeys().onsuccess=e=>{keys=e.target.result;if(vals)finish();};
    tx.objectStore(IDB_STORE).getAll().onsuccess=e=>{vals=e.target.result;if(keys)finish();};
    tx.onerror=()=>rej(tx.error);
    function finish(){keys.forEach((k,i)=>out[k]=vals[i]);res(out);}
  });
}

async function _saveImages(){
  try{
    const db=await _openIDB();
    const tx=db.transaction(IDB_STORE,'readwrite');
    const st=tx.objectStore(IDB_STORE);
    for(const f of S.folders)for(const s of f.sets)for(const c of s.cards){
      if(c.frontImg)st.put(c.frontImg,c.id+'_f'); else st.delete(c.id+'_f');
      if(c.backImg) st.put(c.backImg, c.id+'_b'); else st.delete(c.id+'_b');
    }
  }catch(e){}
}

async function load(){
  try{const r=localStorage.getItem(STORE_KEY);     if(r)S.folders=JSON.parse(r).folders||[];}catch(e){}
  try{const r=localStorage.getItem(STATS_KEY);     if(r)STATS=JSON.parse(r);}catch(e){}
  try{const r=localStorage.getItem(CARD_STATS_KEY);if(r)CARD_STATS=JSON.parse(r);}catch(e){}
  try{const r=localStorage.getItem(SETTINGS_KEY);  if(r){const sv=JSON.parse(r);SETTINGS={...SETTINGS,...sv,keys:{...SETTINGS.keys,...(sv.keys||{})},formatKeys:{...SETTINGS.formatKeys,...(sv.formatKeys||{})}};}}catch(e){}
  _normaliseFormatKeys();_normaliseMasterySettings();

  // Merge images: prefer IDB (new) then fall back to whatever localStorage had (old format)
  try{
    const idbImgs=await _idbAll();
    let needMigrate=false;
    for(const f of S.folders)for(const s of f.sets)for(const c of s.cards){
      const fk=c.id+'_f', bk=c.id+'_b';
      if(idbImgs[fk])c.frontImg=idbImgs[fk];
      else if(c.frontImg){needMigrate=true;} // old localStorage image — will migrate
      if(idbImgs[bk])c.backImg=idbImgs[bk];
      else if(c.backImg){needMigrate=true;}
      if(!idbImgs[fk]&&!c.frontImg)c.frontImg=null;
      if(!idbImgs[bk]&&!c.backImg)c.backImg=null;
    }
    if(needMigrate){
      // Silently migrate old localStorage images → IDB, then strip from localStorage
      await _saveImages();
      const stripped={folders:S.folders.map(f=>({...f,sets:f.sets.map(s=>({...s,cards:s.cards.map(c=>({...c,frontImg:null,backImg:null}))}))}))};
      localStorage.setItem(STORE_KEY,JSON.stringify(stripped));
    }
  }catch(e){}
}

function save(){
  // Save text-only to localStorage (images live in IndexedDB)
  try{
    const stripped={folders:S.folders.map(f=>({...f,sets:f.sets.map(s=>({...s,cards:s.cards.map(c=>({...c,frontImg:null,backImg:null}))}))}))};
    localStorage.setItem(STORE_KEY,JSON.stringify(stripped));
  }catch(e){if(e.name==='QuotaExceededError')toast('⚠️ Storage full — try clearing browser data');}
  _saveImages(); // async, fire-and-forget
}
function saveStats()    { try{localStorage.setItem(STATS_KEY,      JSON.stringify(STATS));}catch(e){} }
function saveCardStats(){ try{localStorage.setItem(CARD_STATS_KEY, JSON.stringify(CARD_STATS));}catch(e){} }
function saveSettings() { try{localStorage.setItem(SETTINGS_KEY,   JSON.stringify(SETTINGS));}catch(e){} }

/* ═══════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════ */
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2);
const esc = s => !s?'':s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function decodeLegacyEntities(s){
  let out=String(s);
  const ta=document.createElement('textarea');
  const entity=/&(?:amp|lt|gt|quot|apos|#39|#x27);/i;
  for(let i=0;i<5&&entity.test(out);i++){
    ta.innerHTML=out;
    const next=ta.value;
    if(next===out)break;
    out=next;
  }
  return out;
}

function safeHTML(s) {
  if (!s) return '';
  let out = esc(decodeLegacyEntities(s));
  out = out.replace(/&lt;(\/?(?:sup|sub|b|strong|i|em))&gt;/gi, '<$1>');
  out = out.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  return out;
}

function toast(msg,ms=2800){const el=Object.assign(document.createElement('div'),{className:'toast',textContent:msg});document.getElementById('toasts').appendChild(el);setTimeout(()=>el.remove(),ms);}
function actionToast(msg,label,cb,ms=20000){
  const el=document.createElement('div');el.className='toast';
  const text=document.createElement('span');text.textContent=msg;
  const btn=document.createElement('button');btn.textContent=label;
  const timer=setTimeout(()=>el.remove(),ms);
  const run=()=>{clearTimeout(timer);el.remove();cb();};
  btn.onclick=run;
  btn.onkeydown=e=>{if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();run();}};
  el.append(text,btn);document.getElementById('toasts').appendChild(el);
}
function _markStudyEditSaved(){
  const el=document.getElementById('study-edit-save-state');if(!el)return;
  el.textContent='Saved';el.classList.add('visible');
  clearTimeout(window._studyEditSaveTimer);
  window._studyEditSaveTimer=setTimeout(()=>el.classList.remove('visible'),1400);
}

async function compress(dataUrl,maxW=1200,maxH=1200,q=0.82){return new Promise(res=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height;if(w>maxW||h>maxH){const r=Math.min(maxW/w,maxH/h);w=Math.round(w*r);h=Math.round(h*r);}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);res(c.toDataURL('image/jpeg',q));};img.src=dataUrl;});}

function relDate(iso){const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000);if(d===0)return'today';if(d===1)return'yesterday';if(d<7)return`${d} days ago`;if(d<14)return'1 week ago';if(d<30)return`${Math.floor(d/7)} weeks ago`;if(d<60)return'1 month ago';return`${Math.floor(d/30)} months ago`;}
function pctColor(p){return p>=80?'var(--success)':p>=50?'var(--amber)':'var(--danger)';}

function keyLabel(k) {
  if (!k) return '—';
  if (k===' ')          return 'Space';
  if (k==='ArrowRight') return '→';
  if (k==='ArrowLeft')  return '←';
  if (k==='ArrowUp')    return '↑';
  if (k==='ArrowDown')  return '↓';
  if (k==='Enter')      return 'Enter';
  if (k==='Escape')     return 'Esc';
  if (k==='Backspace')  return '⌫';
  if (k==='Tab')        return 'Tab';
  return k.length===1 ? k.toUpperCase() : k;
}
function shortcutLabel(sc) {
  if(!sc||!sc.key)return '—';
  const parts=[];
  if(sc.ctrl)parts.push('Ctrl');
  if(sc.shift)parts.push('⇧');
  if(sc.alt)parts.push('⌥');
  if(sc.meta)parts.push('⌘');
  parts.push(keyLabel(sc.key));
  return parts.join(' ');
}
function normaliseShortcut(sc) {
  const out={key:sc?.key||'',code:sc?.code||'',ctrl:!!sc?.ctrl,alt:!!sc?.alt,shift:!!sc?.shift,meta:!!sc?.meta};
  const equalKeys=['=','+','≠','±'];
  if(out.code==='Equal'||equalKeys.includes(out.key)){out.code='Equal';out.key='=';}
  if(!out.code&&String(out.key).toLowerCase()==='b')out.code='KeyB';
  if(!out.code&&String(out.key).toLowerCase()==='i')out.code='KeyI';
  return out;
}
function _normaliseFormatKeys() {
  const before=JSON.stringify(SETTINGS.formatKeys);
  for(const id of ['bold','italic','superscript','subscript']){
    SETTINGS.formatKeys[id]=normaliseShortcut(SETTINGS.formatKeys[id]);
  }
  const sup=SETTINGS.formatKeys.superscript,sub=SETTINGS.formatKeys.subscript;
  if(sup.code==='Equal'&&sup.ctrl&&!sup.meta&&!sup.alt)SETTINGS.formatKeys.superscript={key:'=',code:'Equal',meta:true,alt:true,shift:true,ctrl:false};
  if(sub.code==='Equal'&&sub.ctrl&&!sub.meta&&!sub.alt)SETTINGS.formatKeys.subscript={key:'=',code:'Equal',meta:true,alt:true,shift:false,ctrl:false};
  if(JSON.stringify(SETTINGS.formatKeys)!==before)setTimeout(saveSettings,0);
}
function clampNum(v,min,max,fallback){
  const n=parseInt(v,10);
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function _normaliseMasterySettings(){
  const before=JSON.stringify({t:SETTINGS.masteryThreshold,w:SETTINGS.masteryWindow});
  SETTINGS.masteryThreshold=clampNum(SETTINGS.masteryThreshold,1,100,70);
  SETTINGS.masteryWindow=clampNum(SETTINGS.masteryWindow,1,20,5);
  if(JSON.stringify({t:SETTINGS.masteryThreshold,w:SETTINGS.masteryWindow})!==before)setTimeout(saveSettings,0);
}
function eventToShortcut(e) {
  return normaliseShortcut({key:e.code==='Equal'?'=':e.key,code:e.code,ctrl:!!e.ctrlKey,alt:!!e.altKey,shift:!!e.shiftKey,meta:!!e.metaKey});
}
function shortcutMatches(e,sc) {
  if(!sc)return false;
  const n=normaliseShortcut(sc);
  const keyMatches=n.code==='Equal'?(e.code==='Equal'||['=','+','≠','±'].includes(e.key)):n.code?e.code===n.code:e.key.toLowerCase()===String(n.key).toLowerCase();
  return keyMatches
    && !!e.ctrlKey===!!n.ctrl
    && !!e.altKey===!!n.alt
    && !!e.shiftKey===!!n.shift
    && !!e.metaKey===!!n.meta;
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS — APPLY
═══════════════════════════════════════════════════════════ */
let _mql = null;
function applySettings() {
  if (_mql) { try{_mql.removeEventListener('change',_onSystemTheme);}catch(e){} }
  if (SETTINGS.theme==='system') {
    _mql=window.matchMedia('(prefers-color-scheme: dark)');
    _mql.addEventListener('change',_onSystemTheme);
    _applyDark(_mql.matches);
  } else { _mql=null; _applyDark(SETTINGS.theme==='dark'); }
  const a=ACCENT_MAP[SETTINGS.accent]||ACCENT_MAP.indigo;
  const r=document.documentElement.style;
  r.setProperty('--primary',a.primary); r.setProperty('--primary-dark',a.dark);
  r.setProperty('--primary-light',a.light); r.setProperty('--primary-mid',a.mid);
  r.setProperty('--card-font',SETTINGS.cardFont==='large'?'26px':'22px');
}
function _applyDark(isDark){document.documentElement.classList.toggle('dark',isDark);}
function _onSystemTheme(e){_applyDark(e.matches);}

/* ═══════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════ */
function modalSettings() {
  const accentSwatches=Object.entries(ACCENT_MAP).map(([name,a])=>`<div class="accent-swatch ${SETTINGS.accent===name?'picked':''}" style="background:${a.primary}" title="${name}" onclick="setAccent('${name}',this)"></div>`).join('');
  const themeOpts=['light','system','dark'];
  const themeLabels={light:'☀️ Light',system:'💻 System',dark:'🌙 Dark'};
  const themeTabs=themeOpts.map(t=>`<button class="theme-tab ${SETTINGS.theme===t?'active':''}" onclick="setTheme('${t}',this)">${themeLabels[t]}</button>`).join('');
  const KEY_ACTIONS=[{id:'flip',label:'Flip card'},{id:'yes',label:'Got it ✓'},{id:'no',label:'Still learning ✗'},{id:'undo',label:'Undo'}];
  const keyRows=KEY_ACTIONS.map(a=>`<tr><td>${a.label}</td><td><span class="key-cap" id="kc-${a.id}" onclick="startCapture('${a.id}',this)">${keyLabel(SETTINGS.keys[a.id])}</span></td></tr>`).join('');
  const FORMAT_ACTIONS=[{id:'bold',label:'Bold'},{id:'italic',label:'Italic'},{id:'superscript',label:'Superscript'},{id:'subscript',label:'Subscript'}];
  const formatRows=FORMAT_ACTIONS.map(a=>`<tr><td>${a.label}</td><td><span class="key-cap" id="fkc-${a.id}" onclick="startFormatCapture('${a.id}',this)">${shortcutLabel(SETTINGS.formatKeys[a.id])}</span></td></tr>`).join('');
  document.getElementById('modal-root').innerHTML=`
    <div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:460px">
        <div class="modal-title">⚙️ Settings</div>
        <div class="setting-row"><div><div class="setting-label">Appearance</div><div class="setting-desc">System follows your Mac's setting automatically</div></div><div class="theme-tabs">${themeTabs}</div></div>
        <div class="setting-row"><div><div class="setting-label">Accent Colour</div></div><div class="accent-row">${accentSwatches}</div></div>
        <div class="setting-row"><div><div class="setting-label">Card Text Size</div></div><div class="font-btns"><button class="font-btn ${SETTINGS.cardFont==='normal'?'active':''}" onclick="setCardFont('normal',this)">Aa</button><button class="font-btn ${SETTINGS.cardFont==='large'?'active':''}" onclick="setCardFont('large',this)">A+</button></div></div>
        <div class="setting-row"><div><div class="setting-label">Strong Card Threshold</div><div class="setting-desc">Cards at or above this score count as strong</div></div><div class="setting-control"><input class="setting-number" type="number" min="1" max="100" value="${SETTINGS.masteryThreshold}" onchange="setMasteryThreshold(this.value)" oninput="setMasteryThreshold(this.value)">%</div></div>
        <div class="setting-row"><div><div class="setting-label">Stats Lookback</div><div class="setting-desc">Recent card attempts used for weak/strong scoring</div></div><div class="setting-control"><input class="setting-number" type="number" min="1" max="20" value="${SETTINGS.masteryWindow}" onchange="setMasteryWindow(this.value)" oninput="setMasteryWindow(this.value)">attempts</div></div>
        <div style="margin-top:16px;margin-bottom:8px"><div class="setting-label" style="font-size:13px;margin-bottom:4px">Study Shortcuts</div><div class="setting-desc" style="margin-bottom:10px">Click any key to reassign it — then press the new key</div><table class="keybind-table">${keyRows}</table></div>
        <div style="margin-top:16px;margin-bottom:8px"><div class="setting-label" style="font-size:13px;margin-bottom:4px">Formatting Shortcuts</div><div class="setting-desc" style="margin-bottom:10px">Click a shortcut, then press the new key combination</div><table class="keybind-table">${formatRows}</table></div>
        <div class="modal-footer"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
      </div>
    </div>`;
}
function setTheme(theme,el){SETTINGS.theme=theme;saveSettings();applySettings();el.closest('.theme-tabs').querySelectorAll('.theme-tab').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
function setAccent(name,el){SETTINGS.accent=name;saveSettings();applySettings();el.closest('.accent-row').querySelectorAll('.accent-swatch').forEach(b=>b.classList.remove('picked'));el.classList.add('picked');}
function setCardFont(size,el){SETTINGS.cardFont=size;saveSettings();applySettings();el.closest('.font-btns').querySelectorAll('.font-btn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
function setMasteryThreshold(value){SETTINGS.masteryThreshold=clampNum(value,1,100,70);saveSettings();if(S.view==='stats')renderStats();}
function setMasteryWindow(value){SETTINGS.masteryWindow=clampNum(value,1,20,5);saveSettings();if(S.view==='stats')renderStats();}

let _captureTarget=null,_captureHandler=null;
function startCapture(actionId,el){
  if(_captureTarget)cancelCapture();
  _captureTarget={kind:'study',actionId,el};el.textContent='press key…';el.classList.add('capturing');
  _captureHandler=function(e){
    e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){cancelCapture();return;}
    if(e.key==='Tab')return;
    SETTINGS.keys[actionId]=e.key;saveSettings();
    el.textContent=keyLabel(e.key);el.classList.remove('capturing');
    document.removeEventListener('keydown',_captureHandler,true);
    _captureTarget=null;_captureHandler=null;
    toast(`✓ "${_actionName(actionId)}" bound to ${keyLabel(e.key)}`);
    if(S.view==='study'&&window._studyKey)_setupStudyKeys();
  };
  document.addEventListener('keydown',_captureHandler,true);
}
function startFormatCapture(actionId,el){
  if(_captureTarget)cancelCapture();
  _captureTarget={kind:'format',actionId,el};el.textContent='press shortcut…';el.classList.add('capturing');
  _captureHandler=function(e){
    e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){cancelCapture();return;}
    if(['Meta','Control','Alt','Shift'].includes(e.key))return;
    SETTINGS.formatKeys[actionId]=eventToShortcut(e);saveSettings();
    el.textContent=shortcutLabel(SETTINGS.formatKeys[actionId]);el.classList.remove('capturing');
    document.removeEventListener('keydown',_captureHandler,true);
    _captureTarget=null;_captureHandler=null;
    toast(`✓ "${_actionName(actionId)}" bound to ${shortcutLabel(SETTINGS.formatKeys[actionId])}`);
  };
  document.addEventListener('keydown',_captureHandler,true);
}
function cancelCapture(){
  if(!_captureTarget)return;
  _captureTarget.el.textContent=_captureTarget.kind==='format'?shortcutLabel(SETTINGS.formatKeys[_captureTarget.actionId]):keyLabel(SETTINGS.keys[_captureTarget.actionId]);
  _captureTarget.el.classList.remove('capturing');
  if(_captureHandler)document.removeEventListener('keydown',_captureHandler,true);
  _captureTarget=null;_captureHandler=null;
}
function _actionName(id){return{flip:'Flip',yes:'Got it',no:'Still learning',undo:'Undo',bold:'Bold',italic:'Italic',superscript:'Superscript',subscript:'Subscript'}[id]||id;}

/* ═══════════════════════════════════════════════════════════
   DATA HELPERS
═══════════════════════════════════════════════════════════ */
const getFolder=(id)=>S.folders.find(f=>f.id===id);
const getSet=(fid,sid)=>getFolder(fid)?.sets.find(s=>s.id===sid);
const getCard=(fid,sid,cid)=>getSet(fid,sid)?.cards.find(c=>c.id===cid);

function nav(view,folderId,setId){
  cancelCapture();
  if(S.view==='study'&&S.study&&!S.study.done&&S.setId)saveStudySession(S.setId);
  S.view=view;S.folderId=folderId||null;S.setId=setId||null;S.study=null;
  if(window._studyKey){document.removeEventListener('keydown',window._studyKey);window._studyKey=null;}
  render();
}

/* ═══════════════════════════════════════════════════════════
   CRUD
═══════════════════════════════════════════════════════════ */
function createFolder(name,color){S.folders.push({id:uid(),name,color,sets:[]});save();render();toast('📁 Folder created');}
function updateFolder(id,data){Object.assign(getFolder(id),data);save();render();toast('Folder updated');}
function deleteFolder(id){
  const idx=S.folders.findIndex(f=>f.id===id);if(idx<0)return;
  const folder=S.folders[idx];S.folders.splice(idx,1);save();
  if(S.folderId===id)nav('home');else render();
  actionToast('Folder deleted','Undo',()=>{S.folders.splice(Math.min(idx,S.folders.length),0,folder);save();render();toast('Folder restored');});
}
function createSet(fid,name){const s={id:uid(),name,cards:[]};getFolder(fid).sets.push(s);save();return s;}
function updateSet(fid,sid,data){Object.assign(getSet(fid,sid),data);save();render();toast('Set updated');}
function deleteSet(fid,sid){
  const f=getFolder(fid);if(!f)return;
  const idx=f.sets.findIndex(s=>s.id===sid);if(idx<0)return;
  const set=f.sets[idx];f.sets.splice(idx,1);save();
  if(S.setId===sid)nav('folder',fid);else render();
  actionToast('Set deleted','Undo',()=>{const parent=getFolder(fid);if(!parent)return;parent.sets.splice(Math.min(idx,parent.sets.length),0,set);save();render();toast('Set restored');});
}
function addCard(fid,sid){const c={id:uid(),front:'',back:'',frontImg:null,backImg:null,starred:false};getSet(fid,sid).cards.push(c);save();return c;}
function insertCardAt(fid,sid,index){
  const s=getSet(fid,sid);if(!s)return;
  const c={id:uid(),front:'',back:'',frontImg:null,backImg:null,starred:false};
  s.cards.splice(Math.max(0,Math.min(index,s.cards.length)),0,c);save();renderSet();
  setTimeout(()=>document.querySelector(`#ci-${c.id} .rich-editor`)?.focus(),60);
  return c;
}
function patchCard(fid,sid,cid,data){const c=getCard(fid,sid,cid);if(!c)return;Object.assign(c,data);const active=S.study?.cards?.find(card=>card.id===cid);if(active&&active!==c)Object.assign(active,data);save();_markStudyEditSaved();}
function toggleStar(fid,sid,cid,mode){
  const c=getCard(fid,sid,cid);if(!c)return;
  patchCard(fid,sid,cid,{starred:!c.starred});
  if(mode==='study')renderStudy();else if(mode==='study-edit'){modalStudyEditCard();_markStudyEditSaved();}else renderSet();
}
function deleteCard(fid,sid,cid){
  const s=getSet(fid,sid);if(!s)return;
  const idx=s.cards.findIndex(c=>c.id===cid);if(idx<0)return;
  const card=s.cards[idx];s.cards.splice(idx,1);_idbDel(cid+'_f');_idbDel(cid+'_b');save();renderSet();
  actionToast('Card deleted','Undo',()=>{const set=getSet(fid,sid);if(!set)return;set.cards.splice(Math.min(idx,set.cards.length),0,card);save();renderSet();toast('Card restored');});
}
let _dragCard=null;
function _dragCardStart(event,fid,sid,cid){
  const s=getSet(fid,sid);if(!s)return;
  const idx=s.cards.findIndex(c=>c.id===cid);if(idx<0)return;
  _dragCard={fid,sid,cid,idx};
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',cid);
  document.getElementById('ci-'+cid)?.classList.add('dragging');
}
function _dragCardEnd(){
  document.querySelectorAll('.dragging,.drag-over').forEach(el=>el.classList.remove('dragging','drag-over'));
  _dragCard=null;
}
function _dragZoneOver(event){event.preventDefault();event.currentTarget.classList.add('drag-over');if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
function _dragZoneLeave(event){event.currentTarget.classList.remove('drag-over');}
function _dropCardAt(event,fid,sid,index){
  event.preventDefault();event.currentTarget.classList.remove('drag-over');
  if(!_dragCard||_dragCard.fid!==fid||_dragCard.sid!==sid)return;
  const s=getSet(fid,sid);if(!s)return;
  const from=s.cards.findIndex(c=>c.id===_dragCard.cid);if(from<0)return;
  let to=Math.max(0,Math.min(index,s.cards.length));
  if(to>from)to--;
  if(to===from)return _dragCardEnd();
  const [card]=s.cards.splice(from,1);
  s.cards.splice(to,0,card);save();renderSet();toast('Card moved');
  setTimeout(()=>document.getElementById('ci-'+card.id)?.scrollIntoView({behavior:'smooth',block:'center'}),60);
  _dragCardEnd();
}
function moveCardBy(fid,sid,cid,delta){
  const s=getSet(fid,sid);if(!s)return;
  const from=s.cards.findIndex(c=>c.id===cid);if(from<0)return;
  const to=Math.max(0,Math.min(s.cards.length-1,from+delta));
  if(to===from)return;
  const [card]=s.cards.splice(from,1);
  s.cards.splice(to,0,card);save();renderSet();
  setTimeout(()=>document.getElementById('ci-'+cid)?.scrollIntoView({behavior:'smooth',block:'center'}),60);
}

/* ═══════════════════════════════════════════════════════════
   IMAGE HANDLING
═══════════════════════════════════════════════════════════ */
function _afterCardMediaChange(mode){if(mode==='study-edit'){modalStudyEditCard();_markStudyEditSaved();}else renderSet();}
function pickImg(fid,sid,cid,side,mode){const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.onchange=async e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=async ev=>{patchCard(fid,sid,cid,side==='front'?{frontImg:await compress(ev.target.result)}:{backImg:await compress(ev.target.result)});_afterCardMediaChange(mode);};r.readAsDataURL(file);};inp.click();}
function removeImg(fid,sid,cid,side,mode){patchCard(fid,sid,cid,side==='front'?{frontImg:null}:{backImg:null});_afterCardMediaChange(mode);}
function handlePaste(event,fid,sid,cid,side,mode){const items=Array.from(event.clipboardData?.items||[]);const imgItem=items.find(it=>it.type.startsWith('image/'));if(!imgItem)return;event.preventDefault();const file=imgItem.getAsFile();if(!file)return;const zone=document.getElementById(`zone-${cid}-${side}`);if(zone){zone.classList.add('paste-ok');setTimeout(()=>zone.classList.remove('paste-ok'),600);}const r=new FileReader();r.onload=async ev=>{patchCard(fid,sid,cid,side==='front'?{frontImg:await compress(ev.target.result)}:{backImg:await compress(ev.target.result)});_afterCardMediaChange(mode);};r.readAsDataURL(file);}
async function _dropImg(event,fid,sid,cid,side,mode){event.preventDefault();const file=Array.from(event.dataTransfer.files).find(f=>f.type.startsWith('image/'));if(!file)return;const r=new FileReader();r.onload=async ev=>{patchCard(fid,sid,cid,side==='front'?{frontImg:await compress(ev.target.result)}:{backImg:await compress(ev.target.result)});_afterCardMediaChange(mode);};r.readAsDataURL(file);}

/* ═══════════════════════════════════════════════════════════
   SUPERSCRIPT / SUBSCRIPT
═══════════════════════════════════════════════════════════ */
function _insertTag(fid,sid,cid,side,tag){
  const container=document.getElementById('ci-'+cid);if(!container)return;
  const tas=container.querySelectorAll('textarea');
  const ta=side==='front'?tas[0]:tas[1];if(!ta)return;
  const start=ta.selectionStart,end=ta.selectionEnd;
  const sel=ta.value.slice(start,end);
  const open='<'+tag+'>',close='</'+tag+'>';
  const insert=open+sel+close;
  ta.value=ta.value.slice(0,start)+insert+ta.value.slice(end);
  const newPos=sel?start+insert.length:start+open.length;
  ta.setSelectionRange(newPos,newPos);
  patchCard(fid,sid,cid,side==='front'?{front:ta.value}:{back:ta.value});
  ta.focus();
}
function _taKeydown(e,fid,sid,cid,side){
  if(e.ctrlKey&&e.shiftKey&&e.key==='='){e.preventDefault();_insertTag(fid,sid,cid,side,'sup');}
  else if(e.ctrlKey&&!e.shiftKey&&e.key==='='){e.preventDefault();_insertTag(fid,sid,cid,side,'sub');}
}

function _cleanRichHTML(html){
  const root=document.createElement('div');root.innerHTML=html;
  const allowed={b:'b',strong:'b',i:'i',em:'i',sup:'sup',sub:'sub'};
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue.replace(/\u00a0/g,' ');
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName.toLowerCase();
    if(tag==='br')return '\n';
    let inner=Array.from(node.childNodes).map(walk).join('');
    if(tag==='div'||tag==='p')return inner+'\n';
    if(allowed[tag])return `<${allowed[tag]}>${inner}</${allowed[tag]}>`;
    return inner;
  };
  return Array.from(root.childNodes).map(walk).join('').replace(/\n{3,}/g,'\n\n').replace(/\n$/,'');
}
function _richEmpty(el){return !el.textContent.trim()&&!el.querySelector('b,i,sup,sub');}
function _richSyncEmpty(el){el.classList.toggle('is-empty',_richEmpty(el));}
function _saveRichEditor(el,fid,sid,cid,side){
  _richSyncEmpty(el);
  const value=_cleanRichHTML(el.innerHTML);
  patchCard(fid,sid,cid,side==='front'?{front:value}:{back:value});
}
function _richInput(el,fid,sid,cid,side){_saveRichEditor(el,fid,sid,cid,side);}
function _richCommand(fid,sid,cid,side,cmd){
  const el=document.getElementById(`rich-${cid}-${side}`);if(!el)return;
  el.focus();document.execCommand(cmd,false,null);_saveRichEditor(el,fid,sid,cid,side);
}
function _richKeydown(e,fid,sid,cid,side){
  if(e.defaultPrevented)return;
  const actions=[['superscript','superscript'],['subscript','subscript'],['bold','bold'],['italic','italic']];
  for(const [id,cmd] of actions){
    if(shortcutMatches(e,SETTINGS.formatKeys[id])){
      e.preventDefault();_richCommand(fid,sid,cid,side,cmd);return;
    }
  }
}
document.addEventListener('keydown',function(e){
  if(e.defaultPrevented)return;
  const el=e.target?.closest?.('.rich-editor');if(!el)return;
  const m=el.id.match(/^rich-(.+)-(front|back)$/);if(!m)return;
  _richKeydown(e,S.folderId,S.setId,m[1],m[2]);
},true);

/* ═══════════════════════════════════════════════════════════
   MODALS — FOLDER / SET / CONFIRM
═══════════════════════════════════════════════════════════ */
const COLORS=[{n:'indigo',h:'#4f46e5'},{n:'purple',h:'#7c3aed'},{n:'rose',h:'#e11d48'},{n:'pink',h:'#db2777'},{n:'amber',h:'#d97706'},{n:'emerald',h:'#059669'},{n:'sky',h:'#0284c7'},{n:'teal',h:'#0d9488'}];
let _pickedColor='indigo';
function closeModal(){cancelCapture();document.getElementById('modal-root').innerHTML='';}
function modalFolderNew(){_pickedColor='indigo';_showFolderModal(null);}
function modalFolderEdit(id){_pickedColor=getFolder(id).color;_showFolderModal(id);}
function _showFolderModal(editId){
  const f=editId?getFolder(editId):null;
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-title">${editId?'✏️ Edit Folder':'➕ New Folder'}</div><div class="form-group"><label>Name</label><input id="mi-name" type="text" placeholder="e.g. Biology, History…" value="${esc(f?.name||'')}" autofocus></div><div class="form-group"><label>Colour</label><div class="color-row">${COLORS.map(c=>`<div class="swatch ${_pickedColor===c.n?'picked':''}" style="background:${c.h}" onclick="pickColor('${c.n}',this)"></div>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="${editId?`_saveEditFolder('${editId}')`:'_saveNewFolder()'}">${editId?'Save':'Create'}</button></div></div></div>`;
  document.getElementById('mi-name').onkeydown=e=>{if(e.key==='Enter')editId?_saveEditFolder(editId):_saveNewFolder();};
}
function pickColor(name,el){_pickedColor=name;document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('picked'));el.classList.add('picked');}
function _saveNewFolder(){const name=document.getElementById('mi-name').value.trim();if(!name){toast('Please enter a name');return;}closeModal();createFolder(name,_pickedColor);}
function _saveEditFolder(id){const name=document.getElementById('mi-name').value.trim();if(!name){toast('Please enter a name');return;}closeModal();updateFolder(id,{name,color:_pickedColor});}
function modalSetNew(fid){document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-title">➕ New Set</div><div class="form-group"><label>Name</label><input id="mi-name" type="text" placeholder="e.g. Chapter 1 Vocab…" autofocus></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="_saveNewSet('${fid}')">Create</button></div></div></div>`;document.getElementById('mi-name').onkeydown=e=>{if(e.key==='Enter')_saveNewSet(fid);};}
function modalSetEdit(fid,sid){const s=getSet(fid,sid);document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-title">✏️ Rename Set</div><div class="form-group"><label>Name</label><input id="mi-name" type="text" value="${esc(s.name)}" autofocus></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="_saveEditSet('${fid}','${sid}')">Save</button></div></div></div>`;document.getElementById('mi-name').onkeydown=e=>{if(e.key==='Enter')_saveEditSet(fid,sid);};}
function _saveNewSet(fid){const name=document.getElementById('mi-name').value.trim();if(!name){toast('Please enter a name');return;}closeModal();const set=createSet(fid,name);save();nav('set',fid,set.id);}
function _saveEditSet(fid,sid){const name=document.getElementById('mi-name').value.trim();if(!name){toast('Please enter a name');return;}closeModal();updateSet(fid,sid,{name});}
let _confirmCb=null;
function confirmDel(msg,cb,detail='This cannot be undone.'){_confirmCb=cb;document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-title">Confirm Delete</div><p style="color:var(--text-muted);font-size:14px;margin-bottom:4px">${msg}</p><p style="color:var(--text-muted);font-size:13px">${detail}</p><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="closeModal();_confirmCb()">Delete</button></div></div></div>`;}

/* ═══════════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════════ */
/* ── Lightbox ── */
function lightbox(src){
  const el=document.createElement('div');
  el.className='lightbox-overlay';
  el.innerHTML=`<img src="${src}" alt="">`;
  el.onclick=()=>el.remove();
  document.body.appendChild(el);
}

/* ── Overall mastery snapshot (used for progress bars) ──
   Each card contributes equally: its % is correct/total within its recent attempts.
   Unstudied cards count as 0%. Average across all cards in the set. ── */
function cardMasteryPct(cs){
  // cs may be undefined (never studied) or lack h (old data)
  if(!cs)return 0;
  const h=cs.h;
  if(h&&h.length){
    const recent=h.slice(-SETTINGS.masteryWindow);
    return Math.round(recent.filter(Boolean).length/recent.length*100);
  }
  // fallback for old entries that have c/i but no h
  const tot=cs.c+cs.i;return tot?Math.round(cs.c/tot*100):0;
}
function getOverallMastery(set){
  // All cards count: unstudied = 0%, studied = recent-attempt mastery %
  if(!set.cards.length)return null;
  const sum=set.cards.reduce((acc,card)=>acc+cardMasteryPct(CARD_STATS[card.id]),0);
  return Math.round(sum/set.cards.length);
}

function saveSessionStats(sid,correct,total,incorrectIds=[]){
  const set=S.folders.flatMap(f=>f.sets).find(s=>s.id===sid);
  const overallPct=set?getOverallMastery(set):Math.round(correct/total*100);
  if(!STATS[sid])STATS[sid]=[];
  STATS[sid].push({date:new Date().toISOString(),correct,total,overallPct,incorrectIds:[...incorrectIds]});
  if(STATS[sid].length>50)STATS[sid]=STATS[sid].slice(-50);
  saveStats(); saveCardStats();
}

/* ── Session resume (single unified slot — last session wins) ── */
const _sesKey=sid=>'flashforge_session_'+sid;
function saveStudySession(sid){
  if(!S.study||S.study.done)return;
  try{localStorage.setItem(_sesKey(sid),JSON.stringify({
    cardIds:S.study.cards.map(c=>c.id),idx:S.study.idx,
    correct:[...S.study.correct],incorrect:[...S.study.incorrect],
    history:[...S.study.history],isSubset:!!S.study.isSubset,subsetLabel:S.study.subsetLabel||''
  }));}catch(e){}
}
function loadStudySession(sid,allCards){
  try{
    const raw=localStorage.getItem(_sesKey(sid));if(!raw)return null;
    const snap=JSON.parse(raw);
    const cardMap=Object.fromEntries(allCards.map(c=>[c.id,c]));
    const cards=snap.cardIds.map(id=>cardMap[id]).filter(Boolean);
    if(!cards.length||snap.idx<=0)return null;
    return{cards,idx:snap.idx,correct:snap.correct||[],incorrect:snap.incorrect||[],
      history:snap.history||[],flipped:false,done:false,isSubset:!!snap.isSubset,subsetLabel:snap.subsetLabel||''};
  }catch(e){return null;}
}
function clearStudySession(sid){try{localStorage.removeItem(_sesKey(sid));}catch(e){}}
function getSetStats(sid){
  const sessions=STATS[sid]||[];if(!sessions.length)return null;
  // Use overallPct (progress snapshot) if available, else fall back to session score for old entries
  const pcts=sessions.map(s=>s.overallPct!=null?s.overallPct:Math.round(s.correct/s.total*100));
  const recent=sessions.slice(-8);
  const recentPcts=pcts.slice(-8);
  return{sessions:sessions.length,best:Math.max(...pcts),avg:Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length),last:sessions[sessions.length-1].date,recent,recentPcts};
}
function getCardMastery(set){
  // Uses recent mastery per card. Returns weak (<threshold, studied), strong (>=threshold, studied), unseen lists.
  const threshold=SETTINGS.masteryThreshold;
  const all=set.cards.map(card=>{
    const cs=CARD_STATS[card.id];
    const text=((card.front||card.back||'')).replace(/<\/?(?:sup|sub)>/g,'').replace(/<[^>]+>/g,'').trim();
    const pct=cardMasteryPct(cs);
    const studied=!!(cs&&(cs.c+cs.i)>0);
    const recentN=Math.min(cs?.h?.length??0,SETTINGS.masteryWindow);
    return{text,pct,studied,recentN,starred:!!card.starred};
  });
  // Unstudied cards join the weak list (sorted to bottom at 0%)
  const weak=all.filter(d=>!d.studied||d.pct<threshold).sort((a,b)=>a.pct-b.pct||Number(b.studied)-Number(a.studied));
  const strong=all.filter(d=>d.studied&&d.pct>=threshold).sort((a,b)=>b.pct-a.pct);
  return{weak,strong,hasData:all.length>0};
}

/* ═══════════════════════════════════════════════════════════
   RENDER HELPERS
═══════════════════════════════════════════════════════════ */
function setBreadcrumb(items){const bc=document.getElementById('bc');if(!items.length){bc.innerHTML='';return;}const parts=items.map((it,i)=>i===items.length-1?`<span class="bc-current">${esc(it.label)}</span>`:`<span class="bc-item" onclick="nav('${it.view}','${it.fid||''}','${it.sid||''}')">${esc(it.label)}</span>`);bc.innerHTML='<span class="bc-sep">›</span>'+parts.join('<span class="bc-sep">›</span>');}
function setActions(html){document.getElementById('nav-actions').innerHTML=html;}

/* ═══════════════════════════════════════════════════════════
   VIEW: HOME
═══════════════════════════════════════════════════════════ */
function renderHome(){
  setBreadcrumb([]);
  setActions(`<button class="btn btn-ghost" onclick="modalImport(null)">📥 Quizlet</button><button class="btn btn-ghost" onclick="exportSetsFile()">📦 Export Sets</button><button class="btn btn-ghost" onclick="importSetsFile()">📂 Import Sets</button><button class="btn btn-ghost" onclick="exportBackup()">💾 Backup</button><button class="btn btn-ghost" onclick="importBackup()">↩ Restore</button><button class="btn btn-primary" onclick="modalFolderNew()">+ New Folder</button>`);
  const backupNote=SETTINGS.lastBackup?`<div class="backup-note">💾 Last backup: <strong>${relDate(SETTINGS.lastBackup)}</strong> (${SETTINGS.lastBackup.slice(0,10)})</div>`:`<div class="backup-note" style="color:var(--amber)">💾 No backup yet — use Backup to save a copy of your cards</div>`;
  const app=document.getElementById('app');
  if(!S.folders.length){app.innerHTML=`<div class="main"><div class="empty"><div class="empty-icon">📂</div><div class="empty-title">No folders yet</div><div class="empty-desc">Create your first folder to organise flashcard sets</div><button class="btn btn-primary btn-lg" onclick="modalFolderNew()">Create a Folder</button></div>${backupNote}</div>`;return;}
  const cards=S.folders.map(f=>{const total=f.sets.reduce((n,s)=>n+s.cards.length,0);return`<div class="folder-card fc-${f.color}" onclick="nav('folder','${f.id}')"><div class="folder-card-actions"><button class="btn-icon" onclick="event.stopPropagation();modalFolderEdit('${f.id}')">✏️</button><button class="btn-icon danger" onclick="event.stopPropagation();confirmDel('Delete folder &quot;${esc(f.name)}&quot; and all its sets?',()=>deleteFolder('${f.id}'),'You can undo this briefly after deletion.')">🗑️</button></div><div class="folder-card-icon">📁</div><div class="folder-card-name">${esc(f.name)}</div><div class="folder-card-count">${f.sets.length} set${f.sets.length!==1?'s':''} · ${total} card${total!==1?'s':''}</div></div>`;}).join('');
  app.innerHTML=`<div class="main"><div class="page-header"><div><div class="page-title">My Folders</div><div class="page-subtitle">${S.folders.length} folder${S.folders.length!==1?'s':''}</div></div></div><div class="folder-grid">${cards}</div>${backupNote}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   VIEW: FOLDER
═══════════════════════════════════════════════════════════ */
function renderFolder(){
  const f=getFolder(S.folderId);if(!f){nav('home');return;}
  setBreadcrumb([{label:f.name,view:'folder',fid:f.id}]);
  setActions(`<button class="btn btn-ghost" onclick="nav('stats','${f.id}')">📊 Stats</button><button class="btn btn-ghost" onclick="modalImport('${f.id}')">📥 Import Set</button><button class="btn btn-primary" onclick="modalSetNew('${f.id}')">+ New Set</button>`);
  const app=document.getElementById('app');
  if(!f.sets.length){app.innerHTML=`<div class="main"><div class="page-header"><div class="page-title">${esc(f.name)}</div></div><div class="empty"><div class="empty-icon">📚</div><div class="empty-title">No sets yet</div><div class="empty-desc">Create your first flashcard set</div><button class="btn btn-primary btn-lg" onclick="modalSetNew('${f.id}')">Create a Set</button></div></div>`;return;}
  const cards=f.sets.map(s=>{const preview=s.cards.length?esc(s.cards[0].front.replace(/<\/?(?:sup|sub)>/g,'').slice(0,80))+(s.cards[0].front.length>80?'…':''):'';const st=getSetStats(s.id);const stBadge=st?`<span style="font-size:12px;color:${pctColor(st.avg)};font-weight:700;margin-left:8px">${st.avg}% avg</span>`:'';const starred=s.cards.filter(c=>c.starred).length;return`<div class="set-card"><div class="set-card-actions"><button class="btn-icon" onclick="event.stopPropagation();modalSetEdit('${f.id}','${s.id}')">✏️</button><button class="btn-icon danger" onclick="event.stopPropagation();confirmDel('Delete set &quot;${esc(s.name)}&quot;?',()=>deleteSet('${f.id}','${s.id}'),'You can undo this briefly after deletion.')">🗑️</button></div><div class="set-card-name">${esc(s.name)}${stBadge}</div><div class="set-card-meta">📇 ${s.cards.length} card${s.cards.length!==1?'s':''}${starred?' · ⭐ '+starred+' starred':''}${st?' · '+st.sessions+' session'+(st.sessions!==1?'s':''):''}</div>${preview?`<div class="set-card-preview">"${preview}"</div>`:''}<div class="set-card-btns">${s.cards.length?`<button class="btn btn-primary btn-sm" onclick="modalStudyMode('${f.id}','${s.id}')">▶ Study</button>`:''}<button class="btn btn-outline btn-sm" onclick="nav('set','${f.id}','${s.id}')">✏️ Edit</button></div></div>`;}).join('');
  app.innerHTML=`<div class="main"><div class="page-header"><div><div class="page-title">${esc(f.name)}</div><div class="page-subtitle">${f.sets.length} set${f.sets.length!==1?'s':''}</div></div></div><div class="set-grid">${cards}</div></div>`;
}

/* ═══════════════════════════════════════════════════════════
   VIEW: STATS
═══════════════════════════════════════════════════════════ */
function renderStats(){
  const f=getFolder(S.folderId);if(!f){nav('home');return;}
  setBreadcrumb([{label:f.name,view:'folder',fid:f.id},{label:'Stats',view:'stats',fid:f.id}]);
  setActions(`<button class="btn btn-ghost" onclick="nav('folder','${f.id}')">← Back</button>`);
  const statsNote=`Strong cards are ${SETTINGS.masteryThreshold}%+ over the last ${SETTINGS.masteryWindow} attempt${SETTINGS.masteryWindow!==1?'s':''} per card`;
  const cards=f.sets.map(s=>{
    const st=getSetStats(s.id);const mastery=getCardMastery(s);
    let sessionHTML='',masteryHTML='';
    if(st){
      const bars=st.recentPcts.map((p,i)=>{const ses=st.recent[i];return`<div class="sparkbar" style="height:${Math.max(6,Math.round(p*0.44))}px;background:${pctColor(p)}" title="${p}% overall mastery — ${ses.date.slice(0,10)}"></div>`;}).join('');
      const empties=Array(Math.max(0,8-st.recent.length)).fill('<div class="spark-empty"></div>').join('');
      sessionHTML=`<div class="stats-section"><div class="stats-section-title"><span class="session-badge">📈 ${st.sessions} session${st.sessions!==1?'s':''}</span></div><div class="sparkline-label">Overall mastery after each session (most recent →)</div><div class="sparkline">${empties}${bars}</div><div class="stats-meta"><div class="stats-meta-item">Best: <strong style="color:${pctColor(st.best)}">${st.best}%</strong></div><div class="stats-meta-item">Average: <strong style="color:${pctColor(st.avg)}">${st.avg}%</strong></div><div class="stats-meta-item">Last studied: <strong>${relDate(st.last)}</strong></div></div></div>`;
    } else {sessionHTML=`<div class="stats-section"><div class="stats-never">Not studied yet</div></div>`;}
    if(mastery.hasData){
      const uid2=()=>Math.random().toString(36).slice(2,8);
      const mkItem=d=>{
        const col=pctColor(d.pct);
        const bar=`<div class="mastery-bar-wrap"><div class="mastery-bar-fill" style="width:${d.pct}%;background:${col}"></div></div>`;
        const label=`<span class="mastery-pct" style="color:${col}">${d.pct}%</span>`;
        return`<li class="mastery-item">${bar}${label}<span class="mastery-text">${d.starred?'⭐ ':''}${esc(d.text.slice(0,80)+(d.text.length>80?'…':''))}</span></li>`;
      };
      const mkSection=(icon,title,items,emptyMsg,startOpen)=>{
        const id=uid2();
        const inner=items.length?items.map(mkItem).join(''):`<li><div class="mastery-none">${emptyMsg}</div></li>`;
        const count=items.length?` (${items.length})`:'';
        return`<div class="stats-section"><div class="stats-section-title" style="display:flex;align-items:center;justify-content:space-between">${icon} ${title}${count}<button class="mastery-toggle" onclick="var el=document.getElementById('mc-${id}');el.classList.toggle('collapsed');this.textContent=el.classList.contains('collapsed')?'▶ Show':'▼ Hide'">${startOpen?'▼ Hide':'▶ Show'}</button></div><div class="mastery-collapsible${startOpen?'':' collapsed'}" id="mc-${id}" style="max-height:9999px"><ul class="mastery-list">${inner}</ul></div></div>`;
      };
      const weakSection=mkSection('😤','Struggling',mastery.weak,'No struggling cards — great work!',false);
      const strongSection=mkSection('💪','Strong',mastery.strong,'Study more to see your strongest cards',false);
      masteryHTML=weakSection+strongSection;
    }
    return`<div class="stats-card"><div class="stats-card-header"><div><div class="stats-card-name">${esc(s.name)}</div><div class="stats-card-count">${s.cards.length} card${s.cards.length!==1?'s':''}</div></div></div>${sessionHTML}${masteryHTML}<div class="stats-card-footer">${s.cards.length?`<button class="btn btn-primary btn-sm" onclick="modalStudyMode('${f.id}','${s.id}')">▶ Study Now</button>`:''}<button class="btn btn-ghost btn-sm" onclick="nav('set','${f.id}','${s.id}')">Edit</button>${st?`<button class="btn btn-ghost btn-sm" onclick="clearStats('${s.id}')">Clear</button>`:''}</div></div>`;
  }).join('');
  document.getElementById('app').innerHTML=`<div class="main"><div class="page-header"><div><div class="page-title">📊 ${esc(f.name)} — Stats</div><div class="page-subtitle">${f.sets.length} set${f.sets.length!==1?'s':''} · ${statsNote}</div></div></div>${f.sets.length?`<div class="stats-grid">${cards}</div>`:`<div class="empty"><div class="empty-icon">📚</div><div class="empty-title">No sets yet</div></div>`}</div>`;
}
function clearStats(sid){if(!confirm('Clear all study history for this set?'))return;const set=S.folders.flatMap(f=>f.sets).find(s=>s.id===sid);if(set)set.cards.forEach(c=>delete CARD_STATS[c.id]);delete STATS[sid];saveStats();saveCardStats();renderStats();toast('Stats cleared');}

/* ═══════════════════════════════════════════════════════════
   VIEW: SET EDITOR
═══════════════════════════════════════════════════════════ */
function renderSet(){
  const fid=S.folderId,sid=S.setId,f=getFolder(fid),s=getSet(fid,sid);if(!f||!s){nav('home');return;}
  setBreadcrumb([{label:f.name,view:'folder',fid},{label:s.name,view:'set',fid,sid}]);
  setActions(`<button class="btn btn-ghost" onclick="modalSetEdit('${fid}','${sid}')">✏️ Rename</button>${s.cards.length?`<button class="btn btn-primary" onclick="modalStudyMode('${fid}','${sid}')">▶ Study</button>`:''}`);
  const items=s.cards.length?_insertCardZone(fid,sid,0)+s.cards.map((c,i)=>_cardItemHTML(c,i,fid,sid)+_insertCardZone(fid,sid,i+1)).join(''):'';
  document.getElementById('app').innerHTML=`<div class="main"><div class="page-header"><div><div class="page-title">${esc(s.name)}</div><div class="page-subtitle">${s.cards.length} card${s.cards.length!==1?'s':''}</div></div></div><div class="info-box" style="margin-bottom:16px">💡 <strong>Superscript:</strong> select text then click x<sup>²</sup> or press <kbd style="font-family:monospace;font-size:11px;padding:1px 5px;background:rgba(0,0,0,.1);border-radius:3px">${shortcutLabel(SETTINGS.formatKeys.superscript)}</kbd> &nbsp;·&nbsp; <strong>Subscript:</strong> x<sub>₂</sub> or <kbd style="font-family:monospace;font-size:11px;padding:1px 5px;background:rgba(0,0,0,.1);border-radius:3px">${shortcutLabel(SETTINGS.formatKeys.subscript)}</kbd></div><div class="cards-list" id="cards-list">${items}</div><div style="margin-top:12px"><button class="add-card-zone" onclick="_addAndRender('${fid}','${sid}')">+ Add Card</button></div></div>`;
}
function _insertCardZone(fid,sid,index){
  return`<button class="insert-card-zone" type="button" onclick="insertCardAt('${fid}','${sid}',${index})" ondragover="_dragZoneOver(event)" ondragleave="_dragZoneLeave(event)" ondrop="_dropCardAt(event,'${fid}','${sid}',${index})">+ Insert card here</button>`;
}
function _cardItemHTML(c,i,fid,sid){
  const hint='📷 Click · paste · or drag an image';
  const fImg=c.frontImg?`<div class="img-preview"><img src="${c.frontImg}" alt=""><button class="img-remove" onclick="removeImg('${fid}','${sid}','${c.id}','front')">✕</button></div>`:`<div class="img-upload-zone" id="zone-${c.id}-front" tabindex="0" onclick="pickImg('${fid}','${sid}','${c.id}','front')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','front')" ondragover="event.preventDefault()" ondrop="_dropImg(event,'${fid}','${sid}','${c.id}','front')">${hint}</div>`;
  const bImg=c.backImg?`<div class="img-preview"><img src="${c.backImg}" alt=""><button class="img-remove" onclick="removeImg('${fid}','${sid}','${c.id}','back')">✕</button></div>`:`<div class="img-upload-zone" id="zone-${c.id}-back" tabindex="0" onclick="pickImg('${fid}','${sid}','${c.id}','back')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','back')" ondragover="event.preventDefault()" ondrop="_dropImg(event,'${fid}','${sid}','${c.id}','back')">${hint}</div>`;
  const toolbar=side=>`<div class="card-toolbar"><button class="toolbar-btn" type="button" title="Bold (${shortcutLabel(SETTINGS.formatKeys.bold)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','bold')"><strong>B</strong></button><button class="toolbar-btn" type="button" title="Italic (${shortcutLabel(SETTINGS.formatKeys.italic)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','italic')"><em>I</em></button><button class="toolbar-btn" type="button" title="Superscript (${shortcutLabel(SETTINGS.formatKeys.superscript)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','superscript')">x<sup>²</sup></button><button class="toolbar-btn" type="button" title="Subscript (${shortcutLabel(SETTINGS.formatKeys.subscript)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','subscript')">x<sub>₂</sub></button></div>`;
  const star=`<button class="btn-icon star-btn ${c.starred?'starred':''}" title="${c.starred?'Unstar card':'Star card'}" onclick="toggleStar('${fid}','${sid}','${c.id}')">${c.starred?'★':'☆'}</button>`;
  const drag=`<button class="btn-icon drag-handle" title="Drag to reorder" draggable="true" ondragstart="_dragCardStart(event,'${fid}','${sid}','${c.id}')" ondragend="_dragCardEnd()">↕</button>`;
  const reorder=`<button class="btn-icon" title="Move up" onclick="moveCardBy('${fid}','${sid}','${c.id}',-1)">↑</button><button class="btn-icon" title="Move down" onclick="moveCardBy('${fid}','${sid}','${c.id}',1)">↓</button>`;
  const frontEmpty=(c.front||'').trim()?'':' is-empty',backEmpty=(c.back||'').trim()?'':' is-empty';
  return`<div class="card-item" id="ci-${c.id}"><div class="card-item-header"><span class="card-num">Card ${i+1}${c.starred?' · Starred':''}</span><div class="card-item-actions">${drag}${reorder}${star}<button class="btn-icon danger" onclick="confirmDel('Delete card ${i+1}?',()=>deleteCard('${fid}','${sid}','${c.id}'),'You can undo this briefly after deletion.')">🗑️</button></div></div><div class="card-fields"><div class="card-field"><label>Front — Question / Term</label>${toolbar('front')}<div id="rich-${c.id}-front" class="rich-editor${frontEmpty}" contenteditable="true" data-placeholder="Question or term..." oninput="_richInput(this,'${fid}','${sid}','${c.id}','front')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','front')" onkeydown="_richKeydown(event,'${fid}','${sid}','${c.id}','front')" onfocus="_richSyncEmpty(this)" onblur="_richInput(this,'${fid}','${sid}','${c.id}','front')">${safeHTML(c.front)}</div>${fImg}</div><div class="card-field"><label>Back — Answer / Definition</label>${toolbar('back')}<div id="rich-${c.id}-back" class="rich-editor${backEmpty}" contenteditable="true" data-placeholder="Answer or definition..." oninput="_richInput(this,'${fid}','${sid}','${c.id}','back')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','back')" onkeydown="_richKeydown(event,'${fid}','${sid}','${c.id}','back')" onfocus="_richSyncEmpty(this)" onblur="_richInput(this,'${fid}','${sid}','${c.id}','back')">${safeHTML(c.back)}</div>${bImg}</div></div></div>`;
}
function _addAndRender(fid,sid){addCard(fid,sid);renderSet();setTimeout(()=>document.getElementById('cards-list')?.lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'}),60);}

function modalStudyEditCard(){
  const fid=S.folderId,sid=S.setId,st=S.study;
  if(S.view!=='study'||!st||st.done){toast('No active card to edit');return;}
  const c=getCard(fid,sid,st.cards[st.idx]?.id);
  if(!c){toast('Could not find this card');return;}
  const hint='📷 Click · paste · or drag an image';
  const toolbar=side=>`<div class="card-toolbar"><button class="toolbar-btn" type="button" title="Bold (${shortcutLabel(SETTINGS.formatKeys.bold)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','bold')"><strong>B</strong></button><button class="toolbar-btn" type="button" title="Italic (${shortcutLabel(SETTINGS.formatKeys.italic)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','italic')"><em>I</em></button><button class="toolbar-btn" type="button" title="Superscript (${shortcutLabel(SETTINGS.formatKeys.superscript)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','superscript')">x<sup>²</sup></button><button class="toolbar-btn" type="button" title="Subscript (${shortcutLabel(SETTINGS.formatKeys.subscript)})" onmousedown="event.preventDefault();_richCommand('${fid}','${sid}','${c.id}','${side}','subscript')">x<sub>₂</sub></button></div>`;
  const fImg=c.frontImg?`<div class="img-preview"><img src="${c.frontImg}" alt=""><button class="img-remove" onclick="removeImg('${fid}','${sid}','${c.id}','front','study-edit')">✕</button></div>`:`<div class="img-upload-zone" id="zone-${c.id}-front" tabindex="0" onclick="pickImg('${fid}','${sid}','${c.id}','front','study-edit')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','front','study-edit')" ondragover="event.preventDefault()" ondrop="_dropImg(event,'${fid}','${sid}','${c.id}','front','study-edit')">${hint}</div>`;
  const bImg=c.backImg?`<div class="img-preview"><img src="${c.backImg}" alt=""><button class="img-remove" onclick="removeImg('${fid}','${sid}','${c.id}','back','study-edit')">✕</button></div>`:`<div class="img-upload-zone" id="zone-${c.id}-back" tabindex="0" onclick="pickImg('${fid}','${sid}','${c.id}','back','study-edit')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','back','study-edit')" ondragover="event.preventDefault()" ondrop="_dropImg(event,'${fid}','${sid}','${c.id}','back','study-edit')">${hint}</div>`;
  const star=`<button class="btn-icon star-btn ${c.starred?'starred':''}" title="${c.starred?'Unstar card':'Star card'}" onclick="toggleStar('${fid}','${sid}','${c.id}','study-edit')">${c.starred?'★':'☆'}</button>`;
  const frontEmpty=(c.front||'').trim()?'':' is-empty',backEmpty=(c.back||'').trim()?'':' is-empty';
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this){closeModal();renderStudy();}"><div class="modal" style="max-width:760px"><div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span>✏️ Edit Current Card</span><span style="display:flex;align-items:center;gap:8px">${star}<span class="save-state" id="study-edit-save-state">Saved</span></span></div><div class="card-item study-edit-card" id="ci-${c.id}"><div class="card-fields"><div class="card-field"><label>Front — Question / Term</label>${toolbar('front')}<div id="rich-${c.id}-front" class="rich-editor${frontEmpty}" contenteditable="true" data-placeholder="Question or term..." oninput="_richInput(this,'${fid}','${sid}','${c.id}','front')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','front','study-edit')" onkeydown="_richKeydown(event,'${fid}','${sid}','${c.id}','front')" onfocus="_richSyncEmpty(this)" onblur="_richInput(this,'${fid}','${sid}','${c.id}','front')">${safeHTML(c.front)}</div>${fImg}</div><div class="card-field"><label>Back — Answer / Definition</label>${toolbar('back')}<div id="rich-${c.id}-back" class="rich-editor${backEmpty}" contenteditable="true" data-placeholder="Answer or definition..." oninput="_richInput(this,'${fid}','${sid}','${c.id}','back')" onpaste="handlePaste(event,'${fid}','${sid}','${c.id}','back','study-edit')" onkeydown="_richKeydown(event,'${fid}','${sid}','${c.id}','back')" onfocus="_richSyncEmpty(this)" onblur="_richInput(this,'${fid}','${sid}','${c.id}','back')">${safeHTML(c.back)}</div>${bImg}</div></div></div><div class="modal-footer"><button class="btn btn-primary" onclick="closeModal();renderStudy()">Done</button></div></div></div>`;
}

/* ═══════════════════════════════════════════════════════════
   STUDY SESSION
═══════════════════════════════════════════════════════════ */
/* ── Weak-card helper ── */
function getWeakCards(set){
  // Unstudied cards are weak (need to be learned). Studied cards below threshold are also weak.
  return set.cards.filter(c=>{
    const cs=CARD_STATS[c.id];
    if(!cs||!(cs.c+cs.i))return true;  // never studied = weak
    return cardMasteryPct(cs)<SETTINGS.masteryThreshold;
  });
}
function getUnderThresholdCards(set){return set.cards.filter(c=>{const cs=CARD_STATS[c.id];return !!(cs&&(cs.c+cs.i)>0)&&cardMasteryPct(cs)<SETTINGS.masteryThreshold;});}
function getUnseenCards(set){return set.cards.filter(c=>{const cs=CARD_STATS[c.id];return !(cs&&(cs.c+cs.i)>0);});}
function getStarredCards(set){return set.cards.filter(c=>c.starred);}
function getLastWrongCards(set){
  const sessions=STATS[set.id]||[];
  const last=[...sessions].reverse().find(s=>Array.isArray(s.incorrectIds));
  if(!last||!last.incorrectIds.length)return[];
  const wrong=new Set(last.incorrectIds);
  return set.cards.filter(c=>wrong.has(c.id));
}
function studyModeBtn(icon,label,cards,fid,sid,primary=false){
  const n=cards.length,suffix=`${n} card${n!==1?'s':''}`;
  return n
    ?`<button class="btn ${primary?'btn-primary':'btn-outline'} btn-lg" onclick="closeModal();startStudySubset('${fid}','${sid}','${label}',window._studyModeCards['${label}'])">${icon} ${label} — ${suffix}</button>`
    :`<button class="btn btn-outline btn-lg" disabled>${icon} ${label} — none</button>`;
}

/* ── Study mode picker modal ── */
function modalStudyMode(fid,sid){
  const s=getSet(fid,sid);
  if(!s||!s.cards.length){toast('No cards to study!');return;}
  const n=s.cards.length;
  const weak=getWeakCards(s);
  const underThreshold=getUnderThresholdCards(s),unseen=getUnseenCards(s),lastWrong=getLastWrongCards(s),starred=getStarredCards(s);
  const saved=loadStudySession(sid,s.cards);
  const underLabel=`Under ${SETTINGS.masteryThreshold}%`;
  window._studyModeCards={'Weak Cards':weak,[underLabel]:underThreshold,'Unseen':unseen,'Wrong Last Session':lastWrong,'Starred':starred,'Study All':[...s.cards]};
  const weakBtn=studyModeBtn('📉','Weak Cards',weak,fid,sid,true);
  const underBtn=studyModeBtn('⚠️',underLabel,underThreshold,fid,sid);
  const unseenBtn=studyModeBtn('👀','Unseen',unseen,fid,sid);
  const wrongBtn=studyModeBtn('↩','Wrong Last Session',lastWrong,fid,sid);
  const starredBtn=studyModeBtn('⭐','Starred',starred,fid,sid);
  const sessionType=saved?.subsetLabel||(saved?.isSubset?'subset':'full set');
  const resumeBtn=saved
    ?`<button class="btn btn-outline btn-lg" onclick="closeModal();resumeLastSession('${fid}','${sid}')">▶ Pick up where you left off — card ${saved.idx+1} of ${saved.cards.length} (${sessionType})</button>`
    :`<button class="btn btn-outline btn-lg" disabled>▶ Pick up where you left off — no session saved</button>`;
  const allBtn=`<button class="btn btn-outline btn-lg" onclick="closeModal();startStudy('${fid}','${sid}',true)">📚 Study All — ${n} card${n!==1?'s':''}</button>`;
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:460px"><div class="modal-title">Study "${esc(s.name)}"</div><div class="modal-footer" style="flex-direction:column;gap:8px;align-items:stretch">${weakBtn}${underBtn}${unseenBtn}${wrongBtn}${starredBtn}${resumeBtn}${allBtn}<button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div></div></div>`;
}

function resumeLastSession(fid,sid){
  const s=getSet(fid,sid);if(!s)return;
  const saved=loadStudySession(sid,s.cards);
  if(saved){S.view='study';S.folderId=fid;S.setId=sid;S.study=saved;render();toast('▶ Resuming — card '+(saved.idx+1)+' of '+saved.cards.length);return;}
  toast('No saved session found');
}

function startStudyWeak(fid,sid){
  const s=getSet(fid,sid);if(!s)return;
  const weak=getWeakCards(s);
  startStudySubset(fid,sid,'Weak Cards',weak);
}

function startStudySubset(fid,sid,label,cards){
  const s=getSet(fid,sid);if(!s)return;
  if(!cards||!cards.length){toast(`No ${label.toLowerCase()} cards`);return;}
  clearStudySession(sid);
  S.view='study';S.folderId=fid;S.setId=sid;
  S.study={cards:[...cards],idx:0,flipped:false,correct:[],incorrect:[],done:false,history:[],isSubset:true,subsetLabel:label};
  render();toast(`${label} — ${cards.length} card${cards.length!==1?'s':''}`);
}

function startStudy(fid,sid,forceNew){
  const s=getSet(fid,sid);if(!s||!s.cards.length){toast('No cards to study!');return;}
  S.view='study';S.folderId=fid;S.setId=sid;
  clearStudySession(sid); // always clear before starting fresh
  S.study={cards:[...s.cards],idx:0,flipped:false,correct:[],incorrect:[],done:false,history:[]};
  render();
}

function renderStudy(){
  const fid=S.folderId,sid=S.setId,f=getFolder(fid),s=getSet(fid,sid),st=S.study;
  setBreadcrumb([{label:f.name,view:'folder',fid},{label:s.name,view:'set',fid,sid}]);
  setActions(`<button class="btn btn-ghost" onclick="nav('set','${fid}','${sid}')">✕ Exit</button>`);
  if(st.done){_renderComplete();return;}
  const card=st.cards[st.idx];
  const total=st.cards.length,done=st.correct.length+st.incorrect.length;
  const pct=((done/total)*100).toFixed(1);
  const k=SETTINGS.keys;
  const flipHint=st.flipped?'':('👆 Click the card or press <kbd class="kbd">'+keyLabel(k.flip)+'</kbd> to reveal');
  document.getElementById('app').innerHTML=`
    <div class="study-wrap">
      <div class="study-progress">
        <div class="progress-meta"><span>Card ${st.idx+1} of ${total}</span><span>${pct}% done</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-score"><span class="sc-correct">✓ ${st.correct.length} got it</span><span class="sc-incorrect">✗ ${st.incorrect.length} still learning</span></div>
      </div>
      <div class="card-scene">
        <div class="flip-card${st.flipped?' flipped':''}" id="fc" onclick="flipCard()">
          <div class="card-face card-front">
            <div class="face-label">Question</div>
            ${card.frontImg?`<img class="face-img" src="${card.frontImg}" alt="" onclick="event.stopPropagation();lightbox(this.src)">`:''}
            <div class="face-text">${safeHTML(card.front)||'<em style="color:var(--text-muted)">No text</em>'}</div>
          </div>
          <div class="card-face card-back">
            <div class="face-label">Answer</div>
            ${card.backImg?`<img class="face-img" src="${card.backImg}" alt="" onclick="event.stopPropagation();lightbox(this.src)">`:''}
            <div class="face-text">${safeHTML(card.back)||'<em style="color:var(--text-muted)">No text</em>'}</div>
          </div>
        </div>
      </div>
      <div class="flip-hint" id="flip-hint">${flipHint}</div>
      <div class="study-edit-row"><button class="btn-icon star-btn ${card.starred?'starred':''}" title="${card.starred?'Unstar card':'Star card'}" onclick="toggleStar('${fid}','${sid}','${card.id}','study')">${card.starred?'★':'☆'}</button><button class="btn btn-outline btn-sm" onclick="modalStudyEditCard()">✏️ Edit Card</button></div>
      <div class="study-btns${st.flipped?'':' hidden'}" id="study-btns">
        <button class="btn-nope" onclick="markCard(false)">✗&nbsp; Still Learning</button>
        <button class="btn-know" onclick="markCard(true)">✓&nbsp; Got It!</button>
      </div>
      <div class="study-undo-row">${st.history.length?`<button class="btn-undo" onclick="undoCard()">↩ Undo last card</button>`:''}</div>
      <div class="shortcut-bar">
        <span><kbd class="kbd">${keyLabel(k.flip)}</kbd> Flip</span>
        <span><kbd class="kbd">${keyLabel(k.yes)}</kbd> Got it</span>
        <span><kbd class="kbd">${keyLabel(k.no)}</kbd> Still learning</span>
        <span><kbd class="kbd">${keyLabel(k.undo)}</kbd> Undo</span>
      </div>
    </div>`;
  _setupStudyKeys();
}

function flipCard(){
  S.study.flipped=!S.study.flipped;
  document.getElementById('fc')?.classList.toggle('flipped',S.study.flipped);
  document.getElementById('study-btns')?.classList.toggle('hidden',!S.study.flipped);
  const h=document.getElementById('flip-hint');
  if(h)h.innerHTML=S.study.flipped?'':('👆 Click the card or press <kbd class="kbd">'+keyLabel(SETTINGS.keys.flip)+'</kbd> to reveal');
}
function markCard(correct){
  if(!S.study.flipped){flipCard();return;}
  const card=S.study.cards[S.study.idx];
  if(!CARD_STATS[card.id])CARD_STATS[card.id]={c:0,i:0,h:[]};
  if(correct)CARD_STATS[card.id].c++;else CARD_STATS[card.id].i++;
  // h = rolling recent results array (true=correct, false=incorrect)
  const cs=CARD_STATS[card.id];
  cs.h=([...(cs.h||[]),correct]).slice(-SETTINGS.masteryWindow);
  saveCardStats(); // persist immediately so partial sessions count
  S.study.history.push({cardIdx:S.study.idx,cardId:card.id,correct});
  (correct?S.study.correct:S.study.incorrect).push(card.id);
  S.study.idx++;
  if(S.study.idx>=S.study.cards.length){S.study.done=true;clearStudySession(S.setId);saveSessionStats(S.setId,S.study.correct.length,S.study.cards.length,[...S.study.incorrect]);_renderComplete();}
  else{S.study.flipped=false;saveStudySession(S.setId);renderStudy();}
}
function undoCard(){
  const st=S.study;if(st.done)st.done=false;if(!st.history.length)return;
  const last=st.history.pop();
  if(CARD_STATS[last.cardId]){
    if(last.correct)CARD_STATS[last.cardId].c=Math.max(0,CARD_STATS[last.cardId].c-1);
    else CARD_STATS[last.cardId].i=Math.max(0,CARD_STATS[last.cardId].i-1);
    if(CARD_STATS[last.cardId].h?.length)CARD_STATS[last.cardId].h.pop(); // undo recent-history entry
    if(!CARD_STATS[last.cardId].c&&!CARD_STATS[last.cardId].i)delete CARD_STATS[last.cardId];
    saveCardStats(); // persist the undo immediately
  }
  if(last.correct)st.correct=st.correct.filter(id=>id!==last.cardId);
  else st.incorrect=st.incorrect.filter(id=>id!==last.cardId);
  st.idx=last.cardIdx;st.flipped=false;renderStudy();toast('↩ Undone');
}
function _renderComplete(){
  const st=S.study,fid=S.folderId,sid=S.setId;
  const pct=Math.round(st.correct.length/st.cards.length*100);
  const [emoji,msg]=pct===100?['🎉','Perfect score!']:pct>=80?['🌟','Almost there — great work!']:pct>=50?['👍','Good effort — keep it up!']:['💪',"Keep practising — you'll get there!"];
  document.getElementById('app').innerHTML=`<div class="study-wrap"><div class="complete-wrap"><div class="complete-emoji">${emoji}</div><div class="complete-title">${msg}</div><div class="complete-sub">You scored <strong>${pct}%</strong> on this session</div><div class="stat-row"><div class="stat-box correct"><div class="stat-num">${st.correct.length}</div><div class="stat-lbl">Got It</div></div><div class="stat-box incorrect"><div class="stat-num">${st.incorrect.length}</div><div class="stat-lbl">Still Learning</div></div></div><div class="complete-actions"><button class="btn btn-primary btn-lg" onclick="startStudy('${fid}','${sid}',true)">🔄 Study Again</button>${st.incorrect.length?`<button class="btn btn-outline btn-lg" onclick="_studyMissed('${fid}','${sid}')">📚 Review Missed (${st.incorrect.length})</button>`:''}<button class="btn btn-ghost btn-lg" onclick="nav('stats','${fid}')">📊 View Stats</button><button class="btn btn-ghost btn-lg" onclick="nav('set','${fid}','${sid}')">← Back to Set</button></div></div></div>`;
}
function _studyMissed(fid,sid){const s=getSet(fid,sid),ms=new Set(S.study.incorrect);clearStudySession(sid);S.view='study';S.folderId=fid;S.setId=sid;S.study={cards:s.cards.filter(c=>ms.has(c.id)),idx:0,flipped:false,correct:[],incorrect:[],done:false,history:[],isSubset:true};renderStudy();}
function _setupStudyKeys(){
  if(window._studyKey)document.removeEventListener('keydown',window._studyKey);
  const k=SETTINGS.keys;
  window._studyKey=e=>{
    if(_captureTarget)return;if(S.view!=='study')return;
    const tag=e.target?.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||e.target?.isContentEditable)return;
    if(S.study?.done){if(e.key===k.undo){e.preventDefault();undoCard();}return;}
    if(e.key===k.flip){e.preventDefault();flipCard();}
    else if(e.key===k.yes&&S.study.flipped){markCard(true);}
    else if(e.key===k.no&&S.study.flipped){markCard(false);}
    else if(e.key===k.undo){e.preventDefault();undoCard();}
  };
  document.addEventListener('keydown',window._studyKey);
}

/* ═══════════════════════════════════════════════════════════
   IMPORT — QUIZLET TSV
   Supports three formats (auto-detected):
   1. Tab columns + Semicolon rows  ← recommended for multi-line cards
   2. Tab columns + Newline rows    ← classic single-line cards
   3. Comma/semicolon columns       ← manual fallback
═══════════════════════════════════════════════════════════ */
function modalImport(defaultFolderId){
  const hasFolders=S.folders.length>0;const opts=S.folders.map(f=>`<option value="${f.id}" ${f.id===defaultFolderId?'selected':''}>${esc(f.name)}</option>`).join('');
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:520px"><div class="modal-title">📥 Import from Quizlet</div><div class="info-box"><strong>How to export from Quizlet:</strong><br>Open a set → click <strong>⋯</strong> → <strong>Export</strong><br>"Between term and definition" → <strong>Tab</strong><br>"Between rows" → <strong>Semicolon</strong> (handles multi-line cards)<br>Click <strong>Copy text</strong>, then paste below</div><div class="form-group"><label>Destination Folder</label><select id="imp-folder" onchange="_impFC()">${hasFolders?opts:''}<option value="__new__"${!hasFolders?' selected':''}>+ Create new folder…</option></select></div><div class="form-group" id="imp-new-grp" style="${hasFolders&&defaultFolderId?'display:none':(hasFolders?'display:none':'')}"><label>New Folder Name</label><input id="imp-folder-name" type="text" placeholder="e.g. Biology"></div><div class="form-group"><label>Set Name</label><input id="imp-set-name" type="text" placeholder="e.g. Chapter 1 Vocabulary"></div><div class="form-group"><label>Paste Quizlet text — or <span style="color:var(--primary);cursor:pointer;font-weight:600;text-transform:none;font-size:13px" onclick="impPickFile()">upload .txt file</span></label><textarea id="imp-text" rows="6" placeholder="Paste Quizlet export here…" style="min-height:120px;background:var(--surface2);font-family:monospace;font-size:13px" oninput="_impPrev()"></textarea></div><div id="imp-preview" class="imp-count"></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="_doImport()">Import Cards</button></div></div></div>`;
  setTimeout(()=>{const el=hasFolders?document.getElementById('imp-set-name'):document.getElementById('imp-folder-name');el?.focus();},50);
}
function _impFC(){const v=document.getElementById('imp-folder').value;document.getElementById('imp-new-grp').style.display=v==='__new__'?'':'none';}
function _impPrev(){const t=document.getElementById('imp-text').value.trim(),el=document.getElementById('imp-preview');if(!t){el.textContent='';el.className='imp-count';return;}const c=_parseQ(t);el.textContent=c.length?`✓ ${c.length} card${c.length!==1?'s':''} detected`:'⚠️ No cards detected — make sure Tab separates term from definition';el.className=c.length?'imp-count':'imp-count warn';}
function impPickFile(){const inp=document.createElement('input');inp.type='file';inp.accept='.txt,.csv,.tsv,text/plain';inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{document.getElementById('imp-text').value=ev.target.result;_impPrev();const n=document.getElementById('imp-set-name');if(!n.value)n.value=f.name.replace(/\.[^.]+$/,'');};r.readAsText(f);};inp.click();}

function _parseQ(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Parse a single "term[TAB]definition" chunk (definition may be empty / image-only)
  function parseChunk(chunk) {
    const s = chunk.trim();
    if (!s) return null;
    const ti = s.indexOf('\t');
    if (ti !== -1) {
      const f = s.slice(0, ti).trim();
      const b = s.slice(ti + 1).trim();
      if (f || b) return { front: f, back: b };
      return null;
    }
    // No tab at all — term-only card (definition was an image)
    return { front: s, back: '' };
  }

  // ── Strategy 1: Semicolon row separator + Tab column separator ──────────
  // Quizlet uses ";" as row separator and TAB as column separator.
  // Problem: semicolons can appear INSIDE card content (e.g. I(X;Y)), which
  // creates chunks without a tab.  Fix: merge no-tab chunks back into the
  // previous chunk (they're continuations of a split expression), then parse.
  if (raw.includes('\t') && raw.includes(';')) {
    const rawChunks = raw.split(';');
    const merged = [];
    for (const chunk of rawChunks) {
      if (!chunk.trim()) continue;
      if (merged.length === 0 || chunk.includes('\t')) {
        merged.push(chunk);          // starts a new card
      } else {
        merged[merged.length - 1] += ';' + chunk;  // re-join in-content semicolon
      }
    }
    if (merged.length > 1) {
      const cards = merged.map(parseChunk).filter(Boolean);
      if (cards.length > 0) return cards;
    }
  }

  // ── Strategy 2: Newline row separator + Tab column separator ────────────
  // Lines without a tab are continuations of the previous card's back
  // (multi-line definitions), NOT standalone term-only cards.
  const cards2 = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const ti = s.indexOf('\t');
    if (ti !== -1) {
      const f = s.slice(0, ti).trim();
      const b = s.slice(ti + 1).trim();
      if (f || b) cards2.push({ front: f, back: b });
    } else if (cards2.length > 0) {
      // continuation line — append to previous card's back
      const prev = cards2[cards2.length - 1];
      prev.back = (prev.back ? prev.back + '\n' : '') + s;
    }
  }
  if (cards2.length > 0) return cards2;

  // ── Strategy 3: Comma/semicolon column separator (manual fallback) ──────
  const cards3 = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(.+?)\s*[,;]\s*(.+)$/);
    if (m) cards3.push({ front: m[1].trim(), back: m[2].trim() });
  }
  return cards3;
}

function _doImport(){const name=document.getElementById('imp-set-name').value.trim(),raw=document.getElementById('imp-text').value.trim(),sel=document.getElementById('imp-folder').value;if(!name){toast('Please enter a set name');return;}if(!raw){toast('Please paste some text');return;}const cards=_parseQ(raw);if(!cards.length){toast('No cards detected');return;}let fid;if(sel==='__new__'){const fn=document.getElementById('imp-folder-name').value.trim();if(!fn){toast('Please enter a folder name');return;}const folder={id:uid(),name:fn,color:'indigo',sets:[]};S.folders.push(folder);fid=folder.id;}else{fid=sel;}const set={id:uid(),name,cards:cards.map(c=>({id:uid(),front:c.front,back:c.back,frontImg:null,backImg:null,starred:false}))};getFolder(fid).sets.push(set);save();closeModal();toast(`✅ Imported ${cards.length} card${cards.length!==1?'s':''} into "${name}"`);nav('set',fid,set.id);}

/* ═══════════════════════════════════════════════════════════
   BACKUP / RESTORE
═══════════════════════════════════════════════════════════ */
/* ── Portable Sets Export / Import ── */
function exportSetsFile(){
  const folders=S.folders.map(f=>({
    name:f.name,color:f.color,
    sets:f.sets.map(s=>({
      name:s.name,
      cards:s.cards.map(c=>({front:c.front,back:c.back,frontImg:c.frontImg||null,backImg:c.backImg||null,starred:!!c.starred}))
    }))
  }));
  const date=new Date().toISOString().slice(0,10);
  const data=JSON.stringify({type:'flashforge-sets',version:1,exportedAt:new Date().toISOString(),folders},null,2);
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([data],{type:'application/json'})),download:`flashforge-sets-${date}.json`});
  a.click();URL.revokeObjectURL(a.href);
  toast('📦 Sets exported!');
}
function importSetsFile(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{try{
      const data=JSON.parse(ev.target.result);
      if(data.type==='flashforge-sets'&&data.folders)_showSetsImportModal(data);
      else if(data.folders)_showBackupPreview(data); // full backup dropped here by accident
      else throw new Error();
    }catch{toast('❌ Not a valid FlashForge sets file');}};
    r.readAsText(f);
  };
  inp.click();
}
function _showSetsImportModal(data){
  const totalSets=data.folders.reduce((n,f)=>n+f.sets.length,0);
  const totalCards=data.folders.reduce((n,f)=>n+f.sets.reduce((m,s)=>m+s.cards.length,0),0);
  window._pendingSetsData=data;
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-title">📂 Import Sets File</div><p style="color:var(--text-muted);font-size:14px;margin-bottom:16px">Found <strong>${data.folders.length} folder${data.folders.length!==1?'s':''}</strong>, <strong>${totalSets} set${totalSets!==1?'s':''}</strong>, <strong>${totalCards} card${totalCards!==1?'s':''}</strong><br><span style="font-size:12px">Exported ${data.exportedAt?.slice(0,10)||'unknown date'}</span></p><div class="modal-footer" style="flex-direction:column;gap:8px;align-items:stretch"><button class="btn btn-primary" onclick="closeModal();_doSetsImport(window._pendingSetsData,'merge')">Merge with existing folders</button><button class="btn btn-outline" onclick="closeModal();_doSetsImport(window._pendingSetsData,'replace')">Replace all folders &amp; sets</button><button class="btn btn-ghost" onclick="closeModal()">Cancel</button></div></div></div>`;
}
function _doSetsImport(data,mode){
  const folders=data.folders.map(f=>({
    id:uid(),name:f.name,color:f.color||'indigo',
    sets:f.sets.map(s=>({
      id:uid(),name:s.name,
      cards:s.cards.map(c=>({id:uid(),front:c.front||'',back:c.back||'',frontImg:c.frontImg||null,backImg:c.backImg||null,starred:!!c.starred}))
    }))
  }));
  if(mode==='replace')S.folders=folders;
  else S.folders=[...S.folders,...folders];
  save();render();
  const tc=folders.reduce((n,f)=>n+f.sets.reduce((m,s)=>m+s.cards.length,0),0);
  toast(`✅ Imported ${folders.length} folder${folders.length!==1?'s':''} · ${tc} cards`);
}

function exportBackup(){
  SETTINGS.lastBackup=new Date().toISOString();saveSettings();
  const data=JSON.stringify({version:2,exportedAt:SETTINGS.lastBackup,folders:S.folders,stats:STATS,cardStats:CARD_STATS},null,2);
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([data],{type:'application/json'})),download:`flashforge-backup-${SETTINGS.lastBackup.slice(0,10)}.json`});
  a.click();URL.revokeObjectURL(a.href);toast('💾 Backup downloaded!');
  if(S.view==='home')renderHome();
}
function _backupSummary(data){
  const folders=data.folders||[];
  const sets=folders.reduce((n,f)=>n+(f.sets||[]).length,0);
  const cards=folders.reduce((n,f)=>n+(f.sets||[]).reduce((m,s)=>m+(s.cards||[]).length,0),0);
  const images=folders.reduce((n,f)=>n+(f.sets||[]).reduce((m,s)=>m+(s.cards||[]).reduce((k,c)=>k+(c.frontImg?1:0)+(c.backImg?1:0),0),0),0);
  const starred=folders.reduce((n,f)=>n+(f.sets||[]).reduce((m,s)=>m+(s.cards||[]).filter(c=>c.starred).length,0),0);
  return{folders:folders.length,sets,cards,images,starred,stats:Object.keys(data.stats||{}).length,cardStats:Object.keys(data.cardStats||{}).length};
}
function _summaryBox(title,sm){
  return`<div class="restore-box"><div class="restore-box-title">${title}</div><div>${sm.folders} folder${sm.folders!==1?'s':''}</div><div>${sm.sets} set${sm.sets!==1?'s':''}</div><div>${sm.cards} card${sm.cards!==1?'s':''}</div><div>${sm.images} image${sm.images!==1?'s':''}</div><div>${sm.starred} starred</div><div>${sm.stats} set stat entr${sm.stats!==1?'ies':'y'}</div><div>${sm.cardStats} card stat entr${sm.cardStats!==1?'ies':'y'}</div></div>`;
}
function _showBackupPreview(data){
  window._pendingBackupData=data;
  const incoming=_backupSummary(data);
  const current=_backupSummary({folders:S.folders,stats:STATS,cardStats:CARD_STATS});
  document.getElementById('modal-root').innerHTML=`<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:680px"><div class="modal-title">↩ Restore Backup Preview</div><p style="color:var(--text-muted);font-size:14px">Backup from <strong>${esc(data.exportedAt?.slice(0,10)||'unknown date')}</strong>${data.version?` · version ${esc(String(data.version))}`:''}</p><div class="restore-preview">${_summaryBox('Current app',current)}${_summaryBox('Backup file',incoming)}</div><p style="color:var(--danger);font-size:13px;font-weight:700">Restoring replaces your current folders, stats, and card history with the backup file.</p><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="closeModal();_doFullRestore(window._pendingBackupData)">Replace Current Data</button></div></div></div>`;
}
function _doFullRestore(data){
  S.folders=data.folders||[];STATS=data.stats||{};CARD_STATS=data.cardStats||{};
  save();saveStats();saveCardStats();render();toast(`✅ Restored ${S.folders.length} folder${S.folders.length!==1?'s':''}`);
}
function importBackup(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
  inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const data=JSON.parse(ev.target.result);if(!data.folders)throw new Error();_showBackupPreview(data);}catch{toast('❌ Could not read backup file');}};r.readAsText(f);};
  inp.click();
}

/* ═══════════════════════════════════════════════════════════
   MAIN RENDER DISPATCHER
═══════════════════════════════════════════════════════════ */
function render(){
  document.getElementById('app').style.cssText='';
  switch(S.view){
    case 'home':   renderHome();   break;
    case 'folder': renderFolder(); break;
    case 'set':    renderSet();    break;
    case 'study':  renderStudy();  break;
    case 'stats':  renderStats();  break;
    default:       renderHome();
  }
}

load().then(()=>{applySettings();render();});
window.addEventListener('beforeunload',()=>{if(S.view==='study'&&S.study&&!S.study.done&&S.setId)saveStudySession(S.setId);});

/* Native-fetch Supabase adapter. No secret key, password, or token is exported.
   Versioned compare-and-swap + three-way merge; explicit conflicts, durable drafts.
   The main app remains usable offline and labels local-only mode honestly. */
(function(root){
'use strict';
const ALLOWED_EMAIL='1661531189@qq.com';
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function stable(x){
 if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
 if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
 return JSON.stringify(x);
}
const equal=(a,b)=>stable(a)===stable(b);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const entityArray=x=>Array.isArray(x)&&x.every(v=>object(v)&&typeof v.id==='string');
function mergeSnapshots(base,local,remote,preference=null){
 const conflicts=[];
 function merge(b,l,r,path){
  if(equal(l,r))return copy(l);
  if(equal(l,b))return copy(r);
  if(equal(r,b))return copy(l);
  if(object(b)&&object(l)&&object(r)){
   const out={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    if(['__proto__','constructor','prototype'].includes(key))continue;
    const v=merge(b[key],l[key],r[key],path?path+'.'+key:key);if(v!==undefined)out[key]=v;
   }return out;
  }
  if(entityArray(b)&&entityArray(l)&&entityArray(r)){
   const bm=new Map(b.map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));
   const out=[];for(const id of new Set([...bm.keys(),...lm.keys(),...rm.keys()])){
    const v=merge(bm.get(id),lm.get(id),rm.get(id),path+'['+id+']');if(v!==undefined)out.push(v);
   }return out;
  }
  conflicts.push(path);return copy(preference==='remote'?r:l);
 }
 return {value:merge(base,local,remote,''),conflicts};
}
function validateConfig(value){
 if(!value?.url&&!value?.publishableKey)return null;
 const url=new URL(String(value.url).trim());
 if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/i.test(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Project URL 应为 https://项目标识.supabase.co。');
 const key=String(value.publishableKey||'').trim();
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))throw new Error('仅接受 sb_publishable_ 开头的 Publishable key；不要填写任何 Secret 或 service_role 密钥。');
 return {url:url.origin,publishableKey:key};
}
function readStorage(storage,key){try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}}
class TeachingCloud{
 constructor(options){
  this.o=options;this.$=s=>document.querySelector(s);this.user=null;this.session=null;this.ready=false;this.base=null;this.version=0;this.dirty=false;this.conflict=null;this.syncing=false;this.epoch=0;this.storageError=false;this.message='';this.error='';this.stage='local';
  this.scope='teaching-cloud:'+location.pathname.replace(/index\.html$/,'');
  this.clientId=readStorage(sessionStorage,this.scope+':client');
  if(typeof this.clientId!=='string'){
   this.clientId=crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
   try{sessionStorage.setItem(this.scope+':client',JSON.stringify(this.clientId));}catch{}
  }
  try{this.config=validateConfig(root.TEACHING_CLOUD_CONFIG?.url?root.TEACHING_CLOUD_CONFIG:readStorage(localStorage,this.scope+':config'));}catch(e){this.config=null;this.error=e.message;}
  this.bind();this.render();
  this.timer=setInterval(()=>{if(!document.hidden)this.sync();},10000);
  window.addEventListener('online',()=>this.sync());
  window.addEventListener('storage',e=>{
   if(this.config&&this.user&&e.key===this.authKey()&&e.newValue===null){
    this.cache();this.epoch++;this.session=null;this.user=null;this.ready=false;this.base=null;this.dirty=false;this.conflict=null;this.syncing=false;this.stage='local';this.message='此浏览器的账号已退出，待同步草稿仍保留，重新登录后可恢复。';this.error='';this.o.apply(this.normalize(this.o.guest()));this.render();
   }
  });
  window.addEventListener('focus',()=>this.sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.sync();});
  document.addEventListener('close',()=>setTimeout(()=>this.sync(),40),true);
  window.addEventListener('beforeunload',e=>{if(this.dirty&&this.storageError){e.preventDefault();e.returnValue='';}});
  this.restore();
 }
 authKey(){return this.scope+':'+this.config.url+':session';}
 cachePrefix(){return this.scope+':'+this.config.url+':draft:'+this.user.id+':';}
 cacheKey(){return this.cachePrefix()+this.clientId;}
 normalize(data){return this.o.normalize(copy(data));}
 isLocked(){return !!this.user&&!this.ready;}
 async restore(){
  if(!this.config)return;
  const s=readStorage(sessionStorage,this.authKey())||readStorage(localStorage,this.authKey());
  if(s?.access_token&&s?.refresh_token&&s?.user?.id){this.remember=!!readStorage(localStorage,this.authKey());await this.connect(s);}
 }
 persistSession(){
  if(!this.session)return;
  const s={access_token:this.session.access_token,refresh_token:this.session.refresh_token,expires_at:this.session.expires_at,user:{id:this.session.user.id,email:this.session.user.email}};
  try{(this.remember?localStorage:sessionStorage).setItem(this.authKey(),JSON.stringify(s));(this.remember?sessionStorage:localStorage).removeItem(this.authKey());}catch{this.message='浏览器无法保存登录状态，关闭后需重新登录。';}
 }
 async request(path,{method='GET',body,authenticated=true,retry=true}={}){
  if(!this.config)throw new Error('云端尚未配置。');
  if(authenticated&&(!this.session||!this.user))throw new Error('请先登录。');
  if(authenticated&&this.session.expires_at*1000<Date.now()+30000)await this.refreshToken();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const headers={apikey:this.config.publishableKey,'Content-Type':'application/json'};
   if(authenticated)headers.Authorization='Bearer '+this.session.access_token;
   const response=await fetch(this.config.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
   if(response.status===401&&authenticated&&retry){await this.refreshToken();return this.request(path,{method,body,authenticated,retry:false});}
   const text=await response.text();let result=null;try{result=text?JSON.parse(text):null;}catch{throw new Error('云端返回了无法识别的内容。');}
   if(!response.ok){const msg=result?.msg||result?.message||result?.error_description||result?.error||`HTTP ${response.status}`;throw new Error(String(msg));}
   return result;
  }catch(e){if(e.name==='AbortError')throw new Error('连接超时。修改仍保留在本机，联网后会重试。');throw e;}
  finally{clearTimeout(timer);}
 }
 async refreshToken(){
  if(this.refreshing)return this.refreshing;
  const shared=readStorage(localStorage,this.authKey());
  if(shared?.user?.id===this.user?.id&&shared.expires_at*1000>Date.now()+30000){this.session=shared;return;}

  const epoch=this.epoch;
  this.refreshing=(async()=>{
   try{
    const s=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',authenticated:false,body:{refresh_token:this.session.refresh_token}});
    if(epoch!==this.epoch)return;
    this.session={...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+s.expires_in};this.persistSession();
   }catch(e){this.stage='expired';this.error='登录已过期或网络不可用；待同步资料仍在本机。请重试或重新登录。';this.render();throw e;}
  })();
  try{await this.refreshing;}finally{this.refreshing=null;}
 }
 async login(e){
  e.preventDefault();if(this.syncing)return;
  this.$('#cloud-login-button').disabled=true;this.error='';this.render();
  try{
   this.remember=this.$('#cloud-remember').checked;
   const email=this.$('#cloud-email').value.trim().toLowerCase();if(email!==ALLOWED_EMAIL)throw new Error('仅允许指定账号登录。');
   const s=await this.request('/auth/v1/token?grant_type=password',{method:'POST',authenticated:false,body:{email,password:this.$('#cloud-password').value}});
   this.$('#cloud-password').value='';await this.connect({...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+s.expires_in});
  }catch(e){this.error=/invalid|credentials|grant/i.test(e.message)?'邮箱或密码不正确，或该登录账号尚未创建/验证。':e.message;this.stage='error';this.render();}
  finally{this.$('#cloud-password').value='';this.$('#cloud-login-button').disabled=false;}
 }
 drafts(){
  const out=[];if(!this.user||!this.config)return out;
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(this.cachePrefix())){const v=readStorage(localStorage,k);if(v?.local&&v.userId===this.user.id)out.push({key:k,...v});}}}catch{}
  return out.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 }
 async connect(session){
  if((session?.user?.email||'').toLowerCase()!==ALLOWED_EMAIL){try{sessionStorage.removeItem(this.authKey());localStorage.removeItem(this.authKey());}catch{}this.session=null;this.user=null;this.ready=false;this.stage='local';this.error='仅允许指定账号登录。';this.render();return;}
  this.epoch++;this.session=session;this.user=session.user;this.ready=false;this.dirty=false;this.conflict=null;this.stage='loading';this.error='';this.message='';this.persistSession();
  this.base=null;this.version=0;
  let cached=readStorage(localStorage,this.cacheKey());
  if(!cached){cached=this.drafts().find(d=>d.dirty);if(cached)this.recovered={key:cached.key,updatedAt:cached.updatedAt};}
  try{
   if(cached?.base&&cached?.local&&cached.userId===this.user.id){this.base=this.normalize(cached.base);this.version=cached.version;this.o.apply(this.normalize(cached.local));this.dirty=!equal(this.o.getData(),this.base);this.ready=true;}
  }catch{this.message='本机草稿格式异常，原草稿已保留。请先导出待同步草稿。';}
  this.render();await this.sync();
 }
 async remote(){
  const path='/rest/v1/teaching_workspaces?user_id=eq.'+encodeURIComponent(this.user.id);
  if(this.ready&&this.base){
   const meta=await this.request(path+'&select=revision,updated_at&limit=1');
   if(!Array.isArray(meta))throw new Error('云端数据格式不正确。');
   if(!meta.length)return null;
   if(Number(meta[0].revision)===this.version)return {payload:copy(this.base),revision:this.version,updated_at:meta[0].updated_at};
  }
  const list=await this.request(path+'&select=payload,revision,updated_at&limit=1');
  if(!Array.isArray(list))throw new Error('云端数据格式不正确。');
  return list[0]?{payload:this.normalize(list[0].payload),revision:Number(list[0].revision),updated_at:list[0].updated_at}:null;
 }
 cache(){
  if(!this.user||!this.base)return;
  try{localStorage.setItem(this.cacheKey(),JSON.stringify({userId:this.user.id,base:this.base,local:this.o.getData(),version:this.version,dirty:this.dirty,updatedAt:new Date().toISOString()}));this.storageError=false;}
  catch{this.storageError=true;this.error='本机空间不足，离线草稿无法保存。请保持页面打开并立即导出备份。';}
 }
 capture(){
  if(!this.user)return false;
  if(!this.ready){this.error='尚未完成云端读取，请先重试连接。';this.render();return false;}
  this.dirty=!equal(this.o.getData(),this.base);this.cache();
  if(!this.conflict)this.stage=this.dirty?'pending':'synced';
  this.render();clearTimeout(this.debounce);this.debounce=setTimeout(()=>this.sync(),650);return !this.storageError;
 }
 async sync(){
  if(!this.user||!this.config||this.syncing||this.conflict)return;
  if(this.o.isEditing()){this.stage=this.dirty?'pending':this.stage;this.render();return;}
  this.syncing=true;const epoch=this.epoch;this.stage='syncing';this.render();
  try{
   for(let attempt=0;attempt<3;attempt++){
    const remote=await this.remote();if(epoch!==this.epoch)return;
    if(!this.ready){
     if(remote){this.base=remote.payload;this.version=remote.revision;this.o.apply(remote.payload);this.dirty=false;this.ready=true;this.lastSync=remote.updated_at;
      if(this.o.guestDirty())this.message='已载入云端资料。本机旧版修改仍保留，可在“备份与迁移”中处理。';
      this.cache();this.stage='synced';this.error='';return;
     }
     if(!await this.o.confirm('该账号云端尚无资料。将把这台设备当前的课程、进度、事项与服务首次上传到此账号。','初始化云端资料','上传当前资料')){this.stage='waiting';this.message='尚未初始化。点击“立即同步”可重新开始。';return;}
     if(epoch!==this.epoch)return;
     const initial=this.normalize(this.o.getData());
     const result=await this.request('/rest/v1/rpc/save_teaching_workspace',{method:'POST',body:{p_expected_revision:0,p_payload:initial}});
     if(epoch!==this.epoch)return;
     if(!result?.ok)continue;
     this.base=initial;this.version=Number(result.revision);this.ready=true;this.dirty=false;this.o.apply(initial);this.lastSync=result.updated_at;this.cache();this.stage='synced';this.error='';return;
    }
    if(!remote)throw new Error('云端记录不存在。未自动重新上传，以免恢复已被管理员删除的资料。');
    const local=this.normalize(this.o.getData());
    const result=mergeSnapshots(this.base,local,remote.payload);
    let merged;
    try{merged=this.normalize(result.value);}catch(e){result.conflicts.push('课程安排或数据结构冲突：'+e.message);merged=local;}
    if(result.conflicts.length){this.conflict={base:copy(this.base),local,remote:remote.payload,version:remote.revision,paths:result.conflicts};this.stage='conflict';this.cache();return;}
    if(this.o.isEditing()){this.stage='pending';return;}
    this.o.apply(merged);this.base=remote.payload;this.version=remote.revision;this.dirty=!equal(merged,remote.payload);this.cache();
    if(!this.dirty){this.lastSync=remote.updated_at;this.stage='synced';this.error='';this.clearRecovered();return;}
    const sent=copy(merged);
    const saved=await this.request('/rest/v1/rpc/save_teaching_workspace',{method:'POST',body:{p_expected_revision:remote.revision,p_payload:sent}});
    if(epoch!==this.epoch)return;
    if(!saved?.ok)continue;
    this.base=sent;this.version=Number(saved.revision);this.lastSync=saved.updated_at;this.dirty=!equal(this.o.getData(),sent);this.cache();this.clearRecovered();this.stage=this.dirty?'pending':'synced';this.error='';
    if(this.dirty){clearTimeout(this.debounce);this.debounce=setTimeout(()=>this.sync(),700);}return;
   }
   throw new Error('其他设备正在更新。当前修改已保留，稍后自动重试。');
  }catch(e){if(epoch===this.epoch){this.error=this.friendly(e.message);this.stage=navigator.onLine?'error':'offline';this.cache();}}
  finally{if(epoch===this.epoch){this.syncing=false;this.render();}}
 }
 clearRecovered(){
  if(this.recovered&&!this.dirty){const old=readStorage(localStorage,this.recovered.key);if(old?.updatedAt===this.recovered.updatedAt){try{localStorage.removeItem(this.recovered.key);}catch{}}this.recovered=null;}
 }
 friendly(msg){
  if(/teaching_workspaces|save_teaching_workspace|schema cache|PGRST|permission denied|42501/i.test(msg))return '云端数据表或权限尚未正确配置。请先执行安装包中的 supabase-setup.sql。';
  if(/Failed to fetch|NetworkError|Load failed/i.test(msg))return '无法连接云端。请检查网络；本机修改已保留，恢复连接后自动重试。';
  return msg;
 }
 async logout(){
  if(this.syncing){this.error='正在同步，请完成后再退出。';this.render();return;}
  if(this.dirty||this.conflict){this.error='还有未同步修改或冲突。请先同步或备份处理后再退出，以免丢失资料。';this.render();return;}
  if(!await this.o.confirm('退出后将显示公开的初始课表或此前的本机资料，并清除当前账号在本机的已同步缓存。','退出账号','退出'))return;
  const key=this.authKey(),cache=this.cacheKey();
  try{await this.request('/auth/v1/logout?scope=local',{method:'POST'});}catch{/* local sign-out is still performed */}
  this.epoch++;this.session=null;this.user=null;this.ready=false;this.base=null;this.version=0;this.conflict=null;this.message='';this.error='';this.stage='local';
  try{sessionStorage.removeItem(key);localStorage.removeItem(key);localStorage.removeItem(cache);}catch{}
  this.o.apply(this.normalize(this.o.guest()));this.render();
 }
 async migrate(){
  if(!this.user||!this.ready){this.error='请先登录并成功读取云端资料。';this.render();return;}
  if(this.syncing||this.conflict){this.error='请先完成同步或处理冲突。';this.render();return;}
  if(!await this.o.confirm('将以这台设备保留的旧版资料替换当前账号内容。会先下载一份当前资料备份；其他设备也会收到替换结果。','迁入本机旧版资料','备份并迁入'))return;
  this.o.download('迁入前云端资料备份.json',JSON.stringify(this.o.getData(),null,2),'application/json');
  this.o.apply(this.normalize(this.o.guest()));this.capture();await this.sync();
 }
 async resolveConflict(mode){
  const c=this.conflict;if(!c)return;
  if(!await this.o.confirm('将先生成两份版本的合并备份，再'+(mode==='local'?'优先保留本机冲突字段；无法合并的结构冲突将采用整个本机版本。':'采用整个云端版本，本机冲突修改将不再上传。'),'处理同步冲突','备份并继续'))return;
  this.backupConflict();let next=c.remote;
  if(mode==='local'){try{next=this.normalize(mergeSnapshots(c.base,c.local,c.remote,'local').value);}catch{next=c.local;}}
  this.base=c.remote;this.version=c.version;this.conflict=null;this.o.apply(next);this.dirty=!equal(next,this.base);this.cache();this.stage=this.dirty?'pending':'synced';this.error='';this.render();await this.sync();
 }
 backupConflict(){if(this.conflict)this.o.download('同步冲突备份.json',JSON.stringify({format:'teaching-conflict-backup',createdAt:new Date().toISOString(),local:this.conflict.local,cloud:this.conflict.remote},null,2),'application/json');}
 render(){
  const labels={local:this.config?'未登录 · 仅本机':'仅本机',loading:'读取云端',syncing:'同步中',synced:'已同步',pending:'待同步',conflict:'同步冲突',error:'同步失败',offline:'离线待同步',expired:'请重新登录',waiting:'尚未上传'};
  const authorized=!!this.user&&this.ready&&(this.user.email||'').toLowerCase()===ALLOWED_EMAIL;const gate=this.$('#access-gate'),app=this.$('#protected-app');if(gate)gate.hidden=authorized;if(app)app.hidden=!authorized;document.body.classList.toggle('auth-locked',!authorized);const accessStatus=this.$('#access-status'),accessError=this.$('#access-error');if(accessStatus)accessStatus.textContent=this.user&&!this.ready?'正在验证账号并读取云端资料…':'请使用指定账号登录。';if(accessError){accessError.textContent=this.error||'';accessError.hidden=!this.error;}
  const el=this.$('#save-status');el.textContent=labels[this.stage]||'仅本机';el.classList.toggle('unsaved',['error','offline','expired','conflict'].includes(this.stage));el.title=this.user?(this.dirty?'有修改尚未写入云端。':'云端账号：'+this.user.email):'当前编辑只保存在本机。配置云端并登录后才能跨设备同步。';
  this.$('#cloud-entry').textContent=this.user?'账号与同步':'登录同步';
  this.$('#cloud-unconfigured').hidden=!!this.config;
  this.$('#cloud-login-form').hidden=!this.config||(!!this.user&&this.stage!=='expired');
  this.$('#cloud-account').hidden=!this.user;this.$('#cloud-user').textContent=this.user?.email||'';
  let message=!this.config?'尚未配置云端，当前仅本机保存。':!this.user?'登录后在不同设备同步同一账号资料。':this.dirty?'有修改尚未同步，请保持联网。':this.ready?'已连接云端，同一账号可跨设备使用。':'正在读取云端资料。';
  if(this.stage==='synced'&&this.lastSync)message+='\n最近同步：'+new Date(this.lastSync).toLocaleString('zh-CN');
  if(this.message)message+='\n'+this.message;
  this.$('#cloud-message').textContent=message;this.$('#cloud-error').textContent=this.error;this.$('#cloud-error').hidden=!this.error;
  this.$('#cloud-conflict').hidden=!this.conflict;this.$('#cloud-conflict-detail').textContent=this.conflict?'检测到 '+this.conflict.paths.length+' 处冲突。已暂停自动上传，未静默覆盖任何版本。':'';
  this.$('#cloud-migrate-button').disabled=!this.user||!this.ready;
 }
 bind(){
  const accessForm=this.$('#access-login-form');if(accessForm)accessForm.addEventListener('submit',async e=>{e.preventDefault();const pass=this.$('#access-password');this.$('#cloud-email').value=ALLOWED_EMAIL;this.$('#cloud-password').value=pass.value;this.$('#cloud-remember').checked=!!this.$('#access-remember')?.checked;await this.login({preventDefault(){}});pass.value='';});
  this.$('#save-status').addEventListener('click',()=>{this.render();this.$('#cloud-dialog').showModal();});
  this.$('#cloud-login-form').addEventListener('submit',e=>this.login(e));
  this.$('#cloud-config-form').addEventListener('submit',async e=>{
   e.preventDefault();try{
    const config=validateConfig({url:this.$('#cloud-url').value,publishableKey:this.$('#cloud-key').value});
    if(!config)throw new Error('请填写 Project URL 和 Publishable key。');
    this.config=config;localStorage.setItem(this.scope+':config',JSON.stringify(config));this.error='';
    this.o.download('cloud-config.js','window.TEACHING_CLOUD_CONFIG = '+JSON.stringify(config,null,2)+';\n','application/javascript');
    this.message='配置已保存到本机。请将生成的 cloud-config.js 上传到仓库根目录，其他设备才能共用此连接配置。';this.render();
   }catch(error){this.error=error.message;this.render();}
  });
  document.addEventListener('click',async e=>{
   const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
   if(action==='cloud'){this.render();this.$('#cloud-dialog').showModal();}
   else if(action==='cloud-sync')await this.sync();
   else if(action==='cloud-logout')await this.logout();
   else if(action==='cloud-migrate')await this.migrate();
   else if(action==='cloud-open-backup'){this.$('#cloud-dialog').close();this.$('#data-dialog').showModal();}
   else if(action==='cloud-guest-backup')this.o.download('本机旧版资料备份.json',JSON.stringify(this.o.guest(),null,2),'application/json');
   else if(action==='cloud-drafts-backup')this.o.download('待同步草稿备份.json',JSON.stringify({format:'teaching-pending-drafts',drafts:this.drafts().map(({key,...v})=>v)},null,2),'application/json');
   else if(action==='cloud-conflict-backup')this.backupConflict();
   else if(action==='cloud-conflict-local')await this.resolveConflict('local');
   else if(action==='cloud-conflict-remote')await this.resolveConflict('remote');
  });
 }
}
root.TeachingCloud=TeachingCloud;root.TeachingSyncCore={stable,equal,mergeSnapshots,validateConfig};
if(typeof module!=='undefined'&&module.exports)module.exports=root.TeachingSyncCore;
})(typeof globalThis!=='undefined'?globalThis:this);

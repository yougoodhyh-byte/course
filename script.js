/* Date and timetable logic. Civil dates use UTC arithmetic to avoid DST errors;
   today's date is taken from the device's LOCAL calendar, not its UTC date. */
(function(root){
  'use strict';
  const DAY = 86400000;
  const START = '2026-09-07', END = '2027-01-24', WEEK_COUNT = 20;
  const TIMES = [
    ['1','08:00','08:45'],['2','08:55','09:40'],['3','10:00','10:45'],
    ['4','10:55','11:40'],['5','11:50','12:35'],['6','14:00','14:45'],
    ['7','14:55','15:40'],['8','16:00','16:45'],['9','16:55','17:40'],
    ['0','17:50','18:35'],['A','19:20','20:05'],['B','20:15','21:00'],['C','21:10','21:55']
  ].map(([code,start,end],i)=>({code,start,end,index:i,number:i+1,label:`第${i+1}节课${i>8 ? '（'+code+'）' : ''}`}));
  const DAYS=['周一','周二','周三','周四','周五','周六','周日'];
  const pad=n=>String(n).padStart(2,'0');
  const localISO=(date=new Date())=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  function dayValue(iso){
    if(typeof iso!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
    const [y,m,d]=iso.split('-').map(Number), ms=Date.UTC(y,m-1,d);
    return new Date(ms).toISOString().slice(0,10)===iso ? ms/DAY : NaN;
  }
  const addDays=(iso,n)=>new Date((dayValue(iso)+n)*DAY).toISOString().slice(0,10);
  function currentWeek(iso=localISO()){
    const value=dayValue(iso), from=dayValue(START), to=dayValue(END);
    return Number.isFinite(value)&&value>=from&&value<=to ? Math.floor((value-from)/7)+1 : null;
  }
  function defaultWeek(iso=localISO()){
    return currentWeek(iso) || (dayValue(iso)<dayValue(START) ? 1 : WEEK_COUNT);
  }
  function weekRange(week){
    if(!Number.isInteger(week)||week<1||week>WEEK_COUNT) throw new RangeError('周次超出学期范围');
    const start=addDays(START,(week-1)*7); return {start,end:addDays(start,6)};
  }
  const dateFor=(week,day)=>addDays(weekRange(week).start,day-1);
  const shortDate=iso=>iso.slice(5).replace('-','/');
  const slotIndex=code=>TIMES.findIndex(p=>p.code===String(code));
  const key=r=>`${r.week}|${r.day}|${r.slot}`;
  const identity=r=>`${r.courseId}|${key(r)}`;
  const sortRecords=(a,b)=>a.week-b.week || a.day-b.day || slotIndex(a.slot)-slotIndex(b.slot) || a.courseId.localeCompare(b.courseId);
  function compactNumbers(values){
    const numbers=[...new Set(values)].sort((a,b)=>a-b); let groups=[];
    for(let i=0;i<numbers.length;i++){
      const first=numbers[i]; let last=first;
      while(i+1<numbers.length&&numbers[i+1]===last+1) last=numbers[++i];
      groups.push(first===last?String(first):`${first}–${last}`);
    }
    return groups.join('、');
  }
  /* Group only identical per-week slot patterns and locations. A room change is
     NEVER flattened. Individual progress remains on the atomic period record. */
  function groups(records){
    const perWeek=new Map();
    records.forEach(r=>{
      const k=JSON.stringify([r.courseId,r.day,r.location,r.week]);
      if(!perWeek.has(k)) perWeek.set(k,[]); perWeek.get(k).push(r);
    });
    const result=new Map();
    for(const rows of perWeek.values()){
      rows.sort(sortRecords);
      const first=rows[0], slots=rows.map(r=>r.slot);
      const k=JSON.stringify([first.courseId,first.day,first.location,slots]);
      if(!result.has(k)) result.set(k,{courseId:first.courseId,day:first.day,location:first.location,slots,weeks:[],records:[]});
      const g=result.get(k);g.weeks.push(first.week);g.records.push(...rows);
    }
    return [...result.values()].map(g=>({...g,weeks:g.weeks.sort((a,b)=>a-b),records:g.records.sort(sortRecords)}))
      .sort((a,b)=>a.day-b.day || slotIndex(a.slots[0])-slotIndex(b.slots[0]) || a.weeks[0]-b.weeks[0]);
  }
  function visibleSlots(records,week,showEmpty=false){
    const used=new Set(records.filter(r=>r.week===week).map(r=>r.slot));
    return TIMES.filter(p=>showEmpty||used.has(p.code));
  }
  function conflicts(existing,targets,excludedIds=[]){
    const excluded=new Set(excludedIds), indexed=new Map();
    existing.forEach(r=>{if(!excluded.has(r.id)) indexed.set(key(r),r);});
    return targets.flatMap(t=>indexed.has(key(t))?[{target:t,existing:indexed.get(key(t))}]:[]);
  }
  function validateData(data){
    if(!data||data.schemaVersion!==1||!Array.isArray(data.courses)||!Array.isArray(data.records)) throw new Error('这不是本网站导出的有效备份。');
    if(data.term?.start!==START||data.term?.end!==END||data.term?.weeks!==WEEK_COUNT) throw new Error('备份的学期与当前网站不一致。');
    if(data.records.length>20000||data.courses.length>1000) throw new Error('备份数据过大。');
    const ids=new Set(), names=new Set();
    const str=(s,max=3000)=>typeof s==='string'&&s.length<=max;
    data.courses.forEach(c=>{
      if(!c||!str(c.id,120)||!c.id||ids.has(c.id)||!str(c.name,100)||!c.name.trim()||!/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new Error('课程信息无效。');
      if(names.has(c.name.trim()))throw new Error('备份包含重复课程名。'); names.add(c.name.trim()); ids.add(c.id);
    });
    const recIds=new Set(), positions=new Set();
    data.records.forEach(r=>{
      if(!r||!str(r.id,120)||!r.id||recIds.has(r.id)||!ids.has(r.courseId)||!Number.isInteger(r.week)||r.week<1||r.week>20||!Number.isInteger(r.day)||r.day<1||r.day>7||typeof r.slot!=='string'||slotIndex(r.slot)<0||!str(r.location,240)||!str(r.progress,2000)) throw new Error('备份中存在无效的课程安排。');
      if(positions.has(key(r))) throw new Error('备份中存在课程时间冲突，未导入。');
      positions.add(key(r));recIds.add(r.id);
    });
    if(!Array.isArray(data.notes)||!Array.isArray(data.buses)||!Array.isArray(data.services)) throw new Error('备份缺少事项或服务数据。');
    if(data.notes.length>2000||data.buses.length>1000||data.services.length>1000) throw new Error('备份记录过多。');
    const noteIds=new Set();
    data.notes.forEach(n=>{
      if(!n||!str(n.id,120)||noteIds.has(n.id)||!str(n.title,120)||!n.title.trim()||!str(n.description,3000)||!str(n.date,10)||(n.date!==''&&!Number.isFinite(dayValue(n.date)))||typeof n.done!=='boolean') throw new Error('重要事项数据无效。');
      noteIds.add(n.id);
    });
    const serviceIds=new Set();
    data.services.forEach(s=>{
      if(!s||!str(s.id,120)||serviceIds.has(s.id)||!str(s.title,120)||!s.title.trim()||!str(s.description,3000)||!str(s.url,1500)) throw new Error('服务数据无效。');
      if(s.url&&!/^https?:\/\//i.test(s.url)) throw new Error('服务链接只能使用 http 或 https。');
      serviceIds.add(s.id);
    });
    data.buses.forEach(b=>{
      if(!b||!['id','departure','arrival','from','to','vehicles','note','type'].every(k=>str(b[k],1000))) throw new Error('校车数据无效。');
    });
    return data;
  }
  const api={TIMES,DAYS,START,END,WEEK_COUNT,localISO,dayValue,addDays,currentWeek,defaultWeek,weekRange,dateFor,shortDate,slotIndex,key,identity,sortRecords,compactNumbers,groups,visibleSlots,conflicts,validateData,pad};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TeachingCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);

(function(){
'use strict';
const C=window.TeachingCore;
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clone=value=>JSON.parse(JSON.stringify(value));
const uid=prefix=>prefix+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const ICONS={
 book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/>',
 checklist:'<rect x="5" y="4" width="15" height="17" rx="3"/><path d="M9 3h7v4H9zM8 12l1 1 2-2M14 12h3M8 17l1 1 2-2M14 17h3"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
 'arrow-right':'<path d="M4 12h16M14 6l6 6-6 6"/>',
 'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
 'chevron-left':'<path d="m15 5-7 7 7 7"/>',
 'chevron-right':'<path d="m9 5 7 7-7 7"/>',
 'chevron-down':'<path d="m6 9 6 6 6-6"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 x:'<path d="m6 6 12 12M6 18 18 6"/>',
 sliders:'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 edit:'<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z"/>',
 printer:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h1"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 bus:'<rect x="4" y="3" width="16" height="17" rx="4"/><path d="M4 11h16M8 3v8M16 3v8M7 20v2M17 20v2M7 15h1M16 15h1"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 table:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M9 10v11M3 15h18"/>',
 code:'<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
 link:'<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>'
};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.grid}</svg>`;
function fillIcons(){ $$('[data-icon]:not([data-icon-ready])').forEach(el=>{el.innerHTML=icon(el.dataset.icon);el.dataset.iconReady='1';}); }
const published=C.validateData(JSON.parse($('#seed-data').textContent));
const STORAGE_KEY='teaching-workspace:2026-fall:v1:'+location.pathname.replace(/index\.html$/,'');
let data=clone(published), today=C.localISO(), selectedWeeks=new Set([C.defaultWeek(today)]), currentTab='schedule', courseFilter='', showEmpty=false, viewMode='grid', noteFilter='all';
let dirty=false, publishedRevision=published.revision, cacheWriteFailed=false;
let editingIds=[], editingBulk=false, editingNoteId=null, editingServiceId=null, managementGroups=[];
let hasNewRelease=false;
try{
 const saved=localStorage.getItem(STORAGE_KEY);
 if(saved){
   const cached=JSON.parse(saved);C.validateData(cached.data);
   if(cached.publishedRevision!==published.revision&&!cached.dirty){
     data=clone(published);
   }else{
     data=cached.data;dirty=!!cached.dirty;publishedRevision=cached.publishedRevision;
     hasNewRelease=cached.publishedRevision!==published.revision;
   }
 }
}catch(error){
 $('#storage-banner').hidden=false;
 $('#storage-banner').textContent='未能读取本机保存的数据，现展示发布课表。不要清除浏览器数据；可用 JSON 备份恢复。原因：'+error.message;
}
const courseById=id=>data.courses.find(c=>c.id===id);
const palette=['#6956D9','#2974B5','#B27727','#208578','#AF4E81','#597C3C','#B76542','#577783','#8F64B0','#85604C'];
function nextColor(){const used=new Set(data.courses.map(c=>c.color.toUpperCase()));return palette.find(c=>!used.has(c.toUpperCase()))||'#'+Math.floor(0x445566+Math.random()*0x666666).toString(16).padStart(6,'0');}
function courseStyle(course){
 const hex=course.color, rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
 return `--course:${hex};--course-bg:rgba(${rgb},0.07);--course-border:rgba(${rgb},0.14)`;
}
function toast(message,error=false){
 const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=message;$('#toasts').append(el);setTimeout(()=>el.remove(),4000);
}
function save(label='已保存到本机',markDirty=true){
 if(markDirty) dirty=true;
 try{
  localStorage.setItem(STORAGE_KEY,JSON.stringify({data,dirty,publishedRevision,updatedAt:new Date().toISOString()}));
  cacheWriteFailed=false;$('#save-status').classList.remove('unsaved');$('#save-status').innerHTML='<i></i>'+esc(label);$('#save-status').title='保存在当前浏览器，不会自动同步至 GitHub 或其他设备。';
  return true;
 }catch(error){
  cacheWriteFailed=true;$('#save-status').classList.add('unsaved');$('#save-status').innerHTML='<i></i>尚未保存';
  $('#storage-banner').hidden=false;$('#storage-banner').textContent='浏览器阻止保存或本地空间已满。修改仅留在当前页面，关闭后可能丢失；请立即在“数据与备份”中导出 JSON。';
  return false;
 }
}
function notifySaved(message){toast(cacheWriteFailed?message+' 但本机保存失败，请立即导出备份。':message,cacheWriteFailed);}
async function confirmAction(message,title='请确认',yesText='确认'){
 $('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-yes').textContent=yesText;
 const dlg=$('#confirm-dialog');dlg.returnValue='';dlg.showModal();
 return await new Promise(resolve=>dlg.addEventListener('close',()=>resolve(dlg.returnValue==='confirm'),{once:true}));
}
function closeDialog(button){button.closest('dialog')?.close();}
function showTab(tab){
 currentTab=['schedule','notes','services'].includes(tab)?tab:'schedule';
 $$('.page-section').forEach(s=>s.hidden=s.id!=='section-'+currentTab);
 $$('[data-nav]').forEach(b=>{const active=b.dataset.nav===currentTab;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#breadcrumb-current').textContent={schedule:'教学课程时间',notes:'重要事项',services:'其他服务'}[currentTab];
 if(currentTab==='notes')renderNotes();if(currentTab==='services')renderServices();
}
function renderClock(){
 const week=C.currentWeek(today),range=week?C.weekRange(week):null;
 $('#sidebar-week').textContent=week?`第 ${C.pad(week)} 周 / 20`:(C.dayValue(today)<C.dayValue(C.START)?'学期尚未开始':'本学期已结束');
 $('#semester-track').style.width=week?((week-1)/20*100)+'%':(C.dayValue(today)<C.dayValue(C.START)?'0%':'100%');
 $('#current-week-button').textContent=week?'回到当前周':`定位第${C.defaultWeek(today)}周`;
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'设备本地时区';
 $('#device-date').textContent=`设备日期 ${today.replaceAll('-','.')} · ${zone} · 自动定位周次`;
 const label=week?`第${week}周 · ${range.start}—${range.end}`:(C.dayValue(today)<C.dayValue(C.START)?'学期尚未开始':'本学期已结束');
 $('#device-date').title=label+'。以本机日历日期判断，不使用固定的“当前周”标记。';
}
function renderStats(){
 const current=C.currentWeek(today),selected=data.records.filter(r=>selectedWeeks.has(r.week)&&(!courseFilter||r.courseId===courseFilter));
 const courses=new Set(selected.map(r=>r.courseId)),isCurrent=selectedWeeks.size===1&&selectedWeeks.has(current);
 const range=current?C.weekRange(current):null;
 const label=current?'当前教学周':(C.dayValue(today)<C.dayValue(C.START)?'距离学期开学':'本学期状态');
 const value=current?C.pad(current):(C.dayValue(today)<C.dayValue(C.START)?String(C.dayValue(C.START)-C.dayValue(today)):'已结束');
 const detail=current?`${C.shortDate(range.start)} — ${C.shortDate(range.end)}`:`${C.START.replaceAll('-','.')} — ${C.END.replaceAll('-','.')}`;
 $('#stats').innerHTML=`<div class="stat-card featured"><span class="stat-icon">${icon('calendar')}</span><div><p class="stat-label">${label}</p><div class="stat-value">${value}<small>${current?'/ 20 周':(C.dayValue(today)<C.dayValue(C.START)?'天':'')}</small></div><p class="stat-detail">${detail}</p></div><span class="stat-side">${current?'秋季学期':'2026—2027'}</span></div>
 <div class="stat-card"><span class="stat-icon">${icon('book')}</span><div><p class="stat-label">${isCurrent?'本周':'所选周'}教学课程</p><div class="stat-value">${String(courses.size).padStart(2,'0')}<small>门课程</small></div><p class="stat-detail">${courseFilter?'已按所选课程筛选':'按所选周次统计，不重复计数'}</p></div></div>
 <div class="stat-card"><span class="stat-icon">${icon('clock')}</span><div><p class="stat-label">${isCurrent?'本周':'所选周'}教学课时</p><div class="stat-value">${String(selected.length).padStart(2,'0')}<small>节课</small></div><p class="stat-detail">每节 45 分钟 · 共 ${Number((selected.length*45/60).toFixed(2))} 小时</p></div></div>`;
}
function weekOptions(selected,name){
 const now=C.currentWeek(today);
 return Array.from({length:20},(_,i)=>{
  const w=i+1,{start,end}=C.weekRange(w),active=now===w;
  return `<label class="week-option${active?' is-current':''}"><input type="checkbox" name="${name}" value="${w}" ${selected.has(w)?'checked':''} aria-label="第${w}周 ${start}至${end}${active?' 当前周':''}"><strong>第${w}周${active?'<span class="tag current">当前</span>':''}</strong><small>${C.shortDate(start)}—${C.shortDate(end)}</small></label>`;
 }).join('');
}
function renderWeekControls(){
 $('#view-weeks').innerHTML=weekOptions(selectedWeeks,'view-week');
 const weeks=[...selectedWeeks].sort((a,b)=>a-b);
 $('#week-selection-label').textContent=weeks.length===1?`第${weeks[0]}周 · ${C.shortDate(C.weekRange(weeks[0]).start)}—${C.shortDate(C.weekRange(weeks[0]).end)}`:`已选择 ${weeks.length} 周`;
 $('#selected-weeks').innerHTML=weeks.map(w=>`<span class="selected-chip"><b>第${w}周</b> ${C.shortDate(C.weekRange(w).start)}—${C.shortDate(C.weekRange(w).end)}${weeks.length>1?`<button data-action="remove-week" data-week="${w}" aria-label="移除第${w}周">×</button>`:''}</span>`).join('');
 $('[data-action="prev-week"]').disabled=Math.min(...weeks)===1;
 $('[data-action="next-week"]').disabled=Math.max(...weeks)===20;
 $('#show-empty').checked=showEmpty;
}
function renderCourseMeta(){
 const old=courseFilter;
 if(old&&!courseById(old))courseFilter='';
 $('#course-filter').innerHTML='<option value="">全部课程</option>'+data.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 $('#course-filter').value=courseFilter;
 $('#course-names').innerHTML=data.courses.map(c=>`<option value="${esc(c.name)}"></option>`).join('');
 $('#course-legend').innerHTML=data.courses.map(c=>`<span class="legend-item" style="${courseStyle(c)}"><i class="legend-dot"></i>${esc(c.name)}</span>`).join('');
}
function courseCard(record){
 const c=courseById(record.courseId),p=C.TIMES[C.slotIndex(record.slot)];
 const accessibility=`${c.name} 第${record.week}周 ${C.DAYS[record.day-1]} ${p.label}`;
 return `<div class="course-cell" style="${courseStyle(c)}"><button class="course-title" data-action="edit-record" data-record="${esc(record.id)}" aria-label="编辑${esc(accessibility)}"><span>${esc(c.name)}</span>${icon('edit')}</button><div class="course-location">${esc(record.location||'地点待填写')}</div><textarea class="progress-input" rows="1" maxlength="2000" data-progress="${esc(record.id)}" placeholder="记录进度（选填）" aria-label="${esc(accessibility)} 上课进度（选填）">${esc(record.progress)}</textarea></div>`;
}
function boardHeader(week,records){
 const {start,end}=C.weekRange(week),current=C.currentWeek(today)===week;
 return `<div class="week-board-heading"><div class="week-number"><h2>第 ${C.pad(week)} 周</h2><span>WEEK ${C.pad(week)}</span></div><p class="date-range">${start.replaceAll('-','.')} — ${end.replaceAll('-','.')}</p>${current?'<span class="tag current">当前</span>':''}<p class="week-count">${new Set(records.map(r=>r.courseId)).size} 门课程 · ${records.length} 节课</p></div>`;
}
function daysHeader(week){
 return C.DAYS.map((day,i)=>{
  const iso=C.dateFor(week,i+1),isToday=iso===today;
  return `<th scope="col" class="${isToday?'is-today ':''}${i>4?'is-weekend':''}">${day}${isToday?' · 今天':''}<span class="date-num">${C.shortDate(iso)}</span></th>`;
 }).join('');
}
function emptyWeek(week,hasFilteredOut){
 return `<div class="empty-week-days">${C.DAYS.map((d,i)=>{const iso=C.dateFor(week,i+1);return `<div class="${iso===today?'is-today':''}">${d}${iso===today?' · 今天':''}<span>${C.shortDate(iso)}</span></div>`;}).join('')}</div><div class="empty-week">${icon('calendar')}<h3>${hasFilteredOut?'本周没有符合筛选条件的课程':'这一周，暂无课程安排'}</h3><p>${hasFilteredOut?'切换到“全部课程”可查看其他课程。':'原表没有记录的周次不会自动补课。可点击下方添加，或展开全部空节次。'}</p><button class="button small" data-action="add-course-week" data-week="${week}">${icon('plus')}为第${week}周添加课程</button></div>`;
}
function gridBoard(week,records){
 const periods=C.visibleSlots(records,week,showEmpty);
 if(!periods.length)return emptyWeek(week,data.records.some(r=>r.week===week));
 const lookup=new Map(records.map(r=>[C.key(r),r]));
 return `<div class="timetable-scroll" tabindex="0" aria-label="第${week}周课表，可横向滚动"><table class="timetable" aria-label="第${week}周课程表"><thead><tr><th class="time-th" scope="col">节次 / 时间</th>${daysHeader(week)}</tr></thead><tbody>${periods.map(p=>`<tr data-period="${p.code}"><th scope="row">${p.label}<span>${p.start}–${p.end}</span></th>${C.DAYS.map((_,i)=>{
  const r=lookup.get(`${week}|${i+1}|${p.code}`);
  if(r)return `<td>${courseCard(r)}</td>`;
  const other=data.records.find(x=>x.week===week&&x.day===i+1&&x.slot===p.code);
  return `<td class="empty-cell${i>4?' weekend-cell':''}">${other?`<span class="sr-only">有其他课程，已被筛选隐藏</span>`:`<button data-action="add-course-slot" data-week="${week}" data-day="${i+1}" data-slot="${p.code}" aria-label="在第${week}周 ${C.DAYS[i]} ${p.label}添加课程" title="点击添加课程">+</button>`}</td>`;
 }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function dailyBoard(week,records){
 if(!records.length&&!showEmpty)return emptyWeek(week,data.records.some(r=>r.week===week));
 return `<div class="daily-grid">${C.DAYS.map((day,i)=>{
  const rows=records.filter(r=>r.day===i+1).sort(C.sortRecords),iso=C.dateFor(week,i+1);
  const periods=C.TIMES.filter(p=>showEmpty||rows.some(r=>r.slot===p.code));
  return `<div class="day-column"><div class="day-column-heading"><strong>${day}</strong>${C.shortDate(iso)}${iso===today?'<span class="tag today">今天</span>':''}</div>${periods.map(p=>{
   const r=rows.find(r=>r.slot===p.code);
   if(!r){const other=data.records.find(x=>x.week===week&&x.day===i+1&&x.slot===p.code);return other?'':`<button class="daily-add-slot" data-action="add-course-slot" data-week="${week}" data-day="${i+1}" data-slot="${p.code}">＋ ${p.label} · ${p.start}–${p.end}</button>`;}
   return `<div class="day-period"><div class="period-label"><span>${p.label}</span><span>${p.start}–${p.end}</span></div>${courseCard(r)}</div>`;
  }).join('')}${periods.length?'':'<p class="day-empty">暂无课程 · 空节次已收起</p>'}</div>`;
 }).join('')}</div>`;
}
function renderBoards(){
 $('#weekboards').innerHTML=[...selectedWeeks].sort((a,b)=>a-b).map(week=>{
  const records=data.records.filter(r=>r.week===week&&(!courseFilter||r.courseId===courseFilter)).sort(C.sortRecords);
  const used=C.visibleSlots(records,week).length;
  const board=viewMode==='daily'?dailyBoard(week,records):gridBoard(week,records);
  return `<section class="week-board${viewMode==='daily'?' daily':''}" data-week-board="${week}">${boardHeader(week,records)}${board}<div class="collapse-row"><button data-action="toggle-empty">${icon('chevron-down')}${showEmpty?'收起空节次':viewMode==='daily'?'各天无课节次已隐藏，点击展开全部':used<13?`已隐藏 ${13-used} 个整周无课节次 · 点击展开`:'已展示本周全部节次'}</button></div></section>`;
 }).join('');
 fillIcons();
}
function refreshSchedule(){renderClock();renderWeekControls();renderStats();renderBoards();}
function refreshAll(){renderCourseMeta();refreshSchedule();renderNotesCount();if(currentTab==='notes')renderNotes();if(currentTab==='services')renderServices();$('#update-banner').hidden=!hasNewRelease;fillIcons();}
function changeWeeks(weeks){selectedWeeks=new Set(weeks.filter(w=>w>=1&&w<=20));if(!selectedWeeks.size)selectedWeeks.add(C.defaultWeek(today));refreshSchedule();}
function openCourse(rows=[],defaults={}){
 editingIds=rows.map(r=>r.id);editingBulk=rows.length>1;
 const r=rows[0],course=r?courseById(r.courseId):null;
 $('#course-form').reset();$('#course-error').hidden=true;
 $('#course-dialog-title').textContent=rows.length?(editingBulk?'编辑课程安排':'编辑本节课程'):'添加课程';
 $('#edit-name').value=course?.name||'';$('#edit-location').value=r?.location||'';$('#edit-day').value=String(r?.day||defaults.day||1);$('#edit-color').value=course?.color||nextColor();
 const weeks=new Set(rows.length?rows.map(r=>r.week):(defaults.week?[defaults.week]:[...selectedWeeks]));
 const slots=new Set(rows.length?rows.map(r=>r.slot):(defaults.slot?[defaults.slot]:[]));
 $('#edit-weeks').innerHTML=weekOptions(weeks,'edit-week');
 $('#edit-slots').innerHTML=C.TIMES.map(p=>`<label class="slot-option"><input type="checkbox" name="edit-slot" value="${p.code}" ${slots.has(p.code)?'checked':''} aria-label="${p.label} ${p.start}至${p.end}"><span><strong>${p.label}</strong><small>${p.start}–${p.end}</small></span></label>`).join('');
 $('#edit-progress').value=rows.length===1?r.progress:'';$('#bulk-progress-label').hidden=!editingBulk;$('#bulk-progress').checked=false;$('#delete-editing').hidden=!rows.length;
 $('#editing-summary').hidden=!rows.length;
 $('#editing-summary').textContent=editingBulk?`正在编辑 ${rows.length} 节安排。未勾选“应用到全部课次”时，原日期和节次对应的进度将保留。更换地点不会丢失已有进度。`:`正在编辑第${r?.week}周 ${C.DAYS[(r?.day||1)-1]} ${C.TIMES[C.slotIndex(r?.slot||'1')].label}。勾选额外周次或节次将增加对应安排，冲突时不会覆盖原课程。`;
 updateTargetCount();$('#course-dialog').showModal();fillIcons();
}
function checkedValues(name,numeric=false){return $$(`input[name="${name}"]:checked`).map(x=>numeric?Number(x.value):x.value);}
function updateTargetCount(){const weeks=checkedValues('edit-week',true),slots=checkedValues('edit-slot');$('#edit-target-count').textContent=`已选 ${weeks.length} 周 × ${slots.length} 节 = ${weeks.length*slots.length} 节安排；上课进度可以留空。`;}
function showCourseError(message){const box=$('#course-error');box.textContent=message;box.hidden=false;box.scrollIntoView({block:'nearest'});}
function submitCourse(event){
 event.preventDefault();
 const name=$('#edit-name').value.trim(),locationText=$('#edit-location').value.trim(),weeks=checkedValues('edit-week',true),slots=checkedValues('edit-slot'),day=Number($('#edit-day').value),progress=$('#edit-progress').value;
 if(!name){showCourseError('请输入教学课程名。');return;}
 if(!weeks.length||!slots.length){showCourseError('请至少选择一个周次和一个节次。');return;}
 const targets=weeks.flatMap(week=>slots.map(slot=>({week,day,slot})));
 const hits=C.conflicts(data.records,targets,editingIds);
 if(hits.length){
  showCourseError(`发现 ${hits.length} 处时间冲突，未保存或覆盖任何课程：\n`+hits.slice(0,5).map(h=>`第${h.target.week}周 ${C.DAYS[h.target.day-1]} ${C.TIMES[C.slotIndex(h.target.slot)].label}：已有“${courseById(h.existing.courseId).name}”`).join('\n')+(hits.length>5?'\n……请调整勾选范围，或从“管理课程”修改原安排。':'\n请调整勾选范围，或从“管理课程”修改原安排。'));return;
 }
 const originals=data.records.filter(r=>editingIds.includes(r.id)),oldByPosition=new Map(originals.map(r=>[C.key(r),r]));
 let course=data.courses.find(c=>c.name===name);
 if(!course){course={id:uid('course'),name,color:$('#edit-color').value};data.courses.push(course);}else course.color=$('#edit-color').value;
 const newRows=targets.map(t=>{
   const old=oldByPosition.get(C.key(t));
   return {...t,id:old?.id||uid('period'),courseId:course.id,location:locationText,progress:editingBulk&&!$('#bulk-progress').checked?(old?.progress||''):progress};
 });
 const excluded=new Set(editingIds);data.records=data.records.filter(r=>!excluded.has(r.id)).concat(newRows).sort(C.sortRecords);
 courseFilter='';save();$('#course-dialog').close();refreshAll();notifySaved(`已保存 ${newRows.length} 节课程安排。`);
}
function openManage(){
 managementGroups=C.groups(data.records);
 $('#manage-list').innerHTML=managementGroups.length?managementGroups.map((g,index)=>{
  const c=courseById(g.courseId),periods=C.compactNumbers(g.slots.map(s=>C.slotIndex(s)+1));
  const notes=g.records.filter(r=>r.progress.trim()).length;
  return `<div class="manage-item" style="${courseStyle(c)}"><i class="manage-course-mark"></i><div class="manage-content"><h3>${esc(c.name)}</h3><p>第${C.compactNumbers(g.weeks)}周 · ${C.DAYS[g.day-1]} · 第${periods}节课</p><p><span>${esc(g.location||'地点待填写')}</span> · ${g.records.length} 节安排${notes?` · ${notes} 节已记录进度`:''}</p></div><button class="button" data-action="edit-group" data-group="${index}">编辑安排</button></div>`;
 }).join(''):'<div class="empty-week"><h3>暂无课程</h3><p>点击下方按钮添加第一门课程。</p></div>';
 $('#manage-dialog').showModal();
}
async function deleteEditing(){
 if(!editingIds.length)return;
 const count=editingIds.length;
 if(!await confirmAction(`将删除正在编辑的 ${count} 节课程安排及其进度。其他周次或课程不受影响。建议先导出备份。`,'删除课程安排','确认删除'))return;
 const excluded=new Set(editingIds);data.records=data.records.filter(r=>!excluded.has(r.id));save();$('#course-dialog').close();refreshAll();notifySaved(`已删除 ${count} 节安排。`);
}
function renderNotesCount(){const n=data.notes.filter(n=>!n.done).length;$('#nav-note-count').textContent=n;$('#nav-note-count').hidden=!n;}
function renderNotes(){
 const open=data.notes.filter(n=>!n.done).length;
 $('#notes-summary').textContent=`${open} 项待办 · ${data.notes.length-open} 项已完成`;
 $$('[data-action="filter-notes"]').forEach(b=>b.classList.toggle('active',b.dataset.filter===noteFilter));
 const notes=data.notes.filter(n=>noteFilter==='all'||(noteFilter==='open'?!n.done:n.done)).sort((a,b)=>Number(a.done)-Number(b.done)||(a.date||'9999').localeCompare(b.date||'9999')||a.title.localeCompare(b.title,'zh-CN'));
 $('#notes-list').innerHTML=notes.length?notes.map(n=>{
  const overdue=n.date&&n.date<today&&!n.done,todayDue=n.date===today&&!n.done;
  return `<article class="note-card${n.done?' is-done':''}"><label class="note-check"><span class="sr-only">${n.done?'标为未完成':'完成'}：${esc(n.title)}</span><input type="checkbox" data-note-check="${esc(n.id)}" ${n.done?'checked':''}></label><div class="note-content"><h3><span>${esc(n.title)}</span>${n.done?'<span class="tag done">已完成</span>':overdue?'<span class="tag overdue">已到期</span>':todayDue?'<span class="tag current">今天</span>':''}</h3><small>${n.date?esc(n.date.replaceAll('-','.')):'未设置日期'}</small>${n.description?`<p>${esc(n.description)}</p>`:''}</div><button class="icon-button" data-action="edit-note" data-note="${esc(n.id)}" aria-label="编辑事项：${esc(n.title)}">${icon('edit')}</button></article>`;
 }).join(''):`<div class="large-empty"><span class="empty-symbol">${icon('checklist')}</span><h2>${data.notes.length?'这个分类下暂无事项':'还没有重要事项'}</h2><p>${data.notes.length?'切换其他分类，或添加新的事项。':'上传的表格中“重要事项”为空。可在这里添加考试、备课、作业提交等提醒，不会预填虚构事项。'}</p><button class="button primary" data-action="add-note">${icon('plus')}添加第一项提醒</button></div>`;
 renderNotesCount();
}
function openNote(id=null){
 editingNoteId=id;const n=data.notes.find(n=>n.id===id);
 $('#note-title').textContent=n?'编辑事项':'添加事项';$('#note-input-title').value=n?.title||'';$('#note-input-date').value=n?.date||'';$('#note-input-description').value=n?.description||'';$('#delete-note').hidden=!n;$('#note-dialog').showModal();
}
function submitNote(e){
 e.preventDefault();const title=$('#note-input-title').value.trim();if(!title)return;
 const old=data.notes.find(n=>n.id===editingNoteId);
 const note={id:old?.id||uid('note'),title,date:$('#note-input-date').value,description:$('#note-input-description').value,done:old?.done||false};
 if(old)data.notes=data.notes.map(n=>n.id===old.id?note:n);else data.notes.push(note);
 save();$('#note-dialog').close();renderNotes();notifySaved('事项已保存。');
}
async function deleteNote(){
 if(!editingNoteId)return;if(!await confirmAction('将删除这条重要事项。','删除事项','确认删除'))return;
 data.notes=data.notes.filter(n=>n.id!==editingNoteId);save();$('#note-dialog').close();renderNotes();notifySaved('事项已删除。');
}
function renderServices(){
 const direction=$('#bus-filter').value;
 const buses=data.buses.filter(b=>direction==='all'||(direction==='out'?b.from.includes('桑浦山'):b.from.includes('东海岸'))).sort((a,b)=>a.departure.localeCompare(b.departure)||a.from.localeCompare(b.from,'zh-CN'));
 $('#bus-count').textContent=`${buses.length} 班`;
 $('#bus-body').innerHTML=buses.map(b=>`<tr class="${b.type==='增开'?'extra-row':''}"><td class="bus-time">${esc(b.departure||'未提供')}</td><td class="arrival-time">${esc(b.arrival||'未提供')}</td><td>${esc(b.from)} <span aria-hidden="true">→</span> ${esc(b.to)}</td><td>${esc(b.vehicles||'未提供')}${b.vehicles?' 辆':''}</td><td><span class="tag ${b.type==='增开'?'overdue':'subtle'}">${esc(b.type)}</span>${b.note?`<small>${esc(b.note)}</small>`:''}</td></tr>`).join('');
 $('#service-list').innerHTML=data.services.length?`<div class="service-links">${data.services.map(s=>`<article class="service-link"><span class="service-icon" style="width:33px;height:33px;border-radius:10px">${icon('link')}</span><button class="icon-button service-edit" data-action="edit-service" data-service="${esc(s.id)}" aria-label="编辑服务：${esc(s.title)}">${icon('edit')}</button><h3>${esc(s.title)}</h3>${s.description?`<p>${esc(s.description)}</p>`:''}${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">打开服务 ${icon('arrow-up-right')}</a>`:''}</article>`).join('')}</div>`:'<div class="service-placeholder">原表暂无其他服务内容。点击“添加服务”可保存常用链接或服务说明。</div>';
}
function openService(id=null){
 editingServiceId=id;const s=data.services.find(s=>s.id===id);
 $('#service-title').textContent=s?'编辑服务':'添加服务';$('#service-input-title').value=s?.title||'';$('#service-input-url').value=s?.url||'';$('#service-input-description').value=s?.description||'';$('#delete-service').hidden=!s;$('#service-error').hidden=true;$('#service-dialog').showModal();
}
function submitService(e){
 e.preventDefault();const title=$('#service-input-title').value.trim(),url=$('#service-input-url').value.trim();
 if(!title)return;
 if(url&&!/^https?:\/\//i.test(url)){$('#service-error').textContent='链接只能使用 http:// 或 https://，不能使用脚本或本地文件地址。';$('#service-error').hidden=false;return;}
 const old=data.services.find(s=>s.id===editingServiceId),s={id:old?.id||uid('service'),title,url,description:$('#service-input-description').value};
 if(old)data.services=data.services.map(v=>v.id===old.id?s:v);else data.services.push(s);
 save();$('#service-dialog').close();renderServices();notifySaved('服务已保存。');
}
async function deleteService(){
 if(!editingServiceId)return;if(!await confirmAction('将删除这项自定义服务。','删除服务','确认删除'))return;
 data.services=data.services.filter(s=>s.id!==editingServiceId);save();$('#service-dialog').close();renderServices();notifySaved('服务已删除。');
}
function showCalendar(){
 const current=C.currentWeek(today);
 $('#calendar-weeks').innerHTML=Array.from({length:20},(_,i)=>{const w=i+1,r=C.weekRange(w);return `<div class="calendar-week${current===w?' is-current':''}"><strong>第${w}周 ${current===w?'<span class="tag current">当前</span>':''}</strong><p>${r.start} — ${r.end}</p><small>${data.records.filter(r=>r.week===w).length} 节已排课程</small></div>`;}).join('');
 $('#calendar-dialog').showModal();
}
function download(filename,content,type){
 const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function exportJSON(){download(`教学服务备份_${today}.json`,JSON.stringify(data,null,2),'application/json;charset=utf-8');toast('备份文件已生成。');}
function csvCell(value){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function exportCSV(){
 const rows=[['课程名称','地点','周次','日期','星期','节次代码','节次名称','开始时间','结束时间','上课进度']];
 [...data.records].sort(C.sortRecords).forEach(r=>{const p=C.TIMES[C.slotIndex(r.slot)];rows.push([courseById(r.courseId).name,r.location,`第${r.week}周`,C.dateFor(r.week,r.day),C.DAYS[r.day-1],r.slot,p.label,p.start,p.end,r.progress]);});
 download(`教学课程表_${today}.csv`,'\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('课程表 CSV 已生成，可用 Excel 打开。');
}
async function exportHTML(){
 if(!await confirmAction('将把当前课程、地点、逐节进度、重要事项和服务一起写入 index.html。\n上传到公开网站后，访问者可以查看这些内容。此操作只生成文件，不会自动上传 GitHub。','生成发布网页','生成网页'))return;
 const newSeed=clone(data);newSeed.revision='release-'+Date.now();
 const doc=document.documentElement.cloneNode(true);
 // Remove rendered state and dialogs. The scripts reconstruct the page from the
 // new seed on each visit, independently of today's selected weeks or tab.
 const dynamicIds=['stats','view-weeks','selected-weeks','course-legend','weekboards','manage-list','notes-list','bus-body','service-list','calendar-weeks','edit-weeks','edit-slots'];
 dynamicIds.forEach(id=>{const el=doc.querySelector('#'+id);if(el)el.innerHTML='';});
 doc.querySelector('#seed-data').textContent=JSON.stringify(newSeed).replace(/</g,'\\u003c');
 doc.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));
 doc.querySelector('#toasts').innerHTML='';
 ['storage-banner','update-banner','course-error','service-error'].forEach(id=>doc.querySelector('#'+id).setAttribute('hidden',''));
 doc.querySelectorAll('input:not([type="checkbox"]):not([type="color"]),textarea').forEach(el=>{el.removeAttribute('value');if(el.tagName==='TEXTAREA')el.textContent='';});
 doc.querySelectorAll('input[type="checkbox"]').forEach(el=>el.removeAttribute('checked'));
 doc.querySelector('#save-status').innerHTML='<i></i>已载入课表';
 // The published repository uses separate assets. Keep downloaded releases
 // self-contained so replacing only index.html still works as before.
 try{
  const [css,js]=await Promise.all(['./style.css','./script.js'].map(async path=>{
   const response=await fetch(path);if(!response.ok)throw new Error(path);
   return response.text();
  }));
  const link=doc.querySelector('link[href="./style.css"]');
  const style=doc.ownerDocument.createElement('style');style.textContent=css;link.replaceWith(style);
  const source=doc.querySelector('script[src="./script.js"]');
  const script=doc.ownerDocument.createElement('script');script.textContent=js.replaceAll('</script','<\\/script');source.replaceWith(script);
 }catch(error){toast('生成失败：无法读取页面资源。请刷新后重试。',true);return;}
 download('index.html','<!DOCTYPE html>\n'+doc.outerHTML,'text/html;charset=utf-8');toast('index.html 已生成；上传并替换仓库首页即可发布。');
}
async function importJSON(file){
 if(!file)return;
 try{
  if(file.size>8*1024*1024)throw new Error('文件超过 8 MB 限制。');
  const imported=C.validateData(JSON.parse(await file.text()));
  if(!await confirmAction(`将用备份中的 ${imported.records.length} 节课程、${imported.notes.length} 条事项及其他服务替换本机数据。\n当前未备份的修改将被覆盖。`,'导入备份','导入并替换'))return;
  data=clone(imported);publishedRevision=published.revision;hasNewRelease=false;save();refreshAll();notifySaved('备份已导入。');
 }catch(error){toast('导入失败：'+error.message,true);}
 finally{$('#import-file').value='';}
}
async function resetToPublished(){
 if(!await confirmAction('这会覆盖本机全部修改，恢复当前 HTML 文件内的发布课表。\n建议先导出 JSON 备份。此操作不会修改 GitHub 仓库。','恢复发布版本','确认恢复'))return;
 data=clone(published);dirty=false;publishedRevision=published.revision;hasNewRelease=false;courseFilter='';save('已载入发布版本',false);refreshAll();notifySaved('已恢复当前发布版本。');
}
function setEditorChecks(name,test){$$(`input[name="${name}"]`).forEach(el=>el.checked=test(el.value));updateTargetCount();}
function checkDate(){
 const next=C.localISO();if(next===today)return;
 const oldWeek=C.currentWeek(today);today=next;
 if(C.currentWeek(today)!==oldWeek)selectedWeeks=new Set([C.defaultWeek(today)]);
 refreshSchedule();if(currentTab==='notes')renderNotes();
 // Keep editor selections intact while updating only genuine current badges.
 if($('#course-dialog').open){const chosen=new Set(checkedValues('edit-week',true));$('#edit-weeks').innerHTML=weekOptions(chosen,'edit-week');}
 if($('#calendar-dialog').open){$('#calendar-dialog').close();showCalendar();}
}
// Event delegation preserves handlers when multiweek boards are re-rendered.
document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-nav]');if(nav){showTab(nav.dataset.nav);return;}
 const b=event.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action;
 switch(action){
 case 'close-dialog':closeDialog(b);break;
 case 'add-course':openCourse();break;
 case 'add-course-week':openCourse([],{week:Number(b.dataset.week)});break;
 case 'add-course-slot':openCourse([],{week:Number(b.dataset.week),day:Number(b.dataset.day),slot:b.dataset.slot});break;
 case 'edit-record':{const r=data.records.find(r=>r.id===b.dataset.record);if(r)openCourse([r]);break;}
 case 'manage':openManage();break;
 case 'edit-group':{const group=managementGroups[Number(b.dataset.group)];if(group){$('#manage-dialog').close();openCourse(group.records);}break;}
 case 'add-course-from-manage':$('#manage-dialog').close();openCourse();break;
 case 'delete-editing':await deleteEditing();break;
 case 'prev-week':changeWeeks([...selectedWeeks].map(w=>w-1));break;
 case 'next-week':changeWeeks([...selectedWeeks].map(w=>w+1));break;
 case 'current-week':changeWeeks([C.defaultWeek(C.localISO())]);break;
 case 'view-all-weeks':changeWeeks(Array.from({length:20},(_,i)=>i+1));break;
 case 'view-current-only':changeWeeks([C.defaultWeek(today)]);break;
 case 'close-week-picker':$('#week-picker').open=false;break;
 case 'remove-week':if(selectedWeeks.size>1)changeWeeks([...selectedWeeks].filter(w=>w!==Number(b.dataset.week)));break;
 case 'toggle-empty':showEmpty=!showEmpty;refreshSchedule();break;
 case 'view-grid':case 'view-daily':viewMode=action==='view-grid'?'grid':'daily';$$('[data-action="view-grid"],[data-action="view-daily"]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});renderBoards();break;
 case 'edit-week-all':setEditorChecks('edit-week',()=>true);break;
 case 'edit-week-odd':setEditorChecks('edit-week',v=>Number(v)%2===1);break;
 case 'edit-week-even':setEditorChecks('edit-week',v=>Number(v)%2===0);break;
 case 'edit-week-clear':setEditorChecks('edit-week',()=>false);break;
 case 'edit-slot-morning':setEditorChecks('edit-slot',v=>C.slotIndex(v)<5);break;
 case 'edit-slot-afternoon':setEditorChecks('edit-slot',v=>C.slotIndex(v)>=5&&C.slotIndex(v)<10);break;
 case 'edit-slot-evening':setEditorChecks('edit-slot',v=>C.slotIndex(v)>=10);break;
 case 'edit-slot-clear':setEditorChecks('edit-slot',()=>false);break;
 case 'add-note':openNote();break;
 case 'edit-note':openNote(b.dataset.note);break;
 case 'delete-note':await deleteNote();break;
 case 'filter-notes':noteFilter=b.dataset.filter;renderNotes();break;
 case 'add-service':openService();break;
 case 'edit-service':openService(b.dataset.service);break;
 case 'delete-service':await deleteService();break;
 case 'show-calendar':showCalendar();break;
 case 'data':$('#data-dialog').showModal();break;
 case 'export-json':exportJSON();break;
 case 'export-csv':exportCSV();break;
 case 'export-html':await exportHTML();break;
 case 'import-json':$('#import-file').click();break;
 case 'reset':case 'use-published':await resetToPublished();break;
 case 'keep-local':hasNewRelease=false;publishedRevision=published.revision;save();refreshAll();toast('已保留本机数据。');break;
 case 'print':$('#week-picker').open=false;window.print();break;
 }
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.name==='view-week'){
  if(el.checked)selectedWeeks.add(Number(el.value));else if(selectedWeeks.size>1)selectedWeeks.delete(Number(el.value));else{el.checked=true;toast('请至少保留一个周次。');return;}
  refreshSchedule();
 }else if(el.id==='course-filter'){courseFilter=el.value;refreshSchedule();}
 else if(el.id==='show-empty'){showEmpty=el.checked;refreshSchedule();}
 else if(el.name==='edit-week'||el.name==='edit-slot')updateTargetCount();
 else if(el.dataset.noteCheck){const n=data.notes.find(n=>n.id===el.dataset.noteCheck);if(n){n.done=el.checked;save();renderNotes();}}
 else if(el.id==='bus-filter')renderServices();
 else if(el.id==='import-file')importJSON(el.files[0]);
});
document.addEventListener('input',event=>{
 const el=event.target;
 if(el.dataset.progress){
  const r=data.records.find(r=>r.id===el.dataset.progress);if(!r)return;
  r.progress=el.value;save('进度已保存到本机');
  $$('[data-progress]').forEach(other=>{if(other!==el&&other.dataset.progress===r.id)other.value=r.progress;});
 }else if(el.id==='edit-name'){
  const c=data.courses.find(c=>c.name===el.value.trim());if(c)$('#edit-color').value=c.color;
 }
});
$('#course-form').addEventListener('submit',submitCourse);$('#note-form').addEventListener('submit',submitNote);$('#service-form').addEventListener('submit',submitService);
// Closing by Escape is supported by native <dialog>; clicks inside never close it.
document.addEventListener('pointerdown',event=>{
 if($('#week-picker').open&&!event.target.closest('#week-picker')&&!event.target.closest('#confirm-dialog'))$('#week-picker').open=false;
});
window.addEventListener('focus',checkDate);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDate();});
window.addEventListener('pageshow',event=>{if(event.persisted){today=C.localISO();selectedWeeks=new Set([C.defaultWeek(today)]);refreshSchedule();}});
window.addEventListener('beforeunload',event=>{if(cacheWriteFailed){event.preventDefault();event.returnValue='';}});
setInterval(checkDate,30000);
// Always start with the true current week (or the nearest semester boundary),
// never with a previously chosen review week from localStorage.
refreshAll();showTab(['notes','services'].includes(location.hash.slice(1))?location.hash.slice(1):'schedule');
if(!hasNewRelease)save(dirty?'已读取本机修改':'已载入课表',false);
})();

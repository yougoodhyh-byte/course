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
    if(data.reminderDismissed!==undefined&&(Array.isArray(data.reminderDismissed)||data.reminderDismissed===null||typeof data.reminderDismissed!=='object')) throw new Error('提醒状态数据无效。');
    if(data.attendance!==undefined&&(Array.isArray(data.attendance)||data.attendance===null||typeof data.attendance!=='object')) throw new Error('考勤数据格式无效。');
    if(data.attendance?.courses!==undefined&&(Array.isArray(data.attendance.courses)||data.attendance.courses===null||typeof data.attendance.courses!=='object')) throw new Error('考勤课程数据格式无效。');
    if(data.notes.length>2000||data.buses.length>1000||data.services.length>1000) throw new Error('备份记录过多。');
    const noteIds=new Set();
    data.notes.forEach(n=>{
      if(!n||!str(n.id,120)||noteIds.has(n.id)||!str(n.title,120)||!n.title.trim()||!str(n.description,3000)||!str(n.date,10)||(n.date!==''&&!Number.isFinite(dayValue(n.date)))||typeof n.done!=='boolean') throw new Error('重要事项数据无效。');
      noteIds.add(n.id);
    });
    if(data.reminderDismissed!==undefined){
      for(const [k,v] of Object.entries(data.reminderDismissed))if(typeof k!=='string'||k.length>260||v!==true)throw new Error('提醒状态数据无效。');
    }
    const serviceIds=new Set();
    data.services.forEach(s=>{
      if(!s||!str(s.id,120)||serviceIds.has(s.id)||!str(s.title,120)||!s.title.trim()||!str(s.description,3000)||!str(s.url,1500)) throw new Error('服务数据无效。');
      if(s.url&&!/^https?:\/\//i.test(s.url)) throw new Error('服务链接只能使用 http 或 https。');
      serviceIds.add(s.id);
    });
    data.buses.forEach(b=>{
      if(!b||!['id','departure','arrival','from','to','vehicles','note','type'].every(k=>str(b[k],1000))) throw new Error('校车数据无效。');
    });
    if(data.attendance?.courses){
      for(const [courseId,sheet] of Object.entries(data.attendance.courses)){
        if(!ids.has(courseId)||!sheet||typeof sheet!=='object'||Array.isArray(sheet)||!Array.isArray(sheet.students)||sheet.students.length>2000||typeof sheet.marks!=='object'||sheet.marks===null||Array.isArray(sheet.marks))throw new Error('考勤课程数据无效。');
        if(!str(sheet.filename||'',500)||!str(sheet.importedAt||'',80))throw new Error('考勤文件信息无效。');
        const studentIds=new Set();
        for(const st of sheet.students){
          if(!st||!str(st.id,120)||!st.id||studentIds.has(st.id)||!str(st.name,120)||!st.name.trim()||!str(st.studentNo,120)||!st.studentNo.trim())throw new Error('学生信息无效。');
          studentIds.add(st.id);
        }
        for(const [studentId,marks] of Object.entries(sheet.marks)){
          if(!studentIds.has(studentId)||!marks||typeof marks!=='object'||Array.isArray(marks))throw new Error('考勤记录无效。');
          for(const [date,value] of Object.entries(marks))if(!Number.isFinite(dayValue(date))||!['1','-1'].includes(String(value)))throw new Error('考勤状态无效。');
        }
      }
    }
    return data;
  }

  function normalizeBuses(data){
    if(!data.busHolidays)data.busHolidays={};
    if(!data.attendance)data.attendance={courses:{}};
    if(!data.attendance.courses)data.attendance.courses={};
    const courseIds=new Set((data.courses||[]).map(c=>c.id));
    for(const courseId of Object.keys(data.attendance.courses))if(!courseIds.has(courseId))delete data.attendance.courses[courseId];
    if(data.academicCalendar!==undefined&&(data.academicCalendar===null||Array.isArray(data.academicCalendar)||typeof data.academicCalendar!=='object'))throw new Error('校历数据格式无效。');
    if(!data.reminderDismissed)data.reminderDismissed={};
    const reminderKeys=new Set((data.notes||[]).filter(n=>n&&typeof n.id==='string').map(n=>n.id+'|'+(n.date||'')));
    for(const key of Object.keys(data.reminderDismissed))if(!reminderKeys.has(key))delete data.reminderDismissed[key];
    if(!data.busHolidays||Array.isArray(data.busHolidays)||typeof data.busHolidays!=='object')throw new Error('节假日标记格式无效。');
    for(const [date,value] of Object.entries(data.busHolidays))if(!Number.isFinite(dayValue(date))||typeof value!=='boolean')throw new Error('节假日标记无效。');
    // The publication revision is metadata, not a user's editable field.
    data.revision='2026-09-29-bus-cloud-v2';
    return validateData(data);
  }
  function busesFor(buses,date,mode='date',holiday=false){
    if(mode==='weekday')return buses.filter(b=>b.schedule==='weekday'||b.schedule==='wednesday');
    if(mode==='weekend')return buses.filter(b=>b.schedule==='weekend');
    if(!Number.isFinite(dayValue(date))||date<'2026-09-07')return [];
    const weekday=new Date(dayValue(date)*DAY).getUTCDay();
    const isWeekend=weekday===0||weekday===6,inExtra=date>='2026-09-21'&&date<='2027-01-10';
    return buses.filter(b=>isWeekend?(b.schedule==='weekend'&&(!b.extra||inExtra)):(b.schedule==='weekday'||(b.schedule==='wednesday'&&weekday===3&&inExtra&&!holiday)));
  }
  const api={normalizeBuses,busesFor,TIMES,DAYS,START,END,WEEK_COUNT,localISO,dayValue,addDays,currentWeek,defaultWeek,weekRange,dateFor,shortDate,slotIndex,key,identity,sortRecords,compactNumbers,groups,visibleSlots,conflicts,validateData,pad};
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
const published=C.normalizeBuses(JSON.parse($('#seed-data').textContent));
let cloud=null, cloudRenderPending=false, guestSnapshot=null, guestWasDirty=false, legacyReadFailed=false;
const STORAGE_KEY='teaching-workspace:2026-fall:v1:'+location.pathname.replace(/index\.html$/,'');
let data=clone(published), today=C.localISO(), selectedWeeks=new Set([C.defaultWeek(today)]), currentTab='schedule', courseFilter='', showEmpty=false, viewMode='grid', noteFilter='all', calendarTerm='fall';
let dirty=false, publishedRevision=published.revision, cacheWriteFailed=false;
let editingIds=[], editingBulk=false, editingNoteId=null, editingServiceId=null, managementGroups=[], attendanceUploadCourseId=null;
const attendanceSearchQueries=new Map();
let hasNewRelease=false;
try{
 const saved=localStorage.getItem(STORAGE_KEY);
 if(saved){const cached=JSON.parse(saved);data=C.normalizeBuses(cached.data);dirty=!!cached.dirty;}
 publishedRevision=published.revision;hasNewRelease=false;
}catch(error){
 legacyReadFailed=true;
 try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)localStorage.setItem(STORAGE_KEY+':unreadable-backup:'+Date.now(),raw);}catch{}
 $('#storage-banner').hidden=false;
 $('#storage-banner').textContent='本机数据未能读取，原缓存未删除。请先导出旧版备份；当前展示初始课表。'+error.message;
}
guestSnapshot=clone(data);guestWasDirty=dirty;
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
 if(markDirty)dirty=true;
 if(cloud?.user){
   const ok=cloud.capture();cacheWriteFailed=!ok;return ok;
 }
 guestSnapshot=clone(data);guestWasDirty=dirty;
 try{
  localStorage.setItem(STORAGE_KEY,JSON.stringify({data,dirty,publishedRevision,updatedAt:new Date().toISOString()}));
  cacheWriteFailed=false;
  if(cloud)cloud.render();else{$('#save-status').textContent='仅本机';$('#save-status').title='未连接云端；修改仅保存在此浏览器。';}
  return true;
 }catch(error){
  cacheWriteFailed=true;$('#save-status').classList.add('unsaved');$('#save-status').textContent='尚未保存';
  $('#storage-banner').hidden=false;$('#storage-banner').textContent='本机空间不足或浏览器禁止保存，请立即导出备份，避免关闭后丢失修改。';
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
 if(currentTab==='notes')renderNotes();if(currentTab==='services'){$$('.service-fold,.attendance-course').forEach(d=>d.open=false);renderServices();}
}
function renderClock(){
 const week=C.currentWeek(today),range=week?C.weekRange(week):null;
 $('#sidebar-week').textContent=week?`第 ${C.pad(week)} 周 / 20`:(C.dayValue(today)<C.dayValue(C.START)?'学期尚未开始':'本学期已结束');
 $('#semester-track').style.width=week?((week-1)/20*100)+'%':(C.dayValue(today)<C.dayValue(C.START)?'0%':'100%');
 $('#current-week-button').textContent=week?'回到当前周':`定位第${C.defaultWeek(today)}周`;
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'设备本地时区';
 $('#device-date').textContent=today.replaceAll('-','.');
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
 return `<div class="course-cell" style="${courseStyle(c)}"><button class="course-title" data-action="edit-record" data-record="${esc(record.id)}" aria-label="编辑${esc(accessibility)}"><span>${esc(c.name)}</span>${icon('edit')}</button><div class="course-location">${esc(record.location||'')}</div><textarea class="progress-input" rows="1" maxlength="2000" data-progress="${esc(record.id)}" placeholder="记录进度（选填）" aria-label="${esc(accessibility)} 上课进度（选填）">${esc(record.progress)}</textarea></div>`;
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
 return `<div class="empty-week-days">${C.DAYS.map((d,i)=>{const iso=C.dateFor(week,i+1);return `<div class="${iso===today?'is-today':''}">${d}${iso===today?' · 今天':''}<span>${C.shortDate(iso)}</span></div>`;}).join('')}</div><div class="empty-week">${icon('calendar')}<h3>${hasFilteredOut?'本周没有符合筛选条件的课程':'这一周，暂无课程安排'}</h3><p>${hasFilteredOut?'切换到“全部课程”可查看其他课程。':'可添加课程或展开空节次。'}</p><button class="button small" data-action="add-course-week" data-week="${week}">${icon('plus')}为第${week}周添加课程</button></div>`;
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
function refreshAll(){const semesterRange=$('#semester-range');if(semesterRange)semesterRange.textContent=data.term?.start&&data.term?.end?(data.term.start.replaceAll('-','.')+' — '+data.term.end.replaceAll('-','.')):'';renderCourseMeta();refreshSchedule();renderTodayReminders();renderNotesCount();if(currentTab==='notes')renderNotes();if(currentTab==='services')renderServices();$('#update-banner').hidden=!hasNewRelease;fillIcons();}
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
function reminderKey(note){return note.id+'|'+(note.date||'');}
function renderTodayReminders(){
 const box=$('#today-reminders');if(!box)return;
 const due=data.notes.filter(n=>!n.done&&n.date===today&&!data.reminderDismissed?.[reminderKey(n)]);
 box.hidden=!due.length;
 box.innerHTML=due.length?due.map(n=>`<article class="today-reminder-card">
   <div class="today-reminder-mark">${icon('checklist')}</div>
   <div class="today-reminder-content"><div class="today-reminder-label">今日重要提醒</div><h2>${esc(n.title)}</h2>${n.description?`<p>${esc(n.description)}</p>`:''}<small>${esc(today.replaceAll('-','.'))}</small>
    <div class="today-reminder-actions"><button class="today-reminder-done" data-action="complete-reminder" data-note="${esc(n.id)}"><span class="today-reminder-done-box" aria-hidden="true"></span><span>已完成</span></button></div>
   </div>
   <button class="today-reminder-close" data-action="dismiss-reminder" data-note="${esc(n.id)}" aria-label="擦除提醒：${esc(n.title)}" title="擦除后不再提醒">×</button>
  </article>`).join(''):'';
 fillIcons();
}
function completeReminder(noteId){
 const n=data.notes.find(n=>n.id===noteId);if(!n||n.date!==today)return;
 n.done=true;
 save();renderTodayReminders();renderNotes();toast('已标记为完成，并同步到“重要事项”。');
}
function dismissReminder(noteId){
 const n=data.notes.find(n=>n.id===noteId);if(!n||n.date!==today)return;
 if(!data.reminderDismissed)data.reminderDismissed={};
 data.reminderDismissed[reminderKey(n)]=true;
 save();renderTodayReminders();toast('已擦除本次提醒；“重要事项”中的事项状态不变。');
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
 }).join(''):`<div class="large-empty"><span class="empty-symbol">${icon('checklist')}</span><h2>${data.notes.length?'这个分类下暂无事项':'还没有重要事项'}</h2><p>${data.notes.length?'切换其他分类，或添加新的事项。':'添加需要记录的教学事项。'}</p><button class="button primary" data-action="add-note">${icon('plus')}添加第一项提醒</button></div>`;
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
 save();$('#note-dialog').close();renderNotes();renderTodayReminders();notifySaved('事项已保存。');
}
async function deleteNote(){
 if(!editingNoteId)return;if(!await confirmAction('将删除这条重要事项。','删除事项','确认删除'))return;
 data.notes=data.notes.filter(n=>n.id!==editingNoteId);save();$('#note-dialog').close();renderNotes();renderTodayReminders();notifySaved('事项已删除。');
}
function academicWeekRange(start,week){const from=C.addDays(start,(week-1)*7);return {start:from,end:C.addDays(from,6)};}
function academicWeekFor(start,weeks,iso=today){const d=C.dayValue(iso),s=C.dayValue(start);if(!Number.isFinite(d)||d<s||d>s+weeks*7-1)return null;return Math.floor((d-s)/7)+1;}
function calendarData(){return data.academicCalendar||null;}
function defaultCalendarTerm(iso=today){const cal=calendarData();if(cal?.spring?.periods?.some(p=>iso>=p.start&&iso<=p.end))return 'spring';return 'fall';}
function academicStatus(iso=today){const cal=calendarData();if(!cal)return '';const hits=[];for(const key of ['fall','spring']){const term=cal[key];for(const p of term?.periods||[])if(iso>=p.start&&iso<=p.end)hits.push({term,label:p.label,priority:Number(p.priority||0)});}hits.sort((x,y)=>y.priority-x.priority);if(!hits.length)return cal.title||'学年校历';const hit=hits[0],w=academicWeekFor(hit.term.weekStart,hit.term.weeks,iso);return [hit.term.name,w?('第'+w+'周'):null,hit.label].filter(Boolean).join(' · ');}
function calendarPhase(term,week){return (term.weekPhases||[]).find(p=>week>=Number(p.from)&&week<=Number(p.to))?.label||'';}
function calendarSpecial(term,week){return term.weekNotes?.[String(week)]||'';}
function formatCalendarDate(iso){return iso.replaceAll('-','.');}
function renderCalendar(){const cal=calendarData();if(!cal){toast('校历尚未从云端载入。',true);return;}const term=cal[calendarTerm]||cal.fall,currentWeek=academicWeekFor(term.weekStart,term.weeks,today);$('#calendar-title').textContent=cal.title||'学年校历';$$('#calendar-term-switch button').forEach(b=>{const active=b.dataset.term===calendarTerm;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('#calendar-term-range').textContent=term.range||'';$('#calendar-week-note').textContent=(term.weekPhases||[]).map(p=>`第${p.from===p.to?p.from:p.from+'—'+p.to}周${p.label}`).join('，')+'。';$('#calendar-events').innerHTML=(term.events||[]).map(e=>`<article class="calendar-event ${esc(e.tone||'')}"><span>${esc(e.date||'')}</span><div><strong>${esc(e.title||'')}</strong><p>${esc(e.detail||'')}</p></div></article>`).join('');$('#calendar-weeks').innerHTML=Array.from({length:Number(term.weeks||0)},(_,i)=>{const w=i+1,r=academicWeekRange(term.weekStart,w),phase=calendarPhase(term,w),special=calendarSpecial(term,w),phaseClass=phase.includes('实践')?'practice':phase.includes('考试')?'exam':'teaching';return `<div class="calendar-week${currentWeek===w?' is-current':''}"><div class="calendar-week-top"><strong>第${w}周</strong><span class="calendar-phase phase-${phaseClass}">${esc(phase)}</span></div><p>${formatCalendarDate(r.start)} — ${formatCalendarDate(r.end)}</p>${special?`<small>${esc(special)}</small>`:''}${currentWeek===w?'<span class="calendar-now">当前</span>':''}</div>`;}).join('');$('#calendar-class-times').innerHTML=C.TIMES.map(p=>`<div><strong>${esc(p.code)}</strong><span>${esc(p.start)}–${esc(p.end)}</span></div>`).join('');$('#calendar-exam-times').innerHTML=(cal.examTimes||[]).map(([name,start,end])=>`<div><strong>${esc(name)}</strong><span>${esc(start)}–${esc(end)}</span></div>`).join('');}
function renderServices(){
 const cal=calendarData();$('#calendar-service-title').textContent=cal?.title||'学年校历';$('#calendar-current-summary').textContent=academicStatus(today);$('#calendar-fall-meta').textContent=cal?.fall?.weeks?('秋季 '+cal.fall.weeks+' 周'):'';$('#calendar-spring-meta').textContent=cal?.spring?.weeks?('春季 '+cal.spring.weeks+' 周'):'';
 const stops=[...new Set(data.buses.flatMap(b=>[b.from,b.to]).filter(Boolean))],outStop=stops[0]||'',backStop=stops[1]||'';$('#bus-route-summary').textContent=outStop&&backStop?(outStop+' ⇄ '+backStop):'';const outOpt=$('#bus-filter option[value="out"]'),backOpt=$('#bus-filter option[value="back"]');if(outOpt)outOpt.textContent=outStop&&backStop?(outStop+' → '+backStop):'去程';if(backOpt)backOpt.textContent=outStop&&backStop?(backStop+' → '+outStop):'返程';
 const direction=$('#bus-filter').value,mode=$('#bus-mode').value;
 if(!$('#bus-date').value)$('#bus-date').value=today;
 const date=$('#bus-date').value,holiday=!!data.busHolidays?.[date];
 const buses=C.busesFor(data.buses,date,mode,holiday).filter(b=>direction==='all'||(direction==='out'?b.from===outStop:b.from===backStop)).sort((a,b)=>a.departure.localeCompare(b.departure)||a.order-b.order);
 const weekday=Number.isFinite(C.dayValue(date))?new Date(C.dayValue(date)*86400000).getUTCDay():null;
 $('#bus-date-label').hidden=mode!=='date';
 $('#bus-holiday-control').hidden=mode!=='date'||weekday!==3||date<'2026-09-21'||date>'2027-01-10';
 $('#bus-holiday').checked=holiday;
 $('#bus-day-label').textContent=mode==='date'?(date+' · '+(weekday===0||weekday===6?'周末班次':'工作日班次')):mode==='weekday'?'周一至周五':'周六周日';
 $('#bus-count').textContent=buses.length+' 条发车记录';
 $('#bus-fold-meta').textContent=buses.length?buses.length+'条':'';
 $('#calendar-fold-meta').textContent=cal?.fall?.weeks&&cal?.spring?.weeks?(cal.fall.weeks+' + '+cal.spring.weeks+'周'):'';
 $('#bus-rule-summary').textContent=mode==='date'?'按原表筛选；条件增班及节假日运行情况请核对学校通知。':'含条件增班，适用范围见各行说明。';
 $('#bus-body').innerHTML=buses.length?buses.map(b=>`<tr data-bus-id="${esc(b.id)}" class="${b.extra?'extra-row':''}"><td class="bus-time">${esc(b.departure)}</td><td class="arrival-time">${esc(b.arrival||'未提供')}</td><td>${esc(b.from)} <span aria-hidden="true">→</span> ${esc(b.to)}</td><td>${esc(b.trip)}<small>${b.vehicles?esc(b.vehicles)+' 辆':'车辆数量未提供'}</small></td><td>${b.extra?'<span class="tag overdue">条件增班</span>':'<span class="tag subtle">常规</span>'}${b.note?`<small>${esc(b.note)}</small>`:''}</td></tr>`).join(''):'<tr><td class="bus-empty" colspan="5">该日期或方向没有符合原表范围的班次。</td></tr>';
 $('.custom-services').hidden=!data.services.length;
 renderAttendance();
 $('#service-list').innerHTML=data.services.length?`<div class="service-links">${data.services.map(s=>`<article class="service-link"><span class="service-icon" style="width:33px;height:33px;border-radius:10px">${icon('link')}</span><button class="icon-button service-edit" data-action="edit-service" data-service="${esc(s.id)}" aria-label="编辑服务：${esc(s.title)}">${icon('edit')}</button><h3>${esc(s.title)}</h3>${s.description?`<p>${esc(s.description)}</p>`:''}${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">打开服务 ${icon('arrow-up-right')}</a>`:''}</article>`).join('')}</div>`:'';
}
const ATTENDANCE_MATCHERS=[
 {test:n=>n.includes('计量经济学'),display:n=>n},
 {test:n=>n.includes('专业认知'),display:n=>n==='专业认知'?'数字经济专业认知':n},
 {test:n=>n.includes('微观经济学'),display:n=>n}
];
function attendanceRequiredCourses(){
 const seen=new Set(),out=[];
 for(const m of ATTENDANCE_MATCHERS){const c=data.courses.find(c=>m.test(c.name));if(c&&!seen.has(c.id)){seen.add(c.id);out.push({course:c,display:m.display(c.name)});}}
 return out;
}
function attendanceDates(courseId){
 return [...new Set(data.records.filter(r=>r.courseId===courseId).map(r=>C.dateFor(r.week,r.day)))].sort();
}
function attendanceSheet(courseId){return data.attendance?.courses?.[courseId]||{filename:'',importedAt:'',students:[],marks:{}};}
function attendanceValue(sheet,studentId,date){return String(sheet.marks?.[studentId]?.[date]||'-');}
function attendanceWeek(date){const n=Math.floor((C.dayValue(date)-C.dayValue(C.START))/7)+1;return n>=1&&n<=20?n:null;}
function attendanceStatusClass(value){return value==='1'?'state-present':value==='-1'?'state-absent':'state-neutral';}
function attendanceSearchQuery(courseId){return String(attendanceSearchQueries.get(courseId)||'').trim().toLowerCase();}
function attendanceStudentMatches(st,query){
 if(!query)return true;
 return String(st.name||'').toLowerCase().includes(query)||String(st.studentNo||'').toLowerCase().includes(query);
}
function scrollAttendanceToToday(scope,behavior='smooth'){
 const scroll=scope?.querySelector?.('.attendance-table-scroll');if(!scroll)return;
 const target=scroll.querySelector('thead .attendance-today-col');if(!target)return;
 const left=Math.max(0,target.offsetLeft-(scroll.clientWidth-target.offsetWidth)/2);
 scroll.scrollTo({left,behavior});
}
function wireAttendanceAutoLocate(host){
 host.querySelectorAll('.attendance-course').forEach(details=>{
  details.addEventListener('toggle',()=>{if(details.open)requestAnimationFrame(()=>scrollAttendanceToToday(details));});
 });
 const fold=$('#attendance-fold');
 if(fold&&!fold.dataset.attendanceLocateWired){
  fold.dataset.attendanceLocateWired='1';
  fold.addEventListener('toggle',()=>{
   if(!fold.open)return;
   const todayCourse=host.querySelector('.attendance-course[data-has-today="1"]');
   if(todayCourse){todayCourse.open=true;requestAnimationFrame(()=>scrollAttendanceToToday(todayCourse));}
  });
 }
 if(fold?.open){
  const todayCourse=host.querySelector('.attendance-course[data-has-today="1"]');
  if(todayCourse){todayCourse.open=true;requestAnimationFrame(()=>scrollAttendanceToToday(todayCourse,'auto'));}
 }
}
function renderAttendance(){
 const host=$('#attendance-courses');if(!host)return;
 const openIds=new Set($$('.attendance-course[open]').map(d=>d.dataset.attendanceCourse));
 const courses=attendanceRequiredCourses();
 $('#attendance-fold-meta').textContent=courses.length+'门课程';
 let html='';
 for(const item of courses){
  const course=item.course,display=item.display,sheet=attendanceSheet(course.id),dates=attendanceDates(course.id),students=sheet.students||[];
  const fileInfo=students.length?(esc(sheet.filename||'已导入学生名单')+' · '+students.length+'名学生'):'未导入学生名单';
  const query=attendanceSearchQuery(course.id),hasToday=dates.includes(today);
  let table='';
  if(students.length){
   let head='<div class="attendance-table-scroll"><table class="attendance-table"><thead><tr><th class="attendance-name">姓名</th>';
   for(const date of dates){
    const w=attendanceWeek(date),todayClass=date===today?' attendance-today-col':'';
    head+='<th class="attendance-date'+todayClass+'" data-attendance-date="'+esc(date)+'"><span>'+esc(date.slice(5).replace('-','/'))+'</span><small>'+(w?'第'+w+'周':'')+(date===today?' · 今天':'')+'</small></th>';
   }
   head+='<th class="attendance-id">学号</th></tr></thead><tbody>';
   let body='';
   for(const st of students){
    const visible=attendanceStudentMatches(st,query);
    body+='<tr data-attendance-student-row data-name="'+esc(String(st.name||'').toLowerCase())+'" data-student-no="'+esc(String(st.studentNo||'').toLowerCase())+'"'+(visible?'':' hidden')+'>';
    body+='<td class="attendance-name"><span class="attendance-student-name">'+esc(st.name)+'</span><button class="attendance-student-delete" data-action="attendance-delete-student" data-course="'+esc(course.id)+'" data-student="'+esc(st.id)+'" aria-label="删除学生 '+esc(st.name)+'" title="删除学生">×</button></td>';
    for(const date of dates){
     const value=attendanceValue(sheet,st.id,date),todayClass=date===today?' attendance-today-col':'';
     body+='<td class="'+todayClass.trim()+'" data-attendance-date="'+esc(date)+'"><select class="attendance-status '+attendanceStatusClass(value)+'" data-attendance-course="'+esc(course.id)+'" data-student="'+esc(st.id)+'" data-date="'+esc(date)+'" aria-label="'+esc(st.name)+' '+esc(date)+'考勤">';
     body+='<option value="-"'+(value==='-'?' selected':'')+'>-</option><option value="1"'+(value==='1'?' selected':'')+'>1</option><option value="-1"'+(value==='-1'?' selected':'')+'>-1</option></select></td>';
    }
    body+='<td class="attendance-id">'+esc(st.studentNo)+'</td>';
    body+='</tr>';
   }
   table=head+body+'</tbody></table></div>';
  }else table='<div class="attendance-empty">上传 Excel 后自动生成学生名单与考勤日期。</div>';
  const openAttr=openIds.has(course.id)?' open':'';
  html+='<details class="attendance-course" data-attendance-course="'+esc(course.id)+'" data-has-today="'+(hasToday?'1':'0')+'"'+openAttr+'><summary><span><strong>'+esc(display)+'</strong><small>'+fileInfo+(hasToday?' · 今天有课':'')+'</small></span><span class="service-fold-chevron">'+icon('chevron-down')+'</span></summary><div class="attendance-course-body">';
  html+='<div class="attendance-toolbar"><div><strong>'+esc(display)+'</strong><small>'+dates.length+' 个上课日期 · “-”未登记，“1”到勤，“-1”缺勤</small></div><div class="attendance-toolbar-actions">'+(students.length?'<label class="attendance-search"><input type="search" value="'+esc(attendanceSearchQueries.get(course.id)||'')+'" placeholder="检索姓名或学号" data-attendance-search="'+esc(course.id)+'" autocomplete="off" aria-label="'+esc(display)+'检索学生"></label>':'')+'<button class="button small" data-action="attendance-upload" data-course="'+esc(course.id)+'">'+(students.length?'替换 Excel':'上传 Excel')+'</button></div></div>';
  html+=table+'</div></details>';
 }
 host.innerHTML=html;fillIcons();wireAttendanceAutoLocate(host);
}
function normalizeExcelHeader(value){return String(value??'').trim().replace(/[\s　_\-:：()（）]/g,'').toLowerCase();}
function findExcelHeader(row,type){
 const normalized=row.map(normalizeExcelHeader);
 if(type==='name')return normalized.findIndex(v=>v==='姓名'||v==='学生姓名'||v==='name'||v==='studentname'||v.endsWith('姓名'));
 return normalized.findIndex(v=>v==='学号'||v==='学生学号'||v==='学籍号'||v==='studentid'||v==='studentno'||v==='studentnumber'||v.endsWith('学号'));
}
async function parseAttendanceExcel(file){
 if(!window.XLSX)throw new Error('Excel 解析组件未加载，请刷新页面后重试。');
 if(file.size>15*1024*1024)throw new Error('Excel 文件超过 15MB，请精简后再上传。');
 const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
 const first=workbook.SheetNames[0];if(!first)throw new Error('Excel 中没有可读取的工作表。');
 const rows=XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,defval:'',raw:false,blankrows:false});
 let header=-1,nameCol=-1,idCol=-1;
 for(let i=0;i<Math.min(rows.length,25);i++){const row=Array.isArray(rows[i])?rows[i]:[];const n=findExcelHeader(row,'name'),id=findExcelHeader(row,'id');if(n>=0&&id>=0){header=i;nameCol=n;idCol=id;break;}}
 if(header<0)throw new Error('未找到“姓名”和“学号”两列表头。请检查 Excel 首张工作表。');
 const students=[],seen=new Set();let skipped=0;
 for(let i=header+1;i<rows.length;i++){
  const row=rows[i]||[],name=String(row[nameCol]??'').trim(),studentNo=String(row[idCol]??'').trim();
  if(!name&&!studentNo)continue;if(!name||!studentNo){skipped++;continue;}if(seen.has(studentNo)){skipped++;continue;}
  seen.add(studentNo);students.push({name,studentNo});
 }
 if(!students.length)throw new Error('没有读取到完整的姓名和学号记录。');
 return {students,skipped};
}
async function importAttendanceExcel(courseId,file){
 const course=data.courses.find(c=>c.id===courseId);if(!course||!file)return;
 const parsed=await parseAttendanceExcel(file),old=attendanceSheet(courseId);
 if(old.students?.length){const ok=await confirmAction('将用“'+file.name+'”更新 '+course.name+' 的学生名单。\n相同学号会保留已有考勤；不在新名单中的学生将移除。','替换考勤名单','确认替换');if(!ok)return;}
 const oldByNo=new Map((old.students||[]).map(s=>[s.studentNo,s]));
 const students=parsed.students.map(s=>{const prev=oldByNo.get(s.studentNo);return prev?{...prev,name:s.name,studentNo:s.studentNo}:{id:uid('student'),name:s.name,studentNo:s.studentNo};});
 const marks={};for(const st of students){if(old.marks?.[st.id])marks[st.id]=old.marks[st.id];}
 data.attendance.courses[courseId]={filename:file.name,importedAt:new Date().toISOString(),students,marks};
 save();renderAttendance();notifySaved('已导入 '+students.length+' 名学生'+(parsed.skipped?'，跳过 '+parsed.skipped+' 条不完整或重复记录':'')+'。');
}
function setAttendanceStatus(el){
 const courseId=el.dataset.attendanceCourse,studentId=el.dataset.student,date=el.dataset.date,value=el.value,sheet=data.attendance.courses[courseId];if(!sheet)return;
 if(!sheet.marks[studentId])sheet.marks[studentId]={};
 if(value==='-'){delete sheet.marks[studentId][date];if(!Object.keys(sheet.marks[studentId]).length)delete sheet.marks[studentId];}else sheet.marks[studentId][date]=value;
 el.classList.remove('state-neutral','state-present','state-absent');el.classList.add(attendanceStatusClass(value));save();
}
async function deleteAttendanceStudent(courseId,studentId){
 const sheet=data.attendance?.courses?.[courseId];if(!sheet)return;
 const st=sheet.students?.find(s=>s.id===studentId);if(!st)return;
 const ok=await confirmAction('将从该课程考勤名单中删除“'+st.name+'（'+st.studentNo+'）”。\n该学生已有考勤记录也会同时删除。','删除学生','确认删除');
 if(!ok)return;
 sheet.students=sheet.students.filter(s=>s.id!==studentId);
 delete sheet.marks[studentId];
 save();renderAttendance();notifySaved('已删除学生 '+st.name+'。');
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
 calendarTerm=defaultCalendarTerm(today);renderCalendar();$('#calendar-dialog').showModal();
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
 const dynamicIds=['stats','view-weeks','selected-weeks','course-legend','weekboards','today-reminders','manage-list','notes-list','bus-body','service-list','attendance-courses','calendar-events','calendar-weeks','calendar-class-times','calendar-exam-times','edit-weeks','edit-slots'];
 dynamicIds.forEach(id=>{const el=doc.querySelector('#'+id);if(el)el.innerHTML='';});
 doc.querySelector('#seed-data').textContent=JSON.stringify(newSeed).replace(/</g,'\\u003c');
 doc.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));
 doc.querySelector('#toasts').innerHTML='';
 ['storage-banner','update-banner','course-error','service-error'].forEach(id=>doc.querySelector('#'+id).setAttribute('hidden',''));
 doc.querySelectorAll('input:not([type="checkbox"]):not([type="color"]),textarea').forEach(el=>{el.removeAttribute('value');if(el.tagName==='TEXTAREA')el.textContent='';});
 doc.querySelectorAll('input[type="checkbox"]').forEach(el=>el.removeAttribute('checked'));
 doc.querySelector('#save-status').innerHTML='<i></i>已载入课表';
 // Bundle only same-directory assets. Authentication sessions are never serialized.
 try{
  for(const link of [...doc.querySelectorAll('link[rel="stylesheet"]')]){
   const response=await fetch(link.getAttribute('href'));if(!response.ok)throw new Error('CSS');
   const style=document.createElement('style');style.textContent=await response.text();link.replaceWith(style);
  }
  for(const source of [...doc.querySelectorAll('script[src]')]){
   const src=source.getAttribute('src');if(/^https?:\/\//i.test(src))continue;
   const response=await fetch(src);if(!response.ok)throw new Error('JS');
   const script=document.createElement('script');script.textContent=(await response.text()).replaceAll('</script','<\/script');source.replaceWith(script);
  }
  for(const id of ['cloud-user','cloud-message','cloud-error','cloud-conflict-detail'])doc.querySelector('#'+id).textContent='';
  doc.querySelector('#cloud-entry').textContent='登录同步';
  doc.querySelector('#cloud-account').hidden=true;doc.querySelector('#cloud-conflict').hidden=true;
 }catch(error){toast('生成失败：请在线打开网站后重试。'+error.message,true);return;}
 download('index.html','<!DOCTYPE html>\n'+doc.outerHTML,'text/html;charset=utf-8');toast('index.html 已生成；上传并替换仓库首页即可发布。');
}
async function importJSON(file){
 if(!file)return;
 try{
  if(file.size>8*1024*1024)throw new Error('文件超过 8 MB 限制。');
  const imported=C.normalizeBuses(JSON.parse(await file.text()));
  if(!await confirmAction(`将用备份中的 ${imported.records.length} 节课程、${imported.notes.length} 条事项及其他服务替换当前资料（已登录时会同步到云端）。\n当前未备份的修改将被覆盖。`,'导入备份','导入并替换'))return;
  data=clone(imported);publishedRevision=published.revision;hasNewRelease=false;save();refreshAll();notifySaved('备份已导入。');
 }catch(error){toast('导入失败：'+error.message,true);}
 finally{$('#import-file').value='';}
}
async function resetToPublished(){
 if(!await confirmAction('这会替换当前全部修改，恢复初始课表。已登录时，替换结果会同步至其他设备。\n建议先导出 JSON 备份。','恢复发布版本','确认恢复'))return;
 data=clone(published);dirty=false;publishedRevision=published.revision;hasNewRelease=false;courseFilter='';save('已载入发布版本',false);refreshAll();notifySaved('已恢复当前发布版本。');
}
function setEditorChecks(name,test){$$(`input[name="${name}"]`).forEach(el=>el.checked=test(el.value));updateTargetCount();}
function checkDate(){
 const next=C.localISO();if(next===today)return;
 const oldWeek=C.currentWeek(today);today=next;
 if(C.currentWeek(today)!==oldWeek)selectedWeeks=new Set([C.defaultWeek(today)]);
 refreshSchedule();renderTodayReminders();if(currentTab==='notes')renderNotes();if(currentTab==='services'){if($('#bus-mode').value==='date')$('#bus-date').value=today;renderServices();}
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
 case 'complete-reminder':completeReminder(b.dataset.note);break;
 case 'dismiss-reminder':dismissReminder(b.dataset.note);break;
 case 'edit-note':openNote(b.dataset.note);break;
 case 'delete-note':await deleteNote();break;
 case 'filter-notes':noteFilter=b.dataset.filter;renderNotes();break;
 case 'add-service':openService();break;
 case 'edit-service':openService(b.dataset.service);break;
 case 'delete-service':await deleteService();break;
 case 'show-calendar':showCalendar();break;
 case 'calendar-term':calendarTerm=b.dataset.term==='spring'?'spring':'fall';renderCalendar();break;
 case 'attendance-upload':attendanceUploadCourseId=b.dataset.course;$('#attendance-file').click();break;
 case 'attendance-delete-student':await deleteAttendanceStudent(b.dataset.course,b.dataset.student);break;
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
 else if(el.dataset.noteCheck){const n=data.notes.find(n=>n.id===el.dataset.noteCheck);if(n){n.done=el.checked;save();renderNotes();renderTodayReminders();}}
 else if(['bus-filter','bus-mode','bus-date'].includes(el.id))renderServices();
 else if(el.id==='bus-holiday'){if(el.checked)data.busHolidays[$('#bus-date').value]=true;else delete data.busHolidays[$('#bus-date').value];save();renderServices();}
 else if(el.id==='attendance-file'){const file=el.files[0];if(file&&attendanceUploadCourseId)importAttendanceExcel(attendanceUploadCourseId,file).catch(error=>toast(error.message,true)).finally(()=>{el.value='';attendanceUploadCourseId=null;});}
 else if(el.classList.contains('attendance-status'))setAttendanceStatus(el);
 else if(el.id==='import-file')importJSON(el.files[0]);
});
document.addEventListener('input',event=>{
 const el=event.target;
 if(el.dataset.attendanceSearch){
  const courseId=el.dataset.attendanceSearch,query=String(el.value||'').trim().toLowerCase();
  attendanceSearchQueries.set(courseId,el.value||'');
  const details=el.closest('.attendance-course');
  details?.querySelectorAll('[data-attendance-student-row]').forEach(row=>{
   row.hidden=!!query&&!((row.dataset.name||'').includes(query)||(row.dataset.studentNo||'').includes(query));
  });
 }else if(el.dataset.progress){
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
window.addEventListener('pageshow',event=>{if(event.persisted){today=C.localISO();selectedWeeks=new Set([C.defaultWeek(today)]);refreshSchedule();renderTodayReminders();}});
window.addEventListener('beforeunload',event=>{if(cacheWriteFailed){event.preventDefault();event.returnValue='';}});
setInterval(checkDate,30000);
// Always start with the true current week (or the nearest semester boundary),
// never with a previously chosen review week from localStorage.
refreshAll();showTab(['notes','services'].includes(location.hash.slice(1))?location.hash.slice(1):'schedule');
if(!hasNewRelease&&!legacyReadFailed)save(dirty?'已读取本机修改':'已载入课表',false);

function applyCloudData(next){
 const normalized=C.normalizeBuses(clone(next));
 if(JSON.stringify(data)===JSON.stringify(normalized))return;
 const el=document.activeElement,focus=el?.dataset?.progress?{id:el.dataset.progress,start:el.selectionStart,end:el.selectionEnd}:null;
 data=normalized;refreshAll();
 if(focus){const target=$$('[data-progress]').find(x=>x.dataset.progress===focus.id);if(target){target.focus({preventScroll:true});target.setSelectionRange(Math.min(focus.start,target.value.length),Math.min(focus.end,target.value.length));}}
}
try{
 cloud=new window.TeachingCloud({getData:()=>clone(data),apply:applyCloudData,normalize:value=>C.normalizeBuses(value),guest:()=>clone(guestSnapshot),guestDirty:()=>guestWasDirty,confirm:confirmAction,download,notify:toast,isEditing:()=>!!document.querySelector('#course-dialog[open],#note-dialog[open],#service-dialog[open],#manage-dialog[open]')||document.activeElement?.classList?.contains('attendance-status')});
}catch(error){$('#storage-banner').hidden=false;$('#storage-banner').textContent='同步组件未能启动，当前仅本机保存：'+error.message;}
// Prevent edits while changing accounts / performing the initial cloud read.
const writes=new Set(['add-course','add-course-week','add-course-slot','edit-record','edit-group','add-course-from-manage','delete-editing','add-note','edit-note','delete-note','complete-reminder','dismiss-reminder','attendance-upload','attendance-delete-student','add-service','edit-service','delete-service','import-json','reset','use-published','keep-local']);
document.addEventListener('click',event=>{
 if(cloud?.isLocked()&&(writes.has(event.target.closest('[data-action]')?.dataset.action)||event.target.matches('[data-note-check],#bus-holiday'))){event.preventDefault();event.stopImmediatePropagation();toast('请先完成云端读取，或在“账号与同步”中重试。',true);}
},true);
document.addEventListener('beforeinput',event=>{if(cloud?.isLocked()&&event.target.dataset.progress){event.preventDefault();toast('正在读取云端，请稍后输入。',true);}},true);
document.addEventListener('focusout',()=>{if(cloudRenderPending)setTimeout(()=>{if(!document.activeElement?.dataset?.progress){cloudRenderPending=false;refreshAll();}},0);});
// Exposed narrow interface for deterministic regression tests / local backups only.
window.TeachingApp={getData:()=>clone(data),core:C};
})();

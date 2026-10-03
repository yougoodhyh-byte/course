"""One-time display update. Does not access any account or teaching records."""
from pathlib import Path
import hashlib
expected={'index.html':'f6b2ee8ec98c5a6163a4569a382cf9ee36bcfb899b26f68cd0dad59ff9ef0b9b','script.js':'869dbe8210a0e709a250eb6672dc4fc1381b9c6c93a05ea06fcdd480a8de36f3','style.css':'c412e34c020edb7372f061a41f175b380de187237672a6afcec02463d9110132'}
for n,h in expected.items():assert hashlib.sha256(Path(n).read_bytes()).hexdigest()==h,n

def replace(s,a,b):
 assert s.count(a)==1,(a[:80],s.count(a))
 return s.replace(a,b)

p=Path('index.html');s=p.read_text()
s=replace(s,'<div class="table-scroll"><table class="bus-table">','<details id="bus-all-fold" class="bus-all-fold"><summary><strong>全部班次</strong><span class="bus-all-hint"></span></summary><div class="table-scroll"><table class="bus-table">')
s=replace(s,'<tbody id="bus-body"></tbody></table></div>','<tbody id="bus-body"></tbody></table></div></details>')
s=replace(s,'./script.js?v=20261003-bus-nearest-directions1','./script.js?v=20261003-memo-shuttle1')
import re
s=re.sub(r'(\./style.css)(?:\?[^"\s]+)?',r'\1?v=20261003-memo-shuttle1',s);p.write_text(s)
p=Path('script.js');s=p.read_text()
s=replace(s,"$$('.service-fold,.attendance-course').forEach(d=>d.open=false);","$$('.service-fold,.attendance-course,#bus-all-fold').forEach(d=>d.open=false);")
s=replace(s,"const fold=$('#bus-fold');if(!fold?.open)return;","const fold=$('#bus-fold');if(!fold?.open||!$('#bus-all-fold')?.open)return;")
s=replace(s,"fold.addEventListener('toggle',()=>{if(fold.open)locateNearestBus({behavior:'smooth'});});","fold.addEventListener('toggle',()=>{if(!fold.open)$('#bus-all-fold').open=false;});\n $('#bus-all-fold').addEventListener('toggle',()=>{if($('#bus-all-fold').open)locateNearestBus({behavior:'smooth'});});")
a=s.index(' const stops=[...new Set(data.buses');z=s.index(" $('.custom-services').hidden",a);block=s[a:z]
s=s[:a]+' renderShuttle();\n'+s[z:];a=s.index('function renderServices(){')
s=s[:a]+"function busBeijing(){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));}\nfunction renderShuttle(){\n const cal=calendarData(),clock=busBeijing(),busToday=clock.year+'-'+clock.month+'-'+clock.day;\n"+block.replace('date=today','date=busToday').replace('.value=today','.value=busToday').replace(" locateNearestBus({behavior:'smooth'});\n",'')+'}\n'+s[a:]
a=s.index(' const busNow=new Date(),nearestIds=new Set();');z=s.index(' const weekday=',a)
s=s[:a]+" const live=mode==='date'&&date===busToday,nearestIds=new Set(),origins=direction==='all'?[outStop,backStop]:[direction==='out'?outStop:backStop],mins=Number(clock.hour)*60+Number(clock.minute);\n const nearestBuses=live?origins.map(origin=>buses.find(b=>b.from===origin&&busClockMinutes(b.departure)>=mins)).filter(Boolean):[];nearestBuses.forEach(b=>nearestIds.add(b.id));\n"+s[z:]
s=replace(s,"nearestSummary.hidden=!nearestBuses.length;\n  nearestSummary.innerHTML=nearestBuses.map(b=>'<div class=\"bus-nearest-card\"><span>'+esc(b.from)+'发车</span><strong>'+esc(b.departure)+'</strong><small>'+esc(b.from)+' → '+esc(b.to)+'</small></div>').join('');","nearestSummary.hidden=!live;\n  nearestSummary.innerHTML=live?origins.map(origin=>{const b=nearestBuses.find(b=>b.from===origin);return '<div class=\"bus-nearest-card\"><span>'+esc(origin)+'发车</span>'+(b?'<b class=\"bus-card-badge\">距离我最近的一趟</b>':'')+'<strong>'+esc(b?.departure||'今日已结束')+'</strong><small>'+esc(origin)+' → '+esc(origin===outStop?backStop:outStop)+'</small></div>';}).join(''):'';")
s=s.replace('<small class="bus-nearest-label">最近</small>','<small class="bus-nearest-label">距离我最近的一趟</small>')
s=replace(s,"else if(['bus-filter','bus-mode','bus-date'].includes(el.id))renderServices();","else if(['bus-filter','bus-mode','bus-date'].includes(el.id)){$('#bus-all-fold').open=true;renderShuttle();}")
s=replace(s,"else delete data.busHolidays[$('#bus-date').value];save();renderServices();}","else delete data.busHolidays[$('#bus-date').value];save();$('#bus-all-fold').open=true;renderShuttle();}")
a=s.index("setInterval(()=>{\n if(currentTab!=='services'||!$('#bus-fold')?.open)return;");z=s.index('// Always start with the true current week',a)
s=s[:a]+"setInterval(()=>{if(!document.hidden&&currentTab==='services'&&$('#bus-fold')?.open)renderShuttle();},60000);\n"+s[z:];p.write_text(s)
p=Path('style.css');p.write_text(p.read_text()+'''
.bus-all-fold{border-top:1px solid #e6edf5}
.bus-all-fold>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;padding:16px 20px;color:#315780;font-size:14px;list-style:none}
.bus-all-fold>summary::-webkit-details-marker{display:none}
.bus-all-fold>summary:focus-visible{outline:3px solid #b4d2f1;outline-offset:-3px}
.bus-all-fold .bus-all-hint:after{content:'展开班次 ▾';font-size:12px;color:#7d8fa6}
.bus-all-fold[open] .bus-all-hint:after{content:'收起班次 ▴'}
@media(max-width:650px){.bus-all-fold>summary{padding:14px 16px}}
@media print{.bus-all-fold>summary{display:none}.bus-all-fold>.table-scroll{display:block!important}}
.bus-nearest-card{position:relative}.bus-card-badge{display:block;width:fit-content;border-radius:7px;background:#e8f3ff;color:#2475c7;font-size:11px;padding:3px 7px;margin:7px 0}.bus-time .bus-nearest-label{display:block;width:fit-content;max-width:12em;white-space:normal;line-height:1.6;font-size:11px;padding:2px 7px;margin:6px 0 0;border-radius:7px}
''')
print('Changed only the shuttle UI; all stored teaching data is untouched.')

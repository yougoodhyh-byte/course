const DAY = 86400000
const START = '2026-09-07'
const END = '2027-01-24'
const WEEK_COUNT = 20
const TIMES = [
  ['1','08:00','08:45'],['2','08:55','09:40'],['3','10:00','10:45'],
  ['4','10:55','11:40'],['5','11:50','12:35'],['6','14:00','14:45'],
  ['7','14:55','15:40'],['8','16:00','16:45'],['9','16:55','17:40'],
  ['0','17:50','18:35'],['A','19:20','20:05'],['B','20:15','21:00'],['C','21:10','21:55']
].map((v,i)=>({code:v[0],start:v[1],end:v[2],index:i,label:'第'+(i+1)+'节'}))
const DAYS = ['周一','周二','周三','周四','周五','周六','周日']

const pad = n => String(n).padStart(2,'0')
function localISO(date = new Date()){return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())}
function dayValue(iso){const p=String(iso).split('-').map(Number);return Date.UTC(p[0],p[1]-1,p[2])/DAY}
function addDays(iso,n){return new Date((dayValue(iso)+n)*DAY).toISOString().slice(0,10)}
function currentWeek(iso=localISO()){const d=dayValue(iso),s=dayValue(START),e=dayValue(END);return d>=s&&d<=e?Math.floor((d-s)/7)+1:null}
function defaultWeek(iso=localISO()){const w=currentWeek(iso);return w || (dayValue(iso)<dayValue(START)?1:WEEK_COUNT)}
function weekRange(week){const start=addDays(START,(week-1)*7);return {start,end:addDays(start,6)}}
function dateFor(week,day){return addDays(weekRange(week).start,day-1)}
function slotIndex(code){return TIMES.findIndex(x=>x.code===String(code))}
function localDateTimeMs(date,time){const d=date.split('-').map(Number),t=time.split(':').map(Number);return new Date(d[0],d[1]-1,d[2],t[0],t[1],0,0).getTime()}
function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}

function busRows(buses,date,mode,holiday,direction){
  const weekday = new Date(dayValue(date)*DAY).getUTCDay()
  const weekend = weekday===0||weekday===6
  const extraRange = date>='2026-09-21'&&date<='2027-01-10'
  let rows
  if(mode==='weekday') rows=buses.filter(b=>b.schedule==='weekday'||b.schedule==='wednesday')
  else if(mode==='weekend') rows=buses.filter(b=>b.schedule==='weekend')
  else rows=buses.filter(b=>weekend?(b.schedule==='weekend'&&(!b.extra||extraRange)):(b.schedule==='weekday'||(b.schedule==='wednesday'&&weekday===3&&extraRange&&!holiday)))
  const stops=[...new Set((buses||[]).flatMap(b=>[b.from,b.to]).filter(Boolean))]
  if(direction==='out') rows=rows.filter(b=>b.from===stops[0])
  if(direction==='back') rows=rows.filter(b=>b.from===stops[1])
  return rows.sort((a,b)=>String(a.departure).localeCompare(String(b.departure))||Number(a.order||0)-Number(b.order||0))
}

module.exports={DAY,START,END,WEEK_COUNT,TIMES,DAYS,pad,localISO,dayValue,addDays,currentWeek,defaultWeek,weekRange,dateFor,slotIndex,localDateTimeMs,uid,busRows}

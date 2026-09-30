const core=require('./core')

const MATCHERS=[
  {test:n=>n.includes('计量经济学'),display:n=>n},
  {test:n=>n.includes('专业认知'),display:n=>n==='专业认知'?'数字经济专业认知':n},
  {test:n=>n.includes('微观经济学'),display:n=>n}
]
function requiredCourses(payload){
  const seen=new Set(),out=[]
  for(const m of MATCHERS){
    const c=(payload.courses||[]).find(c=>m.test(c.name))
    if(c&&!seen.has(c.id)){seen.add(c.id);out.push({course:c,display:m.display(c.name)})}
  }
  return out
}
function dates(payload,courseId){return [...new Set((payload.records||[]).filter(r=>r.courseId===courseId).map(r=>core.dateFor(r.week,r.day)))].sort()}
function sheet(payload,courseId){return payload.attendance&&payload.attendance.courses&&payload.attendance.courses[courseId]||{filename:'',importedAt:'',students:[],marks:{}}}
function value(s,studentId,date){return String(s.marks&&s.marks[studentId]&&s.marks[studentId][date]||'-')}
function week(date){const n=Math.floor((core.dayValue(date)-core.dayValue(core.START))/7)+1;return n>=1&&n<=20?n:null}
function timing(payload,courseId,now=new Date()){
  const nowMs=now.getTime(),byDate=new Map()
  ;(payload.records||[]).filter(r=>r.courseId===courseId).forEach(r=>{
    const date=core.dateFor(r.week,r.day),period=core.TIMES[core.slotIndex(r.slot)]
    if(!period)return
    const o={start:core.localDateTimeMs(date,period.start),end:core.localDateTimeMs(date,period.end)}
    if(!byDate.has(date))byDate.set(date,[])
    byDate.get(date).push(o)
  })
  let nearestDate='',nearestDistance=Infinity,activeDate=''
  for(const [date,occ] of byDate){
    let dist=Infinity
    for(const o of occ){
      if(nowMs>=o.start&&nowMs<=o.end){activeDate=date;dist=0;break}
      dist=Math.min(dist,nowMs<o.start?o.start-nowMs:nowMs-o.end)
    }
    if(dist<nearestDistance){nearestDistance=dist;nearestDate=date}
  }
  return {nearestDate,nearestDistance,activeDate}
}
function exportSheets(payload,courseIds){
  return requiredCourses(payload).filter(x=>courseIds.includes(x.course.id)).map(x=>{
    const s=sheet(payload,x.course.id)
    return {name:x.display,dates:dates(payload,x.course.id),students:s.students||[],marks:s.marks||{}}
  }).filter(x=>x.students.length)
}
module.exports={requiredCourses,dates,sheet,value,week,timing,exportSheets}

const workspace=require('../../utils/workspace')
const core=require('../../utils/core')
const attendance=require('../../utils/attendance')
const files=require('../../utils/files')

Page({
 data:{openSection:'',directionLabels:['全部方向','去程','返程'],directionValues:['all','out','back'],directionIndex:0,modeLabels:['按日期','周一至周五全表','周六周日全表'],modeValues:['date','weekday','weekend'],modeIndex:0,busDate:core.localISO(),busRows:[],busRoute:'',attendanceCourses:[],term:'fall',calendarSummary:'',calendarEvents:[],calendarWeeks:[],classTimes:core.TIMES,examTimes:[]},
 async onShow(){this.setData({openSection:''});await this.reload(true)},async onPullDownRefresh(){try{await this.reload(true)}finally{wx.stopPullDownRefresh()}},
 async reload(force=false){try{const p=await workspace.load(force);this.payload=p;this.renderAll()}catch(e){wx.showToast({title:e.message,icon:'none'})}},
 renderAll(){this.renderBus();this.renderAttendance();this.renderCalendar()},
 toggle(e){const k=e.currentTarget.dataset.key;this.setData({openSection:this.data.openSection===k?'':k})},
 renderBus(){
  const p=this.payload||workspace.get(),b=p.buses||[],stops=[...new Set(b.flatMap(x=>[x.from,x.to]).filter(Boolean))],mode=this.data.modeValues[this.data.modeIndex],dir=this.data.directionValues[this.data.directionIndex],holiday=!!(p.busHolidays&&p.busHolidays[this.data.busDate])
  const rows=core.busRows(b,this.data.busDate,mode,holiday,dir).map(x=>Object.assign({},x,{arrivalText:x.arrival||'未提供'}))
  this.setData({busRows:rows,busRoute:stops.length>=2?stops[0]+' ⇄ '+stops[1]:''})
 },
 directionChange(e){this.setData({directionIndex:Number(e.detail.value)},()=>this.renderBus())},modeChange(e){this.setData({modeIndex:Number(e.detail.value)},()=>this.renderBus())},busDateChange(e){this.setData({busDate:e.detail.value},()=>this.renderBus())},
 renderAttendance(){
  const p=this.payload||workspace.get()
  this.setData({attendanceCourses:attendance.requiredCourses(p).map(x=>({id:x.course.id,name:x.display,students:(attendance.sheet(p,x.course.id).students||[]).length,dates:attendance.dates(p,x.course.id).length}))})
 },
 openAttendance(e){wx.navigateTo({url:'/pages/attendance-detail/attendance-detail?courseId='+encodeURIComponent(e.currentTarget.dataset.id)})},
 async exportAllAttendance(){
  try{const p=this.payload||workspace.get(),sheets=attendance.exportSheets(p,attendance.requiredCourses(p).map(x=>x.course.id));if(!sheets.length)throw new Error('暂无可导出的考勤数据');wx.showLoading({title:'生成Excel'});await files.exportExcel(sheets,'考勤汇总_'+core.localISO())}catch(e){wx.showToast({title:e.message,icon:'none'})}finally{wx.hideLoading()}
 },
 renderCalendar(){
  const p=this.payload||workspace.get(),cal=p.academicCalendar||{},term=cal[this.data.term]||{},today=core.localISO(),weeks=[]
  for(let w=1;w<=Number(term.weeks||0);w++){const start=core.addDays(term.weekStart,(w-1)*7),end=core.addDays(start,6),phase=(term.weekPhases||[]).find(x=>w>=x.from&&w<=x.to);weeks.push({week:w,range:start.slice(5)+'—'+end.slice(5),phase:phase?phase.label:'',current:today>=start&&today<=end})}
  this.setData({calendarSummary:cal.title||'学年校历',calendarEvents:term.events||[],calendarWeeks:weeks,examTimes:(cal.examTimes||[]).map(x=>({name:x[0],start:x[1],end:x[2]}))})
 },
 setTerm(e){this.setData({term:e.currentTarget.dataset.term},()=>this.renderCalendar())}
})

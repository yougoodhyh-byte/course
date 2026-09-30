const auth=require('../../utils/auth')
const workspace=require('../../utils/workspace')
const core=require('../../utils/core')

function groupWeek(payload,week){
  const cmap=new Map((payload.courses||[]).map(c=>[c.id,c]))
  const rows=(payload.records||[]).filter(r=>r.week===week).slice().sort((a,b)=>a.day-b.day||core.slotIndex(a.slot)-core.slotIndex(b.slot))
  const groups=[]
  rows.forEach(r=>{
    const c=cmap.get(r.courseId)||{name:'课程',color:'#6956d9'}
    const last=groups[groups.length-1]
    const idx=core.slotIndex(r.slot),can=last&&last.courseId===r.courseId&&last.day===r.day&&last.location===r.location&&last.lastSlot===idx-1
    if(can){last.ids.push(r.id);last.lastSlot=idx;last.end=core.TIMES[idx].end;if(r.progress)last.progress=r.progress}
    else groups.push({courseId:r.courseId,ids:[r.id],day:r.day,location:r.location||'',progress:r.progress||'',firstSlot:idx,lastSlot:idx,start:core.TIMES[idx].start,end:core.TIMES[idx].end,name:c.name,color:c.color})
  })
  return groups.map(g=>({key:g.ids.join('-'),idsText:g.ids.join(','),name:g.name,color:g.color,dayName:core.DAYS[g.day-1],dateText:core.dateFor(week,g.day).slice(5).replace('-','/'),time:g.start+'–'+g.end,location:g.location,progress:g.progress}))
}
Page({
  data:{week:core.defaultWeek(),weekLabel:'',items:[],reminders:[]},
  async onShow(){await this.reload(true)},
  async onPullDownRefresh(){try{await this.reload(true)}finally{wx.stopPullDownRefresh()}},
  async reload(force=false){
    if(!auth.getSession()){wx.reLaunch({url:'/pages/login/login'});return}
    try{
      wx.showNavigationBarLoading()
      const p=await workspace.load(force),week=this.data.week||core.defaultWeek(),range=core.weekRange(week),today=core.localISO()
      const reminders=(p.notes||[]).filter(n=>!n.done&&n.date===today&&!p.reminderDismissed[(n.id+'|'+n.date)])
      this.setData({week,weekLabel:'第'+week+'周 · '+range.start+'—'+range.end,items:groupWeek(p,week),reminders})
    }catch(e){wx.showToast({title:e.message||'读取失败',icon:'none'})}
    finally{wx.hideNavigationBarLoading()}
  },
  prevWeek(){if(this.data.week>1)this.setData({week:this.data.week-1},()=>this.reload(false))},
  nextWeek(){if(this.data.week<20)this.setData({week:this.data.week+1},()=>this.reload(false))},
  goCurrent(){this.setData({week:core.defaultWeek()},()=>this.reload(false))},
  addCourse(){wx.navigateTo({url:'/pages/course-editor/course-editor'})},
  editCourse(e){wx.navigateTo({url:'/pages/course-editor/course-editor?ids='+encodeURIComponent(e.currentTarget.dataset.ids)})},
  async completeReminder(e){const id=e.currentTarget.dataset.id;await workspace.mutate(p=>{const n=p.notes.find(x=>x.id===id);if(n)n.done=true});this.reload(false)},
  async dismissReminder(e){const id=e.currentTarget.dataset.id;await workspace.mutate(p=>{const n=p.notes.find(x=>x.id===id);if(n)p.reminderDismissed[id+'|'+n.date]=true});this.reload(false)},
  async logout(){await auth.logout();workspace.clear();wx.reLaunch({url:'/pages/login/login'})}
})

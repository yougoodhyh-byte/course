const workspace=require('../../utils/workspace')
const core=require('../../utils/core')
Page({
  data:{editing:false,ids:[],courseName:'',location:'',progress:'',dayIndex:0,weeks:[],slots:[],days:core.DAYS,colors:['#2974B5','#6956D9','#B27727','#208578','#AF4E81','#5F7C8A'],color:'#6956D9',saving:false},
  onLoad(q){this.ids=decodeURIComponent(q.ids||'').split(',').filter(Boolean)},
  async onShow(){
    const p=await workspace.load()
    const old=(p.records||[]).filter(r=>this.ids.includes(r.id)),first=old[0],course=first&&(p.courses||[]).find(c=>c.id===first.courseId)
    const selectedWeeks=new Set(old.map(r=>r.week)),selectedSlots=new Set(old.map(r=>r.slot))
    this.setData({
      editing:!!old.length,ids:this.ids,
      courseName:course?course.name:'',location:first?first.location:'',progress:first?first.progress:'',dayIndex:first?first.day-1:0,color:course?course.color:'#6956D9',
      weeks:Array.from({length:20},(_,i)=>({n:i+1,selected:old.length?selectedWeeks.has(i+1):(i+1===core.defaultWeek())})),
      slots:core.TIMES.map(x=>({code:x.code,label:x.label,start:x.start,selected:selectedSlots.has(x.code)}))
    })
  },
  onName(e){this.setData({courseName:e.detail.value})},onLocation(e){this.setData({location:e.detail.value})},onProgress(e){this.setData({progress:e.detail.value})},onDay(e){this.setData({dayIndex:Number(e.detail.value)})},
  toggleWeek(e){const a=this.data.weeks.slice(),i=e.currentTarget.dataset.i;a[i].selected=!a[i].selected;this.setData({weeks:a})},
  toggleSlot(e){const a=this.data.slots.slice(),i=e.currentTarget.dataset.i;a[i].selected=!a[i].selected;this.setData({slots:a})},
  pickColor(e){this.setData({color:e.currentTarget.dataset.color})},
  async save(){
    const name=this.data.courseName.trim(),weeks=this.data.weeks.filter(x=>x.selected).map(x=>x.n),slots=this.data.slots.filter(x=>x.selected).map(x=>x.code),day=this.data.dayIndex+1
    if(!name||!weeks.length||!slots.length){wx.showToast({title:'请填写课程并选择周次和节次',icon:'none'});return}
    this.setData({saving:true})
    try{
      const oldIds=new Set(this.ids),p=JSON.parse(JSON.stringify(await workspace.load()))
      const hits=[];weeks.forEach(w=>slots.forEach(s=>{const r=p.records.find(x=>!oldIds.has(x.id)&&x.week===w&&x.day===day&&x.slot===s);if(r)hits.push(r)}))
      if(hits.length)throw new Error('所选时间与已有课程冲突')
      let course=p.courses.find(c=>c.name===name)
      if(!course){course={id:core.uid('course'),name,color:this.data.color};p.courses.push(course)}else course.color=this.data.color
      const oldByPos=new Map(p.records.filter(r=>oldIds.has(r.id)).map(r=>[r.week+'|'+r.day+'|'+r.slot,r]))
      p.records=p.records.filter(r=>!oldIds.has(r.id))
      weeks.forEach(w=>slots.forEach(s=>{const old=oldByPos.get(w+'|'+day+'|'+s);p.records.push({id:old?old.id:core.uid('period'),courseId:course.id,week:w,day,slot:s,location:this.data.location.trim(),progress:this.data.progress})}))
      await workspace.save(p);wx.navigateBack()
    }catch(e){wx.showToast({title:e.message||'保存失败',icon:'none'})}finally{this.setData({saving:false})}
  },
  remove(){wx.showModal({title:'删除课程安排',content:'确认删除当前编辑的课程安排？',success:async r=>{if(!r.confirm)return;await workspace.mutate(p=>{const set=new Set(this.ids);p.records=p.records.filter(x=>!set.has(x.id))});wx.navigateBack()}})}
})

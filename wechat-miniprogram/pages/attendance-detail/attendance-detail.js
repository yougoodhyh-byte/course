const workspace=require('../../utils/workspace')
const attendance=require('../../utils/attendance')
const files=require('../../utils/files')
const core=require('../../utils/core')
Page({
 data:{courseId:'',courseName:'',query:'',dates:[],students:[],hasStudents:false,scrollIntoView:''},
 onLoad(q){this.courseId=decodeURIComponent(q.courseId||'');this.setData({courseId:this.courseId})},
 async onShow(){await this.reload(true);this.timer=setInterval(()=>this.updateTiming(),30000)},onHide(){clearInterval(this.timer)},onUnload(){clearInterval(this.timer)},
 async reload(force=false){try{this.payload=await workspace.load(force);this.render()}catch(e){wx.showToast({title:e.message,icon:'none'})}},
 render(){
  const p=this.payload||workspace.get(),item=attendance.requiredCourses(p).find(x=>x.course.id===this.courseId);if(!item)return
  const s=attendance.sheet(p,this.courseId),dates=attendance.dates(p,this.courseId),t=attendance.timing(p,this.courseId),q=this.data.query.trim().toLowerCase()
  const dateModels=dates.map(d=>({date:d,key:d.replace(/-/g,''),text:d.slice(5).replace('-','/'),week:attendance.week(d),active:d===t.activeDate}))
  const students=(s.students||[]).filter(st=>!q||String(st.name).toLowerCase().includes(q)||String(st.studentNo).toLowerCase().includes(q)).map(st=>({id:st.id,name:st.name,studentNo:st.studentNo,cells:dates.map(d=>{const v=attendance.value(s,st.id,d);return {date:d,value:v,className:v==='1'?'state-present':v==='-1'?'state-absent':'state-neutral',active:d===t.activeDate}})}))
  this.setData({courseName:item.display,dates:dateModels,students,hasStudents:!!(s.students||[]).length,scrollIntoView:t.nearestDate?'col-'+t.nearestDate.replace(/-/g,''):''})
 },
 updateTiming(){if(this.payload)this.render()},search(e){this.setData({query:e.detail.value},()=>this.render())},
 changeStatus(e){const studentId=e.currentTarget.dataset.student,date=e.currentTarget.dataset.date;wx.showActionSheet({itemList:['到勤 1','缺勤 -1','未登记 -'],success:async r=>{const value=['1','-1','-'][r.tapIndex],p=JSON.parse(JSON.stringify(this.payload)),s=attendance.sheet(p,this.courseId);if(!s.marks[studentId])s.marks[studentId]={};if(value==='-'){delete s.marks[studentId][date];if(!Object.keys(s.marks[studentId]).length)delete s.marks[studentId]}else s.marks[studentId][date]=value;p.attendance.courses[this.courseId]=s;this.payload=await workspace.save(p);this.render()}})},
 deleteStudent(e){const id=e.currentTarget.dataset.id;wx.showModal({title:'删除学生',content:'将同时删除该学生的考勤记录，是否继续？',success:async r=>{if(!r.confirm)return;const p=JSON.parse(JSON.stringify(this.payload)),s=attendance.sheet(p,this.courseId);s.students=s.students.filter(x=>x.id!==id);delete s.marks[id];p.attendance.courses[this.courseId]=s;this.payload=await workspace.save(p);this.render()}})},
 replaceExcel(){wx.chooseMessageFile({count:1,type:'file',extension:['xlsx','xls','xlsb'],success:async r=>{try{wx.showLoading({title:'读取名单'});const parsed=await files.parseExcel(r.tempFiles[0]),p=JSON.parse(JSON.stringify(this.payload)),old=attendance.sheet(p,this.courseId),oldByNo=new Map((old.students||[]).map(s=>[s.studentNo,s])),students=parsed.students.map(s=>{const prev=oldByNo.get(s.studentNo);return prev?Object.assign({},prev,{name:s.name,studentNo:s.studentNo}):{id:core.uid('student'),name:s.name,studentNo:s.studentNo}}),marks={};students.forEach(st=>{if(old.marks&&old.marks[st.id])marks[st.id]=old.marks[st.id]});p.attendance.courses[this.courseId]={filename:r.tempFiles[0].name,importedAt:new Date().toISOString(),students,marks};this.payload=await workspace.save(p);this.render();wx.showToast({title:'已导入'+students.length+'人',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'})}finally{wx.hideLoading()}}})},
 async exportCourse(){try{const sheets=attendance.exportSheets(this.payload,[this.courseId]);if(!sheets.length)throw new Error('暂无可导出的考勤数据');wx.showLoading({title:'生成Excel'});await files.exportExcel(sheets,this.data.courseName+'_考勤_'+core.localISO())}catch(e){wx.showToast({title:e.message,icon:'none'})}finally{wx.hideLoading()}}
})

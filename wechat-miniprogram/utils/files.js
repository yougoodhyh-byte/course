const auth=require('./auth')

function readBase64(path){
  return new Promise((resolve,reject)=>{
    wx.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:r=>resolve(r.data),fail:e=>reject(new Error(e.errMsg||'读取文件失败'))})
  })
}
async function parseExcel(tempFile){
  const base64=await readBase64(tempFile.path)
  return auth.authedRequest('/functions/v1/attendance-xlsx',{method:'POST',data:{action:'parse',filename:tempFile.name||'学生名单.xlsx',base64}})
}
function safeName(name){return String(name||'考勤.xlsx').replace(/[\\/:*?"<>|]/g,'_')}
async function exportExcel(sheets,filename){
  const res=await auth.authedRequest('/functions/v1/attendance-xlsx',{method:'POST',data:{action:'export',filename:filename||'考勤汇总',sheets}})
  if(!res||!res.base64)throw new Error(res&&res.error||'导出失败')
  const path=wx.env.USER_DATA_PATH+'/'+safeName(res.filename||'考勤.xlsx')
  const buffer=wx.base64ToArrayBuffer(res.base64)
  await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:buffer,success:resolve,fail:e=>reject(new Error(e.errMsg||'写入文件失败'))}))
  await new Promise((resolve,reject)=>wx.openDocument({filePath:path,showMenu:true,success:resolve,fail:e=>reject(new Error(e.errMsg||'打开文件失败'))}))
  return path
}
module.exports={parseExcel,exportExcel}

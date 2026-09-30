const auth = require('./auth')

let state = { payload: null, base: null, revision: 0, updatedAt: '' }

const clone = x => JSON.parse(JSON.stringify(x))
function stable(x){
  if(Array.isArray(x)) return '['+x.map(stable).join(',')+']'
  if(x&&typeof x==='object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'
  return JSON.stringify(x)
}
const equal=(a,b)=>stable(a)===stable(b)
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const entityArray=x=>Array.isArray(x)&&x.every(v=>object(v)&&typeof v.id==='string')

function normalize(p){
  const data=clone(p||{})
  data.courses=Array.isArray(data.courses)?data.courses:[]
  data.records=Array.isArray(data.records)?data.records:[]
  data.notes=Array.isArray(data.notes)?data.notes:[]
  data.buses=Array.isArray(data.buses)?data.buses:[]
  data.services=Array.isArray(data.services)?data.services:[]
  data.busHolidays=data.busHolidays&&typeof data.busHolidays==='object'?data.busHolidays:{}
  data.reminderDismissed=data.reminderDismissed&&typeof data.reminderDismissed==='object'?data.reminderDismissed:{}
  data.attendance=data.attendance&&typeof data.attendance==='object'?data.attendance:{courses:{}}
  data.attendance.courses=data.attendance.courses&&typeof data.attendance.courses==='object'?data.attendance.courses:{}
  return data
}

function mergeSnapshots(base,local,remote,preference='local'){
  function merge(b,l,r){
    if(equal(l,r))return clone(l)
    if(equal(l,b))return clone(r)
    if(equal(r,b))return clone(l)
    if(object(b)&&object(l)&&object(r)){
      const out={}
      new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)]).forEach(k=>{
        if(['__proto__','constructor','prototype'].includes(k))return
        const v=merge(b[k],l[k],r[k]);if(v!==undefined)out[k]=v
      })
      return out
    }
    if(entityArray(b)&&entityArray(l)&&entityArray(r)){
      const bm=new Map(b.map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v])),out=[]
      new Set([...bm.keys(),...lm.keys(),...rm.keys()]).forEach(id=>{const v=merge(bm.get(id),lm.get(id),rm.get(id));if(v!==undefined)out.push(v)})
      return out
    }
    return clone(preference==='remote'?r:l)
  }
  return merge(base,local,remote)
}

async function fetchRemote(){
  const session=await auth.ensureSession()
  const path='/rest/v1/teaching_workspaces?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=payload,revision,updated_at&limit=1'
  const rows=await auth.authedRequest(path)
  if(!Array.isArray(rows)||!rows.length)throw new Error('云端教学资料不存在')
  return {payload:normalize(rows[0].payload),revision:Number(rows[0].revision),updatedAt:rows[0].updated_at}
}

async function load(force=false){
  if(state.payload&&!force)return state.payload
  const remote=await fetchRemote()
  state={payload:clone(remote.payload),base:clone(remote.payload),revision:remote.revision,updatedAt:remote.updatedAt}
  return state.payload
}

function get(){return state.payload}

async function save(next){
  let local=normalize(next)
  for(let attempt=0;attempt<3;attempt++){
    const res=await auth.authedRequest('/rest/v1/rpc/save_teaching_workspace',{
      method:'POST',
      data:{p_expected_revision:state.revision,p_payload:local}
    })
    if(res&&res.ok){
      state.payload=clone(local);state.base=clone(local);state.revision=Number(res.revision);state.updatedAt=res.updated_at
      return state.payload
    }
    const remote=await fetchRemote()
    local=normalize(mergeSnapshots(state.base||remote.payload,local,remote.payload,'local'))
    state.base=clone(remote.payload);state.revision=remote.revision
  }
  throw new Error('其他设备正在更新，请稍后重试')
}

async function mutate(fn){
  const current=clone(await load())
  await fn(current)
  return save(current)
}

function clear(){state={payload:null,base:null,revision:0,updatedAt:''}}

module.exports={load,get,save,mutate,clear,normalize}

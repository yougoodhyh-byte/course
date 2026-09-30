const auth=require('../../utils/auth')
const workspace=require('../../utils/workspace')
const config=require('../../utils/config')
Page({
  data:{email:config.allowedEmail,password:'',remember:true,loading:false,error:''},
  async onShow(){
    if(auth.getSession()){
      try{await workspace.load(true);wx.switchTab({url:'/pages/schedule/schedule'})}catch(_){}
    }
  },
  onPassword(e){this.setData({password:e.detail.value,error:''})},
  onRemember(e){this.setData({remember:e.detail.value})},
  async submit(){
    if(!this.data.password)return this.setData({error:'请输入密码'})
    this.setData({loading:true,error:''})
    try{
      await auth.login(this.data.password,this.data.remember)
      await workspace.load(true)
      wx.switchTab({url:'/pages/schedule/schedule'})
    }catch(err){this.setData({error:err.message||'登录失败'})}
    finally{this.setData({loading:false,password:''})}
  }
})

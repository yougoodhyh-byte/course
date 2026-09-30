const auth = require('./utils/auth')
const workspace = require('./utils/workspace')

App({
  globalData: { ready: false },
  onLaunch() {
    auth.restore()
  },
  async requireWorkspace(force = false) {
    if (!auth.getSession()) {
      wx.reLaunch({ url: '/pages/login/login' })
      throw new Error('未登录')
    }
    const payload = await workspace.load(force)
    this.globalData.ready = true
    return payload
  }
})

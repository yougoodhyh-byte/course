const config = require('./config')

const STORAGE_KEY = 'course-wechat-session-v1'
let memorySession = null

function request({ url, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method, data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else {
          const msg = res.data && (res.data.msg || res.data.message || res.data.error_description || res.data.error)
          reject(new Error(String(msg || ('HTTP ' + res.statusCode))))
        }
      },
      fail(err) { reject(new Error(err.errMsg || '网络请求失败')) }
    })
  })
}

function restore() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    if (value && value.access_token && value.user && String(value.user.email || '').toLowerCase() === config.allowedEmail) {
      memorySession = value
    }
  } catch (_) {}
  return memorySession
}

function persist(session, remember = true) {
  memorySession = session
  try {
    if (remember) wx.setStorageSync(STORAGE_KEY, session)
    else wx.removeStorageSync(STORAGE_KEY)
  } catch (_) {}
}

function getSession() { return memorySession }

async function login(password, remember = true) {
  const email = config.allowedEmail
  const data = await request({
    url: config.supabaseUrl + '/auth/v1/token?grant_type=password',
    method: 'POST',
    data: { email, password },
    header: { apikey: config.publishableKey, 'Content-Type': 'application/json' }
  })
  const userEmail = String(data && data.user && data.user.email || '').toLowerCase()
  if (userEmail !== config.allowedEmail) throw new Error('仅允许指定账号登录')
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now()/1000) + Number(data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email },
    remember: !!remember
  }
  persist(session, remember)
  return session
}

async function refresh() {
  if (!memorySession || !memorySession.refresh_token) throw new Error('请重新登录')
  const data = await request({
    url: config.supabaseUrl + '/auth/v1/token?grant_type=refresh_token',
    method: 'POST',
    data: { refresh_token: memorySession.refresh_token },
    header: { apikey: config.publishableKey, 'Content-Type': 'application/json' }
  })
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || memorySession.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now()/1000) + Number(data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email },
    remember: memorySession.remember !== false
  }
  if (String(session.user.email || '').toLowerCase() !== config.allowedEmail) throw new Error('无权访问')
  persist(session, session.remember)
  return session
}

async function ensureSession() {
  if (!memorySession) restore()
  if (!memorySession) throw new Error('请先登录')
  if (Number(memorySession.expires_at || 0) * 1000 < Date.now() + 60000) await refresh()
  return memorySession
}

async function authedRequest(path, { method = 'GET', data, header = {}, retry = true } = {}) {
  const session = await ensureSession()
  try {
    return await request({
      url: config.supabaseUrl + path,
      method, data,
      header: Object.assign({
        apikey: config.publishableKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      }, header)
    })
  } catch (err) {
    if (retry && /401|jwt|token|expired/i.test(err.message)) {
      await refresh()
      return authedRequest(path, { method, data, header, retry: false })
    }
    throw err
  }
}

async function logout() {
  try {
    if (memorySession) await authedRequest('/auth/v1/logout?scope=local', { method: 'POST' })
  } catch (_) {}
  memorySession = null
  try { wx.removeStorageSync(STORAGE_KEY) } catch (_) {}
}

module.exports = { restore, getSession, login, refresh, ensureSession, authedRequest, logout }

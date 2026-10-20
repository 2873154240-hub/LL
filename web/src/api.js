// 统一请求封装：token 注入、错误归一化、401 自动登出。
const TOKEN_KEY = 'mx_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('网络连接失败，请检查后端是否已启动', 0)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 401 说明 token 过期/无效，清掉本地凭证，交给路由跳登录页
    if (res.status === 401) setToken('')
    // 站点被所有者关闭：通知全局维护页立刻接管，不用等下一次轮询
    if (res.status === 503 && data.code === 'site_disabled') {
      window.dispatchEvent(new Event('mx:site-off'))
    }
    throw new ApiError(data.detail || `请求失败（${res.status}）`, res.status)
  }
  return data
}

export const fmtNum = (v, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** 大数字压缩：成交额动辄上亿，原样显示会把布局撑破 */
export const fmtCompact = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)} 万`
  return n.toFixed(0)
}

export const fmtPct = (v) => {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

export const fmtTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return d.toLocaleString('zh-CN', { hour12: false })
}

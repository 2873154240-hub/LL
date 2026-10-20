import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, fmtTime } from '../api'
import { useAuth } from '../auth'

/**
 * 全站营业开关的「守门人」。
 *
 * 后端关站时除登录/健康检查外的接口都返回 503；
 * 这里提前把页面换成维护页，避免用户看到满屏报错。
 * 所有者登录后可以在维护页直接重新开启，不需要去服务器上操作。
 */
export default function SiteGate({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setStatus(await api('/site/status', { auth: false }))
    } catch {
      // 状态接口都挂了（比如后端没启动）就放行，让页面自己显示网络错误，
      // 否则用户会看到一个永远转圈的维护页，反而不知道该修哪里。
      setStatus((prev) => prev || { enabled: true, message: '' })
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 10000)
    const onChange = () => load()
    window.addEventListener('mx:site-off', onChange)
    window.addEventListener('mx:site-on', onChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('mx:site-off', onChange)
      window.removeEventListener('mx:site-on', onChange)
    }
  }, [load])

  async function enable() {
    setBusy(true)
    setError('')
    try {
      const next = await api('/owner/site', { method: 'POST', body: { enabled: true } })
      setStatus(next)
      window.dispatchEvent(new Event('mx:site-on'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div className="site-off" style={{ background: 'var(--bg-primary)' }}>
        <div className="spinner dark" />
      </div>
    )
  }

  // 关站时仍然允许进入登录页：所有者要先登录，才能把站重新打开。
  const isLogin = location.pathname === '/login'
  if (!status.enabled && !isLogin) {
    return (
      <div className="site-off">
        <div className="site-off-card">
          <div className="site-off-mark">析</div>
          <h1>站点维护中</h1>
          <p>{status.message || '站点暂时关闭，请稍后再试。'}</p>

          {user?.is_owner ? (
            <>
              <button className="btn btn-primary" onClick={enable} disabled={busy}>
                {busy ? '处理中…' : '重新开启站点'}
              </button>
              {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
            </>
          ) : user ? (
            <div className="muted" style={{ fontSize: 12.5 }}>当前账号没有开关权限。</div>
          ) : (
            <Link to="/login" className="btn btn-ghost" style={{ border: '1px solid var(--border-strong)' }}>
              所有者登录
            </Link>
          )}

          {status.updated_at && (
            <div className="site-off-time">关闭时间 {fmtTime(status.updated_at)}</div>
          )}
        </div>
      </div>
    )
  }

  return children
}

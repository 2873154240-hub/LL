import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import LiveBtcChip from './LiveBtcChip'

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [quota, setQuota] = useState(null)

  const loadQuota = useCallback(async () => {
    if (!user) { setQuota(null); return }
    try {
      const data = await api('/user/summary')
      setQuota(data.quota)
    } catch {
      /* 静默失败：顶部余额不是关键路径 */
    }
  }, [user])

  useEffect(() => {
    loadQuota()
  }, [loadQuota, location.pathname])

  // 研究/充值完成后页面发这个事件，顶栏余额实时更新
  useEffect(() => {
    const handler = () => loadQuota()
    window.addEventListener('mx:refresh', handler)
    return () => window.removeEventListener('mx:refresh', handler)
  }, [loadQuota])

  const initials = (user?.nickname || user?.email || 'U').slice(0, 2).toUpperCase()

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">析</span>
            <span>
              <span className="brand-name">明析 AI</span>
              <span className="brand-sub">决策研究台</span>
            </span>
          </Link>

          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>研究台</NavLink>
            {user && <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>历史记录</NavLink>}
            {user && <NavLink to="/me" className={({ isActive }) => (isActive ? 'active' : '')}>我的</NavLink>}
          </nav>

          <div className="topbar-right">
            <LiveBtcChip />
            {user ? (
              <>
                <div className="balance-chip" title="今日免费额度 + 付费余额">
                  <span>Token</span>
                  <b>{quota ? quota.available : '—'}</b>
                </div>
                <button className="btn btn-sm btn-lime" onClick={() => navigate('/me')}>充值</button>
                <div className="avatar" title={user?.email}>{initials}</div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'rgba(233,237,230,.7)' }}
                  onClick={() => { logout(); navigate('/') }}
                >
                  退出
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm btn-ghost" onClick={() => navigate('/register')}>注册</button>
                <button className="btn btn-sm btn-lime" onClick={() => navigate('/login')}>登录</button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="footer">
        明析 AI · 研究结果仅供学习与决策参考，不构成投资建议，不会自动向交易所提交订单。
      </footer>
    </div>
  )
}

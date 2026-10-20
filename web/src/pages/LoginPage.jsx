import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={location.state?.from || '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>登录明析 AI</h1>
        <p className="sub">标的 AI 自主研究台</p>

        <form className="auth-form" onSubmit={submit}>
          {error && <div className="error">{error}</div>}
          <div>
            <label className="label">邮箱地址</label>
            <input
              className="input" type="email" value={email} required
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              className="input" type="password" value={password} required
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ justifyContent: 'center', padding: 12 }} disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="auth-foot">
          还没有账号？<Link to="/register">注册</Link>
        </div>
        <div className="auth-foot" style={{ marginTop: 8 }}>
          新用户每天有 20 个免费 Token，可直接体验研究台。
        </div>
      </div>
    </div>
  )
}

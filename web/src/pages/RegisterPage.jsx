import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

export default function RegisterPage() {
  const { user, register } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  if (user) return <Navigate to="/" replace />

  async function sendCode() {
    setError('')
    if (!email.trim()) return setError('请先填写邮箱')
    try {
      const data = await api('/auth/send-code', {
        method: 'POST',
        body: { email: email.trim(), purpose: 'register' },
        auth: false,
      })
      setCountdown(60)
      if (data.dev_code) {
        setDevCode(data.dev_code)
        setCode(data.dev_code)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await register({
        email: email.trim(),
        password,
        code: code.trim(),
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>注册账号</h1>
        <p className="sub">注册即获每日 20 个免费 Token</p>

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
            <label className="label">邮箱验证码</label>
            <div className="code-row">
              <input
                className="input" value={code} required placeholder="6 位验证码"
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button" className="btn" disabled={countdown > 0}
                onClick={sendCode}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
            {devCode && (
              <div className="dev-code">
                开发模式：未配置 SMTP，验证码已自动填入（{devCode}）。生产环境请配置邮件服务。
              </div>
            )}
          </div>

          <div>
            <label className="label">密码</label>
            <input
              className="input" type="password" value={password} required minLength={6}
              placeholder="至少 6 位"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" style={{ justifyContent: 'center', padding: 12 }} disabled={busy}>
            {busy ? '注册中…' : '注册'}
          </button>
        </form>

        <div className="auth-foot">
          已有账号？<Link to="/login">登录</Link>
        </div>
      </div>
    </div>
  )
}

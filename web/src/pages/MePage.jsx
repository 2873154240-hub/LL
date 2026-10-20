import { useCallback, useEffect, useState } from 'react'
import { api, fmtTime } from '../api'
import { useAuth } from '../auth'
import OwnerSiteSwitch from '../components/OwnerSiteSwitch'

// 定价对齐 clawdesk：按 USDT 自填金额，最小 1 USDT。
const PRESETS = [1, 5, 10, 50]
// 钱包转账充值：收款地址 + 支持的转账网络。
const WALLET_ADDRESS = '0x8ccaf78fbb945509a3cc4157121e9fa793503edb'
const NETWORK_OPTIONS = ['BNB-Chain(BEP20)']

const STATUS = {
  pending: { label: '待支付', cls: 'chip-amber' },
  paid: { label: '已支付', cls: 'chip-green' },
  failed: { label: '失败', cls: 'chip-red' },
}

export default function MePage() {
  const { user, refresh } = useAuth()
  const [summary, setSummary] = useState(null)
  const [tab, setTab] = useState('ledger')
  const [rows, setRows] = useState([])
  const [amount, setAmount] = useState('5')
  const [network, setNetwork] = useState(NETWORK_OPTIONS[0])
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 修改密码
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [countdown, setCountdown] = useState(0)

  const loadSummary = useCallback(async () => {
    try {
      const data = await api('/user/summary')
      setSummary(data)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadTab = useCallback(async (which) => {
    try {
      const d = which === 'ledger'
        ? await api('/user/ledger?limit=100')
        : await api('/user/recharge/orders')
      setRows(d.items || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadTab(tab) }, [tab, loadTab])

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const pricing = summary?.pricing || {}
  const perUsdt = pricing.tokens_per_usdt || 100
  const minUsdt = pricing.min_usdt ?? 1
  const maxUsdt = pricing.max_usdt ?? 10000
  const fxRate = pricing.usd_cny_rate || 7.2
  const amountNum = Number(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum >= minUsdt && amountNum <= maxUsdt
  const estTokens = amountValid ? Math.max(1, Math.round(amountNum * perUsdt)) : 0
  const estCny = amountValid ? amountNum * fxRate : 0

  async function recharge() {
    setError('')
    setNotice('')
    if (!amountValid) {
      setError(`请输入 ${minUsdt}–${maxUsdt} 之间的 USDT 金额`)
      return
    }
    setBusy(true)
    try {
      const created = await api('/user/recharge', {
        method: 'POST',
        body: { amount_usdt: Number(amountNum.toFixed(2)) },
      })

      // 钱包转账模式：向收款地址转账后确认到账即入账。
      await api(`/user/recharge/${created.order.id}/pay`, { method: 'POST' })
      setNotice(`已充值 ${created.order.tokens} Token（转账已确认）`)
      await Promise.all([loadSummary(), loadTab('orders'), refresh()])
      window.dispatchEvent(new Event('mx:refresh'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyWalletAddress() {
    try {
      await navigator.clipboard.writeText(WALLET_ADDRESS)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，请手动复制钱包地址')
    }
  }

  async function sendCode() {
    setError('')
    setNotice('')
    try {
      const d = await api('/auth/send-code', {
        method: 'POST',
        body: { email: user.email, purpose: 'reset' },
        auth: false,
      })
      setCountdown(60)
      if (d.dev_code) {
        setCode(d.dev_code)
        setNotice(`开发模式：验证码 ${d.dev_code} 已自动填入`)
      } else {
        setNotice('验证码已发送，请查收邮箱')
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { email: user.email, code: code.trim(), password: newPassword },
        auth: false,
      })
      setCode('')
      setNewPassword('')
      setNotice('密码已更新，下次登录请使用新密码')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!summary) {
    return (
      <div className="container">
        <div className="empty-row"><span className="spinner dark" style={{ display: 'inline-block' }} /></div>
      </div>
    )
  }

  const quota = summary.quota
  const paidOrders = rows.filter((r) => r.status === 'paid')

  return (
    <div className="container">
      <div className="hero" style={{ marginBottom: 18 }}>
        <h1>我的账户</h1>
        <p>管理 Token 余额、充值记录与账户安全。每日免费额度按 UTC 零点重置。</p>
      </div>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {notice && <div className="dev-code" style={{ marginBottom: 14 }}>{notice}</div>}

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="card stat">
          <div className="k">可用 Token</div>
          <div className="v">{quota.available}</div>
          <div className="s">免费 {quota.free_remaining} + 付费 {quota.paid_balance}</div>
        </div>
        <div className="card stat">
          <div className="k">今日免费额度</div>
          <div className="v">{quota.free_remaining}<span style={{ fontSize: 15, color: 'var(--text-muted)' }}> / {quota.free_per_day}</span></div>
          <div className="s">每天零点重置</div>
        </div>
        <div className="card stat">
          <div className="k">累计研究</div>
          <div className="v">{summary.total_runs}</div>
          <div className="s">单次消耗 {quota.cost_per_run} Token</div>
        </div>
        <div className="card stat">
          <div className="k">今日已用免费额度</div>
          <div className="v">{quota.free_per_day - quota.free_remaining}</div>
          <div className="s">共 {quota.free_per_day}，每天零点重置</div>
        </div>
      </div>

      {user?.is_owner && <OwnerSiteSwitch />}

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">账户信息</div>
          <div className="reason-list" style={{ fontSize: 13.5 }}>
            <div className="spread"><span className="muted">邮箱</span><b>{user.email}</b></div>
            <div className="spread"><span className="muted">昵称</span><span>{user.nickname}</span></div>
            <div className="spread"><span className="muted">注册时间</span><span className="muted" style={{ fontSize: 12 }}>{fmtTime(user.created_at)}</span></div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">充值 · 按 USDT 自填金额</div>
          <div className="row" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            {PRESETS.map((p) => (
              <button
                key={p}
                className={`btn ${Number(amount) === p ? 'btn-lime' : ''}`}
                onClick={() => setAmount(String(p))}
              >
                {p} USDT
              </button>
            ))}
          </div>
          <label className="label">充值金额（USDT）</label>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min={minUsdt}
            max={maxUsdt}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`最小 ${minUsdt} USDT`}
            style={{ marginBottom: 6 }}
          />
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
            单笔 {minUsdt}–{maxUsdt} USDT，1 USDT = {perUsdt} Token
          </div>
          <div className="spread" style={{ marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>预计到账</span>
            <b className="mono">{amountValid ? estTokens.toLocaleString() : '—'} Token</b>
          </div>
          <div className="spread" style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>折合人民币</span>
            <b className="mono">¥{estCny.toFixed(2)}</b>
          </div>

          <label className="label">选择网络</label>
          <select
            className="input"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            style={{ marginBottom: 10 }}
          >
            {NETWORK_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <label className="label">收款钱包地址</label>
          <div className="wallet-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <code
              className="mono wallet-addr"
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.05))',
                fontSize: 12, wordBreak: 'break-all', overflowWrap: 'anywhere',
              }}
            >
              {WALLET_ADDRESS}
            </code>
            <button
              className="btn"
              onClick={copyWalletAddress}
              style={{ whiteSpace: 'nowrap', minWidth: 92 }}
            >
              {copied ? '已复制 ✓' : '复制钱包地址'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
            请务必选择 <strong>{network}</strong> 网络转账，否则资产可能丢失；转入 {amountValid ? amountNum : minUsdt} USDT 后点击下方确认到账。
          </div>
          <button className="btn btn-primary run-btn" onClick={recharge} disabled={busy || !amountValid}>
            {busy ? '处理中…' : '我已转账，确认到账'}
          </button>
          <div className="tips">
            请向以上 {network} 网络地址转入 {amountValid ? amountNum : '—'} USDT。到账经链上确认后 Token 自动增加；金额与网络不符可能导致充值失败。
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">修改密码</div>
          <form className="auth-form" onSubmit={changePassword} style={{ gap: 10 }}>
            <div>
              <label className="label">邮箱验证码</label>
              <div className="code-row">
                <input
                  className="input" value={code} required placeholder="6 位验证码"
                  onChange={(e) => setCode(e.target.value)}
                />
                <button type="button" className="btn" onClick={sendCode} disabled={countdown > 0}>
                  {countdown > 0 ? `${countdown}s` : '发送验证码'}
                </button>
              </div>
            </div>
            <div>
              <label className="label">新密码</label>
              <input
                className="input" type="password" value={newPassword} required minLength={6}
                placeholder="至少 6 位"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <button className="btn" disabled={busy}>更新密码</button>
          </form>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">使用说明</div>
          <ul className="reason-list" style={{ fontSize: 13 }}>
            <li><span className="w">01</span><span>每次 AI 研究固定消耗 {quota.cost_per_run} Token，优先扣免费额度。</span></li>
            <li><span className="w">02</span><span>研究失败会自动全额退回，不会产生费用。</span></li>
            <li><span className="w">03</span><span>历史记录保存在服务端，删除后不可恢复。</span></li>
            <li><span className="w">04</span><span>所有结果仅供参考，不构成投资建议。</span></li>
          </ul>
        </div>
      </div>

      <div className="card list-card">
        <div className="list-head">
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
            <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>Token 流水</button>
            <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>充值订单</button>
          </div>
          <div className="grow" />
          {tab === 'orders' && <span className="chip">已支付 {paidOrders.length} 笔</span>}
        </div>

        {tab === 'ledger' && (
          rows.length ? (
            <table className="table">
              <thead><tr><th>时间</th><th>变动</th><th>余额</th><th>说明</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ fontSize: 12 }}>{fmtTime(r.created_at)}</td>
                    <td className={`money ${r.delta >= 0 ? 'up' : 'down'}`}>{r.delta >= 0 ? '+' : ''}{r.delta}</td>
                    <td className="mono">{r.balance_after}</td>
                    <td>
                      {r.reason}
                      <span className="muted" style={{ fontSize: 11.5 }}> {r.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty-row">还没有 Token 流水。</div>
        )}

        {tab === 'orders' && (
          rows.length ? (
            <table className="table">
              <thead><tr><th>订单号</th><th>金额 (USDT)</th><th>折合 CNY</th><th>Token</th><th>状态</th><th>创建时间</th><th>支付时间</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = STATUS[r.status] || { label: r.status, cls: '' }
                  return (
                    <tr key={r.id}>
                      <td className="mono">#{r.id}</td>
                      <td className="money">{r.amount_usdt?.toFixed(2)}</td>
                      <td className="money">¥{r.amount_cny.toFixed(2)}</td>
                      <td className="mono">{r.tokens}</td>
                      <td><span className={`chip ${s.cls}`}>{s.label}</span></td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtTime(r.created_at)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.paid_at ? fmtTime(r.paid_at) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <div className="empty-row">还没有充值订单。</div>
        )}
      </div>
    </div>
  )
}

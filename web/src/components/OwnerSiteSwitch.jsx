import { useEffect, useState } from 'react'
import { api, fmtTime } from '../api'

/**
 * 所有者专属的站点开关。
 *
 * 关站会影响所有访客，所以先弹一次确认；开启不需要确认。
 * 状态来自后端文件，命令行的 site_switch.py 改了之后刷新这里也能看到。
 */
export default function OwnerSiteSwitch() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/owner/site').then(setState).catch((e) => setError(e.message))
  }, [])

  async function toggle() {
    if (state.enabled && !window.confirm('关闭后所有访客都会看到维护页，确定关闭吗？')) return
    setBusy(true)
    setError('')
    try {
      const next = await api('/owner/site', {
        method: 'POST',
        body: { enabled: !state.enabled },
      })
      setState(next)
      window.dispatchEvent(new Event(next.enabled ? 'mx:site-on' : 'mx:site-off'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!state && !error) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div className="section-title">站点开关</div>
        <span className="spinner dark" style={{ display: 'inline-block' }} />
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div className="section-title">站点开关 · 仅所有者可见</div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="row" style={{ gap: 8 }}>
          <span className={`live-dot ${state?.enabled ? '' : 'warn'}`} />
          <b>{state?.enabled ? '站点运行中' : '站点已关闭'}</b>
        </span>
        <button
          className={`btn ${state?.enabled ? 'btn-ghost' : 'btn-primary'}`}
          onClick={toggle}
          disabled={busy}
          style={state?.enabled ? { border: '1px solid var(--border-strong)' } : undefined}
        >
          {busy ? '处理中…' : state?.enabled ? '关闭站点' : '开启站点'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        {state?.enabled
          ? '关闭后，除登录和健康检查外的所有接口都会返回 503，访客看到维护页。'
          : '访客当前看到维护页；开启后立即恢复，无需重启后端。'}
        {state?.updated_at && (
          <div style={{ marginTop: 6 }}>
            最近操作：{fmtTime(state.updated_at)}
            {state.updated_by ? ` · ${state.updated_by}` : ''}
          </div>
        )}
      </div>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api, fmtNum, fmtTime } from '../api'
import DecisionCard from '../components/DecisionCard'

const VERDICT = {
  long: { label: '看多', cls: 'chip-green' },
  short: { label: '看空', cls: 'chip-red' },
  wait: { label: '等待', cls: 'chip-amber' },
  avoid: { label: '回避', cls: '' },
}

export default function HistoryPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api(`/analysis/history?q=${encodeURIComponent(q.trim())}&limit=100`)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    load()
  }, [load])

  async function open(id) {
    setDetailLoading(true)
    setError('')
    try {
      const d = await api(`/analysis/${id}`)
      // 记录 id 与 payload 分开存：payload 是生成当时的快照，不含记录自身的主键
      setDetail({ id: d.id, card: d.payload })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('确定删除这条研究记录？')) return
    try {
      await api(`/analysis/${id}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((x) => x.id !== id))
      setTotal((t) => Math.max(0, t - 1))
    } catch (err) {
      setError(err.message)
    }
  }

  async function clearAll() {
    if (!window.confirm('确定清空全部研究历史？此操作不可恢复。')) return
    try {
      await api('/analysis', { method: 'DELETE' })
      setItems([])
      setTotal(0)
    } catch (err) {
      setError(err.message)
    }
  }

  // ------------------------------------------------------------ 详情视图
  if (detail) {
    return (
      <div className="container">
        <div className="spread" style={{ marginBottom: 16 }}>
          <button className="btn" onClick={() => setDetail(null)}>← 返回历史记录</button>
          <span className="muted" style={{ fontSize: 12.5 }}>记录 #{detail.id}</span>
        </div>
        <DecisionCard card={detail.card} />
      </div>
    )
  }

  return (
    <div className="container">
      <div className="hero" style={{ marginBottom: 18 }}>
        <h1>历史记录</h1>
        <p>每条记录保存的是生成当时的完整快照：价格、指标、结论与执行计划都不会随行情变化而改变。</p>
      </div>

      <div className="card list-card">
        <div className="list-head">
          <h2 style={{ margin: 0 }}>全部研究</h2>
          <span className="chip">{total} 条</span>
          <div className="grow" />
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索代码 / 周期 / 结论"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn" onClick={load}>刷新</button>
          <button className="btn btn-danger" onClick={clearAll} disabled={!items.length}>清空</button>
        </div>

        {error && <div className="error" style={{ margin: '14px 20px' }}>{error}</div>}

        {loading ? (
          <div className="empty-row"><span className="spinner dark" style={{ display: 'inline-block' }} /></div>
        ) : items.length === 0 ? (
          <div className="empty-row">还没有研究记录，回研究台生成第一张决策卡吧。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>周期</th>
                  <th>结论</th>
                  <th>当时价格</th>
                  <th>模型</th>
                  <th>生成时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const v = VERDICT[it.verdict] || { label: it.verdict, cls: '' }
                  return (
                    <tr key={it.id}>
                      <td>
                        <b>{it.symbol}</b>{' '}
                        <span className="muted" style={{ fontSize: 11.5 }}>标的</span>
                      </td>
                      <td className="mono">{it.interval}</td>
                      <td><span className={`chip ${v.cls}`}>{v.label}</span></td>
                      <td className="mono">{fmtNum(it.price, 2)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{it.model}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtTime(it.created_at)}</td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm" onClick={() => open(it.id)} disabled={detailLoading}>查看</button>
                          <button className="btn btn-sm btn-danger" onClick={() => remove(it.id)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

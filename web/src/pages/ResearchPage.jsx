import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtCompact, fmtNum, fmtPct } from '../api'
import { useAuth } from '../auth'
import DecisionCard from '../components/DecisionCard'
import LivePrice from '../components/LivePrice'
import Sparkline from '../components/Sparkline'

const INTERVALS = [
  { id: '15m', label: '15 分钟' },
  { id: '1h', label: '1 小时' },
  { id: '4h', label: '4 小时' },
  { id: '1d', label: '日线' },
]

// 首屏先给几个热门标的，行情列表还没回来时也能直接开跑
const HOT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']

// 前端轮询间隔。服务端报价缓存 2 秒，所以 3 秒能拿到新值；
// 页面切到后台时暂停请求，切回来立刻补一次，避免留下没必要的流量。
const TICK_MS = 3000
const CHART_MS = 20000

// 目录现在有上千个 USDT 对，一次全渲染会拖慢列表。
// 先显示成交额最高的一批，搜索和「显示更多」覆盖长尾。
const VISIBLE_STEP = 60
// 轮询上限：后端单次接受 300 个代码，再多就只更新前 300 个。
const POLL_LIMIT = 300

export default function ResearchPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [symbols, setSymbols] = useState([])
  const [total, setTotal] = useState(0)
  const [quotes, setQuotes] = useState({})
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('')
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP)
  const [selected, setSelected] = useState(null)
  // 注意：这里不能叫 interval/setInterval —— 会遮蔽全局定时器，
  // 后面轮询实时行情时调用 setInterval 就会变成调用 setState。
  const [timeframe, setTimeframe] = useState('1h')
  const [models, setModels] = useState([])
  const [model, setModel] = useState('auto')
  const [cost, setCost] = useState(10)
  const [liveAt, setLiveAt] = useState(null)
  const [liveSource, setLiveSource] = useState('')
  const [liveError, setLiveError] = useState('')

  const [chart, setChart] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)

  const [card, setCard] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  // 标的目录与模型列表只变一次，进页面时拉齐
  useEffect(() => {
    api('/market/symbols?market=crypto')
      .then((d) => {
        const items = d.items || []
        setSymbols(items)
        setTotal(d.total || items.length)
        // 目录里已经带了抓取时刻的价格，直接铺进报价表，
        // 首屏不用再等一次独立的 quotes 请求。
        const seed = {}
        for (const it of items) {
          if (it.price !== undefined) seed[it.symbol] = it
        }
        setQuotes((prev) => ({ ...prev, ...seed }))
      })
      .catch((e) => setError(e.message))
    api('/market/models')
      .then((d) => setModels(d.items || []))
      .catch(() => {})
    api('/analysis/cost')
      .then((d) => setCost(d.cost))
      .catch(() => {})
  }, [])

  // 分类菜单只列目录里真实存在的类别，避免出现空分类
  const sectors = useMemo(() => {
    const set = new Set()
    for (const s of symbols) if (s.sector) set.add(s.sector)
    return [...set]
  }, [symbols])

  const list = useMemo(() => {
    const q = search.trim().toUpperCase()
    return symbols.filter((s) => {
      if (sector && s.sector !== sector) return false
      return !q || s.symbol.includes(q) || s.name.toUpperCase().includes(q)
    })
  }, [symbols, search, sector])

  const visible = useMemo(() => list.slice(0, visibleCount), [list, visibleCount])
  // 只拉当前可见的币种：目录有上千个，全量轮询既没必要也浪费带宽
  const visibleKey = useMemo(
    () => visible.slice(0, POLL_LIMIT).map((s) => s.symbol).join(','),
    [visible],
  )

  // 改搜索词或分类后回到第一批，否则会停在「第 600 个结果」这种奇怪位置
  useEffect(() => {
    setVisibleCount(VISIBLE_STEP)
  }, [search, sector])

  // 实时报价：每 3 秒批量刷新当前可见的标的
  useEffect(() => {
    if (!visibleKey) return undefined
    const wanted = visibleKey.split(',')
    let cancelled = false

    async function tick() {
      if (document.hidden) return
      try {
        const d = await api(`/market/ticker?market=crypto&symbols=${wanted.join(',')}`)
        if (cancelled) return
        setQuotes((prev) => {
          const map = { ...prev }
          for (const it of d.items || []) map[it.symbol] = it
          return map
        })
        setLiveAt(new Date())
        setLiveSource(d.items?.[0]?.source_label || '')
        setLiveError(d.missing?.length ? `部分标的暂无报价：${d.missing.join(', ')}` : '')
      } catch (err) {
        if (!cancelled) setLiveError(err.message)
      }
    }

    tick()
    const timer = window.setInterval(tick, TICK_MS)
    // 从后台切回来时立刻补一次，不然要等下一个 3 秒
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [visibleKey])

  // 当前标的 K 线：20 秒重拉一次，实时价再叠加到最后一根上。
  // K 线接口走 20 秒缓存，比报价慢是刻意的——指标不需要每秒重算。
  useEffect(() => {
    if (!selected) return undefined
    let cancelled = false

    async function load() {
      setChartLoading(true)
      try {
        const d = await api(`/market/overview?symbol=${selected.symbol}&market=crypto&interval=${timeframe}`)
        if (!cancelled) setChart({ candles: d.candles || [], interval: timeframe })
      } catch {
        if (!cancelled) setChart(null)
      } finally {
        if (!cancelled) setChartLoading(false)
      }
    }

    load()
    const timer = window.setInterval(load, CHART_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selected, timeframe])

  // 目录回来前 selected 为空，回来后落到热门标的或列表第一项
  useEffect(() => {
    if (selected) return
    const hot = HOT.find((s) => symbols.some((x) => x.symbol === s))
    const next = symbols.find((s) => s.symbol === hot) || symbols[0] || null
    if (next) setSelected(next)
  }, [symbols, selected])

  async function run() {
    if (!selected || running) return
    // 研究消耗 Token，游客不能直接跑：跳登录页，登录后回到研究台继续。
    if (!user) {
      setError('请先登录后再开始 AI 研究（研究会消耗 Token）')
      navigate('/login', { state: { from: '/' } })
      return
    }
    setRunning(true)
    setError('')
    try {
      const data = await api('/analysis/run', {
        method: 'POST',
        body: { symbol: selected.symbol, market: 'crypto', interval: timeframe, model },
      })
      setCard(data.payload)
      // 顶栏余额依赖这个事件刷新，否则扣了 Token 用户看不到
      window.dispatchEvent(new Event('mx:refresh'))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const quote = selected ? quotes[selected.symbol] : null
  const up = (quote?.change_24h ?? 0) >= 0
  const lineColor = up ? '#087a55' : '#bc3550'

  // 把当前实时价接到 K 线最后一根上，走势图右端会随 3 秒轮询一起动
  const liveCandles = useMemo(() => {
    if (!chart?.candles?.length) return []
    if (!quote) return chart.candles
    const next = chart.candles.slice()
    const last = next[next.length - 1]
    next[next.length - 1] = [last[0], quote.price]
    return next
  }, [chart, quote])

  const cardDelta =
    card && selected && card.symbol === selected.symbol && quote?.price && card.price
      ? ((quote.price - card.price) / card.price) * 100
      : null

  const selectedInterval = INTERVALS.find((i) => i.id === timeframe)?.label

  return (
    <div className="container">
      <div className="hero">
        <div className="hero-top">
          <h1>让 AI 替你<em>读完行情</em>，再给结论。</h1>
          <div className={`hero-live ${liveError ? 'is-warn' : ''}`}>
            <span className="live-dot" />
            {liveError ? '行情连接异常' : `LIVE · ${liveSource || '连接中'} · ${TICK_MS / 1000}s`}
          </div>
        </div>
        <p>
          选择标的与周期，系统会拉取最新 K 线、计算技术指标与波动结构，输出方向判断、执行计划、
          关键价位和一份可直接执行的事件合约建议。每次消耗 {cost} Token。
        </p>
      </div>

      <div className="research-grid">
        {/* ------------------------------ 左侧控制台 ------------------------------ */}
        <aside className="card control-panel">
          <div className="section-title">
            标的 · USDT 永续
            <span className="title-count">{total} 个交易对</span>
          </div>

          <div className="symbol-filters">
            <input
              className="input"
              placeholder="搜索代码或名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="select sector-select"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              aria-label="按类别筛选"
            >
              <option value="">全部类别</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={`live-line ${liveError ? 'has-error' : ''}`}>
            <span className={`live-dot ${liveError ? 'warn' : ''}`} />
            {liveError ? (
              <span className="down">{liveError}</span>
            ) : (
              <>
                实时行情 · {liveSource || '连接中'}
                {liveAt && <span className="muted"> · {liveAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
              </>
            )}
          </div>

          <div className="symbol-list">
            {visible.map((s) => {
              const q = quotes[s.symbol]
              return (
                <button
                  key={s.symbol}
                  className={`symbol-item ${selected?.symbol === s.symbol ? 'active' : ''}`}
                  onClick={() => setSelected(s)}
                >
                  <span>
                    <div className="sym">{s.symbol}</div>
                    <div className="name">{s.name} · {s.sector}</div>
                  </span>
                  <span className="px" style={{ textAlign: 'right' }}>
                    <LivePrice value={q?.price} digits={2} className="px-num" />
                    <div className={(q?.change_24h ?? 0) >= 0 ? 'up' : 'down'} style={{ fontSize: 11 }}>
                      {q ? fmtPct(q.change_24h) : ''}
                    </div>
                  </span>
                </button>
              )
            })}
            {!visible.length && <div className="muted" style={{ padding: 16, fontSize: 12.5 }}>没有匹配的标的</div>}
            {list.length > visible.length && (
              <button
                className="show-more"
                onClick={() => setVisibleCount((v) => v + VISIBLE_STEP)}
              >
                显示更多 · 还有 {list.length - visible.length} 个
              </button>
            )}
          </div>

          <div className="field-row">
            <div>
              <label className="label">分析周期</label>
              <select className="select" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {INTERVALS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">研究模型</label>
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="run-box">
            <div className="spread" style={{ marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>当前标的</span>
              <b className="mono">{selected ? selected.symbol : '—'}</b>
            </div>
            <button
              className="btn btn-primary run-btn"
              onClick={run}
              disabled={running || !selected}
            >
              {running ? <><span className="spinner" /> 研究中…</> : `开始 AI 研究（${cost} Token）`}
            </button>
            <div className="tips">
              结果仅供学习与决策参考，不构成投资建议。系统不会连接交易所，也不会自动下单。
            </div>
          </div>
        </aside>

        {/* ------------------------------ 右侧结果区 ------------------------------ */}
        <section>
          {error && (
            <div className="source-warn" style={{ marginBottom: 16 }}>
              {error}
              {error.includes('Token') && <> · <Link to="/me" style={{ textDecoration: 'underline' }}>去充值</Link></>}
            </div>
          )}

          {/* 实时行情面板：不管有没有决策卡都显示，价格每 3 秒跳动 */}
          {selected && (
            <div className="card live-panel">
              <div className="lp-head">
                <div>
                  <div className="lp-symbol">
                    {selected.symbol}
                    <span>{selected.name}</span>
                    <span className="chip chip-lime">{selectedInterval}</span>
                  </div>
                  <div className="lp-meta">
                    {quote?.source_label || 'Gate.io'}
                    {liveAt && <> · 更新于 {liveAt.toLocaleTimeString('zh-CN', { hour12: false })}</>}
                    <span className="lp-cadence">每 {TICK_MS / 1000} 秒刷新</span>
                  </div>
                </div>
                <div className="lp-price">
                  <LivePrice value={quote?.price} digits={2} className="lp-num" />
                  <div className={`lp-chg ${up ? 'up' : 'down'}`}>
                    {quote ? fmtPct(quote.change_24h) : '—'}
                    <span>24H</span>
                  </div>
                </div>
              </div>

              <div className="lp-chart">
                {liveCandles.length >= 2 ? (
                  <Sparkline data={liveCandles} color={lineColor} height={118} showDot />
                ) : (
                  <div className="lp-chart-empty">
                    {chartLoading ? <span className="spinner dark" /> : 'K 线加载中…'}
                  </div>
                )}
              </div>

              <div className="lp-stats">
                <div>
                  <span>24H 最高</span>
                  <b>{quote ? fmtNum(quote.high_24h, 2) : '—'}</b>
                </div>
                <div>
                  <span>24H 最低</span>
                  <b>{quote ? fmtNum(quote.low_24h, 2) : '—'}</b>
                </div>
                <div>
                  <span>24H 成交额</span>
                  <b>{quote ? fmtCompact(quote.volume_24h) : '—'}</b>
                </div>
                <div>
                  <span>{cardDelta === null ? '研究时价' : '较研究时'}</span>
                  <b className={cardDelta === null ? '' : cardDelta >= 0 ? 'up' : 'down'}>
                    {cardDelta === null
                      ? (card && card.symbol === selected.symbol ? fmtNum(card.price, 2) : '—')
                      : `${cardDelta >= 0 ? '+' : ''}${cardDelta.toFixed(2)}%`}
                  </b>
                </div>
              </div>
            </div>
          )}

          {running && (
            <div className="card empty-state" style={{ marginTop: 18 }}>
              <div>
                <div className="spinner dark" style={{ margin: '0 auto 16px', width: 28, height: 28 }} />
                <h3>AI 正在研究 {selected?.symbol}</h3>
                <p>读取 K 线 → 计算指标 → 评估多周期 → 生成执行计划与风险预案，通常需要 2–8 秒。</p>
              </div>
            </div>
          )}

          {!running && card && (
            <div className="card-enter">
              <DecisionCard card={card} />
            </div>
          )}

          {!running && !card && (
            <div className="card empty-state" style={{ marginTop: 18 }}>
              <div>
                <div className="big">◈</div>
                <h3>选择标的，开始一次完整的 AI 研究</h3>
                <p>
                  右侧会生成一张决策卡：方向结论、信心拆解、开仓/止损/止盈、反向预案、
                  事件合约到期判断与技术快照。
                </p>
                {selected && (
                  <div className="row" style={{ justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
                    <span className="chip chip-lime">{selected.symbol} · {selected.name}</span>
                    {quote && <span className={`chip ${up ? 'chip-green' : 'chip-red'}`}>{fmtPct(quote.change_24h)}</span>}
                    <span className="chip">{selectedInterval}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

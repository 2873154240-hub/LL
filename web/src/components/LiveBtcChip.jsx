import { useEffect, useState } from 'react'
import { api, fmtPct } from '../api'
import LivePrice from './LivePrice'

/**
 * 顶栏的 BTC 实时报价。
 * 它同时承担两个作用：让用户在全站任何页面都能看到行情在动；
 * 也顺便验证行情链路是否健康（拿不到就显示「行情离线」而不是假装有数）。
 */
export default function LiveBtcChip() {
  const [quote, setQuote] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function tick() {
      if (document.hidden) return
      try {
        const d = await api('/market/ticker?market=crypto&symbols=BTCUSDT')
        if (cancelled) return
        setQuote(d.items?.[0] || null)
        setFailed(!d.items?.length)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    tick()
    const timer = window.setInterval(tick, 5000)
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (failed) {
    return (
      <div className="quote-chip quote-chip--offline" title="行情接口不可用">
        <span className="quote-sym">BTC</span>
        <span>行情离线</span>
      </div>
    )
  }

  const up = (quote?.change_24h ?? 0) >= 0

  return (
    <div className="quote-chip" title={quote ? `Gate.io · ${quote.price} USDT` : '加载中'}>
      <span className="quote-sym">BTC</span>
      <LivePrice value={quote?.price} digits={2} className="quote-price" />
      {quote && (
        <span className={`quote-chg ${up ? 'up' : 'down'}`}>{fmtPct(quote.change_24h)}</span>
      )}
    </div>
  )
}

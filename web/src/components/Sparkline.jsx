import { useId } from 'react'

/**
 * 迷你走势图。用 SVG 手绘而非引入图表库：
 * 只需要一条收盘价折线 + 渐变填充，d3/echarts 在这里是杀鸡用牛刀。
 *
 * 渐变 id 用 useId 生成：同页可能同时存在决策卡和实时行情两张图，
 * 写死 id 会让后渲染的那张复用第一张的渐变色。
 */
export default function Sparkline({ data = [], color = '#658408', height = 74, showDot = false }) {
  const rawId = useId()
  const gradientId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  if (!data || data.length < 2) return null

  const values = data.map((d) => d[1])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 600
  const h = height
  const pad = 4

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = pad + (1 - (v - min) / span) * (h - pad * 2)
    return [x, y]
  })

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `0,${h} ${line} ${w},${h}`
  const [lastX, lastY] = points[points.length - 1]

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="价格走势">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {showDot && (
        <circle cx={lastX} cy={lastY} r="4" fill={color} stroke="#f8f6ef" strokeWidth="2" vectorEffect="non-scaling-stroke">
          <animate attributeName="r" values="3.5;5;3.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}

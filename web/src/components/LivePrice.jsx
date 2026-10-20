import { useEffect, useRef, useState } from 'react'
import { fmtNum } from '../api'

/**
 * 实时价格数字。
 *
 * 价格每次变化时给一个 650ms 的涨/跌底色闪动，让用户能「看见」数据在更新——
 * 只靠数字变化，人眼很难注意到 0.01 的跳动。动画结束就移除 class，
 * 保证连续更新时不会积累一串未清理的定时器。
 */
export default function LivePrice({ value, digits = 2, className = '' }) {
  const prev = useRef(value)
  const [tick, setTick] = useState('')

  useEffect(() => {
    if (value === null || value === undefined) return undefined
    if (prev.current !== null && prev.current !== undefined && value !== prev.current) {
      setTick(value > prev.current ? 'tick-up' : 'tick-down')
      const timer = window.setTimeout(() => setTick(''), 650)
      prev.current = value
      return () => window.clearTimeout(timer)
    }
    prev.current = value
    return undefined
  }, [value])

  return (
    <span className={`live-price ${tick} ${className}`.trim()}>
      {fmtNum(value, digits)}
    </span>
  )
}

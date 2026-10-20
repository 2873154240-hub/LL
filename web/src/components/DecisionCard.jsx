import { fmtNum, fmtPct, fmtTime } from '../api'
import Sparkline from './Sparkline'

const CONF_LABEL = { high: '高信心', mid: '中信心', low: '低信心' }
const CYCLE_TONE = { 偏多: 'up', 偏空: 'down', 中性: 'muted', 分歧: 'muted' }

export default function DecisionCard({ card }) {
  const up = Number(card.change_24h) >= 0
  const color = up ? '#087a55' : '#bc3550'
  const plan = card.plan || {}
  const entry = plan.entry?.zone || []
  const levels = card.key_levels || { support: [], resistance: [] }
  const event = card.event_contract || {}
  const confidence = card.confidence || {}
  const isDirectional = plan.direction === 'long' || plan.direction === 'short'

  return (
    <article className="card decision-card">
      {/* ---------------- 头部：标的 / 价格 / 结论 ---------------- */}
      <div className="dc-head">
        <div className="dc-id">
          <div className="dc-symbol">
            <h2>{card.symbol}</h2>
            <span className="company">{card.name}</span>
            <span className="chip">{card.market_label}</span>
            <span className="chip">{card.sector}</span>
            <span className="chip">{card.interval}</span>
            <span className={`chip ${card.market_state?.open ? 'chip-green' : 'chip-amber'}`}>
              {card.market_state?.label}
            </span>
          </div>
          <div className="dc-price">
            <span className="num">{fmtNum(card.price, 2)}</span>
            <span className={`chg ${up ? 'up' : 'down'}`}>{fmtPct(card.change_24h)}</span>
            <span className="muted" style={{ fontSize: 12 }}>24H</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            行情源 {card.source_label || card.source}
            {card.quote_time ? `（${card.quote_time}）` : ''}
            {' · '}生成于 {fmtTime(card.generated_at)}
            {' · '}{card.narrative_by === 'llm' ? `LLM 润色（${card.model}）` : '规则引擎'}
          </div>
        </div>

        <div className="verdict-box">
          <div className={`verdict ${card.verdict}`}>{card.verdict_label}</div>
          <div style={{ marginTop: 8 }} className="muted">
            信心 {CONF_LABEL[confidence.level] || '—'} · 胜率估计{' '}
            <b className="mono">{Math.round((confidence.win_rate || 0) * 100)}%</b>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            维度一致度 {Math.round((confidence.agreement || 0) * 100)}%
          </div>
        </div>
      </div>

      {/* ---------------- 一句话结论 ---------------- */}
      <div className="headline">
        <span className="tag">核心结论</span>
        {card.headline}
      </div>

      <div className="dc-body">
        <div>
          <Sparkline data={card.candles} color={color} />
        </div>

        {/* ---------------- 执行计划 ---------------- */}
        <div className="panel">
          <div className="section-title">执行计划</div>
          <div style={{ fontSize: 13.5, marginBottom: 12, lineHeight: 1.6 }}>{plan.trigger}</div>

          <div className="plan-grid">
            <div className="plan-cell">
              <div className="k">{isDirectional ? '开仓区间' : '观察区间'}</div>
              <div className="v">{entry.length === 2 ? `${fmtNum(entry[0], 3)}–${fmtNum(entry[1], 3)}` : '—'}</div>
              <div className="s">{isDirectional ? '只在区间内分批介入' : '突破任一端再评估'}</div>
            </div>
            <div className="plan-cell">
              <div className="k">止损价</div>
              <div className="v">{fmtNum(plan.stop_loss?.price, 3)}</div>
              <div className="s">{plan.stop_loss?.percentage ? `${plan.stop_loss.percentage}%` : '—'}</div>
            </div>
            <div className="plan-cell">
              <div className="k">止盈（保守 / 激进）</div>
              <div className="v" style={{ fontSize: 13 }}>
                {fmtNum(plan.take_profit?.conservative, 3)} / {fmtNum(plan.take_profit?.aggressive, 3)}
              </div>
              <div className="s">分批止盈，不一次走完</div>
            </div>
            <div className="plan-cell">
              <div className="k">盈亏比</div>
              <div className="v">{plan.risk_reward ?? '—'}</div>
              <div className="s">低于 1.5 不建议参与</div>
            </div>
            <div className="plan-cell">
              <div className="k">建议杠杆</div>
              <div className="v">{plan.leverage ? `${plan.leverage}x` : '—'}</div>
              <div className="s">随波动率下降</div>
            </div>
            <div className="plan-cell">
              <div className="k">建议仓位</div>
              <div className="v">{plan.position_percentage ? `${plan.position_percentage}%` : '—'}</div>
              <div className="s">占总资金比例</div>
            </div>
            <div className="plan-cell">
              <div className="k">单笔风险</div>
              <div className="v">{plan.risk_per_trade_pct ? `${plan.risk_per_trade_pct}%` : '—'}</div>
              <div className="s">止损时的账户回撤</div>
            </div>
            <div className="plan-cell">
              <div className="k">结论失效</div>
              <div className="v" style={{ fontSize: 12, lineHeight: 1.4 }}>{plan.invalidation || '—'}</div>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
            入场条件：{plan.entry?.condition || '—'}
            <br />
            禁止开仓：{plan.no_trade_condition || '—'}
          </div>
        </div>

        {/* ---------------- 关键价位 + 分维度打分 ---------------- */}
        <div className="grid-2">
          <div className="panel">
            <div className="section-title">关键价位</div>
            <div className="level-list">
              {levels.resistance?.length ? (
                levels.resistance.map((l, i) => (
                  <div className="level-row" key={`r${i}`}>
                    <span>阻力 {i + 1}</span>
                    <span className="row">
                      <span className="price">{fmtNum(l.price, 3)}</span>
                      <span className={`strength ${l.strength}`}>{l.strength}</span>
                    </span>
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 12.5 }}>上方无明显阻力</div>
              )}
              <div className="level-row" style={{ background: 'transparent', borderTop: '1px dashed var(--border-default)' }}>
                <span className="muted">现价</span>
                <span className="price">{fmtNum(card.price, 3)}</span>
              </div>
              {levels.support?.length ? (
                levels.support.map((l, i) => (
                  <div className="level-row" key={`s${i}`}>
                    <span>支撑 {i + 1}</span>
                    <span className="row">
                      <span className="price">{fmtNum(l.price, 3)}</span>
                      <span className={`strength ${l.strength}`}>{l.strength}</span>
                    </span>
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 12.5 }}>下方无明显支撑</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="section-title">AI 信心评估</div>
            <div className="dims">
              {(confidence.breakdown || []).map((d) => (
                <div className="dim-row" key={d.name}>
                  <span>{d.name}</span>
                  <span className="dim-bar"><i style={{ width: `${d.score}%` }} /></span>
                  <span className="val">{d.score}</span>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
              50 为中性。分维度打分只表示该维度的方向倾向，不等于概率。
            </div>
          </div>
        </div>

        {/* ---------------- 理由 + 周期 ---------------- */}
        <div className="grid-2">
          <div className="panel">
            <div className="section-title">核心理由</div>
            <ul className="reason-list">
              {(card.reasons || []).map((r, i) => (
                <li key={i}>
                  <span className="w">{Math.round((r.weight || 0) * 100)}%</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <div className="section-title">周期共振</div>
            <div className="cycle-list">
              {(card.cycles || []).map((c) => (
                <div className="cycle" key={c.period}>
                  <div className="p">{c.period}</div>
                  <div className={`b ${CYCLE_TONE[c.bias] || ''}`}>{c.bias}</div>
                  <div className="c">置信 {Math.round((c.confidence || 0) * 100)}%</div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.6 }}>
              短中长周期方向一致时，趋势延续的概率更高；出现分歧说明当前不是好的介入点。
            </div>
          </div>
        </div>

        {/* ---------------- 反向预案 ---------------- */}
        {card.reverse_plan && (
          <div className="panel">
            <div className="section-title">反向预案</div>
            <div style={{ fontSize: 13.5, marginBottom: 10 }}>{card.reverse_plan.trigger}</div>
            <div className="plan-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="plan-cell">
                <div className="k">反向方向</div>
                <div className="v" style={{ fontSize: 14 }}>{card.reverse_plan.direction_label}</div>
              </div>
              <div className="plan-cell">
                <div className="k">反向入场区间</div>
                <div className="v" style={{ fontSize: 13 }}>
                  {card.reverse_plan.entry?.zone
                    ? card.reverse_plan.entry.zone.map((x) => fmtNum(x, 3)).join('–')
                    : '—'}
                </div>
              </div>
              <div className="plan-cell">
                <div className="k">反向止损 / 目标</div>
                <div className="v" style={{ fontSize: 13 }}>
                  {fmtNum(card.reverse_plan.stop_loss?.price, 3)} / {fmtNum(card.reverse_plan.take_profit?.conservative, 3)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 事件合约 ---------------- */}
        <div className="event-box">
          <div className="section-title">事件合约 · 到期判断</div>
          <div className="event-grid">
            <div className="event-cell">
              <div className="k">起始价</div>
              <div className="v">{fmtNum(event.anchor_price, 3)}</div>
            </div>
            <div className="event-cell">
              <div className="k">到期预期</div>
              <div className="v">{fmtNum(event.expiry_price, 3)}</div>
            </div>
            <div className="event-cell">
              <div className="k">到期区间</div>
              <div className="v" style={{ fontSize: 13 }}>
                {fmtNum(event.range?.low, 3)}–{fmtNum(event.range?.high, 3)}
              </div>
            </div>
            <div className="event-cell">
              <div className="k">AI 概率（涨 / 跌）</div>
              <div className="v" style={{ fontSize: 13 }}>
                {Math.round((event.probability?.up || 0) * 100)}% / {Math.round((event.probability?.down || 0) * 100)}%
              </div>
            </div>
            <div className="event-cell">
              <div className="k">执行建议</div>
              <div className="v" style={{ fontSize: 14 }}>{event.recommendation_label}</div>
            </div>
            <div className="event-cell">
              <div className="k">最高买价（点数）</div>
              <div className="v">{event.recommendation === 'none' ? '—' : event.max_buy_price}</div>
            </div>
            <div className="event-cell" style={{ gridColumn: 'span 2' }}>
              <div className="k">放弃条件</div>
              <div style={{ fontSize: 12, color: 'rgba(233,237,230,.8)', marginTop: 2 }}>{event.abandon_condition}</div>
            </div>
          </div>
          <div className="event-note">{event.settlement_rule}</div>
        </div>

        {/* ---------------- 风险 ---------------- */}
        <div className="panel">
          <div className="section-title">风险提示</div>
          <div className="risk-list">
            {(card.risks || []).map((r, i) => (
              <div className={`risk ${r.level}`} key={i}>{r.text}</div>
            ))}
          </div>
        </div>

        {/* ---------------- 技术快照 ---------------- */}
        <div className="panel">
          <div className="section-title">技术快照</div>
          <div className="evidence-grid">
            <div className="evidence-cell"><div className="k">MA5 / MA20</div><div className="v">{fmtNum(card.evidence?.ma5, 2)} / {fmtNum(card.evidence?.ma20, 2)}</div></div>
            <div className="evidence-cell"><div className="k">RSI(14)</div><div className="v">{card.evidence?.rsi ?? '—'}</div></div>
            <div className="evidence-cell"><div className="k">MACD 柱</div><div className="v">{card.evidence?.macd_hist ?? '—'}</div></div>
            <div className="evidence-cell"><div className="k">ADX(14)</div><div className="v">{card.evidence?.adx ?? '—'}</div></div>
            <div className="evidence-cell"><div className="k">ATR 占比</div><div className="v">{card.evidence?.atr_pct ?? '—'}%</div></div>
            <div className="evidence-cell"><div className="k">量比</div><div className="v">{card.evidence?.volume_ratio ?? '—'}</div></div>
            <div className="evidence-cell"><div className="k">30 日分位</div><div className="v">{card.evidence?.percentile_30d ?? '—'}%</div></div>
            <div className="evidence-cell"><div className="k">均线结构</div><div className="v" style={{ fontSize: 12.5 }}>{card.evidence?.trend ?? '—'}</div></div>
          </div>
        </div>

        <div className="disclaimer">{card.disclaimer}</div>
      </div>
    </article>
  )
}

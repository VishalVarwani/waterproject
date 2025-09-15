import PropTypes from 'prop-types'
import { useMemo, useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line } from 'recharts'
import { pearson, olsTrend } from '../utils/stats'

export default function ScatterMatrix({ rows, params, showTrend, pointAlpha }) {
  const [detail, setDetail] = useState(null) // {xParam,yParam,data}

  const grid = useMemo(() => {
    const map = {}
    for (let i = 0; i < params.length; i++) {
      for (let j = 0; j < params.length; j++) {
        const xP = params[i], yP = params[j]
        map[`${xP}|${yP}`] = rows
          .filter(r => r.parameter === xP || r.parameter === yP)
          .reduce((acc, r) => {
            const key = `${r.timestamp}|${r.sampling_point_id}`
            if (!acc._b[key]) acc._b[key] = { timestamp: r.timestamp, site: r.sampling_point_id }
            acc._b[key][r.parameter] = r.value
            return acc
          }, { _b: {} })
        map[`${xP}|${yP}`] = Object.values(map[`${xP}|${yP}`]._b).filter(d => Number.isFinite(d[xP]) && Number.isFinite(d[yP]))
      }
    }
    return map
  }, [rows, params])

  if (!params || params.length < 2) {
    return <div className="muted">Select ≥2 parameters to view the scatter matrix.</div>
  }

  const colsStyle = { gridTemplateColumns: `repeat(${params.length}, minmax(160px,1fr))` }

  return (
    <div className="analytics-card">
      <h3 className="section__title">Scatter Matrix</h3>

      <div className="scatter-matrix__grid" style={colsStyle}>
        {params.map(xP =>
          params.map(yP => {
            const data = grid[`${xP}|${yP}`] || []
            const { r } = corrFor(data, xP, yP)
            return (
              <button
                key={`${xP}-${yP}`}
                className="scatter-matrix__cell"
                onClick={() => setDetail({ xParam: xP, yParam: yP, data })}
                aria-label={`Open detail for ${xP} vs ${yP}`}
              >
                <SmallScatter data={data} xKey={xP} yKey={yP} showTrend={showTrend} pointAlpha={pointAlpha} />
                <div className="label" style={{ padding: '2px 6px' }}>
                  r {Number.isFinite(r) ? r.toFixed(2) : 'NA'}
                </div>
              </button>
            )
          })
        )}
      </div>

      {detail && (
        <div className="analytics-card" role="dialog" aria-label="Scatter detail">
          <div className="section__header">
            <h4 className="section__title">{detail.xParam} vs {detail.yParam}</h4>
            <button className="button button--ghost" onClick={() => setDetail(null)} aria-label="Close detail">Close</button>
          </div>
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={detail.xParam} />
                <YAxis dataKey={detail.yParam} />
                <Tooltip formatter={(v, n, p) => [v, n]} />
                <Scatter data={detail.data} fill="var(--primary)" fillOpacity={pointAlpha} />
                {showTrend && <TrendLine data={detail.data} xKey={detail.xParam} yKey={detail.yParam} />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function corrFor(data, xKey, yKey) {
  const xs = data.map(d => d[xKey])
  const ys = data.map(d => d[yKey])
  return pearson(xs, ys)
}

function TrendLine({ data, xKey, yKey }) {
  const xs = data.map(d => d[xKey])
  const ys = data.map(d => d[yKey])
  const { slope, intercept } = olsTrend(xs, ys)
  if (!Number.isFinite(slope)) return null
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const lineData = [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept }
  ]
  // Use <Line /> from recharts by mapping props to X/Y axes via dataKey.
  return (
    <Line
      type="linear"
      dataKey="y"
      data={lineData}
      xAxisId={0}
      yAxisId={0}
      dot={false}
      isAnimationActive={false}
      stroke="#6b7280"
    />
  )
}

function SmallScatter({ data, xKey, yKey, showTrend, pointAlpha }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <ScatterChart>
        <XAxis dataKey={xKey} hide />
        <YAxis dataKey={yKey} hide />
        <Scatter data={data} fill="var(--primary)" fillOpacity={pointAlpha} />
        {showTrend && <TrendLine data={data} xKey={xKey} yKey={yKey} />}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

ScatterMatrix.propTypes = {
  rows: PropTypes.array.isRequired,
  params: PropTypes.array.isRequired,
  showTrend: PropTypes.bool.isRequired,
  pointAlpha: PropTypes.number.isRequired
}

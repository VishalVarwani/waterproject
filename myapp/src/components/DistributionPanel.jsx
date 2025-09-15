import PropTypes from 'prop-types'
import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts'
import { histogram, mean } from '../utils/stats'

export default function DistributionPanel({ rows, params, unitByParam }) {
  const groups = useMemo(() => {
    const byP = new Map()
    for (const p of params) byP.set(p, [])
    for (const r of rows) {
      if (byP.has(r.parameter) && Number.isFinite(r.value)) {
        byP.get(r.parameter).push(Number(r.value))
      }
    }
    return Array.from(byP.entries()).map(([p, vals]) => ({ param: p, vals }))
  }, [rows, params])

  return (
    <div className="analytics-card">
      <h3 className="section__title">Distributions</h3>
      <div className="dist-grid">
        {groups.map(({ param, vals }) => (
          <div key={param} className="analytics-card">
            <h4 className="section__title" style={{ marginTop: 0 }}>{param} {unitByParam[param] ? `(${unitByParam[param]})` : ''}</h4>
            <ParamDistribution values={vals} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ParamDistribution({ values }) {
  const { bins, counts } = histogram(values, 16)
  const data = bins.map((b, i) => ({ x: b, y: counts[i] }))
  const mu = mean(values)
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="y" />
        </BarChart>
      </ResponsiveContainer>
      {Number.isFinite(mu) && (
        <div className="muted small">mean ≈ {mu.toFixed(2)}</div>
      )}
    </div>
  )
}

DistributionPanel.propTypes = {
  rows: PropTypes.array.isRequired,
  params: PropTypes.array.isRequired,
  unitByParam: PropTypes.object.isRequired
}

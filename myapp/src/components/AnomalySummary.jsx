import PropTypes from 'prop-types'
import { useMemo } from 'react'
import { objectsToCsv, downloadCsv } from '../utils/stats'
import { acceptableRanges } from '../utils/formatters'

export default function AnomalySummary({ rows, spById }) {
  // counts by parameter and by site
  const byParam = useMemo(() => {
    const agg = {}
    for (const r of rows) {
      if (!agg[r.parameter]) agg[r.parameter] = { ok:0, warn:0, outlier:0 }
      agg[r.parameter][r.flag || 'ok']++
    }
    return agg
  }, [rows])

  const bySite = useMemo(() => {
    const agg = {}
    for (const r of rows) {
      const name = spById[r.sampling_point_id]?.name || r.sampling_point_id
      if (!agg[name]) agg[name] = { ok:0, warn:0, outlier:0 }
      agg[name][r.flag || 'ok']++
    }
    return agg
  }, [rows, spById])

  const anomalies = rows.filter(r => r.flag === 'warn' || r.flag === 'outlier')
  const csv = objectsToCsv(anomalies.map(a => ({
    timestamp: a.timestamp,
    site: spById[a.sampling_point_id]?.name || a.sampling_point_id,
    parameter: a.parameter,
    value: a.value,
    unit: a.unit,
    flag: a.flag,
    rule: ruleText(a.parameter)
  })))

  return (
    <div className="analytics-card">
      <div className="section__header">
        <h3 className="section__title">Anomaly Summary</h3>
        <button className="button" onClick={() => downloadCsv('anomalies.csv', csv)}>
          Export Anomalies CSV
        </button>
      </div>

      <h4>By Parameter</h4>
      <MiniTable counts={byParam} />

      <h4>By Sampling Point</h4>
      <MiniTable counts={bySite} />
    </div>
  )
}

function ruleText(parameter) {
  const cfg = acceptableRanges[parameter]
  if (!cfg) return ''
  return `${parameter}: expected ${cfg.min}–${cfg.max} ${cfg.unit || ''}`.trim()
}

function MiniTable({ counts }) {
  const rows = Object.entries(counts)
  if (!rows.length) return <div className="muted">No data in range.</div>
  return (
    <div className="table-wrapper" style={{ marginTop: 8 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th><span className="badge badge--ok">OK</span></th>
            <th><span className="badge badge--warn">Warn</span></th>
            <th><span className="badge badge--out">Outlier</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, c]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{c.ok || 0}</td>
              <td>{c.warn || 0}</td>
              <td>{c.outlier || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

MiniTable.propTypes = { counts: PropTypes.object.isRequired }

AnomalySummary.propTypes = {
  rows: PropTypes.array.isRequired,
  spById: PropTypes.object.isRequired
}

import PropTypes from 'prop-types'
import { buildCorrelationMatrix, objectsToCsv, downloadCsv } from '../utils/stats'

/** Heatmap using plain CSS grid to avoid extra chart deps */
export default function CorrelationHeatmap({ rows, params, method }) {
  if (!params || params.length < 2) {
    return <div className="muted">Select at least two parameters to compute correlations.</div>
  }

  const { matrix, counts, order } = buildCorrelationMatrix(rows, params, method)

  const colorFor = (r) => {
    if (!Number.isFinite(r)) return 'var(--border)'
    // map [-1..1] to red → yellow → green → blue
    // simple piecewise; 0 = yellow
    const t = (r + 1) / 2 // 0..1
    // gradient stops approximated
    if (t < 0.33) return '#ef4444'
    if (t < 0.5) return '#eab308'
    if (t < 0.75) return '#10b981'
    return '#2563eb'
  }

  const csvRows = []
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      csvRows.push({
        param_i: order[i],
        param_j: order[j],
        r: Number.isFinite(matrix[i][j]) ? matrix[i][j].toFixed(4) : '',
        n: counts[i][j],
        method
      })
    }
  }

  const colStyle = { gridTemplateColumns: `auto ${order.length * 40}px` }

  return (
    <div className="analytics-card heatmap">
      <div className="section__header">
        <h3 className="section__title">Correlation Heatmap</h3>
        <button
          className="button"
          onClick={() => downloadCsv(`correlations_${method}.csv`, objectsToCsv(csvRows))}
          aria-label="Download correlation matrix as CSV"
        >
          Download CSV
        </button>
      </div>

      <div className="heatmap__grid" style={colStyle} role="table" aria-label="Correlation heatmap">
        {/* left header column */}
        <div />
        <div style={{ display:'grid', gridTemplateColumns: `repeat(${order.length},40px)` }}>
          {order.map(p => (
            <div key={`top-${p}`} className="label" style={{ textAlign:'center' }}>{p}</div>
          ))}
        </div>

        {/* rows */}
        {order.map((rowName, i) => (
          <FragmentRow key={rowName} rowName={rowName} row={matrix[i]} counts={counts[i]} params={order} colorFor={colorFor} />
        ))}
      </div>

      <div className="heatmap__legend">
        <span className="label">Method:</span> <span className="badge">{method}</span>
        <div className="spacer"></div>
        <span className="label">Strength</span>
        <div className="heatmap__swatch" aria-hidden="true"></div>
      </div>
    </div>
  )
}

function FragmentRow({ rowName, row, counts, params, colorFor }) {
  return (
    <>
      <div className="label" style={{ alignSelf:'center' }}>{rowName}</div>
      <div style={{ display:'grid', gridTemplateColumns: `repeat(${params.length},40px)` }}>
        {row.map((r, j) => (
          <div
            key={`${rowName}-${params[j]}`}
            className="heatmap__cell"
            title={`${rowName} vs ${params[j]}: r=${Number.isFinite(r)?r.toFixed(3):'NA'} (n=${counts[j]})`}
            style={{ background: colorFor(r) }}
            role="cell"
            aria-label={`${rowName} vs ${params[j]} correlation ${Number.isFinite(r)?r.toFixed(2):'NA'}`}
          >
            <span>{Number.isFinite(r) ? r.toFixed(2) : ''}</span>
          </div>
        ))}
      </div>
    </>
  )
}

CorrelationHeatmap.propTypes = {
  rows: PropTypes.array.isRequired,
  params: PropTypes.array.isRequired,
  method: PropTypes.oneOf(['pearson','spearman']).isRequired
}

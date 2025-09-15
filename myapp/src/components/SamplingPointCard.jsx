// src/components/SamplingPointCard.jsx
import PropTypes from 'prop-types'

const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')
const SAFETY_TEXT = { safe: 'Safe', warn: 'Warn', unsafe: 'Unsafe', unknown: '—', na: '—' }

export default function SamplingPointCard({
  name,
  pointId,
  stats,
  latest,
  unit,
  onClick,
  safety = 'unknown',
  safetyHint = '',
}) {
  const badgeText = SAFETY_TEXT[safety] ?? '—'
  const badgeClass = `badge badge--${safety}` // style via CSS: .badge--safe / --warn / --unsafe / --unknown

  return (
    <button
      className="card card--point"
      onClick={onClick}
      aria-label={`Filter by ${name}`}
      title={safetyHint || undefined}
    >
      <div className="card__header">
        <h3 className="card__title">{name}</h3>
        <span className={badgeClass} aria-label={`Safety: ${badgeText}`}>
          {badgeText}
        </span>
      </div>

      <div className="card__content">
        {stats ? (
          <ul className="kpi-list">
            <li>
              <span className="kpi-label">Min</span>
              <span className="kpi-value">{fmt(stats.min)} {unit || ''}</span>
            </li>
            <li>
              <span className="kpi-label">Mean</span>
              <span className="kpi-value">{fmt(stats.mean)} {unit || ''}</span>
            </li>
            <li>
              <span className="kpi-label">Max</span>
              <span className="kpi-value">{fmt(stats.max)} {unit || ''}</span>
            </li>
          </ul>
        ) : (
          <p className="muted">No data in range</p>
        )}
      </div>

      <div className="card__footer">
        <span className="muted small">
          {latest && Number.isFinite(latest.value)
            ? `Latest: ${fmt(latest.value)} ${unit || ''}`
            : '—'}
        </span>
        {safetyHint ? (
          <span className="muted small" style={{ marginLeft: 8 }}>
            {safetyHint}
          </span>
        ) : null}
      </div>
    </button>
  )
}

SamplingPointCard.propTypes = {
  name: PropTypes.string.isRequired,
  pointId: PropTypes.string.isRequired,
  stats: PropTypes.shape({
    min: PropTypes.number,
    mean: PropTypes.number,
    max: PropTypes.number,
  }),
  latest: PropTypes.object,
  unit: PropTypes.string,
  onClick: PropTypes.func.isRequired,
  /** one of: 'safe' | 'warn' | 'unsafe' | 'unknown' | 'na' */
  safety: PropTypes.string,
  /** optional tooltip-ish text like "chlorophyll_a · 10–50 µg/L" */
  safetyHint: PropTypes.string,
}

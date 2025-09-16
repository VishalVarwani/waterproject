import PropTypes from 'prop-types'

export default function KpiStrip({ kpis }) {
  return (
    <div className="kpi-strip" role="region" aria-label="KPIs">
      {/* <div className="kpi-card">
        <div className="kpi-card__label">Records</div>
        <div className="kpi-card__value">{kpis.total}</div>
      </div> */}
      <div className="kpi-card kpi-card--ok">
        <div className="kpi-card__label">OK</div>
        <div className="kpi-card__value">{kpis.oks}</div>
      </div>
      <div className="kpi-card kpi-card--warn">
        <div className="kpi-card__label">Missing Values</div>
        <div className="kpi-card__value">{kpis.warns}</div>
      </div>
      <div className="kpi-card kpi-card--alert">
        <div className="kpi-card__label">Out-of-range</div>
        <div className="kpi-card__value">{kpis.alerts}</div>
      </div>
      {/* <div className="kpi-card">
        <div className="kpi-card__label">Mean Temp</div>
        <div className="kpi-card__value">
          {kpis.meanTemp != null ? `${kpis.meanTemp.toFixed(2)} °${kpis.tempUnit}` : '—'}
        </div>
      </div> */}
    </div>
  )
}

KpiStrip.propTypes = {
  kpis: PropTypes.shape({
    total: PropTypes.number,
    oks: PropTypes.number,
    warns: PropTypes.number,
    alerts: PropTypes.number,
    meanTemp: PropTypes.number,
    tempUnit: PropTypes.oneOf(['C','F'])
  }).isRequired
}

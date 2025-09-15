import PropTypes from 'prop-types'

const ALL = '__ALL__'

export default function Filters({
  samplingPoints,
  parameters,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  selectedPoints,
  setSelectedPoints,
  selectedParams,
  setSelectedParams,
  tempUnit,
  setTempUnit,
  onReset
}) {
  // Include "__ALL__" as selected when everything is selected, so the UI reflects it.
  const allPointIds = samplingPoints.map(sp => sp.id)
  const allParams = parameters.slice()

  const pointsAllSelected = allPointIds.length > 0 && selectedPoints.length === allPointIds.length
  const paramsAllSelected = allParams.length > 0 && selectedParams.length === allParams.length

  const pointsValue = pointsAllSelected ? [ALL, ...selectedPoints] : selectedPoints
  const paramsValue = paramsAllSelected ? [ALL, ...selectedParams] : selectedParams

  const handleMultiSelect = (e, setter, allValues) => {
    const picked = Array.from(e.target.selectedOptions).map(o => o.value)
    if (picked.includes(ALL)) {
      // If "All" was chosen, select every value
      setter(allValues.slice())
    } else {
      setter(picked)
    }
  }

  return (
    <div className="filters">
      <div className="filters__group" role="group" aria-labelledby="date-range-label">
        <div id="date-range-label" className="label">Date range</div>
        <div className="filters__row">
          <label className="label" htmlFor="dateFrom">From</label>
          <input
            id="dateFrom"
            className="input"
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
          />
        </div>
        <div className="filters__row">
          <label className="label" htmlFor="dateTo">To</label>
          <input
            id="dateTo"
            className="input"
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
          />
        </div>
      </div>

      <div className="filters__group" role="group" aria-labelledby="points-label">
        <div id="points-label" className="label">Sampling points</div>
        <select
          className="select select--multi"
          multiple
          value={pointsValue}
          onChange={(e)=>handleMultiSelect(e, setSelectedPoints, allPointIds)}
          aria-multiselectable="true"
          aria-label="Select sampling points"
        >
          <option value={ALL}>(All sampling points)</option>
          {samplingPoints.map(sp => (
            <option key={sp.id} value={sp.id}>{sp.name}</option>
          ))}
        </select>
      </div>

      <div className="filters__group" role="group" aria-labelledby="params-label">
        <div id="params-label" className="label">Parameters</div>
        <select
          className="select select--multi"
          multiple
          value={paramsValue}
          onChange={(e)=>handleMultiSelect(e, setSelectedParams, allParams)}
          aria-multiselectable="true"
          aria-label="Select parameters"
        >
          <option value={ALL}>(All parameters)</option>
          {parameters.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      

      <button className="button button--ghost" onClick={onReset} aria-label="Reset filters">
        Reset filters
      </button>
    </div>
  )
}

Filters.propTypes = {
  samplingPoints: PropTypes.array.isRequired,
  parameters: PropTypes.array.isRequired,
  dateFrom: PropTypes.string.isRequired,
  dateTo: PropTypes.string.isRequired,
  onDateFrom: PropTypes.func.isRequired,
  onDateTo: PropTypes.func.isRequired,
  selectedPoints: PropTypes.array.isRequired,
  setSelectedPoints: PropTypes.func.isRequired,
  selectedParams: PropTypes.array.isRequired,
  setSelectedParams: PropTypes.func.isRequired,
  tempUnit: PropTypes.oneOf(['C','F']).isRequired,
  setTempUnit: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired
}

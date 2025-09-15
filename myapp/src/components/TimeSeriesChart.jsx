import PropTypes from 'prop-types'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Brush, CartesianGrid, Legend, ResponsiveContainer
} from 'recharts'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'

const COLORS = [
  '#2563eb', '#059669', '#f59e0b', '#ef4444', '#a855f7',
  '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ec4899'
]

export default function TimeSeriesChart({ seriesByParam, tempUnit, focusParam }) {
  const [hidden, setHidden] = useStateSet(new Set())

  // When primary parameter changes, clear legend hidden state
  useEffect(() => { setHidden(new Set()) }, [focusParam])

  // Narrow to the focused param if provided
  const activeSeries = useMemo(() => {
    if (focusParam) {
      if (seriesByParam[focusParam]) {
        return { [focusParam]: seriesByParam[focusParam] }
      }
      return {} // nothing for this param
    }
    return seriesByParam
  }, [seriesByParam, focusParam])

  const allPoints = mergeSeries(activeSeries)
  const legendItems = Object.keys(activeSeries)

  const toggleSeries = (key) => {
    const next = new Set(hidden)
    if (hidden.has(key)) next.delete(key)
    else next.add(key)
    setHidden(next)
  }

  return (
    <div className="chart-card" role="region" aria-label="Time series chart">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={allPoints}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(t) => dayjs(t).format('MM-DD')}
            minTickGap={24}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(t) => dayjs(t).format('YYYY-MM-DD HH:mm')}
          />
          <Legend
            onClick={(e) => toggleSeries(e.value)}
            wrapperStyle={{ cursor: 'pointer' }}
          />
          {Object.entries(activeSeries).map(([param, entries], idx) => (
            hidden.has(param) ? null : (
              <Line
                key={param}
                type="monotone"
                dataKey={param}
                dot={false}
                stroke={COLORS[idx % COLORS.length]}
                isAnimationActive={false}
              />
            )
          ))}
          <Brush dataKey="timestamp" height={24} travellerWidth={8} />
        </LineChart>
      </ResponsiveContainer>

      <div className="legend-toggles" aria-label="Legend toggles">
        {legendItems.map((p, idx) => (
          <button
            key={p}
            className={`chip chip--legend ${hidden.has(p) ? 'chip--muted' : ''}`}
            onClick={() => toggleSeries(p)}
            aria-pressed={!hidden.has(p)}
          >
            <span className="chip__swatch" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></span>
            {p}{p === 'temperature' ? ` (°${tempUnit})` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

TimeSeriesChart.propTypes = {
  seriesByParam: PropTypes.object.isRequired,
  tempUnit: PropTypes.oneOf(['C','F']).isRequired,
  focusParam: PropTypes.string, // ← new optional prop
}

/** Merge param series into a single array with keys paramName=value for each timestamp */
function mergeSeries(seriesByParam) {
  const byTime = {}
  Object.entries(seriesByParam).forEach(([param, arr]) => {
    arr.forEach(m => {
      const t = m.timestamp
      if (!byTime[t]) byTime[t] = { timestamp: t }
      byTime[t][param] = m.value
    })
  })
  return Object.values(byTime).sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp))
}

function useStateSet(initial) {
  const [setObj, setSetObj] = useState(initial)
  const set = (next) => setSetObj(new Set(next))
  return [setObj, set]
}

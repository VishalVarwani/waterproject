// src/pages/Analytics.jsx
import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  ScatterChart, Scatter,
  ComposedChart,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts'
import '../styles/analytics.css'

const POINTS = ['P1', 'P2', 'P3', 'P4', 'P5']

function corrColor(v) {
  const x = Math.max(-1, Math.min(1, Number(v) || 0))
  if (x < -0.33) return '#ef4444'
  if (x < 0)     return '#f59e0b'
  if (x < 0.66)  return '#10b981'
  return '#2563eb'
}

function makeDummyCorr(labels) {
  const n = labels.length
  const m = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let v
      if (i === j) v = 1
      else {
        const a = labels[i], b = labels[j]
        if ((a === 'temperature' && b === 'dissolved_oxygen') || (a === 'dissolved_oxygen' && b === 'temperature')) {
          v = -0.62
        } else if ((a === 'turbidity' && b === 'rainfall') || (a === 'rainfall' && b === 'turbidity')) {
          v = 0.58
        } else if ((a === 'conductivity' && b === 'nitrate') || (a === 'nitrate' && b === 'conductivity')) {
          v = 0.44
        } else if ((a === 'ph' && b === 'conductivity') || (a === 'conductivity' && b === 'ph')) {
          v = 0.18
        } else {
          v = (Math.random() - 0.5) * 0.4
        }
      }
      m[i][j] = v
      m[j][i] = v
    }
  }
  return { labels, matrix: m }
}

function makeSeries(days = 30) {
  const out = []
  for (let d = 0; d < days; d++) {
    const date = `Day ${d + 1}`
    const rainPulse = Math.max(0, Math.sin((d + 2) / 4) * 20 + (Math.random() * 6))
    const temp = 14 + Math.sin(d / 5) * 6 + Math.random() * 0.8
    const dox = 9.5 - (temp - 14) * 0.25 + (Math.random() - 0.5) * 0.4
    const turb = Math.max(1, rainPulse * 1.2 + (Math.random() * 3))
    const ph = 7.2 + Math.sin(d / 20) * 0.15 + (Math.random() - 0.5) * 0.05
    const cond = 250 + (Math.sin(d / 6) * 40) + Math.random() * 8
    const nitrate = 0.8 + Math.max(0, Math.sin((d + 1) / 7)) * 0.7 + Math.random() * 0.1
    const solar = Math.max(0, 250 + Math.sin(d / 5) * 200 + Math.random() * 30)
    const wind = 3 + Math.abs(Math.sin(d / 3)) * 2 + Math.random() * 0.6

    out.push({
      date, rainfall: Number(rainPulse.toFixed(1)),
      temperature: Number(temp.toFixed(2)),
      dissolved_oxygen: Number(dox.toFixed(2)),
      turbidity: Number(turb.toFixed(1)),
      ph: Number(ph.toFixed(2)),
      conductivity: Number(cond.toFixed(0)),
      nitrate: Number(nitrate.toFixed(2)),
      solar: Number(solar.toFixed(0)),
      wind: Number(wind.toFixed(1)),
    })
  }
  return out
}

function makeSpatial(pts = POINTS) {
  return pts.map((p, i) => ({
    point: p,
    turbidity: Math.round(10 + i * 7 + Math.random() * 8),
    nitrate: Number((0.6 + i * 0.15 + Math.random() * 0.2).toFixed(2)),
    temperature: Number((14 + i * 0.6 + Math.random()).toFixed(1)),
  }))
}

function makeAnomalyCounts() {
  const params = ['temperature','dissolved_oxygen','turbidity','nitrate','ph','conductivity']
  return params.map(p => ({
    parameter: p,
    ok: Math.round(40 + Math.random() * 80),
    warns: Math.round(4 + Math.random() * 10),
    alerts: Math.round(2 + Math.random() * 7),
  }))
}

function makeLagCorr(days = 9) {
  const lags = []
  for (let k = -days; k <= days; k++) {
    const base = Math.exp(-(k * k) / 12)
    const sign = k > 0 ? 1 : (k < 0 ? -1 : 0)
    const noise = (Math.random() - 0.5) * 0.08
    lags.push({ lag: k, corr: Number((0.6 * base * (sign >= 0 ? 1 : 0.8) + noise).toFixed(2)) })
  }
  return lags
}

function makeFeatureImportance() {
  return [
    { name: 'Rainfall', score: 0.34 },
    { name: 'Temperature', score: 0.27 },
    { name: 'Conductivity', score: 0.18 },
    { name: 'Nitrate', score: 0.12 },
    { name: 'Wind', score: 0.09 },
  ]
}

function makeBeforeAfter() {
  const before = Array.from({ length: 7 }, (_, i) => ({ day: `D-${7 - i}`, turbidity: Math.round(8 + Math.random() * 4) }))
  const after = Array.from({ length: 7 }, (_, i) => ({ day: `D+${i + 1}`, turbidity: Math.round(20 + Math.random() * 8) }))
  return { before, after }
}

function makeSeasonal() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months.map((m, i) => ({
    month: m,
    chl_a: Number((4 + Math.sin((i/12)*Math.PI*2) * 3 + Math.random()).toFixed(1)),
    turbidity: Number((10 + Math.sin((i/12)*Math.PI*2 + 0.7) * 6 + Math.random()).toFixed(1)),
  }))
}

export default function Analytics() {
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [granularity, setGranularity] = useState('daily')

  const timeSeries = useMemo(() => makeSeries(30), [])
  const corr = useMemo(() => makeDummyCorr(['temperature','dissolved_oxygen','turbidity','nitrate','ph','conductivity']), [])
  const spatial = useMemo(makeSpatial, [])
  const anomalyCounts = useMemo(makeAnomalyCounts, [])
  const lagCorr = useMemo(makeLagCorr, [])
  const feat = useMemo(makeFeatureImportance, [])
  const seasonal = useMemo(makeSeasonal, [])
  const scenario = useMemo(makeBeforeAfter, [])

  const indicators = useMemo(() => ([
    { key: 'WQI', label: 'Water Quality Index', value: 78, trend: '+3.2%' },
    { key: 'TRIX', label: 'TRIX (trophic)', value: 4.2, trend: '-0.3' },
    { key: 'TSI', label: 'Carlson TSI', value: 52, trend: '+1.1' },
    { key: 'ABRI', label: 'Algal Bloom Risk Index', value: 0.32, trend: 'stable' },
  ]), [])

  const narrative = useMemo(() =>
    `Turbidity spikes follow rainfall events within ~1–2 days. Dissolved oxygen ` +
    `shows an inverse relation with temperature across the period. P3 and P4 ` +
    `show higher turbidity and nitrate relative to other sites. A storm scenario ` +
    `illustrates elevated turbidity in the week after the event; seasonal patterns ` +
    `suggest higher chlorophyll-a in late summer.`
  , [])

  return (
    <div className="analytics page page--pad">
      <div className="analytics__toolbar" role="toolbar" aria-label="Analytics options">
        <div className="toolbar__group">
          <span className="label">Correlation method</span>
          <select className="select" value={corrMethod} onChange={(e)=> setCorrMethod(e.target.value)}>
            <option value="pearson">Pearson</option>
            <option value="spearman">Spearman</option>
          </select>
        </div>
        <div className="toolbar__group">
          <span className="label">Time</span>
          <select className="select" value={granularity} onChange={(e)=> setGranularity(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="seasonal">Seasonal</option>
          </select>
        </div>
      </div>

      <section className="section">
        <h2 className="section__title">Synthetic Indicators</h2>
        <div className="indicators">
          {indicators.map(ind => (
            <div key={ind.key} className="indicator-card">
              <div className="indicator-card__top">
                <div className="indicator-card__label">{ind.label}</div>
                <div className="badge">{ind.trend}</div>
              </div>
              <div className="indicator-card__value">
                {ind.key === 'ABRI' ? (ind.value * 100).toFixed(0) + '%' : ind.value}
              </div>
              <div className="indicator-bar">
                <div className="indicator-bar__fill" style={{ width: `${Math.min(100, ind.key === 'ABRI' ? ind.value * 100 : ind.value)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Correlation Heatmap</h2>
        <div className="analytics-card heatmap">
          <div className="heatmap__row heatmap__row--header">
            <div className="heatmap__corner" />
            {corr.labels.map(l => <div key={'h-'+l} className="heatmap__head">{l}</div>)}
          </div>
          {corr.matrix.map((row, i) => (
            <div key={'r-'+i} className="heatmap__row">
              <div className="heatmap__side">{corr.labels[i]}</div>
              {row.map((v, j) => (
                <div
                  key={'c-'+i+'-'+j}
                  className="heatmap__cell"
                  title={`${corr.labels[i]} vs ${corr.labels[j]}: ${v.toFixed(2)} (${corrMethod})`}
                  style={{ background: corrColor(v) }}
                >
                  <span className="heatmap__val">{v.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="heatmap__legend">
            <span className="label">-1</span>
            <span className="heatmap__swatch" />
            <span className="label">+1</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Drivers &amp; Causal Factors</h2>
        <div className="two-col">
          <div className="analytics-card">
            <div className="card-title">Turbidity vs Rainfall</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" hide />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="right" dataKey="rainfall" name="Rainfall (mm)" fill="#2563eb" />
                <Line yAxisId="left" type="monotone" dataKey="turbidity" name="Turbidity (NTU)" stroke="#f59e0b" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="analytics-card">
            <div className="card-title">Dissolved Oxygen vs Temperature</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" hide />
                <YAxis yAxisId="left" label={{ value: 'DO (mg/L)', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'Temp (°C)', angle: -90, position: 'insideRight' }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="dissolved_oxygen" name="DO (mg/L)" stroke="#10b981" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="temperature" name="Temp (°C)" stroke="#2563eb" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="analytics-card" style={{ marginTop: '16px' }}>
          <div className="card-title">Climate context (Solar, Wind)</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="solar" name="Solar (W/m²)" fill="#2563eb" stroke="#2563eb" fillOpacity={0.15} />
              <Line yAxisId="right" type="monotone" dataKey="wind" name="Wind (m/s)" stroke="#10b981" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Spatial Variation (by Monitoring Point)</h2>
        <div className="analytics-card">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={spatial}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="point" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="turbidity" name="Turbidity (NTU)" fill="#2563eb" />
              <Bar dataKey="nitrate" name="Nitrate (mg/L)" fill="#f59e0b" />
              <Bar dataKey="temperature" name="Temp (°C)" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Temporal Patterns (Seasonal)</h2>
        <div className="analytics-card">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={seasonal}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="chl_a" name="Chl-a (µg/L)" stroke="#2563eb" dot={false} />
              <Line type="monotone" dataKey="turbidity" name="Turbidity (NTU)" stroke="#f59e0b" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Anomaly Detection</h2>
        <div className="analytics-card">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={anomalyCounts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="parameter" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="ok" name="OK" fill="#10b981" />
              <Bar dataKey="warns" name="Warnings" fill="#f59e0b" />
              <Bar dataKey="alerts" name="Alerts" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chips">
          <span className="badge badge--safe">Auto outlier flagging</span>
          <span className="badge badge--warn">Out-of-range detection</span>
          <span className="badge badge--out">Missing data surfacing</span>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Causality &amp; Prediction</h2>
        <div className="two-col">
          <div className="analytics-card">
            <div className="card-title">Lag correlation (Nitrate → Turbidity)</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lagCorr}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="lag" />
                <YAxis domain={[-1, 1]} />
                <Tooltip />
                <Legend />
                <ReferenceLine y={0} stroke="#aaa" />
                <Line type="monotone" dataKey="corr" name="Correlation" stroke="#2563eb" dot />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="analytics-card">
            <div className="card-title">Prediction drivers (feature importance)</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={feat} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 1]} />
                <YAxis type="category" dataKey="name" />
                <Tooltip />
                <Bar dataKey="score" name="Importance" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Scenario Comparison</h2>
        <div className="two-col">
          <div className="analytics-card">
            <div className="card-title">Before → After storm (Turbidity)</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={[...scenario.before, ...scenario.after]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line dataKey="turbidity" name="Turbidity (NTU)" stroke="#2563eb" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="analytics-card">
            <div className="card-title">Sites comparison (Avg Turbidity)</div>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="category" dataKey="point" />
                <YAxis dataKey="turbidity" />
                <ZAxis range={[60, 180]} dataKey="nitrate" />
                <Tooltip />
                <Legend />
                <Scatter name="Sites" data={spatial} fill="#f59e0b" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Automated Narrative</h2>
        <div className="analytics-card narrative">
          {narrative}
        </div>
      </section>
    </div>
  )
}

// Fixed: use ComposedChart when mixing Bar + Line

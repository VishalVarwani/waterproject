import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
dayjs.extend(minMax)

import Header from './components/Header.jsx'
import Filters from './components/Filters.jsx'
import KpiStrip from './components/KpiStrip.jsx'
import TimeSeriesChart from './components/TimeSeriesChart.jsx'
import ParameterTable from './components/ParameterTable.jsx'
import SamplingPointCard from './components/SamplingPointCard.jsx'
import MapView from './components/MapView.jsx'
import { convertTemperature, acceptableRanges, toLocalISODate } from './utils/formatters.js'
import Talk2Csv from './pages/Talk2Csv.jsx'

import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Analytics from './pages/Analytics.jsx'
import Login from './pages/Login.jsx'
import { FiltersContext } from './utils/filtersContext.js'
import { AuthContext } from './utils/authContext.jsx'
import Ingestion from './pages/Ingestion.jsx'
import Datasets from './pages/Datasets.jsx'
import Parameters from './pages/Parameters.jsx'
import AlgaeBloomWatch from './components/AlgaeBloomWatch.jsx'
import { BLOOM_CODES, pickLevelByCode, latestForPointAndParam, levelToSafety } from './utils/bloom'
import { api } from './utils/api'

const SHOW_MAP = true

function ProtectedRoute({ user, children }) {
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return children
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem('auth_user')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const login = (u) => {
    setUser(u)
    try { sessionStorage.setItem('auth_user', JSON.stringify(u)) } catch {}
  }
  const logout = () => {
    setUser(null)
    try { sessionStorage.removeItem('auth_user') } catch {}
    if (window.location.pathname !== '/login') window.location.assign('/login')
  }

  useEffect(() => {
    const handleUnload = () => { try { sessionStorage.removeItem('auth_user') } catch {} }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  const [datasets, setDatasets] = useState([])
  const [datasetId, setDatasetId] = useState(() => sessionStorage.getItem('datasetId') || '')
  const [rawRows, setRawRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedPoints, setSelectedPoints] = useState([])
  const [selectedParams, setSelectedParams] = useState(['temperature','ph','dissolved_oxygen','turbidity','nitrate'])
  const [tempUnit, setTempUnit] = useState('C')
  const [darkMode, setDarkMode] = useState(false)
  const [primaryParam, setPrimaryParam] = useState('temperature')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!user?.client_id) { setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await api.listDatasets(user.client_id)
        if (cancelled) return
        const items = res.items || []
        setDatasets(items)
        if (!datasetId && items.length) setDatasetId(items[0].dataset_id)
      } catch (e) {
        if (!cancelled) setError(String(e.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [user?.client_id])

  useEffect(() => {
    if (datasetId) sessionStorage.setItem('datasetId', datasetId)
  }, [datasetId])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!user?.client_id || !datasetId) return
      setLoading(true); setError(null)
      try {
        const res = await api.fetchMeasurements({ clientId: user.client_id, datasetId })
        if (cancelled) return
        const FLAG_ID_TO_CODE = { 0: 'ok', 1: 'out_of_range', 2: 'missing', 3: 'outlier' }
        const rows = (res.data || []).map(r => {
          const flagId = r?.quality_flag_id == null ? null : Number(r.quality_flag_id)
          const parameterCode = String((r.parameter_code ?? r.parameter ?? '')).toLowerCase()
          return {
            timestamp: r.ts,
            sampling_point_id: r.sampling_point || '',
            parameter: parameterCode,
            parameter_display: r.parameter_display || r.parameter,
            value: r.value,
            unit: r.unit ?? '',
            lat: r.lat ?? null,
            lon: r.lon ?? null,
            quality_flag_id: flagId,
            flag: flagId != null ? FLAG_ID_TO_CODE[flagId] : null,
          }
        })
        setRawRows(rows)

        const ts = rows.map(m => dayjs(m.timestamp)).filter(t => t.isValid())
        const min = ts.length ? dayjs.min(ts) : dayjs().subtract(30, 'day')
        const max = ts.length ? dayjs.max(ts) : dayjs()
        setDateFrom(min.format('YYYY-MM-DD'))
        setDateTo(max.format('YYYY-MM-DD'))

        const pts = Array.from(new Set(rows.map(m => m.sampling_point_id).filter(Boolean)))
        setSelectedPoints(pts)

        const paramsPresent = Array.from(new Set(rows.map(m => m.parameter).filter(Boolean)))
        if (paramsPresent.length) {
          if (paramsPresent.includes('temperature')) {
            const next = ['temperature', ...paramsPresent.filter(p => p !== 'temperature')].slice(0, 6)
            setSelectedParams(next)
            setPrimaryParam('temperature')
          } else {
            setSelectedParams(paramsPresent.slice(0, 6))
            setPrimaryParam(paramsPresent[0])
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [user?.client_id, datasetId])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const samplingPointsList = useMemo(() => {
    const map = new Map()
    for (const m of rawRows) {
      const id = m.sampling_point_id
      if (!id) continue
      if (!map.has(id)) {
        map.set(id, { id, name: id, lat: m.lat ?? null, lon: m.lon ?? null })
      } else {
        const p = map.get(id)
        if (p.lat == null && m.lat != null) p.lat = m.lat
        if (p.lon == null && m.lon != null) p.lon = m.lon
      }
    }
    return Array.from(map.values())
  }, [rawRows])

  const availableParams = useMemo(() => {
    const s = new Set(rawRows.map(r => r.parameter))
    const arr = Array.from(s)
    return arr.length ? arr : ['temperature','ph','dissolved_oxygen','turbidity','nitrate']
  }, [rawRows])

  const filteredMeasurements = useMemo(() => {
    if (!rawRows.length) return []
    const start = dateFrom ? dayjs(dateFrom).startOf('day') : null
    const end = dateTo ? dayjs(dateTo).endOf('day') : null

    return rawRows
      .filter(m => selectedPoints.includes(m.sampling_point_id))
      .filter(m => selectedParams.includes(m.parameter))
      .filter(m => {
        const t = dayjs(m.timestamp)
        if (start && t.isBefore(start)) return false
        if (end && t.isAfter(end)) return false
        return true
      })
      .map(m => {
        if (m.parameter === 'temperature') {
          const val = convertTemperature(m.value, m.unit, tempUnit)
          return { ...m, value: val, unit: tempUnit === 'C' ? '°C' : '°F' }
        }
        return { ...m }
      })
  }, [rawRows, dateFrom, dateTo, selectedPoints, selectedParams, tempUnit])

  const unfilteredMeasurements = useMemo(() => {
    return rawRows.map(m => {
      if (m.parameter === 'temperature') {
        const val = convertTemperature(m.value, m.unit, tempUnit)
        return { ...m, value: val, unit: tempUnit === 'C' ? '°C' : '°F' }
      }
      return m
    })
  }, [rawRows, tempUnit])

  const paramNameByCode = useMemo(() => {
    const map = {}
    for (const r of rawRows) {
      if (r.parameter && r.parameter_display) map[r.parameter] = r.parameter_display
    }
    return map
  }, [rawRows])

  const lastUpdated = useMemo(() => {
    if (!rawRows.length) return null
    const latest = rawRows.reduce((a, b) => (dayjs(a.timestamp).isAfter(b.timestamp) ? a : b))
    return latest.timestamp
  }, [rawRows])

  const onResetFilters = () => {
    if (!rawRows.length) return
    const timestamps = rawRows.map(m => dayjs(m.timestamp)).filter(t => t.isValid())
    const min = dayjs.min(timestamps)
    const max = dayjs.max(timestamps)
    setDateFrom(min.format('YYYY-MM-DD'))
    setDateTo(max.format('YYYY-MM-DD'))
    setSelectedPoints(samplingPointsList.map(sp => sp.id))

    const params = Array.from(new Set(rawRows.map(r => r.parameter))).filter(Boolean)
    setSelectedParams(params.slice(0, 6))
    setTempUnit('C')
    setPrimaryParam(params.includes('temperature') ? 'temperature' : (params[0] || 'temperature'))
  }

  const seriesByParam = useMemo(() => {
    const map = {}
    unfilteredMeasurements.forEach(m => {
      const key = m.parameter
      if (!map[key]) map[key] = []
      map[key].push(m)
    })
    Object.values(map).forEach(arr => arr.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)))
    return map
  }, [unfilteredMeasurements])

  const statsByPointAll = useMemo(() => {
    const byPoint = {}
    unfilteredMeasurements
      .filter(m => m.parameter === primaryParam)
      .forEach(m => {
        if (!byPoint[m.sampling_point_id]) byPoint[m.sampling_point_id] = []
        if (m.value != null) byPoint[m.sampling_point_id].push(Number(m.value))
      })
    const res = {}
    Object.entries(byPoint).forEach(([pid, vals]) => {
      if (!vals.length) return
      vals.sort((a,b) => a-b)
      const min = vals[0]
      const max = vals[vals.length - 1]
      const mean = vals.reduce((a,b) => a+b, 0) / vals.length
      res[pid] = { min, max, mean }
    })
    return res
  }, [unfilteredMeasurements, primaryParam])

  // NEW: status map for map markers ('safe' | 'warn' | 'unsafe')
  const statusById = useMemo(() => {
    const rank = { alert: 3, watch: 2, ok: 1, na: 0 }
    const map = {}
    for (const sp of samplingPointsList) {
      let worstLevel = 'na'
      for (const code of BLOOM_CODES) {
        const last = latestForPointAndParam(unfilteredMeasurements, sp.id, code)
        const lvl = pickLevelByCode(code, last?.value)?.level || 'na'
        if (rank[lvl] > rank[worstLevel]) worstLevel = lvl
      }
      map[sp.id] = levelToSafety(worstLevel) // -> 'safe' | 'warn' | 'unsafe'
    }
    return map
  }, [unfilteredMeasurements, samplingPointsList])

  const kpis = useMemo(() => {
    const total = filteredMeasurements.length
    const toId = (m) => m?.quality_flag_id == null ? null : Number(m.quality_flag_id)
    const oks    = filteredMeasurements.filter(m => toId(m) === 0).length
    const warns  = filteredMeasurements.filter(m => toId(m) === 2).length
    const alerts = filteredMeasurements.filter(m => toId(m) === 1).length

    const tempVals = filteredMeasurements
      .filter(m => m.parameter === 'temperature' && m.value != null)
      .map(m => Number(m.value))
    const meanTemp = tempVals.length ? tempVals.reduce((a, b) => a + b, 0) / tempVals.length : null

    return { total, oks, warns, alerts, meanTemp, tempUnit }
  }, [filteredMeasurements, tempUnit])

  const spById = useMemo(() => {
    const map = {}
    samplingPointsList.forEach(sp => { map[sp.id] = sp })
    return map
  }, [samplingPointsList])

  const handleSelectPoint = (pointId) => {
    setSelectedPoints([pointId])
  }

  const dailyAggregates = useMemo(() => [], [])

  const ctxValue = {
    rawData: { sampling_points: samplingPointsList, measurements: rawRows },
    unfilteredMeasurements,
    filteredMeasurements,
    dailyAggregates,
    spById,
    dateFrom, dateTo, selectedPoints, selectedParams, tempUnit,
    setDateFrom, setDateTo, setSelectedPoints, setSelectedParams, setTempUnit,
    datasets, datasetId, setDatasetId,
  }

  const datasetToolbar = (
    datasets.length > 1 && (
      <div className="toolbar" style={{ padding: '8px 16px' }}>
        {/* dataset selector intentionally hidden here */}
      </div>
    )
  )

  const content = loading ? (
    <div className="page page--center"><span className="loader" aria-busy="true" aria-label="Loading">Loading…</span></div>
  ) : error ? (
    <div className="page page--center" role="alert">{error}</div>
  ) : (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <div className="layout">
              <aside className="filters-panel" aria-label="Filters">
                <Filters
                  samplingPoints={samplingPointsList}
                  parameters={availableParams}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFrom={setDateFrom}
                  onDateTo={setDateTo}
                  selectedPoints={selectedPoints}
                  setSelectedPoints={setSelectedPoints}
                  selectedParams={selectedParams}
                  setSelectedParams={setSelectedParams}
                  tempUnit={tempUnit}
                  setTempUnit={setTempUnit}
                  onReset={onResetFilters}
                />
                {datasetToolbar}
              </aside>

              <main className="content" aria-live="polite">
                <KpiStrip kpis={kpis} />

                {SHOW_MAP && (
                  <section className="section">
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)',
                        gap: 16,
                      }}
                    >
                      {/* Left: Map */}
                      <div>
                        <h2 className="section__title">Map</h2>
                        <MapView
                          points={samplingPointsList}
                          statusById={statusById}   
                          onSelectPoint={handleSelectPoint}
                        />
                      </div>

                      {/* Right: Sampling Points */}
                      <div>
                        <h2 className="section__title">Sampling Points</h2>
                        <div
                          className="card-grid"
                          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
                        >
                          {samplingPointsList.map(sp => {
                            const stats = statsByPointAll[sp.id]
                            const latest = unfilteredMeasurements
                              .filter(m => m.sampling_point_id === sp.id && m.parameter === primaryParam && m.value != null)
                              .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))[0]

                            const rank = { alert: 3, watch: 2, ok: 1, na: 0 }
                            let worst = { level: 'na', code: null, msg: '—' }
                            for (const code of BLOOM_CODES) {
                              const last = latestForPointAndParam(unfilteredMeasurements, sp.id, code)
                              const lvl  = pickLevelByCode(code, last?.value)
                              if (rank[lvl.level] > rank[worst.level]) worst = { level: lvl.level, code, msg: lvl.msg }
                            }
                            const safety = levelToSafety(worst.level)
                            const safetyHint = worst.code ? `${worst.code} · ${worst.msg}` : 'No recent readings'

                            return (
                              <SamplingPointCard
                                key={sp.id}
                                name={sp.name}
                                pointId={sp.id}
                                latest={latest}
                                unit={
                                  latest
                                    ? latest.unit
                                    : (primaryParam === 'temperature'
                                          ? (tempUnit === 'C' ? '°C' : '°F')
                                          : acceptableRanges[primaryParam]?.unit || '')
                                }
                                onClick={() => handleSelectPoint(sp.id)}
                                safety={safety}
                                safetyHint={safetyHint}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <AlgaeBloomWatch />

                {/* Time Series section currently hidden per your last edit */}

                <section className="section">
                  <h2 className="section__title">Measurements Table</h2>
                  <ParameterTable
                    measurements={filteredMeasurements}
                    spById={spById}
                  />
                </section>
              </main>
            </div>
          </ProtectedRoute>
        }
      />
      <Route path="/analytics" element={<ProtectedRoute user={user}><Analytics /></ProtectedRoute>} />
      <Route path="/ingestion" element={<ProtectedRoute user={user}><Ingestion /></ProtectedRoute>} />
      <Route path="/datasets" element={<ProtectedRoute user={user}><Datasets /></ProtectedRoute>} />
      <Route path="/parameters" element={<ProtectedRoute user={user}><Parameters /></ProtectedRoute>} />
      <Route path="/talk2csv" element={<ProtectedRoute user={user}><Talk2Csv /></ProtectedRoute>} />
      <Route path="*" element={user ? <Navigate to="/" replace /> : <Navigate to="/login" replace />} />
    </Routes>
  )

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <FiltersContext.Provider value={ctxValue}>
        <div className="page">
          {user && (
            <Header
              title="Physical Water-Quality Monitoring"
              lastUpdated={lastUpdated ? toLocalISODate(lastUpdated) : null}
              darkMode={darkMode}
              onToggleDark={() => setDarkMode(d => !d)}
            />
          )}
          {content}
        </div>
      </FiltersContext.Provider>
    </AuthContext.Provider>
  )
}

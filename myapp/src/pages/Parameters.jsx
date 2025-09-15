import { useContext, useEffect, useMemo, useState } from "react"
import dayjs from "dayjs"
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"

import { AuthContext } from "../utils/authContext.jsx"
import { FiltersContext } from "../utils/filtersContext.js"
import { api } from "../utils/api"
import "../styles/parameters.css"

/** === Local vocab (must match backend codes) === */
const PHYSICAL = [
  "temperature","turbidity","conductivity","secchi_depth","photic_zone_depth","reservoir_level","color_real"
]
const CHEMICAL = [
  "ph","nitrate","nitrite","chloride","sulfate","potassium","ammonium","phosphate","suva",
  "redox","dissolved_oxygen","uv_absorbance","carbon_dioxide","toc","total_phosphorus","total_nitrogen","organic_nitrogen","fluoride"
]
const BIO = [
  "chlorophyll_a","chlorophyll","total_cyanobacteria","total_eukaryotic_algae","cryptomonas","diatoms","ceratium",
  "peridinium","dynobryon","aphanizomenon","e_coli","microcystins","pheopigments","eudorina_pandorina",
  "staurastrum","woronochinia","dolichospermum"
]

/** Small helpers */
const fmtDate = (iso) => dayjs(iso).format("YYYY-MM-DD")
const rangeToFrom = (latestISO, mode) => {
  const end = latestISO ? dayjs(latestISO) : dayjs()
  if (mode === "1M") return { from: end.subtract(1, "month").startOf("day").toISOString(), to: end.toISOString() }
  if (mode === "6M") return { from: end.subtract(6, "month").startOf("day").toISOString(), to: end.toISOString() }
  if (mode === "1Y") return { from: end.subtract(1, "year").startOf("day").toISOString(), to: end.toISOString() }
  return { from: "", to: "" } // Max = no bounds
}

export default function Parameters() {
  const { user } = useContext(AuthContext)
  const filters = useContext(FiltersContext) || {}
  const datasetId =
    (filters && filters.datasetId) ||
    localStorage.getItem("datasetId") ||
    ""

  // raw rows already loaded on Dashboard (via FiltersContext)
  const rawRows = (filters?.rawData?.measurements) || []

  // latest timestamp in currently loaded rows (fallback now)
  const latestTs = useMemo(() => {
    if (!rawRows.length) return null
    const latest = rawRows.reduce((a,b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b))
    return latest.timestamp
  }, [rawRows])

  // Set of parameters present in dataset (drives enabled circles)
  const presentParams = useMemo(() => new Set(rawRows.map(r => r.parameter)), [rawRows])

  // Latest value per parameter (for the circle number)
  const latestByParam = useMemo(() => {
    const map = {}
    for (const r of rawRows) {
      const key = r.parameter
      if (!key) continue
      if (!map[key] || new Date(r.timestamp) > new Date(map[key].timestamp)) {
        map[key] = r
      }
    }
    return map
  }, [rawRows])

  // UI state
  const [range, setRange] = useState("6M")
  const [sel, setSel] = useState({ physical: "", chemical: "", bio: "" })
  const [series, setSeries] = useState({ physical: [], chemical: [], bio: [] })
  const [loadingKey, setLoadingKey] = useState("") // for spinner per chart
  const [error, setError] = useState("")

  // Click handler: fetch a parameter’s series into its category
  const handlePick = async (category, param) => {
    if (!user?.client_id || !datasetId || !param) return
    setSel(s => ({ ...s, [category]: param }))
    setLoadingKey(category)
    setError("")
    try {
      const { from, to } = rangeToFrom(latestTs, range)
      const res = await api.fetchMeasurements({
        clientId: user.client_id,
        datasetId,
        parameter: param,
        from,
        to,
      })
      // Transform to {timestamp,value,unit,point}
      const rows = (res.data || []).map(d => ({
        timestamp: d.ts,
        value: d.value,
        unit: d.unit || "",
        point: d.sampling_point || "",
      }))
      // (Optional) simple daily aggregate: average by day
      const byDay = new Map()
      for (const r of rows) {
        const day = (r.timestamp || "").slice(0,10) + "T00:00:00Z"
        if (!byDay.has(day)) byDay.set(day, { sum: 0, n: 0, any: r })
        const o = byDay.get(day); o.sum += (Number(r.value) || 0); o.n += 1
      }
      const agg = Array.from(byDay.entries()).map(([t,o]) => ({
        timestamp: t,
        value: o.n ? o.sum / o.n : null,
        unit: o.any.unit,
      })).sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp))

      setSeries(s => ({ ...s, [category]: agg }))
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoadingKey("")
    }
  }

  // Default select a sensible parameter after initial load
  useEffect(() => {
    if (!sel.physical && presentParams.has("temperature")) handlePick("physical","temperature")
    if (!sel.chemical && presentParams.has("ph")) handlePick("chemical","ph")
    if (!sel.bio && presentParams.has("chlorophyll_a")) handlePick("bio","chlorophyll_a")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentParams.size, datasetId])

  const dateRangeText = useMemo(() => {
    const { from, to } = rangeToFrom(latestTs, range)
    if (!from && !to) return "Max range"
    return `${fmtDate(from)} → ${fmtDate(to || new Date().toISOString())}`
  }, [range, latestTs])

  return (
    <div className="params__page">
      <div className="params__toolbar">
        <h2 className="params__title">Parameters</h2>
        <div className="params__controls">
          <RangeTabs value={range} onChange={setRange} />
          <span className="params__range">{dateRangeText}</span>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <Section
        title="Physical"
        items={PHYSICAL}
        present={presentParams}
        latestByParam={latestByParam}
        selected={sel.physical}
        onPick={(param)=>handlePick("physical", param)}
      />
      <ChartBlock
        loading={loadingKey==="physical"}
        param={sel.physical}
        data={series.physical}
      />

      <Section
        title="Chemical"
        items={CHEMICAL}
        present={presentParams}
        latestByParam={latestByParam}
        selected={sel.chemical}
        onPick={(param)=>handlePick("chemical", param)}
      />
      <ChartBlock
        loading={loadingKey==="chemical"}
        param={sel.chemical}
        data={series.chemical}
      />

      <Section
        title="Biological"
        items={BIO}
        present={presentParams}
        latestByParam={latestByParam}
        selected={sel.bio}
        onPick={(param)=>handlePick("bio", param)}
      />
      <ChartBlock
        loading={loadingKey==="bio"}
        param={sel.bio}
        data={series.bio}
      />
    </div>
  )
}

/** ------- Local, file-scoped mini components ------- */

function Section({ title, items, present, latestByParam, selected, onPick }) {
  return (
    <section className="params__section">
      <h3 className="params__sectionTitle">{title}</h3>
      <div className="params__grid">
        {items.map(code => {
          const has = present.has(code)
          const latest = latestByParam[code]
          const val = (latest && Number.isFinite(latest.value)) ? Number(latest.value).toFixed(1) : "—"
          const unit = latest?.unit || ""
          return (
            <button
              key={code}
              className={
                "params__circle" +
                (selected === code ? " is-active" : "") +
                (!has ? " is-disabled" : "")
              }
              onClick={() => has && onPick(code)}
              title={code}
              aria-pressed={selected === code}
              disabled={!has}
            >
              <div className="params__circleValue">{val}</div>
              <div className="params__circleUnit">{unit}</div>
              <div className="params__circleLabel">{code}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ChartBlock({ loading, param, data }) {
  return (
    <div className="params__chartCard" role="region" aria-label={`${param || "no"} time series`}>
      <div className="params__chartHeader">
        <strong>{param ? `${param} — time series` : "Select a parameter"}</strong>
      </div>
      {!param ? (
        <div className="params__empty">No parameter selected.</div>
      ) : loading ? (
        <div className="params__empty">Loading…</div>
      ) : data.length === 0 ? (
        <div className="params__empty">No data in range.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={(t)=>dayjs(t).format("MM/DD")} minTickGap={24}/>
            <YAxis />
            <Tooltip
              labelFormatter={(t)=>dayjs(t).format("YYYY-MM-DD")}
              formatter={(v, _k, p)=>[Number(v).toFixed(3), (p?.payload?.unit || "")]}
            />
            <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function RangeTabs({ value, onChange }) {
  const opts = ["1M","6M","1Y","Max"]
  return (
    <div className="params__tabs" role="tablist" aria-label="Time range">
      {opts.map(opt => (
        <button
          key={opt}
          role="tab"
          aria-selected={value===opt}
          className={"params__tab" + (value===opt ? " is-active" : "")}
          onClick={()=>onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

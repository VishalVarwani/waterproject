// src/components/AlgaeBloomWatch.jsx
import dayjs from 'dayjs'
import { useContext, useMemo } from 'react'
import { FiltersContext } from '../utils/filtersContext'
import { BLOOM_RULES, BLOOM_CODES, pickLevelByCode } from '../utils/bloom'

// Fallback labels/units if your BLOOM_RULES doesn't include them
const LABEL_FALLBACK = {
  total_cyanobacteria: 'Cyanobacteria',
  chlorophyll_a: 'Chlorophyll-a',
  microcystins: 'Microcystins',
  ph: 'pH',
}
const UNIT_FALLBACK = {
  total_cyanobacteria: 'cells/mL',
  chlorophyll_a: 'µg/L',
  microcystins: 'µg/L',
  ph: '',
}

// Find latest row by parameter code (works with either {parameter} or {parameter_code})
function latestByCode(rows, code) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const pool = rows
    .map(r => {
      const v = r.value == null ? NaN : Number(r.value)
      const ts = r.ts ?? r.timestamp ?? r.time ?? r.date ?? null
      const point = r.sampling_point ?? r.sampling_point_id ?? r.site ?? null
      const unit = r.unit ?? r.standard_unit ?? ''
      const pcode = (r.parameter_code ?? r.parameter ?? '').toLowerCase()
      return { v, ts, point, unit, pcode }
    })
    .filter(r => (r.pcode === code) && Number.isFinite(r.v))

  if (!pool.length) return null

  const withTs = pool.filter(r => !!r.ts)
  const latest = (withTs.length ? withTs : pool)
    .sort((a, b) => {
      if (!a.ts && !b.ts) return 0
      if (!a.ts) return 1
      if (!b.ts) return -1
      return new Date(b.ts) - new Date(a.ts)
    })[0]

  return { value: latest.v, ts: latest.ts || null, unit: latest.unit, point: latest.point }
}

export default function AlgaeBloomWatch() {
  const ctx = useContext(FiltersContext)

  // Base unfiltered dataset rows
  const base =
    ctx?.unfilteredMeasurements ??
    ctx?.rawData?.measurements ??
    ctx?.filteredMeasurements ??
    []

  // ✅ Respect only the Sampling Point filter
  const selectedPoints = new Set(ctx?.selectedPoints || [])
  const data = useMemo(() => {
    if (!selectedPoints.size) return base
    return base.filter(r => {
      const sp = r.sampling_point ?? r.sampling_point_id ?? r.site ?? ''
      return selectedPoints.has(sp)
    })
  }, [base, selectedPoints])

  const items = useMemo(() => {
    return BLOOM_CODES.map(code => {
      const rule = BLOOM_RULES[code] || {}
      const latest = latestByCode(data, code)
      const lvl = latest ? pickLevelByCode(code, latest.value) : { level: 'na', msg: '—' }
      const label = rule.label || LABEL_FALLBACK[code] || code
      const unit  = rule.unit  || UNIT_FALLBACK[code]  || ''
      return {
        key: code,
        label,
        unit,
        value: latest?.value ?? null,
        when: latest?.ts ? dayjs(latest.ts).format('YYYY-MM-DD HH:mm') : null,
        point: latest?.point ?? null,
        level: lvl.level,
        hint: lvl.msg,
      }
    })
  }, [data])

  const worst = useMemo(() => {
    const rank = { alert: 3, watch: 2, ok: 1, na: 0 }
    return items.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a), { level: 'na' })
  }, [items])

  return (
    <section className="section" aria-label="Algae Bloom Watch">
      <div className="section__header">
        <h2 className="section__title">Algae Bloom Watch</h2>
        <div className={`ab-banner ab-banner--${worst.level}`}>
          {worst.level === 'alert' && 'High risk conditions detected'}
          {worst.level === 'watch' && 'Elevated bloom indicators'}
          {worst.level === 'ok' && 'All indicators within expected ranges'}
          {worst.level === 'na' && 'No recent readings'}
        </div>
      </div>

      <div className="ab-grid">
        {items.map(it => (
          <div key={it.key} className={`ab-card ab-card--${it.level}`} role="group" aria-label={it.label}>
            <div className="ab-circle">
              <div className="ab-value">
                {it.value == null ? '—' : Number(it.value).toFixed(2)}
              </div>
              <div className="ab-unit">{it.unit}</div>
            </div>
            <div className="ab-meta">
              <div className="ab-label">{it.label}</div>
              <div className="ab-hint">
                {it.level === 'na' ? 'no recent data' : `${it.level.toUpperCase()} · ${it.hint}`}
              </div>
              {it.when && (
                <div className="ab-sub">
                  {it.point ? `${it.point} · ` : ''}{it.when}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

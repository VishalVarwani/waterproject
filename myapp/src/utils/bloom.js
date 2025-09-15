// src/utils/bloom.js
export const BLOOM_RULES = {
  total_cyanobacteria: {
    unit: 'cells/mL',
    label: 'Cyanobacteria',
    bands: [
      { level: 'ok',    test: v => v < 2000,                 msg: '< 2,000 cells/mL' },
      { level: 'watch', test: v => v >= 2000 && v <= 100000, msg: '2k–100k cells/mL' },
      { level: 'alert', test: v => v > 100000,               msg: '> 100k cells/mL' },
    ],
  },
  chlorophyll_a: {
    unit: 'µg/L',
    label: 'Chlorophyll-a',
    bands: [
      { level: 'ok',    test: v => v < 10,                   msg: '< 10 µg/L' },
      { level: 'watch', test: v => v >= 10 && v <= 50,       msg: '10–50 µg/L' },
      { level: 'alert', test: v => v > 50,                   msg: '> 50 µg/L' },
    ],
  },
  microcystins: {
    unit: 'µg/L',
    label: 'Microcystins',
    bands: [
      { level: 'ok',    test: v => v < 1,                    msg: '< 1 µg/L' },
      { level: 'watch', test: v => v >= 1 && v <= 10,        msg: '1–10 µg/L' },
      { level: 'alert', test: v => v > 10,                   msg: '> 10 µg/L' },
    ],
  },
  ph: {
    unit: '',
    label: 'pH',
    bands: [
      { level: 'alert', test: v => v < 6 || v > 9.5,         msg: '< 6 or > 9.5' },
      { level: 'watch', test: v => (v >= 6 && v < 6.5) || (v > 9 && v <= 9.5), msg: '6–6.5 or 9–9.5' },
      { level: 'ok',    test: v => v >= 6.5 && v <= 9,       msg: '6.5–9' },
    ],
  },
}

export const BLOOM_CODES = ['total_cyanobacteria','chlorophyll_a','microcystins','ph']

export function pickLevelByCode(code, v) {
  const rules = BLOOM_RULES[code]
  if (v == null || !Number.isFinite(Number(v)) || !rules) return { level: 'na', msg: '—' }
  for (const b of rules.bands) if (b.test(Number(v))) return { level: b.level, msg: b.msg }
  return { level: 'na', msg: '—' }
}

export function latestForPointAndParam(rows, pointId, code) {
  const r = (rows || [])
    .filter(m => m.sampling_point_id === pointId && (m.parameter === code || m.parameter_code === code))
    .filter(m => Number.isFinite(Number(m.value)))
    .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0]
  return r ? { value: Number(r.value), when: r.timestamp } : null
}

export function levelToSafety(level) {
  if (level === 'alert') return 'unsafe'
  if (level === 'watch') return 'warn'
  if (level === 'ok')    return 'safe'
  return 'unknown'
}

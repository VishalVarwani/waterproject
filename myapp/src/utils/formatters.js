import dayjs from 'dayjs'

/**
 * Convert temperature between °C and °F.
 * @param {number} value
 * @param {string} fromUnit - "°C" | "°F"
 * @param {"C"|"F"} toUnit
 */
export function convertTemperature(value, fromUnit, toUnit) {
  if (value == null || !Number.isFinite(value)) return value
  if (toUnit === 'C') {
    return fromUnit === '°F' ? (value - 32) * 5/9 : value
  } else {
    return fromUnit === '°C' ? (value * 9/5) + 32 : value
  }
}

/** Acceptable ranges and default units (simple demo thresholds; adjust per project) */
export const acceptableRanges = {
  temperature: { unit: '°C', min: 0, max: 30 }, // example comfort band
  ph: { unit: '', min: 6.5, max: 9 },
  dissolved_oxygen: { unit: 'mg/L', min: 5, max: 14 },
  turbidity: { unit: 'NTU', min: 0, max: 5 },
  nitrate: { unit: 'mg/L', min: 0, max: 10 }
}

/**
 * Derive flag using rules:
 *  - outlier: far outside acceptable range (>20% beyond max/min)
 *  - warn: outside acceptable range
 *  - ok: within range
 * If baseFlag exists and equals 'outlier', keep it.
 */
export function deriveFlag(parameter, value, unit, baseFlag) {
  if (!Number.isFinite(value)) return baseFlag || 'ok'
  if (baseFlag === 'outlier') return 'outlier'
  const cfg = acceptableRanges[parameter]
  if (!cfg) return baseFlag || 'ok'
  let v = value
  if (parameter === 'temperature') {
    // convert to °C for comparison if needed
    if (unit === '°F') {
      v = (value - 32) * 5/9
    }
  }
  if (v < cfg.min || v > cfg.max) {
    const span = cfg.max - cfg.min
    const overshoot = v > cfg.max ? (v - cfg.max) : (cfg.min - v)
    return overshoot > 0.2 * span ? 'outlier' : 'warn'
  }
  return 'ok'
}

export function toLocalISODate(ts) {
  return dayjs(ts).format('YYYY-MM-DD HH:mm')
}

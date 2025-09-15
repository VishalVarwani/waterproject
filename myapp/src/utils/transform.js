// groups flat API rows into the shapes your charts/components already expect

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const r of arr) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// For TimeSeries (multi-parameter line chart)
export function toTimeSeries(apiRows) {
  // apiRows: [{ts, sampling_point, parameter, value, unit}]
  // Return [{ts, <param1>: number, <param2>: number, ...}]
  const byTs = groupBy(apiRows, r => r.ts || 'unknown');
  const out = [];
  for (const [ts, rows] of byTs.entries()) {
    const o = { ts };
    for (const r of rows) {
      if (r.value != null) o[r.parameter] = r.value;
    }
    out.push(o);
  }
  // sort by ts
  out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return out;
}

// Parameter list & units for filters/legend
export function extractParameters(apiRows) {
  const map = new Map();
  for (const r of apiRows) {
    if (!map.has(r.parameter)) map.set(r.parameter, r.unit || '');
  }
  return Array.from(map.entries()).map(([parameter, unit]) => ({ parameter, unit }));
}

// Sampling points for filters/cards
export function extractPoints(apiRows) {
  return Array.from(new Set(apiRows.map(r => r.sampling_point).filter(Boolean)));
}
// src/utils/transform.js
export function buildClientStateFromApi(measurementsRows) {
  // rows come like: { ts, sampling_point, parameter, value, unit }
  const samplingPointCodes = Array.from(
    new Set(measurementsRows.map(r => r.sampling_point || '').filter(Boolean))
  );

  const sampling_points = samplingPointCodes.map(code => ({
    id: code,
    name: code,
    lat: null,
    lon: null,
  }));

  const measurements = measurementsRows
    .filter(r => r.ts) // keep only rows with time
    .map(r => ({
      timestamp: r.ts,                 // ISO string
      sampling_point_id: r.sampling_point || '',
      parameter: String(r.parameter || '').toLowerCase(),
      value: r.value == null ? null : Number(r.value),
      unit: r.unit || '',
      flag: 'ok',                      // backend returns counts; per-row flag is optional
    }));

  return { sampling_points, measurements };
}

export function guessParameterList(measurements) {
  return Array.from(
    new Set(measurements.map(m => m.parameter).filter(Boolean))
  ).slice(0, 20); // keep UI tidy
}

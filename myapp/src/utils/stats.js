/** Minimal, dependency-free stats helpers for Analytics */

export function mean(arr) {
  if (!arr.length) return NaN
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function std(arr) {
  if (arr.length < 2) return NaN
  const m = mean(arr)
  const v = mean(arr.map(x => (x - m) ** 2))
  return Math.sqrt(v)
}

export function pearson(x, y) {
  const xy = pairComplete(x, y)
  const xs = xy.map(d => d[0])
  const ys = xy.map(d => d[1])
  const n = xs.length
  if (n < 2) return { r: NaN, n: 0 }
  const mx = mean(xs), my = mean(ys)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx
    const vy = ys[i] - my
    num += vx * vy
    dx += vx * vx
    dy += vy * vy
  }
  const r = (dx === 0 || dy === 0) ? NaN : (num / Math.sqrt(dx * dy))
  return { r, n }
}

export function spearman(x, y) {
  const xy = pairComplete(x, y)
  const xs = xy.map(d => d[0])
  const ys = xy.map(d => d[1])
  const n = xs.length
  if (n < 2) return { r: NaN, n: 0 }
  const rx = rank(xs)
  const ry = rank(ys)
  return pearson(rx, ry)
}

/** Simple OLS trend (y = a + b x) returning slope/intercept/r2 */
export function olsTrend(x, y) {
  const xy = pairComplete(x, y)
  const xs = xy.map(d => d[0])
  const ys = xy.map(d => d[1])
  const n = xs.length
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN }

  const mx = mean(xs), my = mean(ys)
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r2 = (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2 }
}

/** Pairwise complete observations */
export function pairComplete(x, y) {
  const out = []
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i], b = y[i]
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
      out.push([a, b])
    }
  }
  return out
}

/** Ranks with average for ties */
export function rank(arr) {
  const n = arr.length
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const ranks = new Array(n).fill(0)
  let i = 0
  while (i < n) {
    let j = i + 1
    while (j < n && idx[j][0] === idx[i][0]) j++
    const avg = (i + 1 + j) / 2
    for (let k = i; k < j; k++) {
      ranks[idx[k][1]] = avg
    }
    i = j
  }
  return ranks
}

/** Resample to daily mean per sampling_point_id & parameter (UTC) */
export function resampleDaily(measurements) {
  const key = (d) => `${d.sampling_point_id}|${d.parameter}|${new Date(d.timestamp).toISOString().slice(0,10)}`
  const agg = new Map()
  for (const m of measurements) {
    const k = key(m)
    if (!agg.has(k)) agg.set(k, { sum: 0, n: 0, any: m })
    const o = agg.get(k)
    o.sum += Number(m.value)
    o.n += 1
  }
  const out = []
  for (const [, o] of agg) {
    const m = o.any
    out.push({
      timestamp: new Date(m.timestamp).toISOString().slice(0,10) + 'T00:00:00Z',
      sampling_point_id: m.sampling_point_id,
      parameter: m.parameter,
      value: o.sum / o.n,
      unit: m.unit,
      flag: m.flag ?? 'ok'
    })
  }
  return out
}

/** Build correlation matrix for params -> {matrix, counts, order} */
export function buildCorrelationMatrix(rows, params, method='pearson') {
  const byParam = new Map()
  for (const p of params) byParam.set(p, [])
  // Align by timestamp+site to reduce pairing bias
  const buckets = new Map()
  for (const r of rows) {
    const k = `${r.timestamp}|${r.sampling_point_id}`
    if (!buckets.has(k)) buckets.set(k, {})
    buckets.get(k)[r.parameter] = Number(r.value)
  }
  const aligned = params.map(() => [])
  // Convert to arrays per param, aligned
  const keys = Array.from(buckets.values())
  for (const p of params) {
    aligned[params.indexOf(p)] = keys.map(k => k[p] ?? null)
  }

  const n = params.length
  const matrix = Array.from({ length: n }, () => Array(n).fill(1))
  const counts = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const xi = aligned[i], yj = aligned[j]
      const fn = method === 'spearman' ? spearman : pearson
      const { r, n: nn } = fn(xi, yj)
      matrix[i][j] = matrix[j][i] = r
      counts[i][j] = counts[j][i] = nn
    }
  }
  return { matrix, counts, order: params }
}

/** Simple histogram bins */
export function histogram(data, bins = 20) {
  const clean = data.filter(v => Number.isFinite(v))
  if (!clean.length) return { bins: [], counts: [] }
  const min = Math.min(...clean), max = Math.max(...clean)
  const width = (max - min) / bins || 1
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + i * width)
  const counts = new Array(bins).fill(0)
  for (const v of clean) {
    const idx = Math.min(Math.floor((v - min) / width), bins - 1)
    counts[idx]++
  }
  const centers = edges.slice(0, -1).map((e, i) => (e + edges[i+1]) / 2)
  return { bins: centers, counts }
}

/** Tiny CSV helpers */
export function objectsToCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
  }
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ]
  return lines.join('\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

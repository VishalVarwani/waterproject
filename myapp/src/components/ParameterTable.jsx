import PropTypes from 'prop-types'
import { useMemo, useState } from 'react'
import dayjs from 'dayjs'

const PAGE_SIZES = [10, 25, 50, 100]

export default function ParameterTable({ measurements, spById }) {
  const [sortKey, setSortKey] = useState('timestamp')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [textFilter, setTextFilter] = useState('')

  const sorted = useMemo(() => {
    const arr = measurements
      .map(m => ({
        ...m,
        sampling_point: spById[m.sampling_point_id]?.name || m.sampling_point_id
      }))
      .filter(row => {
        if (!textFilter.trim()) return true
        const q = textFilter.toLowerCase()
        return (
          row.sampling_point.toLowerCase().includes(q) ||
          row.parameter.toLowerCase().includes(q) ||
          String(row.value).toLowerCase().includes(q) ||
          (row.flag || '').toLowerCase().includes(q)
        )
      })

    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let va = a[sortKey]
      let vb = b[sortKey]
      if (sortKey === 'timestamp') {
        va = new Date(a.timestamp)
        vb = new Date(b.timestamp)
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return arr
  }, [measurements, spById, sortKey, sortDir, textFilter])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  return (
    <div className="table-card">
      <div className="table-controls">
        <label className="label" htmlFor="table-search">Search</label>
        <input
          id="table-search"
          className="input"
          type="text"
          placeholder="Filter rows…"
          value={textFilter}
          onChange={(e)=>{ setTextFilter(e.target.value); setPage(1) }}
        />

        <div className="spacer"></div>

        <label className="label" htmlFor="page-size">Rows</label>
        <select
          id="page-size"
          className="select"
          value={pageSize}
          onChange={(e)=>{ setPageSize(Number(e.target.value)); setPage(1) }}
        >
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="table-wrapper" tabIndex="0" role="region" aria-label="Measurements table">
        <table className="table">
          <thead>
            <tr>
              <Th label="Timestamp" onClick={()=>toggleSort('timestamp')} sort={sortKey==='timestamp'?sortDir:null} />
              <Th label="Sampling Point" onClick={()=>toggleSort('sampling_point')} sort={sortKey==='sampling_point'?sortDir:null} />
              <Th label="Parameter" onClick={()=>toggleSort('parameter')} sort={sortKey==='parameter'?sortDir:null} />
              <Th label="Value" onClick={()=>toggleSort('value')} sort={sortKey==='value'?sortDir:null} />
              <Th label="Unit" onClick={()=>toggleSort('unit')} sort={sortKey==='unit'?sortDir:null} />
              <Th label="Flag" onClick={()=>toggleSort('flag')} sort={sortKey==='flag'?sortDir:null} />
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, idx) => (
              <tr key={`${row.timestamp}-${row.sampling_point_id}-${row.parameter}-${idx}`} className={row.flag === 'outlier' ? 'row--alert' : (row.flag === 'warn' ? 'row--warn' : '')}>
                <td>{dayjs(row.timestamp).format('YYYY-MM-DD HH:mm')}</td>
                <td>{row.sampling_point}</td>
                <td>{row.parameter}</td>
                <td>{Number.isFinite(row.value) ? row.value.toFixed(2) : row.value}</td>
                <td>{row.unit}</td>
                <td className={`flag flag--${row.flag || 'ok'}`}>{row.flag || 'ok'}</td>
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan="6" className="muted center">No rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav className="pagination" aria-label="Pagination">
        <button className="button" disabled={page<=1} onClick={()=>setPage(1)} aria-label="First page">«</button>
        <button className="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} aria-label="Previous page">‹</button>
        <span className="pagination__info" aria-live="polite">Page {page} / {totalPages}</span>
        <button className="button" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} aria-label="Next page">›</button>
        <button className="button" disabled={page>=totalPages} onClick={()=>setPage(totalPages)} aria-label="Last page">»</button>
      </nav>
    </div>
  )
}

function Th({ label, onClick, sort }) {
  return (
    <th>
      <button className="th-button" onClick={onClick} aria-label={`Sort by ${label}`}>
        {label} {sort ? (sort === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  )
}

Th.propTypes = {
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  sort: PropTypes.oneOf([null,'asc','desc'])
}

ParameterTable.propTypes = {
  measurements: PropTypes.array.isRequired,
  spById: PropTypes.object.isRequired
}

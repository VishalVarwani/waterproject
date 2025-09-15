// src/pages/Datasets.jsx
import { useContext, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../utils/authContext.jsx'
import { FiltersContext } from '../utils/filtersContext.js'
import '../styles/datasets.css'

function prettyDate(iso) {
  try { return new Date(iso).toLocaleString() } catch { return '—' }
}

function formatYMD(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    : '—'
}

export default function Datasets() {
  const navigate = useNavigate()
  const { user } = useContext(AuthContext)
  const { datasets = [], datasetId, setDatasetId, rawData } = useContext(FiltersContext)

  const items = useMemo(() => (datasets || []), [datasets])

  // Compute date range from the currently loaded (active) dataset's measurements
  const [activeStart, activeEnd] = useMemo(() => {
    const rows = rawData?.measurements || []
    if (!rows.length) return ['—', '—']
    const tsNums = rows
      .map(r => r?.timestamp)
      .filter(Boolean)
      .map(t => new Date(t).getTime())
      .filter(n => Number.isFinite(n))
    if (!tsNums.length) return ['—', '—']
    const min = new Date(Math.min(...tsNums)).toISOString()
    const max = new Date(Math.max(...tsNums)).toISOString()
    return [formatYMD(min), formatYMD(max)]
  }, [rawData])

  const onPick = (id) => {
    setDatasetId(id)   // triggers App to refetch measurements
    navigate('/')      // go to Dashboard
  }

  if (!user) {
    return <div className="page page--center">Please log in to view datasets.</div>
  }

  return (
    <div className="page page--pad">
      <div className="section__header">
        <h2 className="section__title">Datasets</h2>
        <p className="muted">Click a dataset to open it in the dashboard.</p>
      </div>

      {!items.length ? (
        <div className="empty">No datasets found yet.</div>
      ) : (
        <div className="dataset-grid">
          {items.map(d => {
            const active = d.dataset_id === datasetId
            const start = active ? activeStart : '—'
            const end   = active ? activeEnd   : '—'
            return (
              <button
                key={d.dataset_id}
                className={`dataset-card ${active ? 'dataset-card--active' : ''}`}
                onClick={() => onPick(d.dataset_id)}
                aria-label={`Open dataset ${d.file_name}${d.sheet_name ? ' ' + d.sheet_name : ''}`}
              >
                <div className="dataset-card__top">
                  <div className="dataset-card__title">
                    <span className="dataset-card__file">{d.file_name}</span>
                    {d.sheet_name ? <span className="muted"> · {d.sheet_name}</span> : null}
                  </div>
                  <span className={`badge ${active ? 'badge--active' : 'badge--idle'}`}>
                    {active ? 'Active' : 'Idle'}
                  </span>
                </div>

                <div className="dataset-card__meta">
                  <div><span className="muted">Uploaded</span><div>{prettyDate(d.uploaded_at)}</div></div>
                  <div><span className="muted">Rows</span><div>{d.row_count ?? '—'}</div></div>
                  <div><span className="muted">Cols</span><div>{d.col_count ?? '—'}</div></div>
                </div>

                <div className="dataset-card__wb">
                  <span className="muted">Waterbody</span>
                  <div>{d.waterbody_name || '—'} {d.waterbody_type ? `(${d.waterbody_type})` : ''}</div>
                </div>

                <div className="dataset-card__range">
                  <span className="muted">Date range</span>
                  <div>{start} to {end}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

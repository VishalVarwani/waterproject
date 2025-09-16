// src/pages/Datasets.jsx
import { useContext, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../utils/authContext.jsx'
import { FiltersContext } from '../utils/filtersContext.js'
import '../styles/datasets.css'
import { api } from '../utils/api'

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
  const {
    datasets = [],
    datasetId,
    setDatasetId,
    rawData,
    setDatasets,
    refreshDatasets,
  } = useContext(FiltersContext)

  const items = useMemo(() => (datasets || []), [datasets])

  // Compute date range for the *active* dataset (based on loaded measurements)
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

  const onPick = useCallback((id) => {
    setDatasetId(id)   // triggers App to refetch measurements
    navigate('/')      // go to Dashboard
  }, [navigate, setDatasetId])

  const onDelete = useCallback(async (id) => {
    if (!user?.client_id) return
    const ok = window.confirm('Delete this dataset permanently? This cannot be undone.')
    if (!ok) return

    // optimistic UI update
    const prev = datasets
    setDatasets(prev.filter(d => d.dataset_id !== id))
    if (datasetId === id) setDatasetId('') // clear active; App will decide next active when data reloads

    try {
      await api.deleteDataset({ clientId: user.client_id, datasetId: id })
      // ensure client list matches server after deletion
      await refreshDatasets?.()
    } catch (e) {
      alert(`Delete failed: ${e.message || e}`)
      // revert optimistic update
      setDatasets(prev)
      if (!datasetId && prev.find(d => d.dataset_id === id)) setDatasetId(id)
    }
  }, [user?.client_id, datasets, setDatasets, datasetId, setDatasetId, refreshDatasets])

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
              <div key={d.dataset_id} className={`dataset-card ${active ? 'dataset-card--active' : ''}`}>
                <button
                style={{background: 'none', border: 'none', }}
                  className="dataset-card__click"
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

                {/* Bin / delete button (doesn't trigger onPick) */}
                <button
                  className="dataset-card__delete"
                  title="Delete dataset"
                  aria-label={`Delete dataset ${d.file_name}`}
                  onClick={(e) => { e.stopPropagation(); onDelete(d.dataset_id) }}
                >
                  🗑️
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

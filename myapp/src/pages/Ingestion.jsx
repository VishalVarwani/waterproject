// src/pages/Ingestion.jsx
import { useContext, useMemo, useState, useEffect } from 'react'
import { AuthContext } from '../utils/authContext'
import { FiltersContext } from '../utils/filtersContext'
import { api } from '../utils/api'
import '../styles/global.css'
import '../styles/ingestion.css'

export default function Ingestion() {
  const { user } = useContext(AuthContext)
  const { datasets = [] } = useContext(FiltersContext)

  const [file, setFile] = useState(null)
  const [sheet, setSheet] = useState('')
  const [preview, setPreview] = useState(null)
  const [sessionId, setSessionId] = useState('')
  const [availableSheets, setAvailableSheets] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qualifier, setQualifier] = useState('')

  // NEW: save/merge mode controls
  const [persistMode, setPersistMode] = useState('append_auto') // 'new' | 'append_auto' | 'append_to'
  const [targetDatasetId, setTargetDatasetId] = useState('')

  // enable Persist only if we mapped + (if append_to, a target is chosen)
  const canPersist = useMemo(() => {
    if (!(user && sessionId)) return false
    if (persistMode === 'append_to' && !targetDatasetId) return false
    return true
  }, [user, sessionId, persistMode, targetDatasetId])

  // If we have a resolved waterbody from preview, gently suggest append_auto by default
  useEffect(() => {
    if (!preview) return
    // Keep current selection; just a placeholder if you later want to auto-pick append_to
    // based on same waterbody name/type in datasets.
  }, [preview])

  // 🔹 Auto-select first sheet when server reports availableSheets
  useEffect(() => {
    if (availableSheets?.length && !sheet) {
      setSheet(availableSheets[0])
    }
  }, [availableSheets, sheet])

  const doMap = async () => {
    if (!file) { setError('Select a CSV/XLSX first'); return }
    setError(''); setBusy(true)
    try {
      const res = await api.ingestMap(file, sheet || undefined)
      setPreview(res)
      setSessionId(res.session_id)
      setAvailableSheets(res.availableSheets || [])
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  const doPersist = async () => {
    if (!canPersist) return
    setError(''); setBusy(true)
    try {
      const res = await api.ingestPersist({
        clientId: user.client_id || user.clientId || user.clientID || user.clientId,
        sessionId,
        fileName: preview?.file_name || (file?.name ?? 'upload'),
        sheetName: sheet || undefined,
        useContentHash: true,
        valueQualifier: qualifier,
        email: user.email,
        // NEW: merge policy
        mode: persistMode,                               // "new" | "append_auto" | "append_to"
        targetDatasetId: persistMode === 'append_to' ? (targetDatasetId || null) : null,
      })
      alert(
        `Persisted!\n` +
        `dataset_id = ${res.dataset_id}\n` +
        `Inserted = ${res.rows_inserted}\n` +
        (res.appended_to_existing ? `Appended to existing (mode=${res.mode})` : `Created new dataset`)
      )
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <div className="ingestion">
      <div className="section">
        <h2 className="section__title">Ingestion</h2>

        <div className="card" style={{padding:0}}>
          <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              type="file"
              aria-label="Upload CSV or Excel"
              onChange={(e)=> {
                setFile(e.target.files?.[0] || null)
                // reset state on new file
                setPreview(null)
                setSessionId('')
                setAvailableSheets([])
                setSheet('')
                setError('')
              }}
            />

            {/* 🔹 Show sheet dropdown if server reported sheets */}
            {availableSheets.length > 0 ? (
              <>
                <label className="label" htmlFor="sheetSel" style={{ marginLeft: 8 }}>Sheet</label>
                <select
                  id="sheetSel"
                  className="select"
                  value={sheet}
                  onChange={(e)=> setSheet(e.target.value)}
                  disabled={busy}
                >
                  {availableSheets.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </>
            ) : null}

            <button className="button" onClick={doMap} disabled={busy}>
              {availableSheets.length > 1 ? 'Map selected sheet' : 'Map & Harmonize'}
            </button>

            {/* NEW: Save mode controls */}
            <div className="segmented" role="radiogroup" aria-label="Save mode" style={{ display:'flex', gap:12, alignItems:'center' }}>
              <label style={{ display:'flex', alignItems:'center', gap:6 }}>
                <input
                  type="radio"
                  name="save-mode"
                  value="new"
                  checked={persistMode === 'new'}
                  onChange={()=> setPersistMode('new')}
                />
                Add as new Dataset
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6 }}>
                <input
                  type="radio"
                  name="save-mode"
                  value="append_auto"
                  checked={persistMode === 'append_auto'}
                  onChange={()=> setPersistMode('append_auto')}
                />
                Update automatically (same waterbody)
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6 }}>
                <input
                  type="radio"
                  name="save-mode"
                  value="append_to"
                  checked={persistMode === 'append_to'}
                  onChange={()=> setPersistMode('append_to')}
                />
                Add Manually
              </label>
              {persistMode === 'append_to' && (
                <select
                  className="select"
                  value={targetDatasetId}
                  onChange={(e)=> setTargetDatasetId(e.target.value)}
                  aria-label="Choose dataset to append to"
                >
                  <option value="">Pick dataset…</option>
                  {datasets.map(d => (
                    <option key={d.dataset_id} value={d.dataset_id}>
                      {d.file_name}{d.sheet_name ? ` (${d.sheet_name})` : ''} · {d.waterbody_name || '—'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              className="button button--primary"
              onClick={doPersist}
              disabled={!canPersist || busy}
              title={!canPersist ? 'Map a file first (and choose a target if appending to a specific dataset)' : 'Persist'}
            >
              Save
            </button>
          </div>

          {error && <div className="alert alert--error" role="alert">{error}</div>}

          {preview && (
            <div className="ingest-preview" style={{ padding: 16 }}>
              <p><strong>Columns:</strong> {preview.columns.join(', ')}</p>
              {availableSheets?.length ? (
                <p>
                  <strong>Available sheets:</strong> {availableSheets.join(', ')}<br/>
                  <span className="muted">Selected: <code>{sheet || '(auto)'}</code></span>
                </p>
              ) : null}
              <p><strong>Rows:</strong> {preview.row_count} &nbsp; <strong>Cols:</strong> {preview.col_count}</p>
              <p><strong>Sampling points:</strong> {preview.sampling_points.join(', ')}</p>
              <details>
                <summary>Preview (first 20 rows)</summary>
                <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.preview, null, 2)}</pre>
              </details>
              <details>
                <summary>Resolved waterbody</summary>
                <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.waterbody, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

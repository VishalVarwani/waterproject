// src/pages/Ingestion.jsx
import { useContext, useMemo, useState, useEffect, useRef } from 'react'
import { AuthContext } from '../utils/authContext'
import { FiltersContext } from '../utils/filtersContext'
import { api } from '../utils/api'
import '../styles/global.css'
import '../styles/ingestion.css'

const META_NAMES = new Set([
  'timestamp','datetime','date','time',
  'sampling_point','site','station','site_id',
  'latitude','longitude','lat','lon','depth','depth_m','file_name'
])
const BRACKET_UNIT = /\s*\[([^\]]+)\]\s*$/

export default function Ingestion() {
  const { user } = useContext(AuthContext)
  const { datasets = [], refreshDatasets, setDatasetId, setDatasets, } = useContext(FiltersContext)

  // ── Steps: 1 = Upload & Harmonize, 2 = Validate, 3 = Upload ──────────────
  const [step, setStep] = useState(1)

  // core state
  const [file, setFile] = useState(null)
  const [sheetsFound, setSheetsFound] = useState([])
  const [sheet, setSheet] = useState('')

  const [preview, setPreview] = useState(null)   // server preview after /ingest/map
  const [sessionId, setSessionId] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qualifier, setQualifier] = useState('')

  // save/merge
  const [persistMode, setPersistMode] = useState('append_auto')
  const [targetDatasetId, setTargetDatasetId] = useState('')

  // units editor (Step 2)
  const [unitOverrides, setUnitOverrides] = useState({})

  const canPersist = useMemo(() => {
    if (!(user && sessionId)) return false
    if (persistMode === 'append_to' && !targetDatasetId) return false
    return true
  }, [user, sessionId, persistMode, targetDatasetId])

  // ── Upload helpers ────────────────────────────────────────────────────────
  const dzRef = useRef(null)
  const onSelectFile = () => dzRef.current?.click()

  const resetAll = () => {
    setPreview(null); setSessionId('')
    setSheetsFound([]); setSheet('')
    setError(''); setUnitOverrides({})
    setPersistMode('append_auto'); setTargetDatasetId('')
    setStep(1)
  }

  // Map & Harmonize now runs as part of Step 1 (auto or on “Use this sheet”)
  const doMap = async (fileOverride, sheetOverride) => {
    const useFile = fileOverride ?? file
    const useSheet = sheetOverride ?? sheet
    if (!useFile) { setError('Select a CSV/XLSX file first'); return }
    if (!useSheet) { setError('Pick a sheet'); return }

    setError(''); setBusy(true)
    try {
      const res = await api.ingestMap(useFile, useSheet)
      setPreview(res)
      setSessionId(res.session_id)
      setSheetsFound(res.availableSheets || [])
      setUnitOverrides({})
      setStep(2) // straight to Validate
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  // When file chosen: discover sheets. If single sheet / CSV => auto-map here.
  const handleFileChosen = async (f) => {
    setFile(f)
    // clear downstream state
    setPreview(null); setSessionId('')
    setSheetsFound([]); setSheet(''); setUnitOverrides({})
    setError('')

    setBusy(true)
    try {
      const res = await api.ingestSheets(f)
      const names = res.available_sheets || []
      setSheetsFound(names)

      if (res.kind === 'csv') {
        setSheet('csv')
        // auto map & continue to Step 2
        await doMap(f, 'csv')
      } else if (names.length === 1) {
        setSheet(names[0])
        // auto map & continue to Step 2
        await doMap(f, names[0])
      } else {
        // multi-sheet: stay in Step 1 and ask which sheet, then “Use this sheet” maps
        setStep(1)
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation()
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFileChosen(f)
  }
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation() }

  // ── Step 2: manual units (in-session) ─────────────────────────────────────
  const missingUnitCols = useMemo(() => {
    if (!preview?.columns?.length) return []
    return preview.columns.filter(c => {
      const name = String(c).trim()
      if (META_NAMES.has(name.toLowerCase())) return false
      return !BRACKET_UNIT.test(name)
    })
  }, [preview?.columns])

  const applyUnitOverrides = async () => {
    if (!sessionId) return
    const entries = Object.entries(unitOverrides)
      .map(([column, unit]) => ({ column, unit: (unit || '').trim() }))
      .filter(x => x.unit)
    if (!entries.length) return

    setBusy(true); setError('')
    try {
      const res = await api.ingestOverrideUnits({ sessionId, overrides: entries })
      setPreview(p => ({
        ...(p || {}),
        columns: res.columns,
        preview: res.preview,
        row_count: res.row_count,
        col_count: res.col_count,
      }))
      setUnitOverrides({})
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  // ── Step 3: Upload to DB ──────────────────────────────────────────────────
  const doPersist = async () => {
    if (!canPersist) return
    setError(''); setBusy(true)
    try {
      const res = await api.ingestPersist({
        clientId: user.client_id || user.clientId || user.clientID || user?.clientId,
        sessionId,
        fileName: preview?.file_name || (file?.name ?? 'upload'),
        sheetName: sheet || undefined,
        useContentHash: true,
        valueQualifier: qualifier,
        email: user?.email,
        mode: persistMode,
        targetDatasetId: persistMode === 'append_to' ? (targetDatasetId || null) : null,
      })

      // --- instant UI update ---
      // 1) Optimistically add/refresh the dataset in the shared list
      if (typeof setDatasets === 'function') {
        setDatasets(prev => {
        const optimistic = {
          dataset_id: res.dataset_id,
          file_name: preview?.file_name || file?.name || 'upload',
          sheet_name: sheet || null,
          row_count: preview?.row_count ?? 0,
          col_count: preview?.col_count ?? 0,
          uploaded_at: new Date().toISOString(),
          waterbody_name: preview?.waterbody?.name || null,
          waterbody_type: preview?.waterbody?.type || null,
        }
        const other = (prev || []).filter(d => d.dataset_id !== res.dataset_id)
        return [optimistic, ...other]
    })
    }

      // 2) Make the new dataset active (App.jsx effect will refetch measurements)
      if (typeof setDatasetId === 'function' && res.dataset_id) {
        setDatasetId(res.dataset_id)
      }

      // 3) Background refresh to ensure server truth overrides our optimistic item
      if (typeof refreshDatasets === 'function') {
        await refreshDatasets()
      }

      // Optional: route user to Dashboard (or Datasets) immediately
      // navigate('/') // or navigate('/datasets')

      alert(
        `Persisted!\n` +
        `dataset_id = ${res.dataset_id}\n` +
        `Inserted = ${res.rows_inserted}\n` +
        (res.appended_to_existing ? `Appended to existing (mode=${res.mode})` : `Created new dataset`)
      )
      // keep user on step 3 after save (or move them if you prefer)
    } catch (e) {
      setError(String(e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <div className="ingestion">
      {/* New stepper: 1 Upload & Harmonize → 2 Validate → 3 Upload */}
      <div className="rsi-stepper" role="navigation" aria-label="Import steps">
        <StepperItem index={1} label="Upload & Harmonize"  active={step === 1} />
        <div className="rsi-stepper__bar" />
        <StepperItem index={2} label="Validate data"       active={step === 2} />
        <div className="rsi-stepper__bar" />
        <StepperItem index={3} label="Upload to database"  active={step === 3} />
      </div>

      <div className="section">
        {/* STEP 1 — Upload + (optional sheet pick) + auto Map/Harmonize */}
        {step === 1 && (
          <div className="rsi-card">
            <h2 className="rsi-title">Upload file</h2>

            <div
              className="rsi-dropzone"
              onDrop={onDrop}
              onDragOver={onDragOver}
              role="region"
              aria-label="Upload .xlsx, .xls or .csv file"
            >
              <input
                ref={dzRef}
                type="file"
                accept=".csv,.xls,.xlsx"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f) }}
              />
              <div className="rsi-dropzone__center">
                <div className="rsi-dropzone__label">Upload .xlsx, .xls or .csv file</div>
                <button type="button" className="rsi-btn rsi-btn--primary" onClick={onSelectFile} disabled={busy}>
                  Select file
                </button>
                {file && (
                  <div className="rsi-file">
                    <span className="rsi-file__name" title={file.name}>{file.name}</span>
                    <button type="button" className="rsi-btn rsi-btn--ghost rsi-btn--sm" onClick={() => { setFile(null); resetAll() }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* If multiple sheets, user chooses, then we Map immediately */}
            {file && sheetsFound.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <h3 className="section__title" style={{ marginTop: 0, textAlign: 'center' }}>Select the sheet to use</h3>
                <div style={{ display: 'grid', gap: 10, maxWidth: 460, margin: '0 auto' }}>
                  {sheetsFound.map((s) => (
                    <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="radio"
                        name="sheetPick"
                        value={s}
                        checked={sheet === s}
                        onChange={() => setSheet(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
                <div className="rsi-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => doMap(file, sheet)}
                    disabled={!sheet || busy}
                  >
                    Use this sheet & continue
                  </button>
                </div>
              </div>
            )}

            {error && <div className="alert alert--error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}

        {/* STEP 2 — Validate (10-row preview + add units) */}
        {/* --- STEP 2 — Validate (detected headers + 10-row preview + add units) --- */}
        {step === 2 && preview && (
          <div className="rsi-card">
            <h2 className="rsi-title">Validate data</h2>

            {/* Detected (raw) headers from the uploaded sheet */}
            <div style={{ marginTop: 4, marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 6 }}>Detected headers</div>
              {(() => {
                const detected =
                  preview.detected_headers ||
                  preview.raw_headers ||
                  preview.source_headers ||
                  preview.columns_raw ||
                  []; // fallback if backend doesn’t send a raw list
                return (
                  <div
                    className="chip-list"
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                  >
                    {(detected.length ? detected : preview.columns || []).map((h, i) => (
                      <span
                        key={`${String(h)}-${i}`}
                        className="chip"
                        style={{
                          padding: '4px 8px',
                          borderRadius: 8,
                          background: 'var(--surface-2, #f3f4f6)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                        title={String(h)}
                      >
                        {String(h)}
                      </span>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* Harmonized preview (first 10 rows) */}
            <div className="table-wrapper" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>{preview.columns.map(col => <th key={col}>{String(col)}</th>)}</tr>
                </thead>
                <tbody>
                  {(preview.preview || []).slice(0, 7).map((row, i) => (
                    <tr key={i}>
                      {preview.columns.map(col => (
                        <td key={String(col) + i}>{row[String(col)] == null ? '' : String(row[String(col)])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Missing units editor */}
            {(() => {
              const META_NAMES = new Set([
                'timestamp','datetime','date','time',
                'sampling_point','site','station','site_id',
                'latitude','longitude','lat','lon','depth','depth_m','file_name'
              ])
              const BRACKET_UNIT = /\s*\[([^\]]+)\]\s*$/
              const missingUnitCols = (preview.columns || []).filter(c => {
                const name = String(c).trim()
                if (META_NAMES.has(name.toLowerCase())) return false
                return !BRACKET_UNIT.test(name)
              })
              return (
                <>
                  {missingUnitCols.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="label" style={{ marginBottom: 6 }}>Missing units — add them below:</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {missingUnitCols.map((col) => (
                          <div
                            key={col}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(200px, 1fr) 220px',
                              gap: 10,
                              alignItems: 'center'
                            }}
                          >
                            <div><code>{col}</code></div>
                            <input
                              className="input"
                              placeholder="e.g., mg/L, µg/L, NTU, °C, µS/cm, unitless…"
                              value={unitOverrides[col] || ''}
                              onChange={(e) =>
                                setUnitOverrides(u => ({ ...u, [col]: e.target.value }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <div className="rsi-actions">
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={applyUnitOverrides}
                          disabled={busy || Object.values(unitOverrides).every(v => !v?.trim())}
                        >
                          Apply units
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}

            <div className="rsi-actions" style={{ marginTop: 12 }}>
              <button type="button" className="button button--ghost" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
              <button type="button" className="button button--primary" onClick={() => setStep(3)} disabled={busy || !sessionId}>
                Continue
              </button>
            </div>

            {error && <div className="alert alert--error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}

        {/* STEP 3 — Upload to database */}
        {step === 3 && sessionId && (
        <div className="rsi-card">
          <h2 className="rsi-title">Upload to database</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
            Choose how to store these records and confirm the summary below.
          </p>

          {/* Summary strip */}
          <div className="rsi-summary">
            <div className="rsi-summary__item">
              <div className="rsi-summary__label">Rows</div>
              <div className="rsi-summary__value">{preview?.row_count ?? '—'}</div>
            </div>
            <div className="rsi-summary__item">
              <div className="rsi-summary__label">Columns</div>
              <div className="rsi-summary__value">{preview?.col_count ?? '—'}</div>
            </div>
            <div className="rsi-summary__item">
              <div className="rsi-summary__label">File</div>
              <div className="rsi-summary__value" title={file?.name || ''}>
                {file?.name || '—'}
              </div>
            </div>
            <div className="rsi-summary__item">
              <div className="rsi-summary__label">Sheet</div>
              <div className="rsi-summary__value">{sheet || '—'}</div>
            </div>
            <div className="rsi-summary__item">
              <div className="rsi-summary__label">Waterbody</div>
              <div className="rsi-summary__value">
                {preview?.waterbody?.name || '—'}
              </div>
            </div>
          </div>

          {/* Mode selector (segmented) */}
          <div className="rsi-segmented" role="radiogroup" aria-label="Save mode">
            <label className={`rsi-seg ${persistMode==='new' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="save-mode"
                value="new"
                checked={persistMode === 'new'}
                onChange={() => setPersistMode('new')}
              />
              <div className="rsi-seg__title">Add as new dataset</div>
              <div className="rsi-seg__hint">Creates a brand-new dataset record</div>
            </label>

            <label className={`rsi-seg ${persistMode==='append_auto' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="save-mode"
                value="append_auto"
                checked={persistMode === 'append_auto'}
                onChange={() => setPersistMode('append_auto')}
              />
              <div className="rsi-seg__title">Auto-append</div>
              <div className="rsi-seg__hint">Append to most recent dataset for this waterbody</div>
            </label>

            <label className={`rsi-seg ${persistMode==='append_to' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="save-mode"
                value="append_to"
                checked={persistMode === 'append_to'}
                onChange={() => setPersistMode('append_to')}
              />
              <div className="rsi-seg__title">Append to specific</div>
              <div className="rsi-seg__hint">Select an existing dataset below</div>
            </label>
          </div>

          {persistMode === 'append_to' && (
            <div className="rsi-row" style={{ marginTop: 12 }}>
              <label className="label" htmlFor="targetDs">Target dataset</label>
              <select
                id="targetDs"
                className="select"
                value={targetDatasetId}
                onChange={e => setTargetDatasetId(e.target.value)}
                aria-label="Pick dataset to append to"
              >
                <option value="">Pick dataset…</option>
                {datasets.map(d => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.file_name}{d.sheet_name ? ` (${d.sheet_name})` : ''} · {d.waterbody_name || '—'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Optional qualifier */}
          <div className="rsi-row" style={{ marginTop: 12 }}>
            <label className="label" htmlFor="qualifier">Value qualifier</label>
            <input
              id="qualifier"
              className="input"
              placeholder="optional note applied to all values (e.g., 'field', 'lab A')"
              value={qualifier}
              onChange={e => setQualifier(e.target.value)}
            />
          </div>

          {/* Final checklist */}
          <div className="rsi-checklist">
            <div className="rsi-checklist__item">✅ Mapping & units reviewed</div>
            <div className="rsi-checklist__item">✅ {preview?.row_count ?? 0} rows ready</div>
            <div className="rsi-checklist__item">✅ Waterbody set: {preview?.waterbody?.name || '—'}</div>
          </div>

          {/* Actions */}
          <div className="rsi-actions" style={{ marginTop: 12 }}>
            <button type="button" className="button button--ghost" onClick={() => setStep(2)} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={doPersist}
              disabled={!canPersist || busy}
              title={!canPersist ? 'Map a file first (and choose a target if appending)' : 'Save to database'}
            >
              {busy ? 'Saving…' : 'Save to database'}
            </button>
          </div>

          {error && <div className="alert alert--error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      )}
      </div>
    </div>
  )
}
function StepperItem({ index, label, active = false }) {
  return (
    <div className={`rsi-stepper__item ${active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
      <div className="rsi-stepper__dot">{index}</div>
      <div className="rsi-stepper__label">{label}</div>
    </div>
  )
}

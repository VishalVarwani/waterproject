// src/pages/Analytics.jsx
import { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../utils/authContext.jsx';
import { FiltersContext } from '../utils/filtersContext.js';
import { api } from '../utils/api';
import CorrelationHeatmap from '../components/CorrelationHeatmap.jsx';
import ScatterMatrix from '../components/ScatterMatrix.jsx';
import DistributionPanel from '../components/DistributionPanel.jsx';
import AnomalySummary from '../components/AnomalySummary.jsx';
import '../styles/analytics.css';
export default function Analytics() {
  const { user } = useContext(AuthContext);
  const {
    filteredMeasurements,   // ← rows for charts
    selectedParams,
    spById,                 // ← needed by AnomalySummary
    datasetId,
  } = useContext(FiltersContext);

  const [method, setMethod] = useState('pearson');
  const [corr, setCorr] = useState({ labels: [], matrix: [] });
  const [anom, setAnom] = useState({ by_parameter: {}, by_sampling_point: {} });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // build unitByParam from current rows
  const unitByParam = useMemo(() => {
    const map = new Map();
    for (const r of filteredMeasurements || []) {
      if (!r?.parameter) continue;
      if (!map.has(r.parameter) && r.unit) map.set(r.parameter, r.unit);
    }
    return Object.fromEntries(map);
  }, [filteredMeasurements]);

  // server-side correlation + anomalies when dataset/method changes
  useEffect(() => {
    let ignore = false;
    if (!user?.client_id || !datasetId) return;

    (async () => {
      setLoading(true); setErr('');
      try {
        const [c, a] = await Promise.all([
          api.fetchCorrelation({ clientId: user.client_id, datasetId, method }),
          api.fetchAnomalies({ clientId: user.client_id, datasetId }),
        ]);
        if (!ignore) {
          setCorr(c || { labels: [], matrix: [] });
          setAnom(a || { by_parameter: {}, by_sampling_point: {} });
        }
      } catch (e) {
        if (!ignore) setErr(String(e.message || e));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => { ignore = true; };
  }, [user?.client_id, datasetId, method]);

  const rows = filteredMeasurements || [];
  const params = (selectedParams && selectedParams.length ? selectedParams : Array.from(new Set(rows.map(r => r.parameter)))) || [];

  return (
    <div className="page page--pad">
      {/* <div className="sticky-toolbar">
        <label className="label">Correlation method</label>
        <select value={method} onChange={e => setMethod(e.target.value)} className="select" aria-label="Correlation method">
          <option value="pearson">Pearson</option>
          <option value="spearman">Spearman</option>
        </select>
      </div> */}

      {err && <div className="alert alert--error" role="alert">{err}</div>}
      {loading && <div className="page__loading">Loading analytics…</div>}

      {/* <section className="section">
        <h2 className="section__title">Correlation Heatmap</h2>
        {corr.labels.length < 2 ? (
          <div className="empty">Not enough overlapping data to compute correlations.</div>
        ) : (
          <CorrelationHeatmap labels={corr.labels} matrix={corr.matrix} />
        )}
      </section> */}

      {/* <section className="section">
        <h2 className="section__title">Scatter Matrix</h2>
        <ScatterMatrix
          rows={rows}
          params={params}
          showTrend={true}
          pointAlpha={0.7}
        />
      </section> */}

      <section className="section">
        <h2 className="section__title">Distributions</h2>
        <DistributionPanel
          rows={rows}
          params={params}
          unitByParam={unitByParam}
        />
      </section>

      {/* <section className="section">
        <h2 className="section__title">Anomaly Summary</h2>
        <AnomalySummary
          rows={rows}
          spById={spById || {}}
          // you can still render server summary if you want:
          // serverByParameter={anom.by_parameter || {}}
          // serverBySamplingPoint={anom.by_sampling_point || {}}
        />
      </section> */}
    </div>
  );
}

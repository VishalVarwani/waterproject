// src/utils/api.js
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function http(method, path, body, isForm = false) {
  const opts = { method, headers: {} };
  if (isForm) {
    opts.body = body;
  } else if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

async function handle(r) {
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || JSON.stringify(j)); }
    catch { throw new Error(text || r.statusText); }
  }
  try { return JSON.parse(text) } catch { throw new Error(text || 'Bad JSON') }
}

export const api = {
  login: (email, password) => http("POST", "/auth/login", { email, password }),
  

  listDatasets: (clientId) =>
    http("GET", `/datasets?client_id=${encodeURIComponent(clientId)}`),

  fetchMeasurements: ({ clientId, datasetId, parameter, point, from, to, limit }) => {
    const params = new URLSearchParams();
    params.set("client_id", clientId);
    params.set("dataset_id", datasetId);
    if (parameter) params.set("parameter", parameter);
    if (point) params.set("point", point);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (limit) params.set("limit", String(limit));
    return http("GET", `/measurements?${params.toString()}`);
  },

  fetchCorrelation: ({ clientId, datasetId, method = "pearson" }) =>
    http("GET",
      `/analytics/correlation?client_id=${encodeURIComponent(clientId)}&dataset_id=${encodeURIComponent(datasetId)}&method=${method}`
    ),

  fetchAnomalies: ({ clientId, datasetId }) =>
    http("GET",
      `/analytics/anomalies?client_id=${encodeURIComponent(clientId)}&dataset_id=${encodeURIComponent(datasetId)}`
    ),
 deleteDataset: ({ clientId, datasetId }) =>
    http("DELETE", `/datasets/${encodeURIComponent(datasetId)}?client_id=${encodeURIComponent(clientId)}`),
 ingestSheets: (file) => {
    const form = new FormData();
    form.append("file", file);
    return http("POST", "/ingest/sheets", form, true);
  },
  // ingestion endpoints already in your project (kept for completeness)
  ingestMap: (file, sheet) => {
    const form = new FormData();
    form.append("file", file);
    if (sheet) form.append("sheet", sheet);
    return http("POST", "/ingest/map", form, true);
  },
   // NEW: apply units to columns in current session
  ingestOverrideUnits: ({ sessionId, overrides }) =>
    http("POST", "/ingest/override_units", {
      session_id: sessionId,
      overrides,
    }),
   ingestPersist: ({
    clientId, sessionId, fileName, sheetName,
    useContentHash = true, valueQualifier = "", email,
    mode = "new",             // "new" | "append_auto" | "append_to"
    targetDatasetId = null,   // required if mode === "append_to"
  }) =>
    http("POST", "/ingest/persist", {
      client_id: clientId,
      session_id: sessionId,
      file_name: fileName,
      sheet_name: sheetName,
      use_content_hash: useContentHash,
      value_qualifier: valueQualifier,
      email,
      mode,
      target_dataset_id: targetDatasetId,
    }),
  assistantSchema: () => fetch(`${API_BASE}/assistant/schema`).then(handle),
  assistantChat: (messages, limit = 300) =>
    fetch(`${API_BASE}/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, limit }),
    }).then(handle),
};
  
export default api;

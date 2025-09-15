# app.py
from __future__ import annotations
import os, re, json, hashlib, io
from typing import Any, Dict, List, Optional

import pandas as pd
import streamlit as st
from groq import Groq

# ---- Local modules (project structure) ----
from db.db_conn import get_connection
from db.db_util import (
    ensure_schema,ensure_client, upsert_waterbody, upsert_sampling_points,
    register_dataset, melt_harmonized, insert_measurements,
    CONTROLLED_META_VOCAB, CONTROLLED_UNIT_VOCAB, STANDARD_UNITS, upsert_parameters_for_codes, upsert_non_params_for_cols, 
)
from unit_convertor import convert_series, STANDARD_UNITS as STANDARD_UNITS_CONVERTER
from waterbody_llm_resolver import resolve_waterbody
from auth.local_auth import login_local


# =========================
# App Config
# =========================
st.set_page_config(page_title="e.wai — Water Harmonizer & Ingest", page_icon="💧", layout="wide")
st.markdown("""
<style>
:root { --bg:#0b1220; --panel:#121a2b; --panel2:#0e1626; --accent:#70d7ff; --text:#e6eefb; }
html, body, [data-testid="stAppViewContainer"] { background: var(--bg) !important; color: var(--text) !important; }
[data-testid="stHeader"] { background: linear-gradient(180deg, rgba(11,18,32,.7), rgba(11,18,32,0)) !important; }
.block-container { padding-top: 1.2rem; }
div[data-baseweb="select"] * { color:#0b1220 !important; }
</style>
""", unsafe_allow_html=True)

# =========================
# Session init
# =========================
for k, v in {
    "client_id": None,
    "email": "",
    "mapped_ready": False,
    "df_h": None,
    "df_sampling": None,
    "wb": None,
    "raw_bytes": None,
    "file_name": None,
    "sheet": None,
    "is_excel": False,
}.items():
    st.session_state.setdefault(k, v)

# =========================
# Secrets helpers
# =========================
def _get_secret(name: str, default: str = "") -> str:
    try:
        return st.secrets.get(name, os.getenv(name, default))
    except Exception:
        return os.getenv(name, default)

# =========================
# Groq Column Mapping (LLM)
# =========================
UNIT_NOT_PRESENT = "not_present"

SYSTEM_PROMPT = (
    "You are a precise data harmonization assistant for WATER QUALITY datasets. "
    "Return STRICT JSON as an ARRAY only. For each raw header, do three tasks: "
    "1) category: 'parameter' or 'meta'. "
    "2) map_to: ONE canonical field from the chosen category vocabulary (lowercase snake_case EXACTLY). "
    "3) unit_map_to: Only if category='parameter' and a measurement unit is clearly present in the HEADER TEXT "
    "(e.g., 'mg/L', '(µg/L)', 'mV', 'NTU', '°C'), pick ONE allowed unit for that parameter. "
    f"If no unit is present for parameters, set unit_map_to='{UNIT_NOT_PRESENT}'. "
    "If a unit appears but is ambiguous, set 'unknown'. "
    "For category='meta', set unit_map_to='not_applicable'. "
    "Never map timestamps, ids, coordinates, or site/station fields to parameters. "
    "If unsure about map_to, use map_to='unknown' with confidence<=0.5."
)
USER_PROMPT_TEMPLATE = """Task:
For each raw header below, output a JSON object with:
- category: "parameter" or "meta"
- map_to:
  - If category="parameter": one item from PARAM_VOCAB, else "unknown"
  - If category="meta": one item from META_VOCAB, else "unknown"
- unit_map_to:
  - If category="parameter" and the header clearly shows a unit, choose ONE from CONTROLLED_UNIT_VOCAB[map_to]
  - If category="parameter" and no unit appears, set "{unit_not_present}"
  - If category="parameter" and a unit appears but is unclear/ambiguous, set "unknown"
  - If category="meta": set "not_applicable"
- confidence: parameter/meta mapping confidence [0..1]
- unit_confidence: unit mapping confidence [0..1] (for meta: set 1.0)

PARAM_VOCAB:
{param_vocab}

META_VOCAB:
{meta_vocab}

CONTROLLED_UNIT_VOCAB (allowed units per parameter):
{unit_vocab}

Return EXACTLY {n_headers} objects, in the SAME ORDER as the given headers:
[
  {{
    "raw_header": "string",
    "category": "parameter" | "meta",
    "map_to": "canonical_field_or_unknown",
    "confidence": 0.0_to_1.0,
    "unit_map_to": "one_allowed_unit_or_{unit_not_present}_or_unknown_or_not_applicable",
    "unit_confidence": 0.0_to_1.0
  }}
]

Headers to map:
{headers_json}
"""

def _coerce_json_array(text: str) -> list:
    try:
        j = json.loads(text)
        if isinstance(j, list):
            return j
        if isinstance(j, dict):
            for v in j.values():
                if isinstance(v, list):
                    return v
    except Exception:
        pass
    if "[" in text and "]" in text:
        snippet = text[text.find("["): text.rfind("]")+1]
        try:
            j = json.loads(snippet)
            if isinstance(j, list):
                return j
        except Exception:
            pass
    return []

def _norm_col(s: str) -> str:
    s = re.sub(r"\s+", " ", str(s))
    return s.strip()

def _groq_client() -> Groq:
    key = _get_secret("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set. Put it in env or .streamlit/secrets.toml")
    return Groq(api_key=key)

def call_groq_map_headers(headers: List[str]) -> List[Dict[str, Any]]:
    client = _groq_client()
    model_name = _get_secret("GROQ_MODEL", "llama-3.3-70b-versatile")

    CONTROLLED_PARAM_VOCAB = list(CONTROLLED_UNIT_VOCAB.keys())
    user_prompt = USER_PROMPT_TEMPLATE.format(
        param_vocab=json.dumps(CONTROLLED_PARAM_VOCAB, ensure_ascii=False),
        meta_vocab=json.dumps(CONTROLLED_META_VOCAB, ensure_ascii=False),
        unit_vocab=json.dumps(CONTROLLED_UNIT_VOCAB, ensure_ascii=False),
        unit_not_present=UNIT_NOT_PRESENT,
        n_headers=len(headers),
        headers_json=json.dumps(headers, ensure_ascii=False),
    )
    resp = client.chat.completions.create(
        model=model_name,
        temperature=0.0,
        max_tokens=20000,
        response_format={"type": "json_object"},
        messages=[
            {"role":"system", "content": SYSTEM_PROMPT},
            {"role":"user", "content": user_prompt},
        ],
    )
    arr = _coerce_json_array(resp.choices[0].message.content.strip())
    if not arr:
        arr = [{"raw_header": h, "map_to": "unknown", "unit_map_to": UNIT_NOT_PRESENT, "confidence": 0.0, "unit_confidence": 0.0} for h in headers]
    return arr

# =========================
# Utility
# =========================
@st.cache_data(show_spinner=False)
def content_sha256(b: bytes, extra: str = "") -> str:
    h = hashlib.sha256()
    h.update(b)
    if extra:
        h.update(extra.encode("utf-8"))
    return h.hexdigest()

def _uniqueify(names: list[str]) -> list[str]:
    seen: Dict[str, int] = {}
    out: List[str] = []
    for n in names:
        k = n
        if k in seen:
            seen[k] += 1
            k = f"{n} ({seen[n]})"
        else:
            seen[k] = 0
        out.append(k)
    return out

# =========================
# Login
# =========================
st.title("💧 e.wai — Water Harmonizer & Database Ingest")

if st.session_state.client_id is None:
    with st.form("login_form"):
        st.subheader("Sign in")
        email = st.text_input("Email", value=st.session_state.email, placeholder="you@example.com")
        pw = st.text_input("Password", type="password", placeholder="•••••••• (default: eray123)")
        submitted = st.form_submit_button("Login")
    if submitted:
        cid = login_local(email, pw)
        if cid:
            st.session_state.client_id = cid
            st.session_state.email = email
            # optional: create the client row right away
            try:
                with get_connection() as conn:
                    ensure_schema(conn)
                    ensure_client(conn, client_id=cid, email=email, display_name=email.split("@")[0])
            except Exception as e:
                st.warning(f"Could not sync client to DB yet: {e}")
            st.rerun()
        else:
            st.error("Invalid email or password.")
    st.stop()

# Header bar with profile + logout + DB ping
colL, colM, colR = st.columns([1,4,3])
with colL:
    st.markdown("### 📁 Ingestion")
with colR:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                ok = cur.fetchone()[0] == 1
        st.success(f"DB OK • {st.session_state.email}")
    except Exception as e:
        st.error(f"DB error: {e}")
    if st.button("Logout"):
        st.session_state.client_id = None
        st.rerun()

# =========================
# File Upload
# =========================
uploaded = st.file_uploader("Upload CSV or Excel", type=["csv","xlsx","xls"], accept_multiple_files=False)
if not uploaded:
    st.info("Upload a file to begin.")
    st.stop()

raw_bytes = uploaded.read()
uploaded.seek(0)
is_excel = uploaded.name.lower().endswith((".xlsx",".xls"))

df: Optional[pd.DataFrame] = None
sheet: Optional[str] = None

try:
    if is_excel:
        xls = pd.ExcelFile(uploaded)
        sheet = st.selectbox("Sheet", options=xls.sheet_names, index=0)
        df = pd.read_excel(xls, sheet_name=sheet)
    else:
        df = pd.read_csv(uploaded)
except Exception as e:
    st.error(f"Failed to read file: {e}")
    st.stop()

if df is None or df.empty:
    st.error("File is empty or unreadable.")
    st.stop()

st.subheader("Detected headers")
headers = [str(c) for c in df.columns.tolist()]
st.code(headers, language="bash")

# =========================
# Column Mapping + Harmonize
# =========================
if st.button("🔎 Map & Harmonize (Groq)"):
    with st.spinner("Calling Groq and preparing harmonized view…"):
        mapping = call_groq_map_headers(headers)

        norm_index = {_norm_col(c): c for c in df.columns}
        param_set = set(CONTROLLED_UNIT_VOCAB.keys())
        meta_set  = set(CONTROLLED_META_VOCAB)

        rows = []
        used_src_rows = set()

        for item in mapping:
            mapped = str(item.get("map_to", "unknown")).strip()
            conf = float(item.get("confidence", 0.0))
            unit_mapped = str(item.get("unit_map_to", UNIT_NOT_PRESENT)).strip()
            unit_conf = float(item.get("unit_confidence", 0.0))

            if mapped not in (param_set | meta_set | {"unknown"}):
                mapped, conf = "unknown", min(conf, 0.5)

            allowed_units = CONTROLLED_UNIT_VOCAB.get(mapped, [])
            valid_unit = unit_mapped in allowed_units or unit_mapped in ("unknown", UNIT_NOT_PRESENT, "not_applicable")
            if not valid_unit:
                unit_mapped, unit_conf = "unknown", min(unit_conf, 0.4)

            raw_display = str(item.get("raw_header", ""))
            src = norm_index.get(_norm_col(raw_display))
            if src is not None:
                if src in used_src_rows:
                    continue
                used_src_rows.add(src)
                samples = df[src].head(5).astype(str).tolist()
            else:
                samples = []

            rows.append({
                "raw_header": raw_display,
                "suggested_map_to": mapped,
                "confidence": round(conf, 3),
                "unit_map_to": unit_mapped,
                "unit_confidence": round(unit_conf, 3),
                "samples": samples,
            })

        st.success("Mapped.")
        df_map = pd.DataFrame(rows)
        df_map_display = df_map.copy()
        df_map_display["samples"] = df_map_display["samples"].apply(lambda lst: ", ".join(lst))
        st.dataframe(df_map_display, use_container_width=True)

        # Build harmonized wide dataframe
        meta_src, meta_names = [], []
        param_src, param_labels = [], []
        used_src_h = set()

        for item in mapping:
            raw_display = str(item.get("raw_header", ""))
            src = norm_index.get(_norm_col(raw_display))
            if src is None or src in used_src_h:
                continue
            used_src_h.add(src)

            mapped = str(item.get("map_to", "unknown")).strip()
            unit_mapped = str(item.get("unit_map_to", UNIT_NOT_PRESENT)).strip()

            if mapped in meta_set:
                meta_src.append(src)
                meta_names.append(mapped)
            elif mapped in param_set:
                label = mapped if unit_mapped in ("unknown", UNIT_NOT_PRESENT) else f"{mapped} [{unit_mapped}]"
                param_src.append(src)
                param_labels.append(label)

        ordered_src = meta_src + param_src
        if ordered_src:
            df_h = df[ordered_src].copy()
        else:
            df_h = pd.DataFrame()

        # Convert to STANDARD_UNITS when possible
        final_names: List[str] = []
        for src, label in zip(meta_src, meta_names):
            final_names.append(label)

        for i, src in enumerate(param_src):
            label = param_labels[i]
            if " [" in label and label.endswith("]"):
                param = label.split(" [", 1)[0]
                from_unit = label.split(" [", 1)[1][:-1]
            else:
                param = label
                from_unit = UNIT_NOT_PRESENT

            if from_unit not in ("unknown", UNIT_NOT_PRESENT):
                series_converted, unit_to, did_convert = convert_series(param, from_unit, df_h[src])
                if did_convert:
                    df_h[src] = series_converted
                    label = f"{param} [{unit_to}]"
            final_names.append(label)

        final_names = _uniqueify(final_names)
        rename_map = {src: new for src, new in zip(ordered_src, final_names)}
        if rename_map:
            df_h.rename(columns=rename_map, inplace=True)

        # ---- Save state so the next click (Persist) still has data ----
        st.session_state.df_h = df_h
        st.session_state.df_sampling = (
            df_h[["sampling_point"]]
            .dropna()
            .assign(sampling_point=lambda d: d["sampling_point"].astype(str).str.strip())
            .loc[lambda d: d["sampling_point"] != ""]
            .drop_duplicates()
            .reset_index(drop=True)
        ) if "sampling_point" in df_h.columns else pd.DataFrame({"sampling_point":[]})
        st.session_state.wb = resolve_waterbody(
            df=df,
            filename=uploaded.name,
            sheet_names=[sheet] if (is_excel and sheet) else (["csv"])
        )
        st.session_state.raw_bytes = raw_bytes
        st.session_state.file_name = uploaded.name
        st.session_state.sheet = sheet
        st.session_state.is_excel = is_excel
        st.session_state.mapped_ready = True

        st.success("Harmonized data prepared. Scroll down to Persist section.")

# =========================
# Preview + Persist (uses session state)
# =========================
if st.session_state.mapped_ready and isinstance(st.session_state.df_h, pd.DataFrame):
    st.subheader("Harmonized preview")
    n = st.number_input("Rows to preview", min_value=1, max_value=200, value=20, step=1, key="preview_h")
    st.dataframe(st.session_state.df_h.head(n), use_container_width=True)

    if not st.session_state.df_sampling.empty:
        st.caption("Detected sampling points")
        st.dataframe(st.session_state.df_sampling, use_container_width=True)

    with st.expander("Resolved Waterbody (LLM)"):
        wb = st.session_state.wb or {}
        st.json({
            "name": wb.get("name"),
            "type": wb.get("type"),
            "confidence": round(float(wb.get("confidence", 0.0)), 3) if wb else None,
            "provenance": wb.get("provenance", []),
            "needs_confirmation": wb.get("needs_confirmation", False),
            "evidence": wb.get("evidence", []),
        })

    st.markdown("---")
    c1, c2 = st.columns([1,2])
    with c1:
        use_hash = st.toggle("Use content hash (idempotent dataset)", value=True, key="use_hash_toggle")
    with c2:
        qualifier = st.text_input("Optional value qualifier (applies to all rows)", value="", key="qualifier_txt")

    if st.button("🗃️ Persist to Database", type="primary"):
        try:
            client_id = st.session_state.client_id
            email = st.session_state.email or "unknown"
            if client_id is None:
                st.error("No client session. Please login again.")
                st.stop()

            df_h = st.session_state.df_h
            df_sampling = st.session_state.df_sampling
            wb = st.session_state.wb
            raw_bytes = st.session_state.raw_bytes
            file_name = st.session_state.file_name
            sheet = st.session_state.sheet
            is_excel = st.session_state.is_excel

            chash = content_sha256(raw_bytes, extra=(sheet or "")) if use_hash else None

            with get_connection() as conn:
                ensure_schema(conn, seed_all=False)  # no global seeding

                ensure_client(conn, client_id=client_id, email=email, display_name=email.split("@")[0])

                waterbody_id = upsert_waterbody(conn, client_id, wb) if wb else None
                sp_map = upsert_sampling_points(conn, client_id, waterbody_id,
                                                df_sampling if df_sampling is not None else pd.DataFrame({"sampling_point":[]}))
                dataset_id = register_dataset(
                    conn, client_id,
                    file_name=file_name,
                    sheet_name=sheet if is_excel else None,
                    row_count=len(df_h), col_count=df_h.shape[1],
                    waterbody_id=waterbody_id, content_hash=chash
                )

                long_df = melt_harmonized(df_h)

                # ===== NEW: lazy vocab upserts only for what's present =====
                used_param_codes = long_df["parameter_code"].dropna().astype(str).str.lower().unique().tolist()
                upsert_parameters_for_codes(conn, used_param_codes)

                used_meta_cols = [c for c in df_h.columns if c in CONTROLLED_META_VOCAB]
                upsert_non_params_for_cols(conn, used_meta_cols)
                # ===========================================================

                if qualifier.strip():
                    long_df["value_qualifier"] = qualifier.strip()

                result = insert_measurements(conn, client_id, dataset_id, long_df, sp_map)
            st.success(f"Ingested: {result['rows_inserted']} new rows (of {result['rows_in']}).")
            with st.expander("Ingest summary"):
                st.json({
                    "dataset_id": dataset_id,
                    "waterbody_id": waterbody_id,
                    "rows_in": result["rows_in"],
                    "rows_inserted": result["rows_inserted"],
                    "rows_skipped": result["rows_skipped"],
                })

        except Exception as e:
            st.error(f"Persist failed: {e}")
else:
    st.info("Click **Map & Harmonize (Groq)** to prepare data for persistence.")

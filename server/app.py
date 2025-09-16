from __future__ import annotations

import os, sys, io, json, re, uuid, hashlib, traceback, decimal
from typing import Any, Dict, List, Optional, Tuple
from datetime import date, datetime
import re

from flask import Flask, request, jsonify, make_response

import pandas as pd
import psycopg2
import psycopg2.extras as pgx

# Make repo root importable (parent of `server` and `ewai`)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BASE_DIR, ".env"))                     # repo root
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))    # server/.env
except Exception:
    pass
# ---- Imports from shared package ----
from ewai.db.db_conn import get_connection
from ewai.db.db_util import (
    ensure_schema, ensure_client,
    upsert_waterbody, upsert_sampling_points,
    register_dataset, melt_harmonized, insert_measurements,
    CONTROLLED_META_VOCAB, CONTROLLED_UNIT_VOCAB,
    upsert_parameters_for_codes, upsert_non_params_for_cols,
)
from ewai.unit_convertor import convert_series
from ewai.waterbody_llm_resolver import resolve_waterbody
from ewai.auth.local_auth import login_local  # ensure this exists (see file below)

from config import Settings
from utils import allowed_file, json_error, content_sha256, clamp_preview

# ===== App =====
settings = Settings()
ALLOWED_ORIGINS = set(settings.cors_origins)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = settings.max_upload_mb * 1024 * 1024
_UNIT_IN_BRACKETS = re.compile(r"\s*\[[^\]]+\]\s*$")
# ---- Precise CORS (manual, no Flask-CORS) ----
def _normalize_origin(o: str | None) -> str | None:
    if not o:
        return None
    return o[:-1] if o.endswith("/") else o

@app.before_request
def _handle_preflight():
    # Respond early to CORS preflight with exact origin echo
    if request.method == "OPTIONS":
        origin_raw = request.headers.get("Origin")
        origin = _normalize_origin(origin_raw)
        resp = make_response("", 200)
        if origin and origin in ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin_raw  # echo exactly
            resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        return resp
def _score_header_row(row_vals) -> float:
    # prefer rows with many non-empty strings and few numeric-only cells
    non_empty = sum(v is not None and str(v).strip() != "" for v in row_vals)
    texty    = sum(bool(re.search(r"[A-Za-z]", str(v) or "")) for v in row_vals)
    numlike  = sum(bool(re.fullmatch(r"\s*[-+]?\d*\.?\d+(e[-+]?\d+)?\s*", str(v) or "", re.I)) for v in row_vals)
    uniq     = len(set(str(v).strip().lower() for v in row_vals if v is not None and str(v).strip() != ""))
    # reward text and uniqueness, penalize all-numeric rows
    return (texty + 0.5 * uniq) - 0.75 * numlike + 0.1 * non_empty

def _detect_header_index(df_noheader: pd.DataFrame, scan_rows: int = 30) -> int:
    scan = min(scan_rows, len(df_noheader))
    best_i, best_score = 0, float("-inf")
    for i in range(scan):
        score = _score_header_row(df_noheader.iloc[i].tolist())
        if score > best_score:
            best_i, best_score = i, score
    return best_i

def _read_table_with_header_detection(raw: bytes, filename: str, sheet: Optional[str]):
    is_excel = filename.lower().endswith((".xlsx", ".xls"))
    if is_excel:
        xls = pd.ExcelFile(io.BytesIO(raw))
        if not sheet:
            sheet = xls.sheet_names[0]
        # first pass: no header
        df0 = pd.read_excel(xls, sheet_name=sheet, header=None)
        hdr = _detect_header_index(df0)
        # second pass: with detected header index
        df  = pd.read_excel(xls, sheet_name=sheet, header=hdr)
        return df, xls.sheet_names, sheet
    else:
        # CSV
        buf = io.BytesIO(raw)
        df0 = pd.read_csv(buf, header=None)
        hdr = _detect_header_index(df0)
        buf.seek(0)
        df  = pd.read_csv(buf, header=hdr)
        return df, ["csv"], None
@app.after_request
def _add_cors_headers(resp):
    origin_raw = request.headers.get("Origin")
    origin = _normalize_origin(origin_raw)
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin_raw  # echo exactly
        resp.headers["Vary"] = "Origin"
    resp.headers.setdefault("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
    resp.headers.setdefault("Access-Control-Allow-Headers", "Content-Type,Authorization")
    return resp
# -----------------------------------------------

# ---------- LLM header mapping helpers ----------
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

    "FAMILY DISAMBIGUATION RULES (follow strictly):\n"
    "- PHOSPHORUS:\n"
    "  • total_phosphorus  = all P (organic+inorganic, dissolved+particulate). Synonyms: 'total phosphorus', 'TP', "
    "    'P total', 'Ptot'.\n"
    "  • phosphate         = dissolved reactive P (orthophosphate). Synonyms: 'phosphate', 'orthophosphate', "
    "    'PO4-P', 'PO4', 'SRP', 'DRP', 'reactive phosphorus'.\n"
    "  ⚠️ Never map total_phosphorus as phosphate, and never map phosphate as total_phosphorus.\n"
    "  • Headers like 'PO4-P (mg/L as P)' → phosphate.\n"
    "\n"
    "- NITROGEN:\n"
    "  • total_nitrogen    = all N. Synonyms: 'Total Nitrogen', 'TN'.\n"
    "  • nitrate           = NO3 species. Synonyms: 'nitrate', 'NO3-N', 'NO3'.\n"
    "  • nitrite           = NO2 species. Synonyms: 'nitrite', 'NO2-N', 'NO2'.\n"
    "  • ammonium          = NH4 species. Synonyms: 'ammonium', 'NH4-N', 'NH4+'.\n"
    "  • total kjeldahl nitrogen (TKN) → organic_nitrogen (conventionally organic N + NH4).\n"
    "  ⚠️ Do NOT map species (nitrate/nitrite/ammonium) to total_nitrogen, and do NOT map total_nitrogen to any species.\n"
    "\n"
    "- PIGMENTS:\n"
    "  • chlorophyll_a     = 'chlorophyll a', 'chl-a', 'Chl a', 'chlorophyll_a'.\n"
    "  • pheopigments      = 'pheophytin', 'pheopigments', 'phaeophytin a'.\n"
    "  ⚠️ Never map pheopigments/pheophytin to chlorophyll_a, and never map chlorophyll_a to pheopigments.\n"
    "\n"
    "UNITS:\n"
    "- Choose a unit ONLY if it appears clearly next to the header (e.g., 'NO3-N (mg/L)'). "
    "Do not infer units from the parameter meaning. "
    "If no unit text is present, use 'not_present'. "
)

USER_PROMPT_TEMPLATE = """Task:
Use the vocabularies and the FAMILY DISAMBIGUATION RULES given in the system prompt.

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

def _groq_client():
    from groq import Groq
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    return Groq(api_key=key)

def call_groq_map_headers(headers: List[str]) -> List[Dict[str, Any]]:
    client = _groq_client()
    model_name = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
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
        messages=[{"role":"system","content":SYSTEM_PROMPT},
                  {"role":"user","content":user_prompt}],
    )
    arr = _coerce_json_array(resp.choices[0].message.content.strip())
    if not arr:
        arr = [{"raw_header": h, "map_to": "unknown", "unit_map_to": UNIT_NOT_PRESENT,
                "confidence": 0.0, "unit_confidence": 0.0} for h in headers]
    return arr

# In-memory session cache for /ingest/map → /ingest/persist
SESSION_CACHE: Dict[str, Dict[str, Any]] = {}

# ===================================================
# Routes
# ===================================================

@app.get("/health")
def health():
    return jsonify({"ok": True})

@app.post("/auth/login")
def auth_login():
    try:
        data = request.get_json(force=True)
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        # 1) Check password via local auth (keeps the simple pw flow)
        _cid = login_local(email, password)
        if not _cid:
            return json_error("Invalid credentials", 401)

        with get_connection() as conn:
            ensure_schema(conn, seed_all=False)

            # 2) If a client with this email already exists in DB, reuse its client_id
            with conn.cursor() as cur:
                cur.execute("SELECT client_id FROM public.clients WHERE email=%s", (email,))
                row = cur.fetchone()
            if row:
                client_id = row[0]
            else:
                client_id = _cid  # first login for this email → create

            # 3) Upsert (by client_id) so name is set and row exists
            ensure_client(conn, client_id=client_id, email=email, display_name=email.split("@")[0])

        return jsonify({"client_id": client_id, "email": email})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)
@app.post("/ingest/sheets")
def ingest_sheets():
    """
    Return available sheets for an uploaded file WITHOUT mapping.
    Body: multipart/form-data with "file"
    Response: { kind: "csv"|"excel", available_sheets: ["Sheet1", ...] }
    """
    try:
        if "file" not in request.files:
            return json_error("missing file", 400)
        f = request.files["file"]
        raw = f.read()
        if not raw:
            return json_error("empty upload", 400)

        is_excel = f.filename.lower().endswith((".xlsx", ".xls"))
        if is_excel:
            xls = pd.ExcelFile(io.BytesIO(raw))
            return jsonify({
                "kind": "excel",
                "available_sheets": xls.sheet_names or []
            })
        else:
            # treat as CSV (single logical sheet)
            return jsonify({
                "kind": "csv",
                "available_sheets": ["csv"]
            })
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)
@app.post("/ingest/override_units")
def ingest_override_units():
    """
    Body: { session_id, overrides:[{column, unit}, ...] }
    Effect: rename in-session df_h columns from "param" -> "param [unit]" (if no unit yet).
    Returns fresh preview.
    """
    try:
        data = request.get_json(force=True) or {}
        sid = data.get("session_id")
        overrides = data.get("overrides") or []
        sess = SESSION_CACHE.get(sid)
        if not sess:
            return json_error("invalid session_id", 400)

        df_h: pd.DataFrame = sess.get("df_h")
        if not isinstance(df_h, pd.DataFrame) or df_h.empty:
            return json_error("no dataframe for session", 400)

        rename_map = {}
        for item in overrides:
            col = str(item.get("column") or "").strip()
            unit = str(item.get("unit") or "").strip()
            if not col or not unit:
                continue
            if col in df_h.columns and not _UNIT_IN_BRACKETS.search(col):
                rename_map[col] = f"{col} [{unit}]"

        if rename_map:
            df_h = df_h.rename(columns=rename_map)
            sess["df_h"] = df_h

        preview = clamp_preview(df_h, rows=20, cols=30)
        return jsonify({
            "columns": list(df_h.columns.astype(str)),
            "preview": preview,
            "row_count": int(len(df_h)),
            "col_count": int(df_h.shape[1]),
        })
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)
@app.post("/ingest/map")
def ingest_map():
    try:
        if "file" not in request.files:
            return json_error("missing file", 400)
        f = request.files["file"]
        if not allowed_file(f.filename):
            return json_error("unsupported file type", 415)

        sheet = request.form.get("sheet") or None
        raw = f.read()
        if not raw:
            return json_error("empty upload", 400)

        # ---- ONLY CHANGE STARTS HERE ----
        try:
            df, available_sheets, sheet_name = _read_table_with_header_detection(raw, f.filename, sheet)
        except Exception as e:
            traceback.print_exc()
            return json_error(str(e), 400)
        # ---- ONLY CHANGE ENDS HERE ----

        if df is None or df.empty:
            return json_error("empty dataframe", 400)

        headers = [str(c) for c in df.columns.tolist()]
        mapping = call_groq_map_headers(headers)

        # Build harmonized wide df
        norm_index = {_norm_col(c): c for c in df.columns}
        param_set = set(CONTROLLED_UNIT_VOCAB.keys())
        meta_set = set(CONTROLLED_META_VOCAB)

        meta_src, meta_names = [], []
        param_src, param_labels = [], []
        used_src = set()

        for item in mapping:
            raw_display = str(item.get("raw_header", ""))
            src = norm_index.get(_norm_col(raw_display))
            if src is None or src in used_src:
                continue
            used_src.add(src)
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
        df_h = df[ordered_src].copy() if ordered_src else pd.DataFrame()

        # Unit conversions toward standard
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

        # uniqueify
        seen: Dict[str, int] = {}
        def uniq(n: str) -> str:
            if n in seen:
                seen[n] += 1
                return f"{n} ({seen[n]})"
            seen[n] = 0
            return n

        final_names = [uniq(n) for n in final_names]
        rename_map = {src: new for src, new in zip(ordered_src, final_names)}
        if rename_map:
            df_h.rename(columns=rename_map, inplace=True)

        # Sampling points df
        if "sampling_point" in df_h.columns:
            df_sampling = (
                df_h[["sampling_point"]]
                .dropna()
                .assign(sampling_point=lambda d: d["sampling_point"].astype(str).str.strip())
                .loc[lambda d: d["sampling_point"] != ""]
                .drop_duplicates()
                .reset_index(drop=True)
            )
            sampling_points = df_sampling["sampling_point"].tolist()
        else:
            df_sampling = pd.DataFrame({"sampling_point": []})
            sampling_points = []

        try:
            is_excel = f.filename.lower().endswith((".xlsx", ".xls"))
            waterbody = resolve_waterbody(
                df=df,
                filename=f.filename,
                sheet_names=[sheet_name] if (is_excel and sheet_name) else ["csv"]
            )
        except Exception:
            traceback.print_exc()
            waterbody = None

        session_id = str(uuid.uuid4())
        SESSION_CACHE[session_id] = {
            "df_h": df_h,
            "df_sampling": df_sampling,
            "waterbody": waterbody,
            "file_name": f.filename,
            "sheet_name": sheet_name,
            "raw_bytes": raw,
            "available_sheets": available_sheets,
        }

        preview = clamp_preview(df_h, rows=20, cols=30)
        return jsonify({
            "columns": list(df_h.columns.astype(str)),
            "preview": preview,
            "sampling_points": sampling_points,
            "availableSheets": available_sheets,
            "waterbody": waterbody,
            "session_id": session_id,
            "row_count": int(len(df_h)),
            "col_count": int(df_h.shape[1]),
        })
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)
@app.delete("/datasets/<dataset_id>")
def delete_dataset(dataset_id):
    try:
        client_id = request.args.get("client_id")
        if not client_id:
            return json_error("client_id is required", 400)

        with get_connection() as conn:
            with conn.cursor() as cur:
                # Only allow deleting your own dataset
                cur.execute(
                    "DELETE FROM public.datasets WHERE dataset_id = %s AND client_id = %s RETURNING dataset_id",
                    (dataset_id, client_id),
                )
                row = cur.fetchone()
                if not row:
                    return json_error("dataset not found", 404)
            conn.commit()

        # Measurements are removed via ON DELETE CASCADE
        return jsonify({"ok": True, "deleted": dataset_id})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)
@app.post("/ingest/persist")
def ingest_persist():
    try:
        data = request.get_json(force=True)
        session_id = data.get("session_id")
        client_id = data.get("client_id")
        email = data.get("email") or "unknown@example.com"
        use_hash = bool(data.get("use_content_hash", True))
        value_qualifier = (data.get("value_qualifier") or "").strip()

        # NEW: merge policy
        mode = (data.get("mode") or "new").lower()  # "new" | "append_auto" | "append_to"
        target_dataset_id = data.get("target_dataset_id")  # used when mode == "append_to"

        sess = SESSION_CACHE.get(session_id)
        if not sess:
            return json_error("invalid session_id", 400)

        df_h = sess["df_h"]
        df_sampling = sess["df_sampling"]
        wb = sess["waterbody"]
        file_name = data.get("file_name") or sess["file_name"]
        sheet_name = data.get("sheet_name") or sess["sheet_name"]
        raw_bytes = sess["raw_bytes"]

        chash = content_sha256(raw_bytes, extra=(sheet_name or "")) if use_hash else None

        with get_connection() as conn:
            ensure_schema(conn, seed_all=False)
            ensure_client(conn, client_id, email, email.split("@")[0] if email else None)

            waterbody_id = upsert_waterbody(conn, client_id, wb) if wb else None
            sp_map = upsert_sampling_points(conn, client_id, waterbody_id, df_sampling)

            # ---------- decide dataset_id based on mode ----------
            dataset_id = None

            if mode == "append_to":
                if not target_dataset_id:
                    return json_error("target_dataset_id required for mode=append_to", 400)
                dataset_id = target_dataset_id

            elif mode == "append_auto" and waterbody_id:
                # pick the most recent dataset for this client + waterbody
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT dataset_id
                        FROM public.datasets
                        WHERE client_id = %s AND waterbody_id = %s
                        ORDER BY uploaded_at DESC
                        LIMIT 1
                        """,
                        (client_id, waterbody_id),
                    )
                    row = cur.fetchone()
                if row:
                    dataset_id = row[0]

            if not dataset_id:
                # create new dataset row
                dataset_id = register_dataset(
                    conn, client_id,
                    file_name=file_name,
                    sheet_name=sheet_name,
                    row_count=len(df_h), col_count=df_h.shape[1],
                    waterbody_id=waterbody_id,
                    content_hash=chash if use_hash else None,
                )
            else:
                # appending → bump timestamp
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE public.datasets SET uploaded_at = now() WHERE dataset_id = %s",
                        (dataset_id,),
                    )
                conn.commit()
            # ------------------------------------------------------

            long_df = melt_harmonized(df_h)

            used_param_codes = long_df["parameter_code"].dropna().astype(str).str.lower().unique().tolist()
            upsert_parameters_for_codes(conn, used_param_codes)
            used_meta_cols = [c for c in df_h.columns if c in CONTROLLED_META_VOCAB]
            upsert_non_params_for_cols(conn, used_meta_cols)

            if value_qualifier:
                long_df["value_qualifier"] = value_qualifier

            result = insert_measurements(conn, client_id, dataset_id, long_df, sp_map)

        return jsonify({
            "dataset_id": dataset_id,
            "waterbody_id": waterbody_id,
            "rows_in": int(result["rows_in"]),
            "rows_inserted": int(result["rows_inserted"]),
            "rows_skipped": int(result["rows_in"] - result["rows_inserted"]),
            "mode": mode,
            "appended_to_existing": mode in ("append_auto","append_to")
        })
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)

@app.get("/datasets")
def list_datasets():
    try:
        client_id = request.args.get("client_id")
        if not client_id:
            return json_error("client_id is required", 400)
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT d.dataset_id, d.file_name, d.sheet_name, d.row_count, d.col_count, d.uploaded_at,
                           w.name AS waterbody_name, w.type AS waterbody_type
                    FROM public.datasets d
                    LEFT JOIN public.waterbodies w ON w.waterbody_id = d.waterbody_id
                    WHERE d.client_id = %s
                    ORDER BY d.uploaded_at DESC
                    LIMIT 200
                """, (client_id,))
                rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "dataset_id": r[0], "file_name": r[1], "sheet_name": r[2],
                "row_count": r[3], "col_count": r[4],
                "uploaded_at": r[5].isoformat() if r[5] else None,
                "waterbody_name": r[6], "waterbody_type": r[7]
            })
        return jsonify({"items": out})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)

@app.get("/measurements")
def measurements():
    try:
        client_id = request.args.get("client_id")
        dataset_id = request.args.get("dataset_id")
        parameter = request.args.get("parameter")
        point = request.args.get("point")
        t_from = request.args.get("from")
        t_to = request.args.get("to")
        if not client_id or not dataset_id:
            return json_error("client_id and dataset_id required", 400)

        params = [dataset_id]
        where = ["m.dataset_id = %s"]

        if parameter:
            where.append("p.code = %s"); params.append(parameter.lower())
        if point:
            where.append("sp.code = %s"); params.append(point)
        if t_from:
            where.append("m.ts >= %s"); params.append(t_from)
        if t_to:
            where.append("m.ts <= %s"); params.append(t_to)

        sql = f"""
            SELECT
              m.ts,                                                      -- 0
              COALESCE(sp.code,'')              AS spcode,               -- 1
              p.code                            AS pcode,                -- 2
              CASE
                WHEN lower(p.code) = 'ph'  THEN 'pH'
                WHEN lower(p.code) = 'toc' THEN 'TOC'
                ELSE p.display_name
              END                               AS parameter_display,    -- 3
              m.value,                                                   -- 4
              COALESCE(m.unit, p.standard_unit) AS unit,                -- 5
              m.quality_flag_id,                                        -- 6
              sp.lat,                                                   -- 7
              sp.lon                                                    -- 8
            FROM public.measurements AS m
            JOIN public.parameters  AS p  ON p.parameter_id = m.parameter_id
            LEFT JOIN public.sampling_points AS sp ON sp.sampling_point_id = m.sampling_point_id
            WHERE { ' AND '.join(where) }
            ORDER BY m.ts NULLS LAST
            LIMIT 50000
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        data = [{
            "ts": (r[0].isoformat() if r[0] else None),
            "sampling_point": r[1],
            "parameter": r[2],
            "parameter_display": r[3],
            "value": None if r[4] is None else float(r[4]),
            "unit": r[5],
            "quality_flag_id": r[6],
            "lat": None if r[7] is None else float(r[7]),
            "lon": None if r[8] is None else float(r[8]),
        } for r in rows]

        return jsonify({"data": data})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)

@app.get("/analytics/correlation")
def correlation():
    try:
        client_id = request.args.get("client_id")
        dataset_id = request.args.get("dataset_id")
        method = (request.args.get("method") or "pearson").lower()
        if method not in ("pearson", "spearman"):
            return json_error("method must be pearson|spearman", 400)
        if not client_id or not dataset_id:
            return json_error("client_id and dataset_id required", 400)

        sql = """
            SELECT
              m.ts::date                           AS d,
              COALESCE(sp.code,'')                 AS point,
              p.code                                AS param,
              AVG(m.value)                          AS value
            FROM public.measurements m
            JOIN public.parameters p ON p.parameter_id = m.parameter_id
            LEFT JOIN public.sampling_points sp ON sp.sampling_point_id = m.sampling_point_id
            WHERE m.dataset_id = %s
              AND m.value IS NOT NULL
            GROUP BY 1,2,3
        """
        with get_connection() as conn:
            df = pd.read_sql(sql, conn, params=(dataset_id,))
        if df.empty:
            return jsonify({"labels": [], "matrix": []})

        # pivot to (date,point) × param and compute correlations across rows
        df_p = df.pivot_table(index=["d", "point"], columns="param", values="value", aggfunc="mean")
        df_p = df_p.dropna(axis=1, how="all")  # drop empty columns
        corr = df_p.corr(method=method).fillna(0)
        return jsonify({"labels": list(corr.columns.astype(str)), "matrix": corr.values.tolist()})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)

@app.get("/analytics/anomalies")
def anomalies():
    try:
        client_id = request.args.get("client_id")
        dataset_id = request.args.get("dataset_id")
        if not client_id or not dataset_id:
            return json_error("client_id and dataset_id required", 400)
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT p.code, COALESCE(sp.code,''), qf.code, COUNT(*)
                    FROM public.measurements m
                    JOIN public.parameters p ON p.parameter_id = m.parameter_id
                    LEFT JOIN public.sampling_points sp ON sp.sampling_point_id = m.sampling_point_id
                    LEFT JOIN public.quality_flags qf ON qf.quality_flag_id = m.quality_flag_id
                    WHERE m.dataset_id = %s
                    GROUP BY 1,2,3
                """, (dataset_id,))
                rows = cur.fetchall()
        # aggregate
        by_param: Dict[str, Dict[str,int]] = {}
        by_point: Dict[str, Dict[str,int]] = {}
        for pcode, spcode, qcode, cnt in rows:
            q = qcode or "ok"
            by_param.setdefault(pcode, {"ok":0,"out_of_range":0,"missing":0,"outlier":0})
            by_param[pcode][q] = by_param[pcode].get(q, 0) + cnt
            spk = spcode or ""
            by_point.setdefault(spk, {"ok":0,"out_of_range":0,"missing":0,"outlier":0})
            by_point[spk][q] = by_point[spk].get(q, 0) + cnt
        return jsonify({"by_parameter": by_param, "by_sampling_point": by_point})
    except Exception as e:
        traceback.print_exc()
        return json_error(str(e), 500)

# ---------------- Talk2CSV (read-only) ----------------

_BLOCK = (
    "insert","update","delete","drop","alter","create","grant","revoke",
    "truncate","vacuum","analyze","copy","merge","call","do"
)
_COMMENT = re.compile(r"(--[^\n]*\n)|(/\*.*?\*/)", re.IGNORECASE | re.DOTALL)

def _is_safe_select(sql: str) -> bool:
    """
    Defensive checker:
    - strip comments
    - must start with SELECT or WITH
    - cannot contain blacklisted verbs
    - forbid semicolons (single statement only)
    """
    if not sql:
        return False
    s = _COMMENT.sub("\n", sql).strip().lower()
    if ";" in s:
        return False
    if not (s.startswith("select") or s.startswith("with ")):
        return False
    for bad in _BLOCK:
        if re.search(rf"\b{re.escape(bad)}\b", s):
            return False
    return True

def _fetch_schema(conn):
    """
    Lightweight public schema snapshot → {table: [{name,type}, ...]}
    """
    q = """
    SELECT table_name, column_name, data_type, ordinal_position
    FROM information_schema.columns
    WHERE table_schema='public'
    ORDER BY table_name, ordinal_position;
    """
    with conn.cursor(cursor_factory=pgx.DictCursor) as cur:
        cur.execute(q)
        rows = cur.fetchall()
    schema = {}
    for r in rows:
        schema.setdefault(r["table_name"], []).append(
            {"name": r["column_name"], "type": r["data_type"]}
        )
    return schema

def _run_readonly_sql(conn, sql: str, limit: int = 500):
    if not _is_safe_select(sql):
        raise ValueError("Only SELECT statements are allowed.")
    with conn.cursor(cursor_factory=pgx.DictCursor) as cur:
        cur.execute("SET LOCAL default_transaction_read_only = on")
        cur.execute(f"SELECT * FROM ({sql}) sub LIMIT %s", (int(limit),))
        rows = cur.fetchall()

    def norm(v):
        if isinstance(v, decimal.Decimal):
            try:
                return float(v)
            except Exception:
                return None
        if isinstance(v, (datetime, date)):
            return v.isoformat()
        return v

    out_rows = [{k: norm(v) for k, v in dict(r).items()} for r in rows]
    cols = list(out_rows[0].keys()) if out_rows else []
    return {"columns": cols, "rows": out_rows}

ASSISTANT_SYSTEM = (
  "You are Talk2CSV, a careful water-research copilot with read-only access to a Postgres database.\n"
  "\n"
  "CONTRACT (always output STRICT JSON):\n"
  "{\n"
  '  "answer": string,\n'
  '  "sql": string|null,\n'
  '  "chart": {\n'
  '     "type": "line"|"bar"|"area"|"scatter",\n'
  '     "x": "<column name>",\n'
  '     "series": ["<y col 1>", "<y col 2>", ...]\n'
  "  } | null\n"
  "}\n"
  "\n"
  "Guidelines:\n"
  "- Never write/modify data. SELECT/CTE only. One statement. No semicolons.\n"
  "- Do not include result tables inside \"answer\". The UI renders rows itself.\n"
  "- If the user asks to plot/visualize/graph, ALWAYS return a chart block.\n"
  "- Prefer clean, readable SQL. Join via documented keys only.\n"
  "- Use general water-quality knowledge for context in the answer; never invent columns.\n"
  "- If something is ambiguous, ask a brief follow-up in \"answer\" and still provide safe SQL.\n"
)

def _groq():
    from groq import Groq
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    return Groq(api_key=key)

@app.get("/assistant/schema")
def assistant_schema():
    try:
        with get_connection() as conn:
            schema = _fetch_schema(conn)
        return jsonify({"schema": schema})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.post("/assistant/chat")
def assistant_chat():
    """
    Request body:
      { messages:[{role,content}], limit?:number }
    Response:
      { answer, sql, chart, columns, rows, sql_error? }
    """
    try:
        payload = request.get_json(force=True) or {}
        limit = int(payload.get("limit", 300))

        # 1) Current prompt
        msgs = payload.get("messages") or []
        last_user_msg = None
        for m in reversed(msgs[-10:]):
            if (m.get("role") == "user") and (m.get("content") or m.get("text")):
                last_user_msg = m.get("content") or m.get("text")
                break
        prompt = (last_user_msg or "").strip()
        if not prompt:
            return jsonify({"answer": "", "sql": None, "chart": None, "columns": None, "rows": None}), 200

        wants_chart = bool(re.search(r"\b(plot|chart|graph|visual|time series|line|bar|area|scatter)\b", prompt, re.I))

        # 2) Schema snapshot
        with get_connection() as conn:
            schema = _fetch_schema(conn)

        schema_notes = {
            "entities": {
                "measurements": {"keys": ["measurement_id","dataset_id","parameter_id","sampling_point_id","quality_flag_id","ts","value","unit"]},
                "parameters": {"keys": ["parameter_id","code","display_name","standard_unit"]},
                "sampling_points": {"keys": ["sampling_point_id","client_id","code","name","lat","lon"]},
                "datasets": {"keys": ["dataset_id","client_id","uploaded_at","waterbody_id"]},
                "quality_flags": {"keys": ["quality_flag_id","code"]},
            },
            "joins": [
                "measurements.parameter_id = parameters.parameter_id",
                "measurements.sampling_point_id = sampling_points.sampling_point_id",
                "measurements.quality_flag_id = quality_flags.quality_flag_id",
                "measurements.dataset_id = datasets.dataset_id",
            ],
            "notes": [
                "Prefer p.code for parameter identities.",
                "sampling_points.lat/lon are available for mapping.",
                "Use date_trunc for rollups (day, month).",
            ],
        }

        user_content = json.dumps(
            {"schema": schema, "schema_notes": schema_notes, "prompt": prompt, "wants_chart": wants_chart, "policy": "read_only_select_only"},
            ensure_ascii=False
        )

        # 3) Ask the model
        client = _groq()
        resp = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL","llama-3.3-70b-versatile"),
            temperature=0.2,
            max_tokens=10000,
            response_format={"type":"json_object"},
            messages=[
              {"role":"system","content":ASSISTANT_SYSTEM},
              {"role":"user","content":user_content},
            ],
        )
        raw = resp.choices[0].message.content.strip()
        try:
            model_json = json.loads(raw)
        except Exception:
            model_json = {"answer": raw, "sql": None, "chart": None}

        result = {
            "answer": model_json.get("answer",""),
            "sql": model_json.get("sql"),
            "chart": model_json.get("chart"),
            "columns": None,
            "rows": None,
        }

        # 4) Run SQL if present
        sql = (model_json.get("sql") or "").strip()
        columns = None
        rows = None
        if sql:
            try:
                with get_connection() as conn:
                    table = _run_readonly_sql(conn, sql, limit=limit)
                columns = table["columns"]
                rows = table["rows"]
                result["columns"] = columns
                result["rows"] = rows
            except Exception as se:
                result["sql_error"] = str(se)

        # 5) Fallback chart if user hinted and model forgot
        if wants_chart and not result.get("chart") and columns and rows:
            def is_num_col(col):
                for r in rows:
                    v = r.get(col)
                    if v is not None:
                        return isinstance(v, (int, float))
                return False

            x = columns[0]
            y_series = [c for c in columns[1:] if is_num_col(c)]
            if y_series:
                kind = "line" if re.search(r"(date|day|month|year|ts)", x, re.I) else "bar"
                result["chart"] = {"type": kind, "x": x, "series": y_series}

        return jsonify(result), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Ensure you run with Python 3.10+ (for `str | None` union syntax)
    app.run(port=8000, debug=True)

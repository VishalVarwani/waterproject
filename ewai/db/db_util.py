# csv_pipeline/db/db_utils.py
from __future__ import annotations

import re
from typing import Dict, List, Tuple, Optional
import unicodedata
import string
import pandas as pd
import psycopg2
import psycopg2.extras as pgx
from typing import Iterable
# =========================
# Canonical vocab (single source of truth)
# =========================

# Canonical unit per parameter (STANDARD_UNITS)
STANDARD_UNITS: Dict[str, str] = {
    "temperature": "C",
    "ph": "unitless",
    "dissolved_oxygen": "mg/L",
    "turbidity": "NTU",
    "conductivity": "µS/cm",
    "chlorophyll_a": "µg/L",
    "salinity": "PSU",
    "secchi_depth": "m",
    "redox": "mV",
    "total_phosphorus": "mg/L",
    "total_nitrogen": "mg/L",
    "organic_nitrogen": "mg/L",
    "nitrate": "mg/L",
    "nitrite": "mg/L",
    "ammonium": "mg/L",
    "phosphate": "mg/L",
    "sulfate": "mg/L",
    "chloride": "mg/L",
    "fluoride": "mg/L",
    "potassium": "mg/L",
    "carbon_dioxide": "mg/L",
    "uv_absorbance": "absorbance",
    "suva": "L/mg·m",
    "toc": "mg/L",
    "color_real": "PtCo",
    "reservoir_level": "m",
    "photic_zone_depth": "m",
    "pheopigments": "µg/L",
    "total_eukaryotic_algae": "cells/mL",
    "total_cyanobacteria": "cells/mL",
    "diatoms": "cells/mL",
    "ceratium": "cells/mL",
    "peridinium": "cells/mL",
    "dynobryon": "cells/mL",
    "cryptomonas": "cells/mL",
    "eudorina_pandorina": "cells/mL",
    "staurastrum": "cells/mL",
    "woronochinia": "cells/mL",
    "dolichospermum": "cells/mL",
    "aphanizomenon": "cells/mL",
    "e_coli": "CFU/100mL",
    "microcystins": "µg/L",
    "saxitoxina": "µg/L",
}

# Allowed units per parameter (CONTROLLED_UNIT_VOCAB)
CONTROLLED_UNIT_VOCAB: Dict[str, List[str]] = {
    "temperature": ["C", "K", "F"],
    "ph": ["unitless"],
    "dissolved_oxygen": ["mg/L", "ppm",],
    "turbidity": ["NTU", "FNU"],
    "conductivity": ["µS/cm", "mS/cm"],
    "chlorophyll_a": ["µg/L"],
    "salinity": ["PSU"],
    "secchi_depth": ["m"],
    "redox": ["mV"],
    "total_phosphorus": ["mg/L", "µg/L"],
    "total_nitrogen": ["mg/L"],
    "organic_nitrogen": ["mg/L"],
    "nitrate": ["mg/L", "µg/L"],
    "nitrite": ["mg/L", "µg/L"],
    "ammonium": ["mg/L", "µg/L"],
    "phosphate": ["mg/L", "µg/L"],
    "sulfate": ["mg/L"],
    "chloride": ["mg/L"],
    "fluoride": ["mg/L"],
    "potassium": ["mg/L"],
    "carbon_dioxide": ["mg/L", "ppm"],
    "uv_absorbance": ["absorbance"],
    "suva": ["L/mg·m"],
    "toc": ["mg/L"],
    "color_real": ["PtCo"],
    "reservoir_level": ["m"],
    "photic_zone_depth": ["m"],
    "pheopigments": ["µg/L"],
    "total_eukaryotic_algae": ["cells/mL"],
    "total_cyanobacteria": ["cells/mL"],
    "diatoms": ["cells/mL"],
    "ceratium": ["cells/mL"],
    "peridinium": ["cells/mL"],
    "dynobryon": ["cells/mL"],
    "cryptomonas": ["cells/mL"],
    "eudorina_pandorina": ["cells/mL"],
    "staurastrum": ["cells/mL"],
    "woronochinia": ["cells/mL"],
    "dolichospermum": ["cells/mL"],
    "aphanizomenon": ["cells/mL"],
    "e_coli": ["CFU/100mL"],
    "microcystins": ["µg/L"],
    "saxitoxina": ["µg/L"],
}

# Non-parameter (meta) column codes
CONTROLLED_META_VOCAB: List[str] = [
    "timestamp", "datetime", "date", "time",
    "sampling_point", "site", "station", "site_id",
    "latitude", "longitude", "lat", "lon",
    "depth", "sample_id", "operator_id",
    "remarks", "notes", "file_name",
]
# --- Quality flags (code -> id) ---
QUALITY_FLAGS = {
    "ok": 0,
    "out_of_range": 1,
    "missing": 2,
    "outlier": 3,
}

# --- Simple plausible ranges per parameter (edit as you wish) ---
# All values assumed in STANDARD_UNITS (your harmonizer already converts most).
PLAUSIBLE_RANGE = {
    "temperature": (-5.0, 50.0),           # °C
    "ph": (0.0, 14.0),
    "dissolved_oxygen": (0.0, 25.0),       # mg/L
    "conductivity": (0.0, 50000.0),        # µS/cm
    "chlorophyll_a": (0.0, 1000.0),        # µg/L
    "nitrate": (0.0, 50.0),                # mg/L
    "turbidity": (0.0, 20000.0),           # NTU
    # ...add more as needed...
}
PARAM_CATEGORY_MAP = {
    # Physical
    "temperature": "physical",
    "turbidity": "physical",
    "conductivity": "physical",
    "secchi_depth": "physical",
    "photic_zone_depth": "physical",
    "reservoir_level": "physical",
    "color_real": "physical",

    # Chemical
    "ph": "chemical",
    "nitrate": "chemical",
    "nitrite": "chemical",
    "chloride": "chemical",
    "sulfate": "chemical",
    "potassium": "chemical",
    "ammonium": "chemical",
    "phosphate": "chemical",
    "suva": "chemical",
    "redox": "chemical",
    "dissolved_oxygen": "chemical",
    "uv_absorbance": "chemical",
    "organic_nitrogen": "chemical",
    "total_phosphorus": "chemical",
    "toc": "chemical",
    "total_nitrogen": "chemical",
    "fluoride": "chemical",
    "carbon_dioxide": "chemical",
    


    # Biological
    "chlorophyll_a": "bio",
    "total_cyanobacteria": "bio",
    "total_eukaryotic_algae": "bio",
    "cryptomonas": "bio",
    "diatoms": "bio",
    "ceratium": "bio",
    "peridinium": "bio",
    "dynobryon": "bio",
    "aphanizomenon": "bio",
    "e_coli": "bio",
    "saxitoxina": "bio", 
    "microcystins": "bio",
    "pheopigments": "bio",
    "woronochinia": "bio",
    "staurastrum": "bio",
    "dolichospermum": "bio",
    "eudorina_pandorina": "bio",

  # if this code appears; adjust spelling to your code
}

def _norm_point_key(s: Optional[str]) -> Optional[str]:
    """Normalize a sampling-point label for dictionary matching."""
    if not s:
        return None
    # de-accent, lowercase, strip, collapse spaces, drop punctuation
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    s = " ".join(s.split())  # collapse whitespace
    s = s.translate(str.maketrans("", "", string.punctuation))
    return s or None

# Preset lat/lon for known points (normalized key -> (lat, lon))
PRESET_SAMPLING_LOCATIONS: Dict[str, Tuple[float, float]] = {
    _norm_point_key("Descarga Bombeo Pantanillo"):  (6.097617,  -75.493633),
    _norm_point_key("Entrada Palmas-Esp.Santo"):    (6.1115,    -75.497717),
    _norm_point_key("Entrada Potreros"):            (6.1043,    -75.500833),
    _norm_point_key("Presa"):                       (6.098556,  -75.490806),
    _norm_point_key("Torre 1 Superficial"):         (6.106722,  -75.498),
    _norm_point_key("Torre 2 Media"):               (6.106722,  -75.498),
    _norm_point_key("Torre 3 Profunda"):            (6.106722,  -75.498),
}
# =========================
# DDL (kept in code for ensure_schema)
# =========================

_DDL_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- NEW: clients table (for FK targets)
CREATE TABLE IF NOT EXISTS public.clients (
  client_id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.waterbodies (
  waterbody_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reservoir','lake','river','lagoon','wetland','canal','unknown')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  provenance TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, name, type)
);

CREATE TABLE IF NOT EXISTS public.sampling_points (
  sampling_point_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  waterbody_id UUID NULL REFERENCES public.waterbodies(waterbody_id) ON DELETE SET NULL,
  code TEXT NULL,
  name TEXT NULL,
  lat DOUBLE PRECISION NULL,
  lon DOUBLE PRECISION NULL,
  depth_m DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);

CREATE TABLE IF NOT EXISTS public.parameters (
  parameter_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  standard_unit TEXT NOT NULL,
  allowed_units TEXT[] NOT NULL
);

CREATE TABLE IF NOT EXISTS public.non_parameters (
  meta_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.datasets (
  dataset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  waterbody_id UUID NULL REFERENCES public.waterbodies(waterbody_id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  sheet_name TEXT NULL,
  row_count INTEGER NOT NULL,
  col_count INTEGER NOT NULL,
  content_hash TEXT NULL UNIQUE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.measurements (
  measurement_id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(dataset_id) ON DELETE CASCADE,
  sampling_point_id UUID NULL REFERENCES public.sampling_points(sampling_point_id) ON DELETE SET NULL,
  parameter_id INTEGER NOT NULL REFERENCES public.parameters(parameter_id),
  ts TIMESTAMPTZ NULL,
  value DOUBLE PRECISION NULL,
  unit TEXT NULL,
  value_qualifier TEXT NULL,
  source_column TEXT NULL,
  method TEXT NOT NULL DEFAULT 'harmonized',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, sampling_point_id, parameter_id, ts, source_column)
);

CREATE INDEX IF NOT EXISTS measurements_idx_ts
  ON public.measurements (ts);

CREATE INDEX IF NOT EXISTS measurements_idx_point_param
  ON public.measurements (sampling_point_id, parameter_id);
"""

# =========================
# Helpers
# =========================
def get_param_category(code: str) -> str:
    try:
        c = (code or "").strip().lower()
        return PARAM_CATEGORY_MAP.get(c, "unknown")
    except Exception:
        return "unknown"
def _norm_str(x) -> Optional[str]:
    if x is None:
        return None
    s = str(x).strip()
    return s if s else None

def _first_present(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    cols = {str(c).strip().lower(): c for c in df.columns}
    for c in candidates:
        if c in cols:
            return cols[c]
    return None

# =========================
# Public API
# =========================

def ensure_schema(conn, seed_all: bool = False) -> None:
    """
    Creates tables + indexes. Optionally seeds full vocab.
    Re-runnable / idempotent.
    """
    with conn.cursor() as cur:
        # Base DDL (tables without the new column)
        cur.execute(_DDL_SQL)

        # --- add/maintain the new parameters.category column & constraint ---
        # 1) add the column if missing
        cur.execute("""
          ALTER TABLE public.parameters
          ADD COLUMN IF NOT EXISTS category text
        """)

        # 2) backfill any NULLs to 'unknown'
        cur.execute("""
          UPDATE public.parameters
          SET category = COALESCE(category, 'unknown')
          WHERE category IS NULL
        """)

        # 3) set default + not null
        cur.execute("""
          ALTER TABLE public.parameters
          ALTER COLUMN category SET DEFAULT 'unknown'
        """)
        cur.execute("""
          ALTER TABLE public.parameters
          ALTER COLUMN category SET NOT NULL
        """)

        # 4) add CHECK constraint once
        cur.execute("""
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'parameters_category_check'
                AND conrelid = 'public.parameters'::regclass
            ) THEN
              ALTER TABLE public.parameters
                ADD CONSTRAINT parameters_category_check
                CHECK (category IN ('physical','chemical','bio','unknown'));
            END IF;
          END$$;
        """)

        # --- seed quality_flags (existing behavior) ---
        for code, qid in QUALITY_FLAGS.items():
            label = {
                "ok": "OK",
                "out_of_range": "Out of range",
                "missing": "Missing",
                "outlier": "Outlier",
            }[code]
            desc = {
                "ok": "Value present and within range",
                "out_of_range": "Present but outside expected range",
                "missing": "Value missing or non-numeric",
                "outlier": "Statistical outlier",
            }[code]
            cur.execute(
                """
                INSERT INTO public.quality_flags (quality_flag_id, code, label, description)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (quality_flag_id) DO UPDATE
                SET code = EXCLUDED.code,
                    label = EXCLUDED.label,
                    description = EXCLUDED.description
                """,
                (qid, code, label, desc),
            )

        # --- optional eager parameter/meta seeding (now includes category) ---
        if seed_all:
            for code, std_unit in STANDARD_UNITS.items():
                allowed = CONTROLLED_UNIT_VOCAB.get(code, [])
                display_name = code.replace("_", " ").title()
                category = get_param_category(code)
                cur.execute(
                    """
                    INSERT INTO public.parameters (code, display_name, standard_unit, allowed_units, category)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (code) DO UPDATE
                    SET display_name  = EXCLUDED.display_name,
                        standard_unit = EXCLUDED.standard_unit,
                        allowed_units = EXCLUDED.allowed_units,
                        category      = EXCLUDED.category
                    """,
                    (code, display_name, std_unit, allowed, category),
                )

            for code in CONTROLLED_META_VOCAB:
                cur.execute(
                    """
                    INSERT INTO public.non_parameters (code)
                    VALUES (%s)
                    ON CONFLICT (code) DO NOTHING
                    """,
                    (code,),
                )
    conn.commit()
def _compute_quality_flags_df(long_df: pd.DataFrame) -> pd.Series:
    """
    Returns a Series of quality_flag codes aligned with long_df index.
    Priority: missing > out_of_range > outlier > ok.
    Outliers computed per parameter_code within the given long_df (Tukey 3*IQR).
    """
    out = pd.Series(index=long_df.index, dtype="object")

    # missing
    missing_mask = long_df["value"].isna()
    out.loc[missing_mask] = "missing"

    # out_of_range by parameter
    for pcode, (lo, hi) in PLAUSIBLE_RANGE.items():
        mask_p = (long_df["parameter_code"] == pcode) & (~missing_mask)
        if not mask_p.any():
            continue
        vals = long_df.loc[mask_p, "value"]
        oor = (vals < lo) | (vals > hi)
        out.loc[mask_p & oor] = "out_of_range"

    # outlier: apply per parameter on remaining non-missing rows
    rem = out.isna() & (~missing_mask)
    for pcode, grp in long_df.loc[rem].groupby("parameter_code"):
        v = grp["value"].astype(float)
        if v.size < 5:
            continue  # too few to score outliers
        q1 = v.quantile(0.25)
        q3 = v.quantile(0.75)
        iqr = q3 - q1
        if pd.isna(iqr) or iqr == 0:
            continue
        low = q1 - 3.0 * iqr
        high = q3 + 3.0 * iqr
        outlier_mask = (v < low) | (v > high)
        out.loc[grp.index[outlier_mask]] = "outlier"

    # remaining → ok
    out.fillna("ok", inplace=True)
    return out

def upsert_parameters_for_codes(conn, codes: Iterable[str]) -> None:
    """
    Lazily upsert only the parameter codes used by this ingest.
    Unknown codes (not in STANDARD_UNITS) are ignored.
    Ensures the new 'category' column is populated/updated.
    """
    codes = [str(c).strip().lower() for c in set(codes or []) if c]
    if not codes:
        return
    with conn.cursor() as cur:
        for code in codes:
            std_unit = STANDARD_UNITS.get(code)
            if not std_unit:
                # unknown param → skip (insert_measurements will also skip it)
                continue
            allowed = CONTROLLED_UNIT_VOCAB.get(code, [])
            display_name = code.replace("_", " ").title()
            category = get_param_category(code)  # 'physical' | 'chemical' | 'bio' | 'unknown'
            cur.execute(
                """
                INSERT INTO public.parameters (code, display_name, standard_unit, allowed_units, category)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET display_name  = EXCLUDED.display_name,
                    standard_unit = EXCLUDED.standard_unit,
                    allowed_units = EXCLUDED.allowed_units,
                    category      = EXCLUDED.category
                """,
                (code, display_name, std_unit, allowed, category),
            )
    conn.commit()

def upsert_non_params_for_cols(conn, cols: Iterable[str]) -> None:
    """
    Optional: lazily track meta codes seen in files. Safe to skip.
    """
    # keep only those in our controlled meta vocab
    wanted = [c for c in set((cols or [])) if c in CONTROLLED_META_VOCAB]
    if not wanted:
        return
    with conn.cursor() as cur:
        for code in wanted:
            cur.execute(
                """
                INSERT INTO public.non_parameters (code)
                VALUES (%s)
                ON CONFLICT (code) DO NOTHING
                """,
                (code,),
            )
    conn.commit()
def ensure_client(conn, client_id: str, email: str, display_name: Optional[str] = None) -> None:
    """
    Upserts the logged-in client into public.clients so FK constraints succeed.
    Safe to call on every request.
    """
    if not client_id or not email:
        raise ValueError("client_id and email are required for ensure_client()")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.clients (client_id, email, display_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (client_id) DO UPDATE
            SET email = EXCLUDED.email,
                display_name = COALESCE(EXCLUDED.display_name, public.clients.display_name)
            """,
            (client_id, email, display_name),
        )
    conn.commit()
def upsert_waterbody(conn, client_id: str, wb: dict) -> str:
    """
    Inserts or finds existing (client_id, name, type).
    Returns waterbody_id.
    """
    if not client_id:
        raise ValueError("client_id is required")
    if not wb or not wb.get("name") or not wb.get("type"):
        raise ValueError("wb must include name and type")

    name = _norm_str(wb.get("name"))
    wtype = _norm_str(wb.get("type"))
    confidence = float(wb.get("confidence") or 0.0)
    provenance = wb.get("provenance") or []
    if wtype not in ('reservoir','lake','river','lagoon','wetland','canal','unknown'):
        wtype = 'unknown'

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.waterbodies (client_id, name, type, confidence, provenance)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (client_id, name, type)
            DO UPDATE SET
                confidence = GREATEST(public.waterbodies.confidence, EXCLUDED.confidence),
                provenance = (SELECT ARRAY(SELECT DISTINCT UNNEST(public.waterbodies.provenance || EXCLUDED.provenance)))
            RETURNING waterbody_id
            """,
            (client_id, name, wtype, confidence, provenance),
        )
        waterbody_id = cur.fetchone()[0]
    conn.commit()
    return waterbody_id


def upsert_sampling_points(conn, client_id: str, waterbody_id: Optional[str], df_sampling: pd.DataFrame) -> dict:
    """
    Upserts per (client_id, code). Links to waterbody_id if provided.
    Returns mapping {code_or_name: sampling_point_id}.
    """
    if not isinstance(df_sampling, pd.DataFrame) or df_sampling.empty:
        return {}

    code_col = _first_present(df_sampling, ["sampling_point", "site", "station", "site_id"])
    if not code_col:
        raise ValueError("df_sampling must contain one of: sampling_point/site/station/site_id")

    lat_col = _first_present(df_sampling, ["lat", "latitude"])
    lon_col = _first_present(df_sampling, ["lon", "longitude"])
    depth_col = _first_present(df_sampling, ["depth_m", "depth"])

    # Deduplicate & clean
    sub = (
        df_sampling[[c for c in [code_col, lat_col, lon_col, depth_col] if c is not None]]
        .dropna(subset=[code_col])
        .copy()
    )
    sub[code_col] = sub[code_col].astype(str).str.strip()
    sub = sub.loc[sub[code_col] != ""].drop_duplicates(subset=[code_col])

    mapping: Dict[str, str] = {}
    with conn.cursor() as cur:
        for _, row in sub.iterrows():
            code = _norm_str(row[code_col])
            if not code:
                continue
            name = code  # optional friendly alias same as code for now
            lat = float(row[lat_col]) if lat_col and pd.notna(row[lat_col]) else None
            lon = float(row[lon_col]) if lon_col and pd.notna(row[lon_col]) else None

            # Auto-assign from preset if missing
            if lat is None or lon is None:
                preset = PRESET_SAMPLING_LOCATIONS.get(_norm_point_key(code)) or PRESET_SAMPLING_LOCATIONS.get(_norm_point_key(name))
                if preset:
                    plat, plon = preset
                    # only fill if missing; never overwrite provided values
                    lat = lat if lat is not None else plat
                    lon = lon if lon is not None else plon
            depth_m = float(row[depth_col]) if depth_col and pd.notna(row[depth_col]) else None

            cur.execute(
                """
                INSERT INTO public.sampling_points (client_id, waterbody_id, code, name, lat, lon, depth_m)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (client_id, code)
                DO UPDATE SET
                  waterbody_id = COALESCE(EXCLUDED.waterbody_id, public.sampling_points.waterbody_id),
                  name = COALESCE(EXCLUDED.name, public.sampling_points.name),
                  lat = COALESCE(EXCLUDED.lat, public.sampling_points.lat),
                  lon = COALESCE(EXCLUDED.lon, public.sampling_points.lon),
                  depth_m = COALESCE(EXCLUDED.depth_m, public.sampling_points.depth_m)
                RETURNING sampling_point_id
                """,
                (client_id, waterbody_id, code, name, lat, lon, depth_m),
            )
            sp_id = cur.fetchone()[0]
            mapping[code] = sp_id
    conn.commit()
    return mapping


def register_dataset(
    conn,
    client_id: str,
    file_name: str,
    sheet_name: Optional[str],
    row_count: int,
    col_count: int,
    waterbody_id: Optional[str],
    content_hash: Optional[str],
) -> str:
    """
    Inserts dataset and returns dataset_id.
    If content_hash is provided and already exists, returns the existing id (idempotent).
    """
    if not client_id or not file_name:
        raise ValueError("client_id and file_name are required")

    with conn.cursor() as cur:
        if content_hash:
            cur.execute(
                """
                INSERT INTO public.datasets (client_id, waterbody_id, file_name, sheet_name, row_count, col_count, content_hash)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (content_hash)
                DO UPDATE SET uploaded_at = now()
                RETURNING dataset_id
                """,
                (client_id, waterbody_id, file_name, sheet_name, row_count, col_count, content_hash),
            )
        else:
            cur.execute(
                """
                INSERT INTO public.datasets (client_id, waterbody_id, file_name, sheet_name, row_count, col_count)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING dataset_id
                """,
                (client_id, waterbody_id, file_name, sheet_name, row_count, col_count),
            )
        dataset_id = cur.fetchone()[0]
    conn.commit()
    return dataset_id


# ---------- melt (wide -> long) ----------

_UNIT_IN_BRACKETS = re.compile(r"^(?P<param>[^\[]+?)\s*\[(?P<unit>[^\]]+)\]\s*$", re.UNICODE)

def _parse_param_and_unit(col_name: str) -> Tuple[str, Optional[str]]:
    """
    Accept:
      - "param"
      - "param [unit]"
    Returns (parameter_code, unit or None).
    """
    c = str(col_name).strip()
    m = _UNIT_IN_BRACKETS.match(c)
    if m:
        return m.group("param").strip(), m.group("unit").strip()
    return c, None


def melt_harmonized(df_h: pd.DataFrame) -> pd.DataFrame:
    """
    Convert harmonized wide dataframe into long/tidy:
      columns: ts, sampling_point, parameter_code, unit, value, source_column
    - Detect timestamp column from meta vocab.
    - Detect sampling_point column from synonyms.
    - Keep rows even when value is NaN (so they can be flagged as 'missing').
    """
    if not isinstance(df_h, pd.DataFrame) or df_h.empty:
        return pd.DataFrame(columns=["ts","sampling_point","parameter_code","unit","value","source_column"])

    ts_col = _first_present(df_h, ["timestamp","datetime","date","time"])
    sp_col = _first_present(df_h, ["sampling_point","site","station","site_id"])

    ts_series = None
    if ts_col:
        ts_try = pd.to_datetime(df_h[ts_col], errors="coerce", utc=True, infer_datetime_format=True)
        if ts_try.isna().mean() > 0.5:
            ts_try = pd.to_datetime(df_h[ts_col], errors="coerce", utc=True, dayfirst=True, infer_datetime_format=True)
        ts_series = ts_try

    sp_series = (
        df_h[sp_col].astype(str).str.strip()
        if sp_col else pd.Series([None]*len(df_h), index=df_h.index)
    )

    meta_cols = set([c for c in [ts_col, sp_col] if c])
    param_cols = [c for c in df_h.columns if c not in meta_cols]

    out_rows = []
    for col in param_cols:
        pcode_raw, unit = _parse_param_and_unit(col)
        pcode = pcode_raw.strip().lower()
        values = pd.to_numeric(df_h[col], errors="coerce")  # NaNs kept

        part = pd.DataFrame({
            "ts": ts_series if ts_series is not None else pd.NaT,
            "sampling_point": sp_series,
            "parameter_code": pcode,
            "unit": unit,
            "value": values,
            "source_column": str(col),
        })
        out_rows.append(part)

    if not out_rows:
        return pd.DataFrame(columns=["ts","sampling_point","parameter_code","unit","value","source_column"])

    long_df = pd.concat(out_rows, ignore_index=True)
    long_df["sampling_point"] = long_df["sampling_point"].apply(
        lambda x: x if (isinstance(x, str) and x.strip() != "") else None
    )

    return long_df[["ts","sampling_point","parameter_code","unit","value","source_column"]]


def insert_measurements(conn, client_id: str, dataset_id: str, long_df: pd.DataFrame, sp_map: dict) -> dict:
    if not isinstance(long_df, pd.DataFrame) or long_df.empty:
        return {"rows_in": 0, "rows_inserted": 0, "rows_skipped": 0}

    required = ["parameter_code", "value", "source_column"]
    for c in required:
        if c not in long_df.columns:
            raise ValueError(f"long_df missing required column: {c}")

    # derive quality flags for this long_df (uses value; marks NaNs as 'missing')
    flags_series = _compute_quality_flags_df(long_df)
    long_df = long_df.copy()
    long_df["quality_flag_code"] = flags_series

    # parameter_id map
    param_codes = sorted(set(str(c).strip().lower() for c in long_df["parameter_code"].unique()))
    with conn.cursor(cursor_factory=pgx.DictCursor) as cur:
        cur.execute("SELECT parameter_id, code FROM public.parameters WHERE code = ANY(%s)", (param_codes,))
        rows = cur.fetchall()
    code_to_pid = {r["code"]: r["parameter_id"] for r in rows}

    qcode_to_id = QUALITY_FLAGS.copy()

    rows_in = 0
    payload = []
    for _, r in long_df.iterrows():
        pcode = str(r["parameter_code"]).strip().lower()
        pid = code_to_pid.get(pcode)
        if not pid:
            continue

        sp_code = r.get("sampling_point")
        sp_id = sp_map.get(sp_code.strip()) if isinstance(sp_code, str) and sp_code.strip() else None

        ts = None
        if "ts" in r and pd.notna(r["ts"]):
            t = pd.to_datetime(r["ts"], utc=True, errors="coerce")
            ts = t.to_pydatetime() if pd.notna(t) else None

        val = r.get("value")
        is_missing = pd.isna(val)
        val = None if is_missing else float(val)
        # decide quality flag
        # 1) Missing value always wins
        # decide quality flag
        if is_missing:
            qid = QUALITY_FLAGS["missing"]  # missing always wins
        else:
            qcode = r.get("quality_flag_code")
            if qcode is None or (isinstance(qcode, float) and pd.isna(qcode)):
                qid = QUALITY_FLAGS["ok"]
            else:
                qid = QUALITY_FLAGS.get(str(qcode), QUALITY_FLAGS["ok"])

        unit = _norm_str(r.get("unit"))
        src  = _norm_str(r.get("source_column"))

        payload.append((dataset_id, sp_id, pid, ts, val, unit, None, src, 'harmonized', qid))
        rows_in += 1

    if not payload:
        return {"rows_in": 0, "rows_inserted": 0, "rows_skipped": 0}

    inserted = 0
    try:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO public.measurements
                  (dataset_id, sampling_point_id, parameter_id, ts, value, unit,
                   value_qualifier, source_column, method, quality_flag_id)
                VALUES %s
                ON CONFLICT (dataset_id, sampling_point_id, parameter_id, ts, source_column)
                DO NOTHING
                RETURNING 1
            """
            ret = pgx.execute_values(cur, sql, payload, fetch=True, page_size=10000)
            inserted = len(ret) if ret else 0
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {"rows_in": rows_in, "rows_inserted": inserted, "rows_skipped": rows_in - inserted}
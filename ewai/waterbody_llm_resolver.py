# waterbody_llm_resolver.py
from __future__ import annotations
import json, re, os
from typing import List, Dict, Any, Tuple

import pandas as pd
from groq import Groq

WATERBODY_TYPES = ["reservoir","lake","river","lagoon","wetland","canal","unknown"]

SYSTEM_PROMPT = (
    "You are a hydrology metadata resolver. From short spreadsheet snippets, "
    "extract the waterbody NAME and TYPE. TYPE must be one of: "
    + ", ".join(WATERBODY_TYPES) + ". "
    "Return STRICT JSON exactly as:\n"
    '{"name":"...","type":"...","confidence":0.0-1.0,"evidence":["...","..."]}\n'
    "Guidelines:\n"
    "- Prefer names that repeat across multiple snippets (sheet titles, notes, sampling points).\n"
    "- If you see tokens like 'Embalse/Presa/Reservorio/Reservoir/Dam' -> type=reservoir. "
    "If 'Lago/Laguna/Lake' -> type=lake. If unclear, type=unknown.\n"
    "- Keep names short, without generic words (e.g., 'Embalse La Fe' -> name='La Fe').\n"
    "- If very uncertain, set confidence<0.5 and keep type='unknown'."
)

def _get_secret(name: str, default: str = "") -> str:
    try:
        import streamlit as st
        return st.secrets.get(name, os.getenv(name, default))
    except Exception:
        return os.getenv(name, default)

def _coerce_json_obj(text: str) -> Dict[str, Any]:
    # Accept {"...":...} or {"result":{...}}
    try:
        j = json.loads(text)
        if isinstance(j, dict): 
            if all(k in j for k in ("name","type","confidence","evidence")):
                return j
            # find first dict child that looks right
            for v in j.values():
                if isinstance(v, dict) and all(k in v for k in ("name","type","confidence","evidence")):
                    return v
    except Exception:
        pass
    # last resort: try to extract the outermost {...}
    if "{" in text and "}" in text:
        snippet = text[text.find("{"): text.rfind("}")+1]
        try:
            j = json.loads(snippet)
            if isinstance(j, dict):
                return j
        except Exception:
            pass
    return {}

def _norm_text(s: str) -> str:
    return re.sub(r"\s+"," ", str(s or "")).strip()

def _sample_cells(df: pd.DataFrame, rows: int = 6, cols: int = 6) -> List[str]:
    r = min(rows, len(df))
    c = min(cols, len(df.columns))
    cells = []
    for i in range(r):
        row_vals = []
        for j in range(c):
            row_vals.append(_norm_text(df.iloc[i, j]))
        cells.append(" | ".join(row_vals))
    return cells

def build_snippets(
    df: pd.DataFrame, filename: str, sheet_names: List[str]
) -> Dict[str, Any]:
    # pick some helpful bits
    headers = [ _norm_text(c) for c in df.columns.tolist() ]
    head_cells = _sample_cells(df, rows=6, cols=min(8, len(df.columns)))

    # sniff sampling-point-like column to pass a few values
    sp_candidates = {"sampling_point","site","station","punto de muestreo","probenahmestelle"}
    sp_col = None
    for c in df.columns:
        if str(c).strip().lower() in sp_candidates:
            sp_col = c; break
    sp_values = []
    if sp_col is not None:
        sp_values = [ _norm_text(v) for v in df[sp_col].dropna().astype(str).head(30).tolist() ]

    return {
        "filename": _norm_text(filename),
        "sheet_names": sheet_names[:6],
        "headers": headers[:50],        # cap to keep token usage small
        "head_cells": head_cells[:10],
        "sampling_points": sp_values
    }

def call_groq_name_type(snippets: Dict[str, Any]) -> Dict[str, Any]:
    client = Groq(api_key=_get_secret("GROQ_API_KEY"))
    model_name = _get_secret("GROQ_MODEL", "llama-3.3-70b-versatile")
    user_prompt = (
        "Use these snippets to identify the waterbody:\n\n"
        + json.dumps(snippets, ensure_ascii=False, indent=2)
        + "\n\nReturn STRICT JSON with fields name,type,confidence,evidence."
    )
    resp = client.chat.completions.create(
        model=model_name,
        temperature=0.0,
        max_tokens=600,
        response_format={"type":"json_object"},
        messages=[{"role":"system","content":SYSTEM_PROMPT},
                  {"role":"user","content":user_prompt}]
    )
    raw = resp.choices[0].message.content.strip()
    j = _coerce_json_obj(raw)

    # sanitize
    name = _norm_text(j.get("name",""))
    wtype = _norm_text(j.get("type","unknown")).lower()
    conf  = float(j.get("confidence", 0.0) or 0.0)
    evidence = j.get("evidence", [])
    if not isinstance(evidence, list):
        evidence = [str(evidence)]

    if wtype not in WATERBODY_TYPES:
        wtype = "unknown"
    return {"name": name or "unknown", "type": wtype, "confidence": conf, "evidence": evidence}

# ---- Optional fallback using a super-light heuristic (only if LLM is unsure) ----
TYPE_HINTS = {
    "reservoir": r"\b(embalse|presa|reservorio|reservoir|dam)\b",
    "lake": r"\b(lago|laguna|lake)\b",
}

def fallback_light(snips: Dict[str,Any]) -> Tuple[str,str,float]:
    blob = " ".join([
        snips.get("filename",""),
        " ".join(snips.get("sheet_names",[])),
        " ".join(snips.get("headers",[])),
        " ".join(snips.get("head_cells",[])),
        " ".join(snips.get("sampling_points",[]))
    ]).lower()
    t = "unknown"
    if re.search(TYPE_HINTS["reservoir"], blob): t = "reservoir"
    elif re.search(TYPE_HINTS["lake"], blob): t = "lake"
    # super-naive name pull: take a capitalized bigram after a type word
    m = re.search(r"(embalse|presa|reservorio|reservoir|dam|lago|laguna|lake)\s+([A-ZÁÉÍÓÚÜÑ][\w\-]+(?:\s+[A-ZÁÉÍÓÚÜÑ][\w\-]+)?)", " ".join(snips.get("sheet_names",[])), flags=re.I)
    name = m.group(2).strip() if m else "unknown"
    return name, t, 0.55 if name!="unknown" or t!="unknown" else 0.3

def resolve_waterbody(df: pd.DataFrame, filename: str, sheet_names: List[str]) -> Dict[str, Any]:
    snips = build_snippets(df, filename, sheet_names)
    llm = call_groq_name_type(snips)
    if llm["confidence"] >= 0.6 and llm["name"] != "unknown":
        return {
            "name": llm["name"],
            "type": llm["type"],
            "confidence": llm["confidence"],
            "provenance": ["llm"],
            "needs_confirmation": False if llm["confidence"] >= 0.75 else True,
            "evidence": llm["evidence"][:3],
        }
    # fallback
    fname, ftype, fconf = fallback_light(snips)
    return {
        "name": llm["name"] if llm["name"]!="unknown" else fname,
        "type": llm["type"] if llm["type"]!="unknown" else ftype,
        "confidence": max(llm["confidence"], fconf),
        "provenance": ["llm_low_conf","fallback"],
        "needs_confirmation": True,
        "evidence": llm.get("evidence", [])[:1],
    }

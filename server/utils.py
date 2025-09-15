# server/utils.py
import hashlib
from flask import jsonify
import pandas as pd

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}

def json_error(msg: str, status: int = 400):
    resp = jsonify({"error": msg})
    resp.status_code = status
    return resp

def allowed_file(filename: str) -> bool:
    """Match app.py import; wrapper around extension check."""
    if not filename or "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[-1].lower()
    return ext in ALLOWED_EXTENSIONS

def content_sha256(b: bytes, extra: str = "") -> str:
    h = hashlib.sha256()
    h.update(b or b"")
    if extra:
        h.update(extra.encode("utf-8"))
    return h.hexdigest()

def clamp_preview(df: pd.DataFrame, rows: int = 20, cols: int = 30):
    """
    Return a JSON-serializable preview: first N rows *and* clamp wide tables.
    """
    if not isinstance(df, pd.DataFrame) or df.empty:
        return []
    sub = df.iloc[:rows, :cols].copy()
    # make sure all values are JSON encodable
    def _coerce(v):
        if pd.isna(v):
            return None
        if isinstance(v, (int, float, str, bool)):
            return v
        return str(v)
    out = []
    for _, r in sub.iterrows():
        out.append({str(k): _coerce(v) for k, v in r.to_dict().items()})
    return out

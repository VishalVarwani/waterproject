# csv_pipeline/auth/local_auth.py
from __future__ import annotations
import json, uuid
from pathlib import Path
from typing import Optional, Tuple

APP_PASSWORD = "eray123"
STORE_PATH = Path(".streamlit/local_clients.json")  # local only

def _load_store() -> dict:
    if STORE_PATH.exists():
        try:
            return json.loads(STORE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"clients": {}}  # { email_lower: {"client_id": "<uuid>"} }

def _save_store(data: dict) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def login_local(email: str, password: str) -> Optional[str]:
    """Returns client_id if password correct, else None. Creates a local id for new emails."""
    email = (email or "").strip().lower()
    if password != APP_PASSWORD or not email:
        return None
    store = _load_store()
    clients = store.get("clients", {})
    if email not in clients:
        clients[email] = {"client_id": str(uuid.uuid4())}
        store["clients"] = clients
        _save_store(store)
    return clients[email]["client_id"]

def get_local_client_id(email: str) -> Optional[str]:
    email = (email or "").strip().lower()
    store = _load_store()
    c = store.get("clients", {}).get(email)
    return c["client_id"] if c else None

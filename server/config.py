# server/config.py
import os
from dataclasses import dataclass, field

def _parse_origins(val: str) -> list[str]:
    if not val:
        return []
    parts = [p.strip() for p in val.split(",") if p.strip()]
    # normalize (no trailing slash)
    return [p[:-1] if p.endswith("/") else p for p in parts]

@dataclass
class Settings:
    # Comma-separated list in env; fallback includes local + Render
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,https://waterproject-34lr.onrender.com"
            )
        )
    )
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))

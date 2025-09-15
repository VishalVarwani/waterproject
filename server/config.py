# server/config.py
import os
from dataclasses import dataclass

@dataclass
class Settings:
    cors_origins: str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))

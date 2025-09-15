# csv/db/db_conn.py
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()  # optional .env support

def get_connection():
    # Prefer env var, else fallback to your Neon URL
    db_url = os.getenv(
        "DATABASE_URL",
        "postgresql://neondb_owner:npg_f4vizwCtZ7kF@ep-royal-darkness-ad1wv6pn-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    )
    if not db_url:
        raise RuntimeError("DATABASE_URL not set (and no fallback provided)")

    conn = psycopg2.connect(db_url)
    with conn.cursor() as cur:
        cur.execute("SET search_path TO public;")
    return conn

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import asyncpg

from models import RunRecord, RunStatus, TriggerType

DATABASE_URL = "postgresql://bearagent:Yuer0113@192.168.31.61:5432/fastcronui"

_pool: Optional[asyncpg.Pool] = None


async def init_pool():
    global _pool
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def ensure_table():
    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                trigger TEXT NOT NULL DEFAULT 'scheduled',
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                duration_ms INTEGER,
                exit_code INTEGER,
                log_file TEXT,
                error_msg TEXT
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_job_id ON runs(job_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at)")


async def insert_run(run: RunRecord):
    async with _pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO runs (id, job_id, status, trigger, started_at, log_file)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            run.id, run.job_id, run.status.value, run.trigger.value,
            run.started_at, run.log_file,
        )


async def finish_run(run_id: str, status: RunStatus, exit_code: Optional[int], error_msg: Optional[str] = None):
    now = datetime.now(timezone.utc)
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT started_at FROM runs WHERE id = $1", run_id)
        if not row:
            return
        started = row["started_at"]
        if isinstance(started, str):
            started = datetime.fromisoformat(started)
        duration_ms = int((now - started).total_seconds() * 1000)
        await conn.execute(
            """UPDATE runs SET status=$1, finished_at=$2, duration_ms=$3, exit_code=$4, error_msg=$5
               WHERE id=$6""",
            status.value, now, duration_ms, exit_code, error_msg, run_id,
        )


async def get_runs_for_job(job_id: str, limit: int = 50) -> list[RunRecord]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM runs WHERE job_id=$1 ORDER BY started_at DESC LIMIT $2",
            job_id, limit,
        )
    return [_row_to_record(r) for r in rows]


async def get_latest_run(job_id: str) -> Optional[RunRecord]:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM runs WHERE job_id=$1 ORDER BY started_at DESC LIMIT 1",
            job_id,
        )
    return _row_to_record(row) if row else None


async def get_run(run_id: str) -> Optional[RunRecord]:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM runs WHERE id=$1", run_id)
    return _row_to_record(row) if row else None


def _row_to_record(row: asyncpg.Record) -> RunRecord:
    return RunRecord(
        id=row["id"],
        job_id=row["job_id"],
        status=RunStatus(row["status"]),
        trigger=TriggerType(row["trigger"]),
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        duration_ms=row["duration_ms"],
        exit_code=row["exit_code"],
        log_file=row["log_file"],
        error_msg=row["error_msg"],
    )

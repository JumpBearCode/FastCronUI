from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import db
import scheduler
from executor import kill_job, run_job
from models import (
    JobConfig,
    JobCreate,
    JobUpdate,
    JobWithRecentRuns,
    TriggerType,
)

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
CONFIG_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    await db.ensure_table()
    await db.cleanup_stale_runs()
    yield
    await db.close_pool()


app = FastAPI(title="FastCronUI", lifespan=lifespan)


# ── Job YAML helpers ──────────────────────────────────────────

def _load_job(job_id: str) -> JobConfig:
    path = CONFIG_DIR / f"{job_id}.yaml"
    if not path.exists():
        raise HTTPException(404, f"Job {job_id} not found")
    with open(path) as f:
        return JobConfig(**yaml.safe_load(f))


def _save_job(job: JobConfig):
    path = CONFIG_DIR / f"{job.id}.yaml"
    with open(path, "w") as f:
        yaml.dump(job.model_dump(mode="json"), f, default_flow_style=False)


def _all_jobs() -> list[JobConfig]:
    jobs = []
    for p in sorted(CONFIG_DIR.glob("*.yaml")):
        with open(p) as f:
            data = yaml.safe_load(f)
            if data:
                jobs.append(JobConfig(**data))
    return jobs


# ── API: Jobs ─────────────────────────────────────────────────

@app.get("/api/jobs")
async def list_jobs() -> list[JobWithRecentRuns]:
    result = []
    for job in _all_jobs():
        latest = await db.get_latest_run(job.id)
        recent = await db.get_recent_runs(job.id, limit=10)
        cron_expr = job.schedule.to_cron()
        result.append(JobWithRecentRuns(
            config=job,
            last_status=latest.status if latest else None,
            last_run=latest.started_at if latest else None,
            next_run=cron_expr,
            recent_runs=recent,
        ))
    return result


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> JobConfig:
    return _load_job(job_id)


@app.post("/api/jobs")
def create_job(body: JobCreate) -> JobConfig:
    job = JobConfig(id=uuid.uuid4().hex[:8], **body.model_dump())
    _save_job(job)
    scheduler.sync_job(job)
    return job


@app.put("/api/jobs/{job_id}")
def update_job(job_id: str, body: JobUpdate) -> JobConfig:
    job = _load_job(job_id)
    updates = body.model_dump(exclude_none=True)
    merged = job.model_dump()
    merged.update(updates)
    job = JobConfig(**merged)
    _save_job(job)
    scheduler.sync_job(job)
    return job


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    path = CONFIG_DIR / f"{job_id}.yaml"
    if path.exists():
        path.unlink()
    scheduler.remove_job(job_id)
    return {"ok": True}


# ── API: Runs ─────────────────────────────────────────────────

@app.post("/api/jobs/{job_id}/run")
async def trigger_run(job_id: str, request: Request):
    job = _load_job(job_id)
    trigger_header = request.headers.get("X-Trigger", "manual")
    trigger = TriggerType.scheduled if trigger_header == "scheduled" else TriggerType.manual
    run_id = await run_job(job.id, job.script_path, job.timeout_seconds, trigger)
    return {"run_id": run_id}


@app.post("/api/jobs/{job_id}/kill")
async def kill_job_runs(job_id: str):
    killed = await kill_job(job_id)
    return {"ok": True, "killed": killed}


@app.get("/api/jobs/{job_id}/runs")
async def get_runs(job_id: str, limit: int = 50):
    return await db.get_runs_for_job(job_id, limit=limit)


@app.get("/api/runs")
async def list_all_runs(limit: int = 100):
    return await db.get_all_recent_runs(limit=limit)


@app.get("/api/runs/{run_id}/log")
async def get_log(run_id: str):
    run = await db.get_run(run_id)
    if not run or not run.log_file:
        raise HTTPException(404, "Log not found")
    log_path = Path(run.log_file)
    if not log_path.exists():
        raise HTTPException(404, "Log file not found on disk")
    return PlainTextResponse(log_path.read_text(errors="replace"))


# ── API: File Browser ─────────────────────────────────────────

BROWSE_ROOT = Path.home()
HIDDEN_DIRS = {".git", "node_modules", "__pycache__", ".tox", ".mypy_cache"}


@app.get("/api/browse")
def browse(path: str = ""):
    target = (BROWSE_ROOT / path).resolve()
    if not str(target).startswith(str(BROWSE_ROOT)):
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Path not found")

    if target.is_file():
        return {"type": "file", "path": str(target)}

    items = []
    try:
        for entry in sorted(target.iterdir()):
            if entry.name in HIDDEN_DIRS:
                continue
            if entry.is_dir():
                items.append({"name": entry.name, "type": "dir"})
            else:
                items.append({"name": entry.name, "type": "file", "path": str(entry)})
    except PermissionError:
        pass

    rel = str(target.relative_to(BROWSE_ROOT))
    return {"type": "dir", "path": rel, "items": items}


# ── Static files ──────────────────────────────────────────────

@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

"""Async script executor with venv detection and timeout support."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import db
from models import RunRecord, RunStatus, TriggerType

LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

# ── Process tracking ──────────────────────────────────────────
# run_id -> Process
_running: dict[str, asyncio.subprocess.Process] = {}
# job_id -> set of run_ids
_job_runs: dict[str, set[str]] = {}


def _find_venv_python(script_path: str) -> str | None:
    """Walk up to 5 parent dirs from script looking for .venv/bin/python3."""
    p = Path(script_path).resolve().parent
    for _ in range(5):
        candidate = p / ".venv" / "bin" / "python3"
        if candidate.exists():
            return str(candidate)
        p = p.parent
    return None


def _build_command(script_path: str) -> list[str]:
    if script_path.endswith(".sh"):
        return ["/bin/zsh", script_path]
    if script_path.endswith(".py"):
        python = _find_venv_python(script_path) or "python3"
        return [python, script_path]
    return ["/bin/zsh", script_path]


def _register(job_id: str, run_id: str, proc: asyncio.subprocess.Process):
    _running[run_id] = proc
    _job_runs.setdefault(job_id, set()).add(run_id)


def _unregister(job_id: str, run_id: str):
    _running.pop(run_id, None)
    if job_id in _job_runs:
        _job_runs[job_id].discard(run_id)
        if not _job_runs[job_id]:
            del _job_runs[job_id]


async def kill_job(job_id: str) -> int:
    """Kill all running processes for a job. Returns number of processes killed."""
    run_ids = list(_job_runs.get(job_id, set()))
    killed = 0
    for run_id in run_ids:
        proc = _running.get(run_id)
        if proc and proc.returncode is None:
            proc.kill()
            killed += 1
            # _execute will handle cleanup and db update via the exception path
    return killed


async def run_job(job_id: str, script_path: str, timeout_seconds: int,
                  trigger: TriggerType = TriggerType.scheduled) -> str:
    """Execute a script asynchronously. Returns run_id."""
    run_id = uuid.uuid4().hex[:12]
    log_path = LOGS_DIR / f"{run_id}.log"

    run = RunRecord(
        id=run_id,
        job_id=job_id,
        status=RunStatus.running,
        trigger=trigger,
        started_at=datetime.now(timezone.utc),
        log_file=str(log_path),
    )
    await db.insert_run(run)

    asyncio.create_task(_execute(run_id, job_id, script_path, timeout_seconds, log_path))
    return run_id


async def _execute(run_id: str, job_id: str, script_path: str, timeout_seconds: int, log_path: Path):
    cmd = _build_command(script_path)
    env = os.environ.copy()
    work_dir = str(Path(script_path).resolve().parent)

    try:
        with open(log_path, "w") as log_file:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=log_file,
                stderr=asyncio.subprocess.STDOUT,
                cwd=work_dir,
                env=env,
            )
            _register(job_id, run_id, proc)
            try:
                await asyncio.wait_for(proc.wait(), timeout=timeout_seconds)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                with open(log_path, "a") as lf:
                    lf.write(f"\n[CRONUI] Process killed: timeout after {timeout_seconds}s\n")
                await db.finish_run(run_id, RunStatus.timeout, exit_code=-1,
                                    error_msg=f"Timeout after {timeout_seconds}s")
                return

        exit_code = proc.returncode
        # returncode -9 means SIGKILL (from our kill_job)
        if exit_code == -9:
            with open(log_path, "a") as lf:
                lf.write("\n[CRONUI] Process cancelled by user\n")
            await db.finish_run(run_id, RunStatus.cancelled, exit_code=-9,
                                error_msg="Cancelled by user")
        else:
            status = RunStatus.success if exit_code == 0 else RunStatus.failed
            await db.finish_run(run_id, status, exit_code=exit_code)

    except Exception as exc:
        with open(log_path, "a") as lf:
            lf.write(f"\n[CRONUI] Execution error: {exc}\n")
        await db.finish_run(run_id, RunStatus.failed, exit_code=-1, error_msg=str(exc))
    finally:
        _unregister(job_id, run_id)

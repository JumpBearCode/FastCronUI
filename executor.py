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

    asyncio.create_task(_execute(run_id, script_path, timeout_seconds, log_path))
    return run_id


async def _execute(run_id: str, script_path: str, timeout_seconds: int, log_path: Path):
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
        status = RunStatus.success if exit_code == 0 else RunStatus.failed
        await db.finish_run(run_id, status, exit_code=exit_code)

    except Exception as exc:
        with open(log_path, "a") as lf:
            lf.write(f"\n[CRONUI] Execution error: {exc}\n")
        await db.finish_run(run_id, RunStatus.failed, exit_code=-1, error_msg=str(exc))

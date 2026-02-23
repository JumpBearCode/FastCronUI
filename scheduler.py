"""Manage crontab entries tagged with # CRONUI:{job_id}."""
from __future__ import annotations

import subprocess

from models import JobConfig

MARKER = "CRONUI"
API_BASE = "http://127.0.0.1:8787"


def _read_crontab() -> str:
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if result.returncode != 0:
        return ""
    return result.stdout


def _write_crontab(content: str):
    proc = subprocess.run(["crontab", "-"], input=content, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Failed to write crontab: {proc.stderr}")


def _build_entry(job: JobConfig) -> str:
    cron_expr = job.schedule.to_cron()
    url = f"{API_BASE}/api/jobs/{job.id}/run"
    return (
        f'{cron_expr} /usr/bin/curl -s -X POST {url} '
        f'-H "X-Trigger: scheduled" > /dev/null 2>&1 '
        f"# {MARKER}:{job.id}"
    )


def sync_job(job: JobConfig):
    """Add or update the crontab entry for a job."""
    current = _read_crontab()
    tag = f"# {MARKER}:{job.id}"
    lines = [ln for ln in current.splitlines() if tag not in ln]

    if job.enabled:
        lines.append(_build_entry(job))

    new_content = "\n".join(lines)
    if not new_content.endswith("\n"):
        new_content += "\n"
    _write_crontab(new_content)


def remove_job(job_id: str):
    """Remove the crontab entry for a job."""
    current = _read_crontab()
    tag = f"# {MARKER}:{job_id}"
    lines = [ln for ln in current.splitlines() if tag not in ln]
    new_content = "\n".join(lines)
    if not new_content.endswith("\n"):
        new_content += "\n"
    _write_crontab(new_content)


def list_managed_entries() -> list[str]:
    """Return all CRONUI-managed crontab lines."""
    current = _read_crontab()
    return [ln for ln in current.splitlines() if f"# {MARKER}:" in ln]

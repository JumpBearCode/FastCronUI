from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Frequency(str, Enum):
    hourly = "hourly"
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    custom = "custom"


class Schedule(BaseModel):
    frequency: Frequency
    minute: int = 0
    hour: int = 0
    day_of_week: Optional[int] = None  # 0=Sun .. 6=Sat
    day_of_month: Optional[int] = None  # 1-28
    interval: Optional[int] = None  # for hourly: 5/10/15/20/30
    cron_expression: Optional[str] = None  # for custom: raw 5-field cron

    def to_cron(self) -> str:
        if self.frequency == Frequency.custom:
            if not self.cron_expression:
                raise ValueError("cron_expression is required for custom frequency")
            fields = self.cron_expression.strip().split()
            if len(fields) != 5:
                raise ValueError(
                    f"cron_expression must have exactly 5 fields, got {len(fields)}"
                )
            return self.cron_expression.strip()
        if self.frequency == Frequency.hourly:
            interval = self.interval or 30
            return f"*/{interval} * * * *"
        if self.frequency == Frequency.daily:
            return f"{self.minute} {self.hour} * * *"
        if self.frequency == Frequency.weekly:
            dow = self.day_of_week if self.day_of_week is not None else 0
            return f"{self.minute} {self.hour} * * {dow}"
        if self.frequency == Frequency.monthly:
            dom = self.day_of_month if self.day_of_month is not None else 1
            return f"{self.minute} {self.hour} {dom} * *"
        raise ValueError(f"Unknown frequency: {self.frequency}")


class JobConfig(BaseModel):
    id: str
    name: str
    script_path: str
    schedule: Schedule
    enabled: bool = True
    timeout_seconds: int = 3600


class JobCreate(BaseModel):
    name: str
    script_path: str
    schedule: Schedule
    enabled: bool = True
    timeout_seconds: int = 3600


class JobUpdate(BaseModel):
    name: Optional[str] = None
    script_path: Optional[str] = None
    schedule: Optional[Schedule] = None
    enabled: Optional[bool] = None
    timeout_seconds: Optional[int] = None


class RunStatus(str, Enum):
    running = "running"
    success = "success"
    failed = "failed"
    timeout = "timeout"
    cancelled = "cancelled"


class TriggerType(str, Enum):
    scheduled = "scheduled"
    manual = "manual"


class RunRecord(BaseModel):
    id: str
    job_id: str
    status: RunStatus = RunStatus.running
    trigger: TriggerType = TriggerType.scheduled
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    log_file: Optional[str] = None
    error_msg: Optional[str] = None


class JobWithStatus(BaseModel):
    """Job config + latest run info for the monitor table."""
    config: JobConfig
    last_status: Optional[RunStatus] = None
    last_run: Optional[datetime] = None
    next_run: Optional[str] = None


class RecentRunSummary(BaseModel):
    id: str
    status: RunStatus
    started_at: datetime
    duration_ms: Optional[int] = None


class JobWithRecentRuns(BaseModel):
    """Job config + latest run info + recent runs for Workflows list."""
    config: JobConfig
    last_status: Optional[RunStatus] = None
    last_run: Optional[datetime] = None
    next_run: Optional[str] = None
    recent_runs: list[RecentRunSummary] = []

# FastCronUI - FastAPI Cron Scheduler with Web UI

## Context

Cronicle 暴露了两个核心问题：(1) 环境变量/PATH 丢失导致脚本跑不了，(2) 黑盒的 master 选举机制。用 FastAPI + 系统 crontab 替代，实现一个完全可控、轻量的调度器。

## Architecture

```
Browser UI  ←→  FastAPI (port 8787)  ←→  crontab + subprocess
                                          ↑
                  cron 触发时用 curl 回调 FastAPI，
                  由 FastAPI 统一执行脚本、捕获日志
```

**关键设计：cron 只负责 curl localhost，不直接跑脚本。** FastAPI 继承用户完整 shell 环境，彻底解决 PATH 问题。

## Project Structure

```
/Users/wqeq/Desktop/project/FastCronUI/
├── main.py              # FastAPI app，所有路由，lifespan 管理 asyncpg 连接池
├── models.py            # Pydantic 数据模型
├── scheduler.py         # crontab 读写（用 # CRONUI:tag 标记管理的条目）
├── db.py                # asyncpg 连接池，异步读写 PostgreSQL
├── executor.py          # 异步执行脚本，自动检测 .venv
├── config/              # 每个 job 一个 YAML：{job_id}.yaml
├── logs/                # 每次 run 一个 log：{run_id}.log
├── static/
│   ├── index.html       # SPA，两个 tab（Monitor + Create/Edit）
│   ├── style.css        # 状态 badge + 文件浏览器 + 终端风格样式
│   └── app.js           # 前端逻辑（vanilla JS）
├── start.sh             # 启动脚本，source ~/.zshrc 继承环境
├── pyproject.toml       # uv 项目配置
└── uv.lock              # 锁定依赖版本
```

## Database

**PostgreSQL**（运行在 Mac Mini `192.168.31.61:5432`）

- 数据库名：`fastcronui`
- 用户：`bearagent`
- 驱动：`asyncpg`（全异步连接池，min=2, max=10）
- 连接串：`postgresql://bearagent:***@192.168.31.61:5432/fastcronui`

**runs 表**:
```sql
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',  -- running|success|failed|timeout
    trigger TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|manual
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    exit_code INTEGER,
    log_file TEXT,
    error_msg TEXT
);
CREATE INDEX idx_runs_job_id ON runs(job_id);
CREATE INDEX idx_runs_started_at ON runs(started_at);
```

## API Endpoints

| Method | Endpoint | 功能 |
|--------|----------|------|
| GET | `/api/jobs` | 列出所有 job + 最近一次 run 状态 |
| GET | `/api/jobs/{id}` | 获取单个 job 完整配置 |
| POST | `/api/jobs` | 创建 job → 写 YAML + 更新 crontab |
| PUT | `/api/jobs/{id}` | 编辑 job |
| DELETE | `/api/jobs/{id}` | 删除 job + 移除 crontab 条目 |
| POST | `/api/jobs/{id}/run` | 执行 job（cron 回调 / 手动触发） |
| GET | `/api/jobs/{id}/runs` | 查看 run history |
| GET | `/api/runs/{run_id}/log` | 获取 log 内容 |
| GET | `/api/browse?path=` | 文件浏览器（只显示 .sh/.py，隐藏 .git/node_modules 等） |

## UI Pages

### Page 1: Monitor（仿 Databricks）
- **Job 表格**：Job Name / Script / Schedule / Status / Last Run / Actions
- **状态 badge**：绿色=success，红色=failed，黄色=running，灰色=no runs，粉色=timeout
- **Actions**：Run Now / Edit / Delete
- 点击 job 行展开 **Run History** 面板（Run ID / Status / Trigger / Started / Duration / View Log）
- **Log Viewer**：点击某次 run 的 View Log，弹窗显示该次执行的**完整 stdout + stderr 输出**（所有 print 内容），黑底绿字终端风格，支持滚动
- executor 通过 `stdout=log_file, stderr=STDOUT` 合并捕获所有输出，实时写入 `logs/{run_id}.log`
- 每 10 秒自动刷新

### Page 2: Create/Edit Job
- Job Name 输入框
- **Script Path + Browse 按钮** → 弹出文件浏览器（从 ~/Desktop/project 开始，可导航目录，只显示 .sh/.py 文件）
- **Frequency 下拉**：Hourly / Daily / Weekly / Monthly
  - Hourly：支持 5/10/15/20/30 分钟间隔
  - Daily：选 hour + minute
  - Weekly：选 day of week + hour + minute
  - Monthly：选 day of month (1-28) + hour + minute
- Timeout 设置
- 提交后自动更新 crontab

## Data Models

**YAML Job Config** (`config/{job_id}.yaml`):
```yaml
id: "a1b2c3d4"
name: "Tesla Data Sync"
script_path: "/Users/wqeq/Desktop/project/TeslaWebscrape/start.sh"
schedule:
  frequency: "daily"
  minute: 0
  hour: 9
enabled: true
timeout_seconds: 3600
```

**Crontab 条目格式**:
```
0 9 * * * /usr/bin/curl -s -X POST http://127.0.0.1:8787/api/jobs/a1b2c3d4/run -H "X-Trigger: scheduled" > /dev/null 2>&1 # CRONUI:a1b2c3d4
```

## Key Design Decisions

1. **环境继承**：`start.sh` source `~/.zshrc`，FastAPI 继承完整 PATH。cron 只跑 curl，不直接执行脚本，彻底避免 Cronicle 的 PATH 问题。

2. **venv 自动检测**：executor.py 从脚本目录向上最多查 5 层找 `.venv/bin/python3`，自动使用项目的虚拟环境。`.sh` 文件用 `/bin/zsh` 执行。

3. **crontab 安全管理**：所有 CronUI 管理的条目用 `# CRONUI:{job_id}` 标记。sync 时只操作带标记的行，不影响用户手动添加的 cron 条目。

4. **全异步架构**：db.py 使用 asyncpg 连接池，executor.py 用 asyncio subprocess，所有 I/O 路径无阻塞。FastAPI lifespan 管理连接池生命周期。

5. **前端**：纯 HTML + Tailwind CDN + vanilla JS，无构建步骤。暗色主题。

## Dependencies

4 个包（其余全用 Python stdlib）：
- `fastapi` — Web 框架
- `uvicorn[standard]` — ASGI server
- `pyyaml` — Job 配置读写
- `asyncpg` — PostgreSQL 异步驱动

用 `uv` 管理。

## Implementation Status

- [x] `pyproject.toml` + uv 依赖安装
- [x] `models.py` — Pydantic 模型（Job、Schedule、Run、枚举）
- [x] PostgreSQL 数据库创建 + runs 表 + 索引
- [x] `db.py` — asyncpg 连接池 + CRUD
- [x] `scheduler.py` — crontab 读写
- [x] `executor.py` — 异步脚本执行引擎
- [x] `main.py` — FastAPI 路由（lifespan 管理）
- [x] `static/index.html` + `style.css` + `app.js` — 前端 SPA
- [x] `start.sh` — 启动脚本
- [x] Smoke test 通过（API 返回 200，asyncpg 连接正常）

## Verification

1. `cd /Users/wqeq/Desktop/project/FastCronUI && ./start.sh`
2. 打开 `http://localhost:8787`
3. 创建一个测试 job，选择 TeslaWebscrape/start.sh
4. `crontab -l` 确认条目已写入
5. 点 Run Now，确认 Monitor 页面显示 running → success/failed
6. 查看 View Log 弹窗确认日志捕获正常
7. 等一个 cron 周期，确认定时触发正常

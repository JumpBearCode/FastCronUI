# FastCronUI

轻量 cron 调度器，替代 Cronicle。FastAPI + 系统 crontab + PostgreSQL + Web UI。

## 为什么

Cronicle 的两个痛点：
1. 环境变量/PATH 丢失，脚本跑不了
2. 黑盒 master 选举机制

FastCronUI 的方案：cron 只负责 `curl localhost`，由 FastAPI 统一执行脚本，继承用户完整 shell 环境。

## 快速启动

```bash
cd /Users/wqeq/Desktop/project/FastCronUI
./start.sh
# 打开 http://localhost:8787
```

## 依赖

- Python 3.12+
- PostgreSQL（`192.168.31.61:5432/fastcronui`）
- `uv` 包管理器

```bash
uv sync  # 安装依赖
```

## 功能

- Web UI 创建/编辑/删除定时任务
- 自动写入系统 crontab
- 手动触发执行（Run Now）
- 执行历史 + 完整日志查看
- 文件浏览器选择脚本
- .venv 自动检测
- 全异步架构（asyncpg + asyncio subprocess）

#!/bin/zsh
# Source full user environment for PATH inheritance
source ~/.zshrc 2>/dev/null

cd "$(dirname "$0")"

echo "Starting FastCronUI on http://localhost:8787"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8787 --reload

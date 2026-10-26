#!/bin/bash
# 사용: bash scripts/restart_measurement_worker.sh normal 또는 접수 번호
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-normal}"
[[ "$mode" == normal || "$mode" =~ ^[0-9]+$ ]] || { echo 'normal 또는 접수 번호를 지정하세요'; exit 2; }
if [ -f backend/.env ]; then set -a; source backend/.env; set +a; fi
: "${INTERNAL_SERVICE_TOKEN:=local-dev-internal-token-0123456789abcdef}"
export INTERNAL_SERVICE_TOKEN DEMO_FORCE_PHOTO=0
export REPAIR_MEASURE=1 REPAIR_MEASURE_VERSION=v2-optimized
export REPAIR_MEASURE_FILE="$(cat logs/measurements/latest.path)"
export REPAIR_MEASURE_SESSION="$(basename "$REPAIR_MEASURE_FILE" .jsonl)"
export PYTHONPATH="$PWD/instrumentation:$PWD${PYTHONPATH:+:$PYTHONPATH}"
if [ -f logs/worker.pid ]; then
  pkill -P "$(cat logs/worker.pid)" 2>/dev/null || true
  kill "$(cat logs/worker.pid)" 2>/dev/null || true
fi
if [ "$mode" == normal ]; then
  nohup env -u OPENAI_API_KEY uv run --env-file .env python -m worker.main >> logs/worker.log 2>&1 &
else
  nohup env -u OPENAI_API_KEY BOUNDARY_REPAIR_ID="$mode" uv run --env-file .env python scripts/full_boundary_worker.py >> logs/worker.log 2>&1 &
fi
echo $! > logs/worker.pid
echo "워커 모드: $mode"

#!/bin/bash
# 사용: ./measure.sh v1 bash run.sh 또는 ./measure.sh v1 uv run --env-file .env python -m worker.main
set -euo pipefail
cd "$(dirname "$0")"
version="${1:-v1}"
if [ "$#" -gt 0 ]; then shift; fi
if [ "$#" -eq 0 ]; then echo '실행 명령을 지정하세요: ./measure.sh v1 bash run.sh'; exit 2; fi
export REPAIR_MEASURE=1 REPAIR_MEASURE_VERSION="$version"
export REPAIR_MEASURE_SESSION="$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p logs/measurements
export REPAIR_MEASURE_FILE="$PWD/logs/measurements/$REPAIR_MEASURE_SESSION.jsonl"
export PYTHONPATH="$PWD/instrumentation:$PWD${PYTHONPATH:+:$PYTHONPATH}"
touch "$REPAIR_MEASURE_FILE"
printf '%s\n' "$REPAIR_MEASURE_FILE" > logs/measurements/latest.path
printf '측정 로그: %s\n' "$REPAIR_MEASURE_FILE"
exec "$@"

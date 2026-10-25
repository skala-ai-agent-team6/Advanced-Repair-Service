#!/bin/bash
# V1과 같은 포트를 쓰므로 V1 앱과 컨테이너를 먼저 종료한다.
set -euo pipefail
cd "$(dirname "$0")"
export COMPOSE_PROJECT_NAME=repair-v2
export DEMO_FORCE_PHOTO=0
exec ./measure.sh v2-optimized bash run.sh

#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -f backend/.env ]; then set -a; source backend/.env; set +a; fi
export COMPOSE_PROJECT_NAME=repair-v2
bash stop.sh

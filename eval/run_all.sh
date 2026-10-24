#!/bin/bash
# 평가셋 한 번에: MCP 서버(기계, Rag_mcp 4개)를 평가 전용 포트로 켜기 → run_eval → 끄기
# 사용: bash eval/run_all.sh <label> [레포 .env 경로]
#   .env 경로를 주면 이 폴더에 .env 링크를 만든다 (내용은 읽지 않음)
set -e
cd "$(dirname "$0")/.."
LABEL=${1:-baseline}
[ -e .env ] || { [ -n "$2" ] && ln -s "$2" .env; }
[ -e .env ] || { echo ".env 없음: bash eval/run_all.sh $LABEL <레포 .env 경로>"; exit 1; }
MECH=19104; OBS=18011; PCB=18012; DMG=18013; RAG=18014
for p in $MECH $OBS $PCB $DMG $RAG; do
  lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "포트 $p 사용 중"; exit 1; }
done
mkdir -p logs
trap 'pkill -P $$ 2>/dev/null; pkill -f "$PWD/Rag_mcp/.venv" 2>/dev/null; pkill -f "$PWD/mcp_servers/mechanical/.venv" 2>/dev/null; true' EXIT
(cd mcp_servers/mechanical && PORT=$MECH exec uv run python server.py > ../../logs/mech.log 2>&1) &
for s in observation:$OBS pcb:$PCB damage:$DMG rag:$RAG; do
  (cd Rag_mcp && exec env -u OPENAI_API_KEY QDRANT_URL= uv run --env-file ../.env repair-mcp serve ${s%%:*} --transport http --port ${s##*:} > ../logs/rag-${s%%:*}.log 2>&1) &
done
echo -n "서버 기다리는 중"
for i in $(seq 1 120); do
  ok=1; for p in $MECH $OBS $PCB $DMG $RAG; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 || ok=0; done
  [ $ok = 1 ] && break; echo -n "."; sleep 2
done
echo
env -u OPENAI_API_KEY DEMO_FORCE_PHOTO=0 SAVE_REPAIR_CASES=0 \
  EVAL_MECH_MCP_URL=http://127.0.0.1:$MECH/mcp EVAL_OBSERVATION_MCP_URL=http://127.0.0.1:$OBS/mcp \
  EVAL_PCB_INTERPRET_MCP_URL=http://127.0.0.1:$PCB/mcp EVAL_DAMAGE_MCP_URL=http://127.0.0.1:$DMG/mcp \
  EVAL_RAG_MCP_URL=http://127.0.0.1:$RAG/mcp \
  uv run python -m eval.run_eval --label "$LABEL"

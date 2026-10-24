#!/bin/bash
# 전부 한 번에 띄운다: DB·Kafka → Spring → MCP 5개 → 프론트 → 에이전트 워커 → 사진 요청 대역
# 로그는 logs/, 끄기는 ./stop.sh
set -e
cd "$(dirname "$0")"
ROOT=$PWD
mkdir -p logs

# 키 파일 하나를 여러 클론이 같이 쓴다: 레포에 .env가 없으면 ~/.config/skala-repair/ 의 파일을 링크한다
SHARED="${REPAIR_ENV_DIR:-$HOME/.config/skala-repair}"
[ -e .env ] || { [ -f "$SHARED/.env" ] && ln -s "$SHARED/.env" .env && echo ".env ← $SHARED/.env"; }
[ -e backend/.env ] || { [ -f "$SHARED/backend.env" ] && ln -s "$SHARED/backend.env" backend/.env && echo "backend/.env ← $SHARED/backend.env"; }

# 백엔드 비밀값: backend/.env가 있으면 그 값, 없거나 비었으면 로컬 기본값
if [ -f backend/.env ]; then set -a; . backend/.env; set +a; fi
: "${DB_PASSWORD:=repair-local}"
: "${INTERNAL_SERVICE_TOKEN:=local-dev-internal-token-0123456789abcdef}"  # 로컬 전용, 32자 이상
DEV_PASSWORD=1234  # 로그인 비밀번호 고정 (backend/.env 값과 상관없이, 새 DB에서만 적용)
export DB_PASSWORD INTERNAL_SERVICE_TOKEN DEV_PASSWORD

# 업무 MCP(재고·공장): Spring → 게이트웨이(8089) → 로컬 업무 MCP(8015, 우리 DB). 가짜로 돌리려면 REAL_BUSINESS_MCP=0 ./run.sh
if [ "${REAL_BUSINESS_MCP:-1}" = 1 ]; then
  : "${MCP_TOKEN:=local-dev-business-token}"  # Spring과 게이트웨이가 같은 값을 쓴다 (로컬 전용)
  export MCP_TOKEN MCP_URL=http://localhost:8089/rpc SPRING_PROFILES_ACTIVE="${SPRING_PROFILES_ACTIVE:-dev},realmcp"
fi

busy=""
for p in 8080 5173 9104 8011 8012 8013 8014 8015 8089; do
  lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && busy="$busy $p"
done
[ -z "$busy" ] || { echo "포트 사용 중:$busy → ./stop.sh 먼저"; exit 1; }

echo "1/6 DB·Kafka (5432, 9092)"
(cd backend && docker compose up -d --wait) || { echo "실패: 5432·9092를 다른 Postgres/Kafka가 쓰는지 확인 (lsof -nP -iTCP:5432 -sTCP:LISTEN)"; exit 1; }

echo "2/6 Spring (8080)"
(cd backend; nohup ./gradlew bootRun --args='--app.mock-ai.enabled=false' > "$ROOT/logs/spring.log" 2>&1 &)

echo "3/6 MCP: 기계(9104), Rag_mcp(8011~8014)"
(cd mcp_servers/mechanical; nohup uv run python server.py > "$ROOT/logs/mech.log" 2>&1 &)
# 셸에 남은 옛 OPENAI_API_KEY가 .env 키보다 먼저 쓰이면 401이 나서 뺀다
# RAG 자료·코드가 바뀌면(PR 합친 뒤 등) 인덱스를 다시 만든다. 안 그러면 검색이 "Index stale"로 실패해 유사 사례가 0건
stamp=$(cd Rag_mcp && find data src -type f ! -name '*.pyc' | sort | xargs cat | shasum | cut -c1-40)
if [ ! -d Rag_mcp/.runtime/qdrant ] || [ "$(cat Rag_mcp/.runtime/index.stamp 2>/dev/null)" != "$stamp" ]; then
  echo "    RAG 인덱스 생성 (1~2분)"
  (cd Rag_mcp && env -u OPENAI_API_KEY uv run --env-file ../.env repair-mcp index > "$ROOT/logs/rag-index.log" 2>&1)
  echo "$stamp" > Rag_mcp/.runtime/index.stamp
fi
for s in observation:8011 pcb:8012 damage:8013 rag:8014; do
  (cd Rag_mcp; nohup env -u OPENAI_API_KEY uv run --env-file ../.env repair-mcp serve ${s%%:*} --transport http --port ${s##*:} > "$ROOT/logs/rag-${s%%:*}.log" 2>&1 &)
done

if [ "${REAL_BUSINESS_MCP:-1}" = 1 ]; then
  echo "    업무 MCP (8015), 게이트웨이 (8089)"
  # 업무 MCP는 우리 DB(repair)를 그대로 읽는다. 발주 추천의 GPT 키는 .env에서
  (cd mcp_servers/business; nohup env -u OPENAI_API_KEY HOST=127.0.0.1 PORT=8015 PGPASSWORD="$DB_PASSWORD" uv run --env-file ../../.env python server.py > "$ROOT/logs/business-mcp.log" 2>&1 &)
  nohup env BUSINESS_GATEWAY_TOKEN="$MCP_TOKEN" uv run uvicorn worker.business_gateway:app --port 8089 > logs/business.log 2>&1 &
fi

echo "4/6 프론트 (5173)"
(cd frontend; VITE_USE_MOCK=false VITE_API_BASE_URL= VITE_API_PROXY_TARGET=http://localhost:8080 nohup npx vite --port 5173 --strictPort > "$ROOT/logs/front.log" 2>&1 &)

echo -n "5/6 Spring 기다리는 중"
for i in $(seq 1 90); do
  curl -s -o /dev/null http://localhost:8080/api/auth/csrf && break
  echo -n "."; sleep 2
done
echo
curl -s -o /dev/null http://localhost:8080/api/auth/csrf || { echo "Spring이 안 떴다: logs/spring.log 확인"; exit 1; }

echo "6/6 에이전트 워커, 사진 요청 대역"
# DEMO_FORCE_PHOTO=1: 첫 진단은 무조건 추가 사진 요청 (시연용). 끄려면 DEMO_FORCE_PHOTO=0 ./run.sh
nohup env DEMO_FORCE_PHOTO="${DEMO_FORCE_PHOTO:-1}" env -u OPENAI_API_KEY uv run --env-file .env python -m worker.main > logs/worker.log 2>&1 &
echo $! > logs/worker.pid
(cd integration; nohup python3 auto_photo.py > "$ROOT/logs/auto_photo.log" 2>&1 & echo $! > "$ROOT/logs/auto_photo.pid")

echo
echo "완료 → http://localhost:5173  (tech1 / 1234, 본사 quality / 1234)"
echo "로그: logs/  · 끄기: ./stop.sh"

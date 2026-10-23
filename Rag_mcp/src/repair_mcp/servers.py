from contextlib import asynccontextmanager
import asyncio
import os
import threading
from typing import Annotated, Literal

from fastmcp import FastMCP
from pydantic import Field

from .config import read_json
from .labels import SURFACE_DEFECTS, interpret_damage_labels, interpret_pcb_labels
from .models import AgentCase, LegacyDamageLabel, SearchRequest
from .normalize import normalize_observations
from .products import ProductType

READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True,
             "openWorldHint": False}
AI_READ_ONLY = {**READ_ONLY, "idempotentHint": False, "openWorldHint": True}
# [통합] 평가표 "rag-mcp 조회·변경 도구". 덮어쓰기만 하고 지우지 않는다. 같은 case_id면 같은 결과
WRITE = {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}


def create_server(service: str, store=None, sync_service=None) -> FastMCP:
    @asynccontextmanager
    async def lifespan(server):
        try:
            if service == "rag":
                sync = get_sync()
                if sync is not None:
                    sync.start()
            yield {}
        finally:
            if service == "rag" and synchronizer[0] is not None:
                await asyncio.to_thread(synchronizer[0].stop)
            if service == "rag" and instance[0] is not None and store is None:
                instance[0].close()
                instance[0] = None

    instance = [store]
    synchronizer = [sync_service]
    init_lock = threading.Lock()
    sync_init_lock = threading.Lock()
    sync_enabled = sync_service is not None or os.environ.get("REPAIR_SYNC_ENABLED", "false").lower() in {"1", "true", "yes"}
    mcp = FastMCP(f"{service}-mcp", lifespan=lifespan,
                 instructions="Interpretation/retrieval of evidence. Model labels are observations, not confirmed fault causes. "
                 "Only save_repair_case writes (unconfirmed agent cases, not indexed). "
                 "Optional report sync imports only technician-confirmed reports from the configured Spring service into the search index; it never changes business records.")
    if service == "observation":
        @mcp.tool(annotations=AI_READ_ONLY)
        def normalize_observation(raw_text: Annotated[str, Field(min_length=1, max_length=2000)],
                                  origin: Literal["technician", "ai_image"] = "technician",
                                  technician_confirmed: bool = False,
                                   product_type: ProductType = "unknown") -> dict:
            """OpenAI로 기사 소견을 표준 용어 후보로 변환. 부정·추정·원문·미등록 표현 보존."""
            return normalize_observations(raw_text, origin, technician_confirmed, product_type)

        @mcp.tool(annotations=READ_ONLY)
        def list_observation_terms() -> dict:
            """지원하는 소견 코드와 출처를 반환."""
            return read_json("observation_vocabulary.json")
    elif service == "pcb":
        @mcp.tool(annotations=READ_ONLY)
        def interpret_pcb(labels: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)]],
                                           Field(max_length=30)],
                           product_type: ProductType = "unknown") -> dict:
            """팀 PCB 모델의 라벨 결과를 해석. 이미지 추론·고장 원인 확정은 수행하지 않음."""
            return {**interpret_pcb_labels(labels), "product_type": product_type}
    elif service == "damage":
        @mcp.tool(annotations=READ_ONLY)
        def interpret_damage(labels: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)] | LegacyDamageLabel],
                                              Field(max_length=30)],
                           product_type: ProductType = "unknown") -> dict:
            """표면 결함 6종 해석. 이전 dent/부위 payload는 미등록으로 보존."""
            return {**interpret_damage_labels(labels), "product_type": product_type}

        @mcp.tool(annotations=READ_ONLY)
        def list_damage_labels() -> dict:
            """지원하는 표면 결함 라벨과 한국어 이름."""
            return {label: {"name_ko": name, "description_ko": description}
                    for label, (name, description) in SURFACE_DEFECTS.items()}
    elif service == "rag":
        def get_store():
            with init_lock:
                if instance[0] is None:
                    from .retrieval import DenseStore
                    instance[0] = DenseStore()
                return instance[0]

        def get_sync():
            if not sync_enabled:
                return None
            with sync_init_lock:
                if synchronizer[0] is None:
                    from .sync import ConfirmedCaseSync
                    synchronizer[0] = ConfirmedCaseSync.from_env(get_store())
                return synchronizer[0]

        @mcp.tool(annotations=READ_ONLY)
        def get_case_sync_status() -> dict:
            """확정 보고서 자동 동기화 상태와 저장 건수. 토큰·보고서 원문을 노출하지 않음."""
            sync = get_sync()
            if sync is None:
                return {"enabled": False, "running": False, "last_run": None,
                        "indexed_reports": get_store().internal_case_count()}
            return sync.status()

        if sync_enabled:
            @mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": False,
                                   "idempotentHint": True, "openWorldHint": False})
            def sync_confirmed_cases() -> dict:
                """설정된 Spring 내부 API의 확정 보고서를 지금 색인. 데모·운영자용.
                임의 보고서·URL을 받지 않고 미확정 보고서를 제외한다. Spring DB는 수정하지 않는다.
                """
                return get_sync().sync_once()

        @mcp.tool(annotations=READ_ONLY)
        def search_repair_cases(query: Annotated[str, Field(min_length=1, max_length=2000)],
                                top_k: Annotated[int, Field(ge=1, le=20)] = 3,
                                min_score: Annotated[float, Field(ge=-1, le=1)] = 0.75,
                                repair_status: Literal["Fixed", "Repairable", "End of life", "Unknown",
                                                       "Not fixed", "No fault found"] | None = None,
                                 product_type: ProductType = "unknown") -> dict:
            """공개·사내 확정 사례를 함께 검색. LLM 소견 생성 없이 출처·점수·사례 반환."""
            from .retrieval import brief_cases
            cases = get_store().search("repair_cases", query, top_k, min_score, repair_status, product_type)
            return {"product_type": product_type,
                    "case_search_status": ("product_type_required" if product_type == "unknown" else
                                           "candidates_found" if cases else "no_candidates"),
                    "repair_cases": cases, "case_briefs": brief_cases(cases), "diagnosis_confirmed": False}

        @mcp.tool(annotations=AI_READ_ONLY)
        def retrieve_repair_context(request: SearchRequest) -> dict:
            """소견+PCB+외형 라벨로 사례·기술 문서 검색 및 정확한 라벨의 점검 지침 조회.
            근거별 출처, 짧은 증상 요약, 점검 순서, OpenAI 최종 소견을 반환.
            외형 지침은 위치를 지정하지 않는 표면 점검 팀 초안. 확정 진단/DB 저장/승인은 수행하지 않음.
            """
            from .retrieval import retrieve_context
            return retrieve_context(request, get_store())

        @mcp.tool(annotations=READ_ONLY)
        def search_reference_documents(query: Annotated[str, Field(min_length=1, max_length=2000)],
                                       collection: Literal["pcb_documents", "damage_documents"],
                                       top_k: Annotated[int, Field(ge=1, le=20)] = 5,
                                       min_score: Annotated[float, Field(ge=-1, le=1)] = 0.75) -> dict:
            """PCB/파손 문서의 독립 dense 검색. 사례와 문서의 출처 유형을 분리."""
            return {"documents": get_store().search(collection, query, top_k, min_score)}

        @mcp.tool(annotations=WRITE)
        def save_repair_case(case: AgentCase) -> dict:
            """에이전트 진단을 '미확정 사례'로 저장(변경). 같은 case_id는 덮어씀.
            기사 확인 전이라 검색 색인(repair_cases)에는 넣지 않는다. 저장 위치: .runtime/agent_cases.jsonl"""
            from .case_store import save_case
            return save_case(case.model_dump())

        @mcp.tool(annotations=READ_ONLY)
        def list_saved_cases(limit: Annotated[int, Field(ge=1, le=50)] = 10) -> dict:
            """save_repair_case로 저장한 미확정 사례를 최근 순으로 조회."""
            from .case_store import list_cases
            return {"cases": list_cases(limit)}
    else:
        raise ValueError(f"Unknown MCP service: {service}")
    return mcp

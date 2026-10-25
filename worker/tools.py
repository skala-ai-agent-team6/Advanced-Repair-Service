"""그래프가 쓰는 '팔다리': 사진 받기, MCP 호출, GPT 호출. graph.py는 이 함수들만 부른다."""

import base64
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Literal

import httpx
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from pydantic import BaseModel, Field, field_validator

from . import config as C
from .products import normalize_product_type, PRODUCT_NAMES
from .prompts import render
from .harness import guarded
from .context_policy import (UsageTracker, masked, prepare_text, prepare_findings, reserve_llm)
from .tool_policy import ToolResponseError, check_image_result, check_object, check_response

# ── 1. 사진 ──────────────────────────────────────────────


async def load_photos(command: dict) -> list[dict]:
    """접수 사진만 내려받는다. 누락·다운로드 오류를 예시 사진으로 대체하지 않는다."""
    folder = Path(tempfile.mkdtemp(prefix=f"task{command['taskId']}_"))
    photos = []
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        for a in command["payload"]["attachments"]:
            if a["downloadPath"] != f"/internal/attachments/{a['id']}":
                raise ValueError("Invalid attachment download path")
            content = bytearray()
            async with client.stream("GET", C.SPRING_URL.rstrip("/") + a["downloadPath"],
                                     headers={"Authorization": f"Bearer {C.SPRING_TOKEN}"}) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > min(a["byte_size"], 20_000_000):
                        raise ValueError("Attachment exceeds expected size")
            if len(content) != a["byte_size"] or hashlib.sha256(content).hexdigest() != a["sha256"]:
                raise ValueError("Attachment size or checksum mismatch")
            path = folder / f"{a['id']}.jpg"
            path.write_bytes(content)
            photos.append({"attachmentId": a["id"], "path": str(path), "target": a.get("target")})
    return photos


# ── 2. MCP ───────────────────────────────────────────────


@guarded(weight=2)
async def call_mech_mcp(path: str) -> dict:
    """mechanical-mcp: 표면 결함(scratches, patches 등) + 찌그러짐(dent, breakage)을 둘 다 보고 합친다."""
    async with Client(C.MECH_MCP_URL) as c:
        surface = check_image_result(check_response(
            await c.call_tool("detect_surface_defects", {"photo_id": path}), "detect_surface_defects").data,
            "detect_surface_defects")
        dent = check_image_result(check_response(
            await c.call_tool("detect_dents", {"photo_id": path}), "detect_dents").data, "detect_dents")
    return {
        "is_defective": surface["is_defective"] or dent["is_defective"],
        "defects": surface["defects"] + dent["defects"],
        "defect_counts": {**surface.get("defect_counts", {}), **dent.get("defect_counts", {})},
        "annotated_image": surface["annotated_image"],
        "dent_image": dent["annotated_image"],
        "damage_labels": surface.get("damage_labels", []) + dent.get("damage_labels", []),
    }


@guarded()
async def call_pcb_mcp(path: str) -> dict:
    """pcb-detector (MCP_Error_check/pcb_agent): PCB 결함 (short, missing_hole 등)."""
    transport = StdioTransport(command=C.PCB_MCP_PYTHON, args=[C.PCB_MCP_SERVER], log_file=C.HERE / "pcb_mcp.log")
    # 옛 서버가 내는 경고(server/discover 모름)는 터미널 대신 로그 파일로. 동작엔 문제없음
    async with Client(transport) as c:
        r = await c.call_tool("analyze_pcb_image", {"image_path": path})
        check_response(r, "analyze_pcb_image")
        return check_image_result(json.loads(r.content[0].text), "analyze_pcb_image")
        # 옛 mcp 1.x 서버라 결과가 글(JSON 문자열)로 온다


@guarded()
async def call_rag_mcp(text: str, pcb_labels: list[str] | None, damage_labels: list[str] | None = (), *,
                       product_type: str = "unknown", normalized_observation: dict | None = None,
                       error_codes: list[str] | None = None) -> dict:
    """Rag_mcp(retrieve_repair_context): 증상 글 + PCB 라벨로 과거 수리 사례·라벨 정의를 찾는다.

    [통합] 10/21부터 기계 MCP 표면 결함 6종도 보낸다. 찌그러짐(자동차 라벨)은 여전히 보내지 않는다.
    """
    product_type = normalize_product_type(product_type)
    request = {"product_type": product_type, "raw_text": prepare_text(text, "rag_query"), "origin": "technician", "technician_confirmed": True,
               "normalized_observation": normalized_observation, "error_codes": [prepare_text(code, "rag_error_code") for code in (error_codes or [])],
               "pcb_labels": pcb_labels, "damage_labels": list(damage_labels) if damage_labels is not None else None, "top_k": 3}  # [통합] 표면 결함 라벨 전달
    async with Client(C.RAG_MCP_URL, timeout=60) as c:
        d = check_object(check_response(
            await c.call_tool("retrieve_repair_context", {"request": request}),
            "retrieve_repair_context").structured_content, "retrieve_repair_context")
    # [통합] score 추가: RAG가 주는 similarity_score를 버려서 화면 유사도가 0%로 나왔다
    hits = [case_hit(x) for x in d["repair_cases"]]
    # [통합] 표면 결함 라벨 정의는 title 없이 name_ko만 온다 (10/21 Rag_mcp). title만 읽으면 KeyError로 사례가 다 빠진다
    hits += [{"kind": "LABEL", "citation": x["document_id"], "excerpt": x.get("title") or x.get("name_ko") or x.get("label", "")}
             for x in d["label_definitions"]]
    hits += [{"kind": "REFERENCE", "citation": x["document_id"],
              "excerpt": (x.get("text") or x.get("chunk_text") or x.get("title") or "")[:2000],
              **({"sourceUri": x["source_url"]} if x.get("source_url") else {})}
             for x in d.get("pcb_references", [])]
    return {"product_type": product_type, "hits": hits, "status": d["case_search_status"],
            "observation": d.get("observation", {}),
            "warnings": d.get("warnings", []), "integrated_assessment": d.get("integrated_assessment", {})}


def case_hit(case):
    """Adapt public, confirmed and synthetic RAG records to Spring evidence."""
    citation = case.get("document_id") or case.get("source_id")
    if not citation:
        raise ToolResponseError("retrieve_repair_context")
    summary = case.get("korean_summary") or case.get("chunk_text") or case.get("original_text") or ""
    if isinstance(summary, dict):
        summary = "; ".join(str(summary[key]) for key in (
            "reported_symptom_ko", "reported_observations_ko", "reported_action_ko") if summary.get(key))
    summary = " ".join(str(summary).split())
    demo = case.get("is_demo") is True or case.get("source_type") == "synthetic_demo_repair"
    if demo and not summary.startswith("[가상 데모 사례]"):
        summary = "[가상 데모 사례] " + summary
    internal = case.get("source_type") == "internal_confirmed_repair" and not demo
    return {"kind": "CASE", "citation": citation,
            "sourceUri": case.get("source_uri") or case.get("source_url"),
            "score": case.get("similarity_score", 0), "excerpt": summary[:300],
            "origin": "INTERNAL" if internal else "EXTERNAL",
            "sourceLabel": case.get("source_label") or ("사내 확정 사례" if internal else "공개 사례"),
            "isDemo": demo, "product_type": case.get("product_type", "unknown")}


# ── 3. GPT ───────────────────────────────────────────────


class PhotoKind(BaseModel):
    kind: Literal["PCB", "MECH", "OTHER"] = Field(description="PCB: 회로기판·구리 배선·납땜·전자부품. MECH: 금속 표면 클로즈업·모터·기어·축·바퀴. OTHER: 그 외")


class Candidate(BaseModel):
    cause: str = Field(description="고장 원인 한 줄")
    confidence: float = Field(ge=0, le=1)
    explanation: str = Field(description="근거가 된 MCP 결과를 들어 설명")

    @field_validator("cause", "explanation")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Candidate text must not be blank")
        return value


class RecommendedPart(BaseModel):
    partId: str = Field(pattern=r"^[1-9][0-9]*$")
    quantity: int = Field(ge=1, le=100)


class RecommendedTool(BaseModel):
    name: str = Field(description="수리 기사가 준비할 공구 이름")
    purpose: str = Field(description="이 공구를 사용할 점검·수리 목적")
    evidence: str = Field(description="진단 근거 또는 수리 방법과 연결되는 이유")


class Report(BaseModel):
    summary: str
    repairMethod: str
    candidates: list[Candidate] = Field(min_length=1)
    recommendedParts: list[RecommendedPart] = Field(default_factory=list, max_length=20)
    recommendedTools: list[RecommendedTool] = Field(default_factory=list, max_length=10)

    @field_validator("summary", "repairMethod")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Report text must not be blank")
        return value


def gpt(schema):
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=C.GPT_MODEL, temperature=0, timeout=C.TOOL_TIMEOUT, max_retries=0,
                      max_completion_tokens=C.MAX_OUTPUT_TOKENS, callbacks=[UsageTracker()]).with_structured_output(schema)


@guarded()
async def translate_cases(texts: list[str]) -> list[str]:
    """[통합] 유사사례 원문(네덜란드어 등)을 화면용 한국어 한 줄로. GPT가 없거나 실패하면 원문 그대로."""
    if not C.USE_GPT or not texts:
        return texts
    from pydantic import BaseModel

    class Ko(BaseModel):
        lines: list[str]
    try:
        out = await gpt(Ko).ainvoke("각 줄을 순서대로 한국어 한 줄로 직역해. 꾸밈말 금지.\n" + "\n".join(f"{i}. {t}" for i, t in enumerate(texts)))
        return out.lines if len(out.lines) == len(texts) else texts
    except Exception:
        return texts


@guarded()
async def classify_photo(path: str) -> str:
    """사진 한 장이 PCB / MECH / OTHER 중 무엇인지."""
    if not C.USE_GPT:
        return "PCB" if "pcb" in Path(path).name else "MECH"  # 키 없을 때: 파일 이름으로
    prompt = render("classify_photo", PhotoKind)
    reserve_llm(PhotoKind, prompt, image=True)
    b64 = base64.b64encode(Path(path).read_bytes()).decode()
    msg = [{"role": "user", "content": [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
    ]}]
    return (await gpt(PhotoKind).ainvoke(msg)).kind


@guarded()
async def write_report(text: str, findings: list[dict], compatible_parts=None, *, product_type="unknown") -> Report:
    """MCP 결과를 근거로 진단 리포트를 쓴다."""
    defects = [d for f in findings for d in f["output"].get("defects", [])]
    if not C.USE_GPT:
        top = max(defects, key=lambda d: d["confidence"])
        return Report(summary=f"{top['type']} 결함 추정", repairMethod="해당 부품 점검 후 교체",
                      candidates=[Candidate(cause=top["type"], confidence=top["confidence"], explanation="MCP 검출 결과")])
    product_type = normalize_product_type(product_type)
    safe_text = prepare_text(text, "report_text")
    safe_findings, trimmed = prepare_findings(findings)
    prompt = render("write_report", Report, compatible_parts=masked(compatible_parts or []),
                    text=f"제품: {PRODUCT_NAMES[product_type]}\n{safe_text}", findings=safe_findings)
    reserve_llm(Report, prompt)
    result = await gpt(Report).ainvoke(prompt)
    result = Report.model_validate(masked(result.model_dump()))
    if trimmed or safe_text != masked(text):
        result.summary += "\n\n문맥 제한: 리포트 작성에는 길이를 줄인 입력·도구 근거를 사용했습니다. 원본 사진별 근거를 함께 확인해 주세요."
    allowed = {str(p["id"]) for p in compatible_parts or []}
    identifiers = [p.partId for p in result.recommendedParts]
    if not set(identifiers) <= allowed or len(set(identifiers)) != len(identifiers):
        raise ValueError("Unknown or duplicate recommended part")
    return result


# ── 4. 부품 확인 Agent (업무 MCP) / 사례 저장 (rag-mcp) ───────────────
# [통합] 평가표 "모델이 도구를 선택" + "business-mcp를 Agent가 호출". 조회 도구만 연다. 발주 초안은 Spring이 만든다.

BUSINESS_READ_TOOLS = ("get_part_availability", "get_product", "search_products", "search_past_orders")
PARTS_AGENT_PROMPT = (
    "너는 가전제품 수리 부품 담당이다. 진단 근거와 호환 부품 목록을 보고, 교체가 필요해 보이는 부품의 재고·입고 예정을 "
    "업무 MCP 도구로 직접 확인하라. 어떤 도구를 몇 번 쓸지는 네가 정한다(최대 {max_calls}번). "
    "part_id는 호환 부품 목록의 id만 써라. 확인이 끝나면 도구 없이 한국어 3줄 이내로 "
    "'부품 id·이름 / 재고 여부 / 근거 도구'를 정리하라. 교체 근거가 없으면 도구를 쓰지 말고 그렇게 말하라."
)


def compact(value, limit=1500) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


async def business_tool_specs() -> list[dict]:
    """업무 MCP가 알려 주는 도구 이름·설명·입력 형식을 그대로 GPT 도구로 넘긴다."""
    async with Client(C.BUSINESS_MCP_URL, timeout=15) as c:
        listed = await c.list_tools()
    return [{"type": "function", "function": {"name": t.name, "description": t.description or "",
                                               "parameters": t.inputSchema}}
            for t in listed if t.name in BUSINESS_READ_TOOLS]


@guarded(name_arg="name")
async def call_business_tool(name: str, arguments: dict) -> dict:
    if name not in BUSINESS_READ_TOOLS:
        raise ToolResponseError(name)
    async with Client(C.BUSINESS_MCP_URL, timeout=30) as c:
        r = check_response(await c.call_tool(name, arguments), name)
    data = r.structured_content
    if data is None:
        data = {"result": json.loads(r.content[0].text)}
    return check_object(data, name)


async def ask_parts_agent(llm, messages, turn: int):
    """GPT 한 차례. 메시지 객체는 하네스 지문에 못 넣어 차례 번호로 구분한다."""
    async def parts_agent_turn(turn: int):
        return await llm.ainvoke(messages)
    return await guarded()(parts_agent_turn)(turn)


def parts_agent_llm(specs, *, tool_choice=None):
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=C.GPT_MODEL, temperature=0, timeout=C.TOOL_TIMEOUT, max_retries=0,
                      max_completion_tokens=C.MAX_OUTPUT_TOKENS, callbacks=[UsageTracker()]).bind_tools(specs, **({"tool_choice": tool_choice} if tool_choice else {}))


@guarded()
async def save_repair_case(case: dict) -> dict:
    """rag-mcp save_repair_case(변경 도구): AI 진단을 '미확정 사례'로 저장. 검색 색인에는 넣지 않는다."""
    async with Client(C.RAG_MCP_URL, timeout=30) as c:
        r = check_response(await c.call_tool("save_repair_case", {"case": case}), "save_repair_case")
    return check_object(r.structured_content, "save_repair_case")

"""Spring inventory.lookup → 팀 업무 MCP get_part_availability 변환. 발주는 Spring 승인 흐름 유지.
[출장] preparation.report → 업무 MCP get_repair_preparation_report (출장 전 방문 준비 리포트)."""
import hmac
import os

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import Literal
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import config as C
from .enrichment import call


def back(mapping, business_id):
    """업무 MCP 번호 → Spring 번호. 짝이 없으면 None (Spring DB 외래키에 없는 번호라 넘기면 발주 저장이 실패한다)"""
    if not mapping:  # [통합] 대응표가 비면 같은 DB라 번호 그대로
        return str(business_id)
    return next((spring for spring, biz in mapping.items() if biz == str(business_id)), None)


class Arguments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partIds: list[str] = Field(max_length=100)


class Params(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["inventory.lookup"]
    arguments: Arguments


class ReportArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repairId: int = Field(ge=1)


class ReportParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["preparation.report"]
    arguments: ReportArguments


class RPCRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jsonrpc: Literal["2.0"]
    id: str
    method: Literal["tools/call"]
    params: Params | ReportParams


async def lookup(part_ids):
    stocks, factories = [], []
    for part in dict.fromkeys(part_ids):
        if not part.isascii() or not part.isdecimal() or int(part) < 1:
            raise ValueError("Invalid part ID")
        # [통합] Spring 부품 번호를 업무 MCP 번호로 바꿔 묻는다. 짝이 없는 부품은 재고 없음으로 둔다
        biz_part = C.BUSINESS_PART_MAP.get(part) if C.BUSINESS_PART_MAP else part
        if biz_part is None:
            continue
        raw = await call(C.BUSINESS_MCP_URL, "get_part_availability", {"part_id": int(biz_part)})
        if str(raw["part"]["id"]) != biz_part:
            raise ValueError("Part mismatch")
        for row in raw["warehouses"]:
            numbers = [row[k] for k in ("on_hand", "reserved", "available")]
            if any(type(n) is not int or n < 0 for n in numbers) or numbers[2] != numbers[0]-numbers[1]:
                raise ValueError("Invalid inventory")
            warehouse = back(C.BUSINESS_WAREHOUSE_MAP, row["warehouse_id"])
            if warehouse:
                stocks.append({"partId": part, "warehouseId": warehouse,
                               "onHand": numbers[0], "reserved": numbers[1], "available": numbers[2]})
        factories.extend({"partId": part, "factoryId": back(C.BUSINESS_FACTORY_MAP, row["factory_id"]),
                          "region": row["region"], "contact": row["phone"], "lead_days": row["lead_days"]}
                         for row in raw["suppliers"] if back(C.BUSINESS_FACTORY_MAP, row["factory_id"]))
    return {"stocks": stocks, "factories": factories}


async def rpc(request: Request):
    token = os.getenv("BUSINESS_GATEWAY_TOKEN", "")
    if not token or not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer "+token):
        return JSONResponse({"error": "Service authentication required"}, status_code=401)
    try:
        data = RPCRequest.model_validate(await request.json())
    except (ValueError, ValidationError):
        return JSONResponse({"error": "Invalid RPC request"}, status_code=400)
    try:
        if isinstance(data.params, ReportParams):
            # 같은 DB를 읽으므로 번호 변환 없음. 파일 경로는 서버 내부라 Spring에 넘기지 않는다
            raw = await call(C.BUSINESS_MCP_URL, "get_repair_preparation_report", {"repair_id": data.params.arguments.repairId})
            result = {k: v for k, v in raw.items() if k != "report_path"}
        else:
            result = await lookup(data.params.arguments.partIds)
        body = {"result": {"isError": False, "structuredContent": result}}
    except Exception:
        body = {"error": {"code": -32000, "message": "Business MCP lookup failed"}}
    return JSONResponse({"jsonrpc": "2.0", "id": data.id, **body})


app = Starlette(routes=[Route("/rpc", rpc, methods=["POST"])])

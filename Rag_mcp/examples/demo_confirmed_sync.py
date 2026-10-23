"""Synthetic Spring response + real E5 embeddings + temporary persistent Qdrant + MCP tools.

No OpenAI request, production index write, or Spring database mutation is made.
"""
import argparse
import asyncio
import copy
import json
from pathlib import Path
import tempfile

import httpx
from fastmcp import Client
from qdrant_client import QdrantClient

from repair_mcp.retrieval import DenseStore
from repair_mcp.servers import create_server
from repair_mcp.sync import ConfirmedCaseSync


async def main():
    parser = argparse.ArgumentParser(description="가상 보고서로 확정 사례 자동 동기화 시연")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    fixture = json.loads(Path(__file__).with_name("confirmed_report.demo.json").read_text())
    rows = []
    token = "demo-service-token-not-a-real-secret"
    query = "청소기 왼쪽 바퀴가 걸리고 회전하지 않아 제자리에서 멈춥니다"

    def spring(request):
        assert request.url.path == "/internal/confirmed-cases"
        assert request.headers["Authorization"] == f"Bearer {token}"
        page, size = int(request.url.params["page"]), int(request.url.params["size"])
        return httpx.Response(200, json=rows[page * size:(page + 1) * size])

    evidence = {"backend": "simulated HTTP responses; not live Spring",
                "report": "synthetic demo fixture; not real repair history", "query": query}
    with tempfile.TemporaryDirectory(prefix="repair-sync-demo-") as directory:
        store = DenseStore(client=QdrantClient(path=directory))
        with httpx.Client(transport=httpx.MockTransport(spring)) as http:
            sync = ConfirmedCaseSync(store, "http://spring.demo", token, interval=1, client=http)
            try:
                print("[준비] 기존 공개 사례를 임시 Qdrant에 실제 임베딩합니다.", flush=True)
                indexed = await asyncio.to_thread(store.index)
                evidence["embedding_model"] = indexed["model"]
                evidence["public_index"] = indexed["counts"]
                async with Client(create_server("rag", store, sync), timeout=300) as client:
                    async def search():
                        return (await client.call_tool("search_repair_cases", {"query": query, "top_k": 3, "product_type": fixture["product_type"]})).data

                    async def immediate():
                        for _ in range(100):
                            result = (await client.call_tool("sync_confirmed_cases", {})).data
                            if result["status"] != "busy":
                                return result
                            await asyncio.sleep(.1)
                        raise RuntimeError("Demo sync stayed busy")

                    evidence["before"] = await search()
                    print("[가상 기사 확정] 예제 보고서를 API 응답에 추가합니다.", flush=True)
                    rows.append(copy.deepcopy(fixture))
                    for _ in range(300):
                        status = (await client.call_tool("get_case_sync_status", {})).data
                        if status["indexed_reports"] == 1 and not status["running"]:
                            break
                        await asyncio.sleep(.1)
                    else:
                        raise RuntimeError("Automatic polling did not index the fixture")
                    evidence["automatic_sync"] = status
                    evidence["after"] = await search()
                    evidence["repeated_sync"] = await immediate()
                    rows[0]["confirmed_revision"] = 2
                    rows[0]["content"]["actualAction"] += ". 재확인 시험에서도 정상 주행"
                    evidence["revision_sync"] = await immediate()
                    evidence["revised_search"] = await search()
                encoder = store.encoder
            finally:
                sync.stop()
                store.close()

            reopened = DenseStore(client=QdrantClient(path=directory), encoder=encoder)
            try:
                sync2 = ConfirmedCaseSync(reopened, "http://spring.demo", token, client=http)
                evidence["after_restart"] = {"indexed_reports": reopened.internal_case_count(),
                                             "sync": sync2.sync_once()}
                expected_id = f"internal:report:{fixture['report_id']}"
                assert all(case["case_id"] != expected_id for case in evidence["before"]["case_briefs"])
                assert expected_id in {case["case_id"] for case in evidence["after"]["case_briefs"]}
                assert evidence["repeated_sync"]["unchanged"] == 1
                assert evidence["after_restart"]["indexed_reports"] == 1
                assert evidence["after_restart"]["sync"]["unchanged"] == 1
                assert all(case.get("report_revision") == 2 for case in
                           evidence["revised_search"]["repair_cases"] if case["document_id"] == expected_id)
            finally:
                reopened.close()
    for step in ("before", "automatic_sync", "after", "repeated_sync", "revision_sync", "after_restart"):
        print(f"\n[{step}]", flush=True)
        print(json.dumps(evidence[step].get("case_briefs", evidence[step]), ensure_ascii=False, indent=2), flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        print(f"\n결과 파일: {args.output}")


if __name__ == "__main__":
    asyncio.run(main())

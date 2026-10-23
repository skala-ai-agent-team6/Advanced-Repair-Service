"""Talk to the running RAG MCP; never open its local Qdrant files a second time."""
import argparse
import asyncio
import json

from fastmcp import Client


async def main():
    parser = argparse.ArgumentParser(description="확정 사례 동기화·상태·통합 검색 시연")
    parser.add_argument("action", choices=["sync", "status", "search"])
    parser.add_argument("--url", default="http://127.0.0.1:8014/mcp")
    parser.add_argument("--query", default="전원이 켜지지 않아요")
    parser.add_argument("--product-type", choices=["vacuum", "washing_machine", "air_conditioner", "unknown"],
                        default="unknown")
    args = parser.parse_args()
    tool, payload = {
        "sync": ("sync_confirmed_cases", {}),
        "status": ("get_case_sync_status", {}),
        "search": ("search_repair_cases", {"query": args.query, "top_k": 3, "product_type": args.product_type}),
    }[args.action]
    async with Client(args.url, timeout=300) as client:
        data = (await client.call_tool(tool, payload)).data
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

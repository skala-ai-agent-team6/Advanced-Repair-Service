"""Opt-in synthetic reports sharing the confirmed-case index, with distinct IDs."""
import re
from .config import read_json
from .sync import report_document


def demo_documents():
    dataset = read_json("demo_confirmed_cases.json")
    if dataset.get("synthetic") is not True:
        raise ValueError("Demo dataset must be explicitly synthetic")
    seen = set()
    for raw in dataset["reports"]:
        slug = raw.get("demo_id", "")
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", slug) or slug in seen:
            raise ValueError("Invalid or duplicate demo_id")
        seen.add(slug)
        doc = report_document(raw)
        if doc["product_type"] == "unknown":
            raise ValueError("Demo product_type is required")
        doc.update(document_id=f"demo:confirmed-report:{slug}",
                   source_uri=f"urn:repair-demo:{slug}:revision:{doc['report_revision']}",
                   source_type="synthetic_demo_repair", source_label="가상 확정 사례 (데모)",
                   source_document_confirmed=False, is_demo=True)
        doc["korean_summary"] = "[가상 데모 사례] " + doc["korean_summary"]
        text = "[가상 데모 사례 — 실제 수리 이력 아님]\n" + doc["text"]
        for key in ("text", "search_text", "original_text"):
            doc[key] = text
        yield doc


def seed_demo_cases(store):
    # Validate the entire file before the first write; IDs cannot collide with Spring reports.
    documents = list(demo_documents())
    result = {"added": 0, "updated": 0, "unchanged": 0, "stale": 0, "synthetic": True}
    for doc in documents:
        result[store.upsert_confirmed_case(doc)] += 1
    return {**result, "collection": store.internal_collection}

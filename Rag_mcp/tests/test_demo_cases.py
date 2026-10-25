from collections import Counter

from repair_mcp.demo_cases import demo_documents, seed_demo_cases
from repair_mcp.retrieval import brief_cases
from repair_mcp.sync import report_document
from test_confirmed_sync import store_at, public_index, report


def test_synthetic_demo_identity_product_filter_and_idempotence():
    documents=list(demo_documents())
    assert Counter(d['product_type'] for d in documents)=={'washing_machine':3,'air_conditioner':3}
    assert all(d['is_demo'] and not d['source_document_confirmed'] for d in documents)
    store=store_at()
    public_index(store)
    try:
        assert seed_demo_cases(store)['added']==6
        calls=store.encoder.calls
        assert seed_demo_cases(store)['unchanged']==6
        assert store.encoder.calls==calls
        raw=report(report_id=documents[0]['report_id'])
        raw['product_type']='washing_machine'
        store.upsert_confirmed_case(report_document(raw))
        assert store.internal_case_count()==7  # Real report cannot overwrite matching numeric demo ID.
        for kind in ('washing_machine','air_conditioner'):
            found=store.search('repair_cases','filter',top_k=20,min_score=-1,product_type=kind)
            assert {d['product_type'] for d in found}=={kind}
            assert len([d for d in found if d.get('is_demo')])==3
            briefs=brief_cases([d for d in found if d.get('is_demo')])
            assert all(b['is_demo'] and '데모' in b['source_label'] for b in briefs)
    finally:
        store.close()

"""Persistent internal reports, independent of the bundled public corpus version."""
import hashlib
import json
import math
import uuid

from qdrant_client import models as qm


class InternalCasesMixin:
    @property
    def internal_collection(self):
        # Changing static documents must not make confirmed reports disappear.
        signature = json.dumps([self.model_name, self.revision, "confirmed-report-v1"])
        digest = hashlib.sha256(signature.encode()).hexdigest()[:16]
        return f"repair_mcp_internal_cases_{digest}"

    def internal_case_count(self):
        with self.lock:
            if not self.client.collection_exists(self.internal_collection):
                return 0
            return self.client.count(self.internal_collection, exact=True).count

    def upsert_confirmed_case(self, document):
        """One stable point per report; successful upsert is the sync checkpoint.

        Long reports use the normalized mean of chunk embeddings. The payload
        keeps the full report, so a revision replaces its vector and evidence
        together without leaving obsolete chunks or a separate checkpoint file.
        """
        point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, document["document_id"]))
        digest = hashlib.sha256(json.dumps(document, sort_keys=True,
                                          ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            exists = self.client.collection_exists(self.internal_collection)
            previous = self.client.retrieve(self.internal_collection, [point_id]) if exists else []
            if previous:
                payload = previous[0].payload
                if payload["report_revision"] > document["report_revision"]:
                    return "stale"
                if payload["report_revision"] == document["report_revision"]:
                    if payload["content_hash"] == digest:
                        return "unchanged"
                    source_fields = ("report_id", "case_id", "report_revision", "confirmed_at",
                                     "reported_observations_ko", "confirmed_cause_ko",
                                     "reported_action_ko", "outcome")
                    missing_product = ("product_type" not in payload or (
                        payload["product_type"] == "unknown" and document["product_type"] != "unknown"))
                    legacy_metadata_upgrade = missing_product and all(
                        payload.get(key) == document.get(key) for key in source_fields)
                    if not legacy_metadata_upgrade:
                        raise ValueError("CONFIRMED_REVISION_CONTENT_CHANGED")

            vectors = self._encode(list(self._chunks(document)), "passage: ")
            mean = [sum(values) / len(vectors) for values in zip(*vectors)]
            norm = math.sqrt(sum(value * value for value in mean))
            if not math.isfinite(norm) or norm == 0:
                raise ValueError("INVALID_REPORT_EMBEDDING")
            vector = [value / norm for value in mean]
            if not exists:
                self.client.create_collection(self.internal_collection,
                    vectors_config=qm.VectorParams(size=len(vector), distance=qm.Distance.COSINE))
            self.client.upsert(self.internal_collection, points=[qm.PointStruct(
                id=point_id, vector=vector,
                payload={**document, "content_hash": digest,
                         "record_kind": "document", "chunk_text": document["text"]},
            )], wait=True)
            return "updated" if previous else "added"

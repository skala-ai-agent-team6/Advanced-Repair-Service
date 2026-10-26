"""Shared observation contract for extraction and the RAG handoff; no API calls."""
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import read_json
from .products import ProductType
from .search_terms import ENGLISH_HINTS

VOCAB = {t["code"]: t for t in read_json("observation_vocabulary.json")["terms"]}
ObservationCode = Enum("ObservationCode", {code: code for code in VOCAB}, type=str)


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: ObservationCode
    polarity: Literal["present", "absent"]
    certainty: Literal["reported", "suspected"]
    evidence_text: str = Field(min_length=1, max_length=2000)


class Extraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observations: list[Observation] = Field(max_length=43)
    unmapped_fragments: list[str] = Field(max_length=100)


class NormalizedTerm(Observation):
    label_ko: str
    search_hint_en: str

    @model_validator(mode="after")
    def canonical_terms(self):
        code = self.code.value
        if self.label_ko != VOCAB[code]["label_ko"] or self.search_hint_en != ENGLISH_HINTS[code]:
            raise ValueError("Observation labels must match the registered vocabulary")
        return self


class NormalizedObservation(BaseModel):
    """The successful normalize_observation response, passed unchanged to RAG."""
    model_config = ConfigDict(extra="forbid")
    product_type: ProductType
    raw_text: str = Field(min_length=1, max_length=2000)
    origin: Literal["technician", "ai_image"]
    technician_confirmed: bool
    engine: Literal["openai-structured-output-v1"]
    model: str = Field(min_length=1, max_length=200)
    observations: list[NormalizedTerm] = Field(max_length=43)
    unmapped_fragments: list[str] = Field(max_length=100)
    diagnosis_confirmed: Literal[False]

    @model_validator(mode="after")
    def evidence_in_source(self):
        fragments = [o.evidence_text for o in self.observations] + self.unmapped_fragments
        if not self.raw_text.strip() or any(not f.strip() or f not in self.raw_text for f in fragments):
            raise ValueError("Observation evidence must be copied from raw_text")
        return self

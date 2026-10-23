from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LegacyDamageLabel(StrictModel):
    """Older worker payload; its vehicle part is not a surface defect label."""
    damage_type: Literal["damage", "dent"]
    part: str = Field(min_length=1, max_length=100)


class SearchRequest(StrictModel):
    raw_text: str = Field(default="", max_length=2000)
    origin: Literal["technician", "ai_image"] = "technician"
    technician_confirmed: bool = False
    # None means the upstream model result was not delivered; [] means it
    # completed without a supported detection. Both allow partial retrieval.
    pcb_labels: list[Annotated[str, Field(min_length=1, max_length=100)]] | None = Field(default=None, max_length=30)
    damage_labels: list[Annotated[str, Field(min_length=1, max_length=100)] | LegacyDamageLabel] | None = Field(default=None, max_length=30)
    model_code: str | None = Field(default=None, max_length=120)
    top_k: int = Field(default=5, ge=1, le=20)
    # Relevance cutoff is experimental, NOT diagnosis confidence.
    min_score: float = Field(default=0.75, ge=-1, le=1)
    repair_status: Literal["Fixed", "Repairable", "End of life", "Unknown", "Not fixed", "No fault found"] | None = None
    use_bilingual_hints: bool = True


class AgentCase(StrictModel):
    """[통합] 에이전트가 저장하는 미확정 사례 (save_repair_case 입력)."""
    case_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")
    repair_id: str = Field(default="", max_length=50)
    symptom: str = Field(default="", max_length=2000)
    summary: str = Field(default="", max_length=4000)
    causes: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list, max_length=10)
    labels: list[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=30)
    recommended_part_ids: list[Annotated[str, Field(max_length=20)]] = Field(default_factory=list, max_length=20)

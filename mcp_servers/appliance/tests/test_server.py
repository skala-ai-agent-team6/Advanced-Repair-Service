"""appliance-mcp 시험: 도구 목록·스키마, 출력 모양, 보류(uncertain) 경로, 없는 파일, 실제 모델 스모크."""
import sys
from pathlib import Path

import numpy as np
import pytest
import torch
from fastmcp import Client
from fastmcp.exceptions import ToolError
from PIL import Image
from sklearn.linear_model import LogisticRegression

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
import server  # noqa: E402

SAMPLES = BASE / "tests/samples"
HAS_DEFECTS = all((server.WEIGHTS / f).exists() for f in ("defects.pt", "severity.pt"))
HAS_PARTS = (server.WEIGHTS / "parts_head.joblib").exists()


@pytest.fixture
def image(tmp_path):
    p = tmp_path / "plain.jpg"
    Image.new("RGB", (64, 64), (120, 120, 120)).save(p)
    return str(p)


class FakeClip:
    """CLIP 대신 고정 벡터를 돌려준다 (모델 내려받기 없이 분기만 시험)."""
    def __init__(self, vec):
        self.vec = torch.tensor(vec, dtype=torch.float32).unsqueeze(0)

    def encode_image(self, _):
        return self.vec


def fake_parts(part_vec, state_threshold=0.6):
    rng = np.random.default_rng(0)
    a, b = rng.normal(0, 1, (20, 8)) + 3, rng.normal(0, 1, (20, 8)) - 3
    part = LogisticRegression().fit(np.vstack([a, b]), ["ac_filter"] * 20 + ["other"] * 20)
    state = LogisticRegression().fit(np.vstack([a + 1, a - 1]), ["clean"] * 20 + ["heavily_dirty"] * 20)
    bundle = {"part": part, "part_threshold": 0.4, "min_per_class": 6,
              "states": {"ac_filter": {"clf": state, "counts": {"clean": 20, "heavily_dirty": 20},
                                       "threshold": state_threshold}}}
    return bundle, FakeClip(part_vec), (lambda img: torch.zeros(3)), torch


async def call(name, args):
    async with Client(server.mcp) as c:
        return (await c.call_tool(name, args)).data


async def test_tools_and_schemas():
    async with Client(server.mcp) as c:
        tools = {t.name: t for t in await c.list_tools()}
    assert set(tools) == {"detect_common_defects", "inspect_appliance_part", "list_inspection_items"}
    assert tools["inspect_appliance_part"].input_schema["required"] == ["image_path", "product_type"]
    assert tools["detect_common_defects"].input_schema["required"] == ["image_path"]
    assert all(t.annotations.read_only_hint for t in tools.values())


async def test_list_items_has_severity_for_every_state():
    out = await call("list_inspection_items", {"product_type": "washing_machine"})
    assert set(out["items"]) == {"wm_inlet_hose", "wm_drain_filter", "wm_door_gasket"}
    for item in out["items"].values():
        assert set(item["states"].values()) <= {"none", "minor", "moderate", "severe"}


async def test_missing_file_is_tool_error():
    with pytest.raises(ToolError, match="사진이 없다"):
        await call("detect_common_defects", {"image_path": "/nope/missing.jpg"})
    with pytest.raises(ToolError, match="사진이 없다"):
        await call("inspect_appliance_part", {"image_path": "/nope/missing.jpg", "product_type": "air_conditioner"})


async def test_unknown_product_is_tool_error(image):
    with pytest.raises(ToolError, match="product_type"):
        await call("inspect_appliance_part", {"image_path": image, "product_type": "fridge"})


async def test_unrecognized_part_is_uncertain(image, monkeypatch):
    monkeypatch.setattr(server, "parts_model", lambda: fake_parts([-3] * 8))
    out = await call("inspect_appliance_part", {"image_path": image, "product_type": "air_conditioner"})
    assert out["status"] == "uncertain" and out["part"] is None and out["severity"] is None


async def test_low_state_confidence_is_uncertain(image, monkeypatch):
    # 부위는 알아보지만 상태 확신도가 기준 미만이면 보류 (기준을 1 초과로 둬 이 분기를 강제)
    monkeypatch.setattr(server, "parts_model", lambda: fake_parts([3] * 8, state_threshold=1.01))
    out = await call("inspect_appliance_part", {"image_path": image, "product_type": "air_conditioner"})
    assert out["part"] == "ac_filter" and out["status"] == "uncertain" and out["severity"] is None


async def test_confident_state_returns_severity(image, monkeypatch):
    monkeypatch.setattr(server, "parts_model", lambda: fake_parts([4] * 8, state_threshold=0.5))
    out = await call("inspect_appliance_part", {"image_path": image, "product_type": "air_conditioner"})
    assert out["status"] == "ok" and out["severity"] in {"none", "severe"}
    assert out["severity"] == server.SEVERITY[out["state"]]


async def test_item_without_enough_data_is_uncertain(image, monkeypatch):
    bundle, clip, pre, t = fake_parts([3] * 8)
    bundle["states"] = {}
    monkeypatch.setattr(server, "parts_model", lambda: (bundle, clip, pre, t))
    out = await call("inspect_appliance_part", {"image_path": image, "product_type": "air_conditioner"})
    assert out["status"] == "uncertain" and "부족" in out["reason"]


@pytest.mark.skipif(not HAS_DEFECTS, reason="학습된 가중치 없음")
@pytest.mark.parametrize("name", ["scratch_metal.jpg", "rust_metal.jpg"])
async def test_real_defect_model_smoke(name):
    out = await call("detect_common_defects", {"image_path": str(SAMPLES / name)})
    assert {"is_defective", "overall_severity", "defects", "annotated_image"} <= set(out)
    for d in out["defects"]:
        assert d["type"] in {"rust", "dent", "crack", "scratch"}
        assert d["severity"] in {"minor", "moderate", "severe"} and 0 <= d["severity_confidence"] <= 1
        assert len(d["box_xyxy"]) == 4


@pytest.mark.skipif(not HAS_PARTS, reason="학습된 가중치 없음")
async def test_real_parts_model_smoke():
    out = await call("inspect_appliance_part", {"image_path": str(SAMPLES / "ac_filter.jpg"), "product_type": "air_conditioner"})
    assert out["status"] in {"ok", "uncertain"} and "part_scores" in out

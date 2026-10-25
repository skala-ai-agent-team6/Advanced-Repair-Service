import json
import os
import sys
from contextlib import redirect_stdout
from functools import cache
from pathlib import Path

os.environ["YOLO_VERBOSE"] = "False"

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from PIL import Image

from parts_spec import ITEMS, PRODUCTS, SEVERITY, items_for

BASE = Path(__file__).parent
WEIGHTS = Path(os.getenv("APPLIANCE_WEIGHTS", BASE / "weights"))
OUT_DIR = Path(os.getenv("OUT_DIR", BASE / "results"))
MIN_CONF = 0.25
SEVERITY_ORDER = ["none", "minor", "moderate", "severe"]
# 모델 3개: 공통 결함 탐지(YOLO), 결함 심각도 분류(YOLO-cls), 가전 부품 상태 분류(CLIP 특징 + 학습한 분류기)
# 심각도·상태는 전부 학습된 모델 출력이다. GPT는 학습 라벨 교사로만 썼고 여기서는 부르지 않는다.

mcp = FastMCP("appliance-mcp")


@cache
def defect_model():
    from ultralytics import YOLO
    return YOLO(str(WEIGHTS / "defects.pt"))


@cache
def severity_model():
    from ultralytics import YOLO
    return YOLO(str(WEIGHTS / "severity.pt"))


@cache
def parts_model():
    """CLIP 인코더 + 부품 인식기 + 부품별 상태 분류기. 학습 정보(meta)에 클래스별 학습 장수가 있다."""
    import joblib
    import open_clip
    import torch
    bundle = joblib.load(WEIGHTS / "parts_head.joblib")
    model, _, preprocess = open_clip.create_model_and_transforms(bundle["clip"], pretrained=bundle["pretrained"])
    model.eval()
    return bundle, model, preprocess, torch


def open_image(image_path: str) -> tuple[Path, Image.Image]:
    path = Path(image_path).expanduser()
    if not path.is_file():
        raise ToolError(f"사진이 없다: {path}")
    try:
        return path, Image.open(path).convert("RGB")
    except Exception as exc:
        raise ToolError(f"사진을 열 수 없다: {path} ({type(exc).__name__})")


def crop(image: Image.Image, box, pad=0.5) -> Image.Image:
    """결함 주변을 여유 있게 잘라 심각도 모델에 넣는다 (심각도 학습 사진이 손상 부위 클로즈업이라)."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    return image.crop((max(0, x1 - w * pad), max(0, y1 - h * pad),
                       min(image.width, x2 + w * pad), min(image.height, y2 + h * pad)))


@mcp.tool(annotations={"readOnlyHint": True})
def detect_common_defects(image_path: str, conf: float = MIN_CONF) -> dict:
    """가전 외관·부품 사진에서 공통 결함 4종(rust 녹, dent 찌그러짐, crack 균열, scratch 긁힘)을 찾고
    결함마다 심각도(minor·moderate·severe)를 학습된 분류 모델로 매긴다.

    image_path: 사진 절대경로. conf: 이 확신도 미만 탐지는 버림(0~1).
    """
    path, image = open_image(image_path)
    model = defect_model()
    with redirect_stdout(sys.stderr):
        r = model.predict(image, conf=conf, iou=0.6, verbose=False)[0]
        defects = []
        for c, s, b in zip(r.boxes.cls, r.boxes.conf, r.boxes.xyxy):
            box = [round(v) for v in b.tolist()]
            sev = severity_model().predict(crop(image, box), verbose=False)[0].probs
            defects.append({"type": model.names[int(c)], "confidence": round(float(s), 3), "box_xyxy": box,
                            "severity": severity_model().names[int(sev.top1)],
                            "severity_confidence": round(float(sev.top1conf), 3)})
    counts = {}
    for d in defects:
        counts[d["type"]] = counts.get(d["type"], 0) + 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    annotated = OUT_DIR / f"{path.stem}_defects_boxed.jpg"
    Image.fromarray(r.plot()[..., ::-1]).save(annotated)
    worst = max((d["severity"] for d in defects), key=SEVERITY_ORDER.index, default="none")
    return {"image": str(path), "is_defective": bool(defects),
            "max_confidence": max((d["confidence"] for d in defects), default=0.0),
            "overall_severity": worst, "defect_counts": counts, "defects": defects,
            "annotated_image": str(annotated), "model": "appliance-defects (YOLO11) + severity (YOLO11-cls)"}


@mcp.tool(annotations={"readOnlyHint": True})
def list_inspection_items(product_type: str = "") -> dict:
    """가전별 점검 부위와 상태 클래스 목록. product_type: air_conditioner | washing_machine | robot_vacuum (비우면 전부)."""
    keys = items_for(product_type) if product_type else list(ITEMS)
    return {"products": PRODUCTS,
            "items": {k: {"product": ITEMS[k]["product"], "part": ITEMS[k]["part"],
                          "states": {s: SEVERITY[s] for s in ITEMS[k]["classes"]}} for k in keys}}


@mcp.tool(annotations={"readOnlyHint": True})
def inspect_appliance_part(image_path: str, product_type: str) -> dict:
    """소비자가 찍은 가전 부품 사진에서 어떤 부위인지와 그 상태·심각도를 학습된 분류 모델로 판정한다.
    예: 에어컨 필터 오염 정도, 세탁기 급수 호스 손상, 도어 고무 패킹 곰팡이, 로봇청소기 바퀴 마모·모터 탄 자국.
    확신이 낮거나 학습 사진이 부족한 부위면 status=uncertain으로 판정을 보류한다.

    image_path: 사진 절대경로. product_type: air_conditioner | washing_machine | robot_vacuum.
    """
    if product_type not in PRODUCTS:
        raise ToolError(f"product_type은 {', '.join(PRODUCTS)} 중 하나여야 한다: {product_type}")
    path, image = open_image(image_path)
    bundle, clip, preprocess, torch = parts_model()
    with torch.no_grad():
        f = clip.encode_image(preprocess(image).unsqueeze(0))
        f = (f / f.norm(dim=-1, keepdim=True)).numpy()
    allowed = set(items_for(product_type))
    part_clf = bundle["part"]
    probs = {k: p for k, p in zip(part_clf.classes_, part_clf.predict_proba(f)[0]) if k in allowed or k == "other"}
    total = sum(probs.values()) or 1.0
    probs = {k: v / total for k, v in probs.items()}  # 이 가전의 부위만 놓고 다시 나눈다
    part, part_conf = max(probs.items(), key=lambda kv: kv[1])
    result = {"image": str(path), "product_type": product_type,
              "part_scores": {k: round(float(v), 3) for k, v in sorted(probs.items(), key=lambda kv: -kv[1])}}
    if part == "other" or part_conf < bundle["part_threshold"]:
        return {**result, "status": "uncertain", "part": None, "part_confidence": round(float(part_conf), 3),
                "state": None, "severity": None, "reason": "점검 부위를 알아보지 못했다. 해당 부위를 가까이 다시 찍어야 한다"}
    head = bundle["states"].get(part)
    base = {**result, "part": part, "part_label": ITEMS[part]["part"], "part_confidence": round(float(part_conf), 3)}
    if head is None:
        return {**base, "status": "uncertain", "state": None, "severity": None,
                "reason": "이 부위는 학습 사진이 부족해 상태를 판정하지 않는다"}
    sp = head["clf"].predict_proba(f)[0]
    i = int(sp.argmax())
    state, state_conf = head["clf"].classes_[i], float(sp[i])
    out = {**base, "state": state, "state_confidence": round(state_conf, 3),
           "state_scores": {c: round(float(p), 3) for c, p in zip(head["clf"].classes_, sp)},
           "severity": SEVERITY[state], "trained_samples": head["counts"]}
    if state_conf < head["threshold"]:
        return {**out, "status": "uncertain", "severity": None,
                "reason": f"상태 확신도 {state_conf:.2f}가 기준 {head['threshold']:.2f}보다 낮다"}
    return {**out, "status": "ok"}


if __name__ == "__main__":
    mcp.run(transport="http", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "9105")), show_banner=False)
    # Streamable HTTP: http://127.0.0.1:9105/mcp

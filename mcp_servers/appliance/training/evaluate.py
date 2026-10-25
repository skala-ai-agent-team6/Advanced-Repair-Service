"""홀드아웃 평가: 클래스별 정밀도·재현율을 출력하고 weights/eval_report.json에 저장한다.

- 결함 탐지: defects/data.yaml의 test 분할 (YOLO val)
- 심각도: severity/val 폴더 (학습에 안 쓴 검증 분할)
- 부위 상태: train_parts.py가 남긴 parts_report.json (부위별 30% 홀드아웃)
사용: python training/evaluate.py <appliance_data>
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

os.environ["YOLO_VERBOSE"] = "False"
from ultralytics import YOLO  # noqa: E402

root = Path(sys.argv[1])
DEVICE = os.getenv("EVAL_DEVICE", "cpu")  # 학습 중인 GPU와 겹치지 않게 기본은 CPU
weights = Path(__file__).resolve().parents[1] / "weights"
report = {}

if (weights / "defects.pt").exists():
    m = YOLO(str(weights / "defects.pt"))
    r = m.val(data=str(root / "defects/data.yaml"), split="test", conf=0.25, iou=0.6, plots=False, verbose=False, device=DEVICE)
    rows = {}
    for i, c in enumerate(r.box.ap_class_index):
        p, rc, ap50, _ = r.box.class_result(i)
        rows[m.names[int(c)]] = {"precision": round(p, 3), "recall": round(rc, 3), "mAP50": round(ap50, 3)}
    report["defects_test"] = {"per_class": rows, "mAP50": round(r.box.map50, 3)}
    print("결함 탐지 (test)  mAP50", round(r.box.map50, 3))
    for k, v in rows.items():
        print(f"  {k:8} P {v['precision']:.2f}  R {v['recall']:.2f}  mAP50 {v['mAP50']:.2f}")

if (weights / "severity.pt").exists():
    m = YOLO(str(weights / "severity.pt"))
    pairs = []
    for cls_dir in sorted((root / "severity/val").iterdir()):
        for img in sorted(cls_dir.iterdir()):
            pairs.append((cls_dir.name, m.names[int(m.predict(str(img), verbose=False, device=DEVICE)[0].probs.top1)]))
    tp, pred, true = Counter(), Counter(p for _, p in pairs), Counter(t for t, _ in pairs)
    for t, p in pairs:
        tp[t] += t == p
    rows = {c: {"precision": round(tp[c] / max(pred[c], 1), 3), "recall": round(tp[c] / max(true[c], 1), 3), "n": true[c]}
            for c in sorted(true)}
    acc = round(sum(tp.values()) / len(pairs), 3)
    report["severity_val"] = {"accuracy": acc, "per_class": rows}
    print("심각도 (val)  정확도", acc)
    for k, v in rows.items():
        print(f"  {k:9} P {v['precision']:.2f}  R {v['recall']:.2f}  (n={v['n']})")

if (weights / "parts_report.json").exists():
    pr = json.loads((weights / "parts_report.json").read_text())
    report["parts"] = pr
    print("부위 인식 홀드아웃 정확도", round(pr["part"]["accuracy"], 3))
    for item, info in pr["items"].items():
        h = info.get("holdout")
        if not h:
            print(f"  {item:16} 보류: {info.get('skipped')}")
            continue
        cls = {k: v for k, v in h.items() if isinstance(v, dict) and k not in ("macro avg", "weighted avg")}
        print(f"  {item:16} acc {h['accuracy']:.2f} (n={info['holdout_n']}) " +
              " ".join(f"{k}: P{v['precision']:.2f}/R{v['recall']:.2f}" for k, v in cls.items()))

(weights / "eval_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))

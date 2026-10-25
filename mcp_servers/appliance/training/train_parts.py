"""가전 부품 상태 분류기 학습: CLIP 이미지 특징 + 로지스틱 회귀.

라벨: GPT 교사 라벨(gpt_label)만 쓴다. 검색어 라벨(query_label)은 GPT 라벨과 일치율이 10%(50/480)라 학습에서 뺐다.
gpt_label=not_relevant 인 사진은 부위 인식기의 'other' 클래스로 쓴다.
클래스당 학습 사진이 MIN_PER_CLASS 미만인 부위는 상태 분류기를 만들지 않는다 → 서버가 uncertain으로 답한다.
사용: python training/train_parts.py <appliance_data> [--out weights/parts_head.joblib]
결과: 분류기 묶음(joblib) + 홀드아웃 성능 표(parts_report.json)
"""
import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
import open_clip
import torch
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parts_spec import ITEMS  # noqa: E402

CLIP, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"
MIN_PER_CLASS = 5
PART_THRESHOLD = 0.6  # 홀드아웃에서 부위 정밀도 11/17, 재현율 11/26 (0.4면 19/40, 19/26). 보류를 택해 정밀도 우선
STATE_THRESHOLD = {2: 0.6, 3: 0.45}  # 클래스 수별 확신도 기준. 이보다 낮으면 uncertain


def final_label(row):
    return (row["gpt_label"], "gpt-teacher") if row.get("gpt_label") else (None, "unlabeled")


def embed(paths, cache_path):
    cache = dict(np.load(cache_path, allow_pickle=True)) if cache_path.exists() else {}
    todo = [p for p in paths if str(p) not in cache]
    if todo:
        model, _, preprocess = open_clip.create_model_and_transforms(CLIP, pretrained=PRETRAINED)
        model.eval()
        with torch.no_grad():
            for i in range(0, len(todo), 32):
                batch = torch.stack([preprocess(Image.open(p).convert("RGB")) for p in todo[i:i + 32]])
                f = model.encode_image(batch)
                f = (f / f.norm(dim=-1, keepdim=True)).numpy()
                for p, v in zip(todo[i:i + 32], f):
                    cache[str(p)] = v
        np.savez(cache_path, **cache)
    return np.stack([cache[str(p)] for p in paths])


def fit(x, y):
    return LogisticRegression(max_iter=2000, C=2.0, class_weight="balanced").fit(x, y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "weights/parts_head.joblib"))
    args = ap.parse_args()
    root = Path(args.root) / "parts"
    rows = [r for r in csv.DictReader((root / "sources.csv").open())]
    for r in rows:
        r["label"], r["label_source"] = final_label(r)
    skipped = sum(r["label"] is None for r in rows)
    rows = [r for r in rows if r["label"] is not None]
    x = embed([root / r["file"] for r in rows], root / "clip_cache.npz")
    report = {"label_sources": Counter(r["label_source"] for r in rows), "unlabeled_skipped": skipped, "items": {}}

    # 1. 부위 인식기: 관련 있는 사진은 item, not_relevant는 other
    part_y = np.array([("other" if r["label"] == "not_relevant" else r["item"]) for r in rows])
    tr, te = train_test_split(np.arange(len(rows)), test_size=0.25, random_state=0, stratify=part_y)
    clf = fit(x[tr], part_y[tr])
    report["part"] = classification_report(part_y[te], clf.predict(x[te]), output_dict=True, zero_division=0)
    bundle = {"clip": CLIP, "pretrained": PRETRAINED, "part": fit(x, part_y), "part_threshold": PART_THRESHOLD,
              "states": {}, "min_per_class": MIN_PER_CLASS}

    # 2. 부위별 상태 분류기
    for item, spec in ITEMS.items():
        idx = np.array([i for i, r in enumerate(rows) if r["item"] == item and r["label"] in spec["classes"]])
        counts = Counter(rows[i]["label"] for i in idx) if len(idx) else Counter()
        info = {"counts": dict(counts)}
        enough = [c for c in spec["classes"] if counts.get(c, 0) >= MIN_PER_CLASS]
        if len(enough) < len(spec["classes"]):
            info["skipped"] = f"클래스당 {MIN_PER_CLASS}장 미만: {[c for c in spec['classes'] if c not in enough]}"
            report["items"][item] = info
            continue
        y = np.array([rows[i]["label"] for i in idx])
        a, b = train_test_split(np.arange(len(idx)), test_size=0.3, random_state=0, stratify=y)
        m = fit(x[idx][a], y[a])
        info["holdout"] = classification_report(y[b], m.predict(x[idx][b]), output_dict=True, zero_division=0)
        info["holdout_n"] = int(len(b))
        report["items"][item] = info
        bundle["states"][item] = {"clf": fit(x[idx], y), "counts": dict(counts),
                                  "threshold": STATE_THRESHOLD[len(spec["classes"])]}

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out)
    (Path(args.out).parent / "parts_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=int))
    print("부위 인식 홀드아웃 정확도", round(report["part"]["accuracy"], 3))
    for item, info in report["items"].items():
        h = info.get("holdout")
        print(f"{item:16} {info['counts']} " + (f"acc {h['accuracy']:.2f} (n={info['holdout_n']})" if h else info.get("skipped", "")))


if __name__ == "__main__":
    main()

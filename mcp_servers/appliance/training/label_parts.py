"""GPT 비전을 '라벨 교사'로만 쓴다: 수집한 학습 사진에 상태 라벨을 붙인다. 추론에는 쓰지 않는다.

키는 레포 .env를 실행 시 읽는다 (uv run --env-file ../../.env). 이 스크립트는 키를 출력하지 않는다.
사용: python training/label_parts.py <데이터 폴더> [--limit 500]
결과: parts/sources.csv에 gpt_label, gpt_confidence 열을 채운다 (이미 채운 행은 건너뜀).
"""
import argparse
import base64
import csv
import json
import os
import sys
from itertools import zip_longest
from pathlib import Path

from openai import OpenAI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parts_spec import ITEMS  # noqa: E402

MODEL = os.getenv("LABEL_MODEL", "gpt-4.1-mini")


def ask(client, item, path):
    spec = ITEMS[item]
    classes = list(spec["classes"]) + ["not_relevant"]
    prompt = (f"You label training images for a home-appliance repair model.\n"
              f"Target part: {spec['part']}.\n"
              f"Classes: {json.dumps({c: d for c, d in spec['classes'].items()})}\n"
              "Use not_relevant if the photo does not clearly show this kind of part "
              "(e.g. a different object, a diagram, a document scan, a car tire for a robot-vacuum wheel is fine only if the visible condition is clear).\n"
              'Reply JSON only: {"label": <one class>, "confidence": <0-1>}')
    b64 = base64.b64encode(Path(path).read_bytes()).decode()
    r = client.chat.completions.create(
        model=MODEL, temperature=0, max_tokens=60, response_format={"type": "json_object"},
        messages=[{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}}]}])
    out = json.loads(r.choices[0].message.content)
    label = out.get("label") if out.get("label") in classes else "not_relevant"
    return label, float(out.get("confidence", 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()
    root = Path(args.root) / "parts"
    path = root / "sources.csv"
    rows = list(csv.DictReader(path.open()))
    client = OpenAI()
    done = 0
    # 비용 상한(--limit) 안에서 부위가 고르게 라벨되도록 부위별로 번갈아 고른다
    by_item = {}
    for row in rows:
        by_item.setdefault(row["item"], []).append(row)
    order = [r for group in zip_longest(*by_item.values()) for r in group if r is not None]
    for row in order:
        if row.get("gpt_label") or done >= args.limit:
            continue
        try:
            row["gpt_label"], conf = ask(client, row["item"], root / row["file"])
            row["gpt_confidence"] = f"{conf:.2f}"
        except Exception as exc:  # 한 장 실패는 건너뛰고 기록만
            row["gpt_label"], row["gpt_confidence"] = "", f"error:{type(exc).__name__}"
        row["label_source"] = "gpt-teacher" if row["gpt_label"] else "query"
        done += 1
        if done % 25 == 0:
            print(done, flush=True)
            write(path, rows)
    write(path, rows)
    print("labeled", done)


def write(path, rows):
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()

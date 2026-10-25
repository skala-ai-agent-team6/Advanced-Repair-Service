"""합성 결함 데이터: 정상 가전 사진에 진짜 결함 조각을 붙이고, 붙인 위치를 그대로 YOLO 정답 박스로 쓴다.

결함 조각은 defects/images/train의 박스에서 잘라 온다 (test·val은 쓰지 않음 → 평가 오염 없음).
- rust: 색까지 섞어 붙임 (경계는 부드럽게)
- scratch·crack·dent: 조각의 명암 변화(고주파)만 옮겨 바탕 색은 유지 → 붙인 티를 줄임
합성 사진은 학습에만 쓴다. 평가는 진짜 사진으로만 한다.
사용: python training/synth_defects.py <데이터 폴더> --bases 30 --n 200
결과: <데이터 폴더>/synth/{base,images,labels}, preview.jpg, bases.csv
"""
import argparse
import csv
import hashlib
import io
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from collect_parts import commons, get, licensed, openverse

NAMES = ["rust", "dent", "crack", "scratch"]
BASE_QUERIES = ["washing machine", "front load washing machine", "top load washing machine",
                "air conditioner indoor unit", "split air conditioner", "window air conditioner",
                "robot vacuum cleaner", "robotic vacuum"]


def fetch_bases(root, per_query):
    folder = root / "base"
    folder.mkdir(parents=True, exist_ok=True)
    csv_path = root / "bases.csv"
    rows = list(csv.DictReader(csv_path.open())) if csv_path.exists() else []
    seen = {r["sha1"] for r in rows}
    for q in BASE_QUERIES:
        hits = [h for h in commons(q, per_query) + openverse(q, per_query) if licensed(h["license"])]
        with ThreadPoolExecutor(8) as pool:
            blobs = list(pool.map(lambda h: get(h["url"]), hits))
        for h, blob in zip(hits, blobs):
            if not blob:
                continue
            sha = hashlib.sha1(blob).hexdigest()
            if sha in seen:
                continue
            try:
                img = Image.open(io.BytesIO(blob)).convert("RGB")
            except Exception:
                continue
            if min(img.size) < 256:
                continue
            seen.add(sha)
            img.save(folder / f"{sha[:16]}.jpg", quality=92)
            rows.append({"file": f"base/{sha[:16]}.jpg", "sha1": sha, "query": q, "source": h["source"],
                         "license": h["license"], "page": h["page"], "title": h["title"]})
    with csv_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file", "sha1", "query", "source", "license", "page", "title"])
        w.writeheader()
        w.writerows(rows)
    return rows


def patch_bank(defects, per_class=300, seed=0):
    rnd = random.Random(seed)
    bank = {i: [] for i in range(len(NAMES))}
    labels = sorted((defects / "labels" / "train").glob("*.txt"))
    rnd.shuffle(labels)
    for lab in labels:
        if all(len(v) >= per_class for v in bank.values()):
            break
        img_path = next((p for p in (defects / "images" / "train").glob(lab.stem + ".*")), None)
        if img_path is None:
            continue
        img = None
        for line in lab.read_text().split("\n"):
            parts = line.split()
            if len(parts) != 5:
                continue
            c = int(parts[0])
            if len(bank[c]) >= per_class:
                continue
            if img is None:
                img = cv2.imread(str(img_path))
                if img is None:
                    break
            h, w = img.shape[:2]
            cx, cy, bw, bh = (float(v) for v in parts[1:])
            x0, y0 = int((cx - bw / 2) * w), int((cy - bh / 2) * h)
            x1, y1 = int((cx + bw / 2) * w), int((cy + bh / 2) * h)
            if x1 - x0 < 16 or y1 - y0 < 16:
                continue
            bank[c].append(img[max(0, y0):y1, max(0, x0):x1].copy())
    return bank


def soft_mask(h, w):
    m = np.zeros((h, w), np.float32)
    cv2.ellipse(m, (w // 2, h // 2), (int(w * 0.45), int(h * 0.45)), 0, 0, 360, 1, -1)
    k = max(3, (min(h, w) // 6) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)[..., None]


def paste(base, patch, cls, rnd):
    H, W = base.shape[:2]
    side = rnd.uniform(0.08, 0.25) * min(H, W)
    ph, pw = patch.shape[:2]
    s = side / max(ph, pw)
    pw, ph = max(16, int(pw * s)), max(16, int(ph * s))
    patch = cv2.resize(patch, (pw, ph))
    if rnd.random() < 0.5:
        patch = cv2.flip(patch, 1)
    # 가전은 보통 사진 가운데 있다 → 가운데 70% 안에만 붙인다
    x = rnd.randint(int(W * 0.15), max(int(W * 0.15), int(W * 0.85) - pw))
    y = rnd.randint(int(H * 0.15), max(int(H * 0.15), int(H * 0.85) - ph))
    region = base[y:y + ph, x:x + pw].astype(np.float32)
    if region.shape[:2] != (ph, pw):
        return None
    m = soft_mask(ph, pw)
    p = patch.astype(np.float32)
    if NAMES[cls] == "rust":
        # 바탕 밝기에 맞춘 뒤 색째 섞는다
        p = p * (region.mean() + 1) / (p.mean() + 1)
        out = region * (1 - m) + p * m
    else:
        # 명암 변화만 옮긴다 (바탕 색 유지)
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
        detail = gray - cv2.GaussianBlur(gray, (0, 0), max(2, min(ph, pw) / 12))
        gain = rnd.uniform(1.0, 2.0)
        out = region + (detail[..., None] * gain) * m
    base[y:y + ph, x:x + pw] = np.clip(out, 0, 255).astype(np.uint8)
    # 마스크가 옅은 가장자리는 박스에서 뺀다
    mx, my = int(pw * 0.08), int(ph * 0.08)
    return cls, (x + pw / 2) / W, (y + ph / 2) / H, (pw - 2 * mx) / W, (ph - 2 * my) / H


def synthesize(root, bank, n, seed=0):
    rnd = random.Random(seed)
    bases = sorted((root / "base").glob("*.jpg"))
    (root / "images").mkdir(exist_ok=True)
    (root / "labels").mkdir(exist_ok=True)
    made = []
    for i in range(n):
        base = cv2.imread(str(rnd.choice(bases)))
        scale = 640 / max(base.shape[:2])
        base = cv2.resize(base, (int(base.shape[1] * scale), int(base.shape[0] * scale)))
        boxes = []
        for _ in range(rnd.randint(1, 3)):
            cls = rnd.randrange(len(NAMES))
            if bank[cls]:
                b = paste(base, rnd.choice(bank[cls]), cls, rnd)
                if b:
                    boxes.append(b)
        if not boxes:
            continue
        name = f"syn_{i:05d}"
        cv2.imwrite(str(root / "images" / f"{name}.jpg"), base, [cv2.IMWRITE_JPEG_QUALITY, rnd.randint(70, 92)])
        (root / "labels" / f"{name}.txt").write_text(
            "\n".join(f"{c} {cx:.5f} {cy:.5f} {w:.5f} {h:.5f}" for c, cx, cy, w, h in boxes) + "\n")
        made.append((name, boxes))
    return made


def negatives(root):
    """결함 없는 바탕 사진을 빈 라벨로 넣는다 → 정상 사진 오탐(C3·C4 같은 경우)을 줄이는 학습 예시."""
    for p in sorted((root / "base").glob("*.jpg")):
        img = cv2.imread(str(p))
        if img is None:
            continue
        s = 640 / max(img.shape[:2])
        cv2.imwrite(str(root / "images" / f"neg_{p.stem}.jpg"), cv2.resize(img, (int(img.shape[1] * s), int(img.shape[0] * s))))
        (root / "labels" / f"neg_{p.stem}.txt").write_text("")


def preview(root, made, k=12):
    tiles = []
    colors = [(0, 90, 255), (255, 160, 0), (0, 0, 255), (0, 220, 0)]
    for name, boxes in made[:k]:
        img = cv2.imread(str(root / "images" / f"{name}.jpg"))
        H, W = img.shape[:2]
        for c, cx, cy, w, h in boxes:
            x0, y0, x1, y1 = int((cx - w / 2) * W), int((cy - h / 2) * H), int((cx + w / 2) * W), int((cy + h / 2) * H)
            cv2.rectangle(img, (x0, y0), (x1, y1), colors[c], 2)
            cv2.putText(img, NAMES[c], (x0, max(12, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colors[c], 1)
        tiles.append(cv2.resize(img, (320, 320)))
    while len(tiles) % 4:
        tiles.append(np.zeros((320, 320, 3), np.uint8))
    grid = np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)])
    cv2.imwrite(str(root / "preview.jpg"), grid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--bases", type=int, default=30, help="검색어당 받을 수")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--skip-fetch", action="store_true")
    args = ap.parse_args()
    data = Path(args.data)
    root = data / "synth"
    root.mkdir(exist_ok=True)
    if not args.skip_fetch:
        rows = fetch_bases(root, args.bases)
        print(f"바탕 사진 {len(rows)}장")
    bank = patch_bank(data / "defects")
    print("결함 조각", {NAMES[c]: len(v) for c, v in bank.items()})
    made = synthesize(root, bank, args.n)
    negatives(root)
    preview(root, made)
    print(f"합성 {len(made)}장 → {root}")


if __name__ == "__main__":
    main()

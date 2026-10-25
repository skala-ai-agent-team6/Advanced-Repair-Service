"""공통 결함 4종(rust, dent, crack, scratch) YOLO 탐지 데이터셋을 합친다.

원본 (모두 appliance_data/raw 아래, git 밖):
- car_damage  DrBimmer/car-parts-and-damage-dataset (MIT). HF 폴더 이름이 뒤바뀌어 'Car parts dataset'에 손상 라벨이 있다
              Scratch→scratch, Dent→dent, Cracked→crack, Corrosion→rust (Paint chip·Flaking 등은 버림)
- msdd        rltjr/metal-surface-defect-v1 (CC BY 4.0). Scratch→scratch, Oxidation→rust. 폴리곤 → 박스
- corrosion   LibreYOLO/corrosion-bi3q3 (RF100, CC BY 4.0). corrosion→rust, crack→crack
사용: python training/build_defect_dataset.py <appliance_data>
결과: <appliance_data>/defects/{images,labels}/{train,val,test}, data.yaml, stats.json
"""
import json
import random
import shutil
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

NAMES = ["rust", "dent", "crack", "scratch"]
CAR = {"Corrosion": 0, "Dent": 1, "Cracked": 2, "Scratch": 3}
MSDD = {2: 0, 4: 3}  # Oxidation, Scratch
root = Path(sys.argv[1])
raw, out = root / "raw", root / "defects"
shutil.rmtree(out, ignore_errors=True)
stats = Counter()


def put(split, src, name, lines):
    (out / "images" / split).mkdir(parents=True, exist_ok=True)
    (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    img = Image.open(src).convert("RGB")
    img.thumbnail((1024, 1024))  # 큰 원본은 줄여 저장 (좌표는 비율이라 그대로)
    img.save(out / "images" / split / f"{name}.jpg", quality=92)
    (out / "labels" / split / f"{name}.txt").write_text("\n".join(lines))
    stats[f"{split}_images"] += 1
    for l in lines:
        stats[f"{split}_{NAMES[int(l.split()[0])]}"] += 1


def box(points, w, h):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x1, x2, y1, y2 = max(min(xs), 0), min(max(xs), w), max(min(ys), 0), min(max(ys), h)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return f"{(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}"


# 1. 차량 손상
car = raw / "car_damage/Car parts dataset/File1"
anns = sorted((car / "ann").glob("*.json"))
random.Random(0).shuffle(anns)
for i, a in enumerate(anns):
    split = "test" if i % 10 == 0 else "val" if i % 10 == 1 else "train"
    d = json.loads(a.read_text())
    w, h = d["size"]["width"], d["size"]["height"]
    lines = []
    for o in d["objects"]:
        if o["classTitle"] in CAR and o["geometryType"] in ("polygon", "rectangle"):
            b = box(o["points"]["exterior"], w, h)
            if b:
                lines.append(f"{CAR[o['classTitle']]} {b}")
    src = car / "img" / a.name[:-5]
    if lines and src.exists():
        put(split, src, f"car_{i:04d}", lines)

# 2. MSDD 금속 (정상 이미지도 일부 넣어 배경 학습)
for split in ("train", "val", "test"):
    for lab in sorted((raw / "msdd/labels" / split).glob("*.txt")):
        lines = []
        for row in lab.read_text().split("\n"):
            v = row.split()
            if len(v) >= 7 and int(v[0]) in MSDD:
                pts = [(float(v[k]), float(v[k + 1])) for k in range(1, len(v) - 1, 2)]
                b = box([(x * 1000, y * 1000) for x, y in pts], 1000, 1000)  # 0~1 좌표라 1000배로 같은 함수 사용
                if b:
                    lines.append(f"{MSDD[int(v[0])]} {b}")
        src = raw / "msdd/images" / split / f"{lab.stem}.jpg"
        if src.exists() and (lines or hash(lab.stem) % 4 == 0):
            put(split, src, f"msdd_{lab.stem[:60]}", lines)

# 3. 부식·균열 (있을 때만)
cor = raw / "corrosion"
if (cor / "data.yaml").exists():
    import yaml
    names = yaml.safe_load((cor / "data.yaml").read_text())["names"]
    names = names if isinstance(names, list) else [names[k] for k in sorted(names)]
    mapping = {i: {"corrosion": 0, "crack": 2}[n.lower()] for i, n in enumerate(names) if n.lower() in ("corrosion", "crack")}
    for split, sub in (("train", "train"), ("val", "valid"), ("test", "test")):
        folder = cor / sub
        if not folder.exists():
            folder = cor / ("validation" if sub == "valid" else sub)
        for lab in sorted((folder / "labels").glob("*.txt")):
            lines = []
            for row in lab.read_text().split("\n"):
                v = row.split()
                if len(v) == 5 and int(v[0]) in mapping:
                    lines.append(f"{mapping[int(v[0])]} {' '.join(v[1:])}")
            src = next((folder / "images").glob(f"{lab.stem}.*"), None)
            if lines and src:
                put(split, src, f"cor_{lab.stem[:60]}", lines)

(out / "data.yaml").write_text(f"path: {out}\ntrain: images/train\nval: images/val\ntest: images/test\nnames: {NAMES}\n")
(out / "stats.json").write_text(json.dumps(dict(sorted(stats.items())), indent=1))
print(json.dumps(dict(sorted(stats.items())), indent=1))

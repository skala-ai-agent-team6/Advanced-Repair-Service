"""가전 부품 사진 수집: Wikimedia Commons + Openverse에서 공개 라이선스 사진만 내려받는다.

검색어가 곧 약한 라벨(query_label)이다. 진짜 라벨은 label_parts.py(GPT 교사)와 사람 확인으로 정한다.
사용: python training/collect_parts.py <데이터 폴더> [--per-query 40]
결과: <데이터 폴더>/parts/images/<item>/*.jpg, <데이터 폴더>/parts/sources.csv
"""
import argparse
import csv
import hashlib
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

UA = {"User-Agent": "skala-appliance-mcp-dataset/0.1 (education project)"}
OK_LICENSES = ("cc0", "pdm", "public domain", "cc by", "cc-by", "by", "by-sa", "cc by-sa", "by-nc", "by-nc-sa", "by-nd")

# item → [(검색어, 약한 라벨)]
QUERIES = {
    "ac_filter": [("dirty air conditioner filter", "heavily_dirty"), ("dusty air filter", "mildly_dirty"),
                  ("clean air conditioner filter", "clean"), ("new air filter", "clean"),
                  ("dirty AC filters", "heavily_dirty"), ("air filter dust", "mildly_dirty")],
    "ac_drain_hose": [("air conditioner drain hose", "ok"), ("condensate drain pipe", "ok"),
                      ("kinked hose", "kinked_or_blocked"), ("clogged drain pipe", "kinked_or_blocked")],
    "rv_motor": [("small dc motor", "normal"), ("electric motor armature", "normal"),
                 ("burnt motor", "burn_marks"), ("burnt electric motor winding", "burn_marks"),
                 ("burned motor coil", "burn_marks")],
    "rv_wheel": [("robot vacuum wheel", "ok"), ("robotic vacuum cleaner underside", "ok"),
                 ("worn rubber wheel", "worn"), ("worn tire tread", "worn"),
                 ("broken plastic wheel", "broken"), ("broken wheel", "broken")],
    "wm_inlet_hose": [("washing machine inlet hose", "ok"), ("water supply hose", "ok"),
                      ("cracked rubber hose", "damaged"), ("leaking hose", "damaged"), ("burst hose", "damaged")],
    "wm_drain_filter": [("washing machine drain pump filter", "clean"), ("washing machine filter", "clean"),
                        ("lint clogged filter", "clogged"), ("clogged filter", "clogged")],
    "wm_door_gasket": [("washing machine door seal", "ok"), ("front loader door gasket", "ok"),
                       ("washing machine mold", "mold_or_torn"), ("mold rubber seal", "mold_or_torn"),
                       ("torn rubber seal", "mold_or_torn")],
}


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
                return r.read()
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def commons(query, n):
    q = urllib.parse.quote(f"{query} filetype:bitmap")
    url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6"
           f"&gsrlimit={n}&gsrsearch={q}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=512")
    data = get(url)
    if not data:
        return []
    out = []
    for page in json.loads(data).get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if info.get("thumburl"):
            out.append({"url": info["thumburl"], "page": info.get("descriptionurl", ""), "license": lic,
                        "title": page.get("title", "")[5:], "source": "commons"})
    return out


def openverse(query, n):
    data = get(f"https://api.openverse.org/v1/images/?q={urllib.parse.quote(query)}&page_size={min(n, 20)}")
    if not data:
        return []
    return [{"url": r.get("thumbnail") or r["url"], "page": r.get("foreign_landing_url", ""),
             "license": f"{r.get('license', '')} {r.get('license_version', '')}".strip(),
             "title": r.get("title", ""), "source": "openverse"} for r in json.loads(data).get("results", [])]


def licensed(lic):
    l = lic.lower()
    return any(k in l for k in OK_LICENSES)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--per-query", type=int, default=40)
    args = ap.parse_args()
    root = Path(args.root) / "parts"
    csv_path = root / "sources.csv"
    done_path = root / "done_queries.txt"
    root.mkdir(parents=True, exist_ok=True)
    done = set(done_path.read_text().split("\n")) if done_path.exists() else set()
    seen, rows = set(), []
    if csv_path.exists():
        rows = list(csv.DictReader(csv_path.open()))
        seen = {r["sha1"] for r in rows}
    for item, queries in QUERIES.items():
        folder = root / "images" / item
        folder.mkdir(parents=True, exist_ok=True)
        for query, label in queries:
            key = f"{item}|{query}"
            if key in done:
                continue
            hits = [h for h in commons(query, args.per_query) + openverse(query, args.per_query) if licensed(h["license"])]
            with ThreadPoolExecutor(8) as pool:
                blobs = list(pool.map(lambda h: get(h["url"], tries=2), hits))
            got = 0
            for h, raw in zip(hits, blobs):
                if not raw:
                    continue
                sha = hashlib.sha1(raw).hexdigest()
                if sha in seen:
                    continue
                try:
                    img = Image.open(io.BytesIO(raw)).convert("RGB")
                except Exception:
                    continue
                if min(img.size) < 96:
                    continue
                img.thumbnail((512, 512))
                path = folder / f"{sha[:16]}.jpg"
                img.save(path, quality=90)
                seen.add(sha)
                got += 1
                rows.append({"item": item, "file": str(path.relative_to(root)), "sha1": sha, "query": query,
                             "query_label": label, "source": h["source"], "license": h["license"],
                             "page": h["page"], "title": h["title"][:120]})
            print(f"{item:16} {query:40} {got}", flush=True)
            with csv_path.open("w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["item"])
                w.writeheader()
                w.writerows(rows)
            with done_path.open("a") as f:
                f.write(key + "\n")
            done.add(key)
    print("total", len(rows))


if __name__ == "__main__":
    main()

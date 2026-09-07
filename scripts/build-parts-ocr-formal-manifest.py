#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: build-parts-ocr-formal-manifest.py PHOTO_DIR OUT.json")

root = Path(sys.argv[1])
out = Path(sys.argv[2])

def find(prefix: str):
    matches = sorted(p for p in root.iterdir() if p.is_file() and p.name.startswith(prefix))
    if not matches:
        raise FileNotFoundError(f"missing fixed photo for {prefix}")
    return str(matches[0].resolve())

items = []
for n in range(675, 687):
    stem = f"IMG_{n:04d}"
    items.append({
        "filename": f"{stem}(1).jpeg",
        "path": find(stem),
        "set": "formal-yellow",
        "expectedMode": "dedicated",
        "autoTimeoutMs": 300000,
        "ocrTimeoutMs": 600000,
        "dynamicTimeoutMs": 600000,
    })

white_expected = [
    {"name":"ポンプ キット, ウォーター","qty":"1","retail":"11100","cost":""},
    {"name":"プーリー, ファン&ウォーター ポンプ","qty":"1","retail":"3270","cost":""},
    {"name":"プーリー, アイドラー","qty":"1","retail":"5050","cost":""},
    {"name":"ショックアブソーバー キット, リア","qty":"2","retail":"9630","cost":""},
    {"name":"ブッシュ, リア ショックアブソーバー","qty":"4","retail":"850","cost":""},
]
for n in (699, 700, 701):
    stem = f"IMG_{n:04d}"
    items.append({
        "filename": f"{stem}(3).jpeg",
        "path": find(stem),
        "set": "formal-white",
        "expectedMode": "general",
        "expectedRows": white_expected,
        "expectedRetail": [r["retail"] for r in white_expected],
        "autoTimeoutMs": 300000,
        "ocrTimeoutMs": 600000,
    })

ref_expected = [
    {"name":"ガスケット, ロッカー カバー","qty":"1","retail":"1210","cost":""},
    {"name":"スパークプラグ","qty":"4","retail":"2700","cost":""},
    {"name":"ガスケット, インテーク マニホールド","qty":"1","retail":"410","cost":""},
    {"name":"ショックアブソーバー キット, リア","qty":"2","retail":"9630","cost":""},
    {"name":"ブッシュ, リア ショックアブソーバー","qty":"4","retail":"850","cost":""},
]
for n in (622, 623):
    stem = f"IMG_{n:04d}"
    try:
        p = find(stem)
    except FileNotFoundError:
        continue
    items.append({
        "filename": f"{stem}(4).jpeg",
        "path": p,
        "set": "reference-white",
        "expectedMode": "general",
        "expectedRows": ref_expected,
        "expectedRetail": [r["retail"] for r in ref_expected],
        "autoTimeoutMs": 300000,
        "ocrTimeoutMs": 600000,
    })

out.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {len(items)} entries to {out}")

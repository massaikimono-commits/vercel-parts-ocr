#!/usr/bin/env python3
import json
import math
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

MODELS = {
    "ONNX_JA_LIGHT": {
        "model": "https://huggingface.co/tobiichioriguchi/japan_PP-OCRv3_mobile_rec_onnx/resolve/main/inference.onnx?download=true",
        "dict": "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/japan_dict.txt",
    },
    "ONNX_V5": {
        "model": "https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ch_PP-OCRv5_rec_mobile_infer.onnx?download=true",
        "dict": "https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ppocrv5_dict.txt?download=true",
    },
}

CACHE = Path(".stage-a21-cache")
CACHE.mkdir(exist_ok=True)


def fetch(url: str, path: Path):
    if path.exists() and path.stat().st_size:
        return
    req = urllib.request.Request(url, headers={"User-Agent": "icb-stage-a21-audit/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r, path.open("wb") as f:
        f.write(r.read())


def read_dict(path: Path):
    # Match A20 JS exactly: CR removal, split lines, filter(Boolean).
    text = path.read_text(encoding="utf-8").replace("\r", "")
    return [x for x in text.split("\n") if x]


def preprocess(img: Image.Image):
    img = img.convert("RGB")
    h = 48
    ratio = img.width / max(1, img.height)
    rw = max(8, min(320, math.ceil(h * ratio)))
    canvas = Image.new("RGB", (320, 48), "white")
    resized = img.resize((rw, h), Image.Resampling.BILINEAR)
    canvas.paste(resized, (0, 0))
    x = np.asarray(canvas, dtype=np.float32) / 255.0
    x = (x - 0.5) / 0.5
    x = np.transpose(x, (2, 0, 1))[None, ...]
    return x.astype(np.float32)


def synthetic(label: str):
    img = Image.new("RGB", (420, 84), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 48)
    except Exception:
        font = ImageFont.load_default()
    draw.text((12, 12), label, fill="black", font=font)
    return img


def decode_like_a20(data: np.ndarray, dictionary):
    # A20 assumes classes are the last output dimension, blank index 0,
    # dict indices 1..N, and optional space at N+1.
    shape = list(data.shape)
    classes = shape[-1]
    flat = data.astype(np.float32, copy=False).reshape(-1)
    steps = flat.size // classes
    prev = -1
    chars = []
    indexes = []
    for t in range(steps):
        row = flat[t * classes:(t + 1) * classes]
        best = int(np.argmax(row))
        if best != 0 and best != prev:
            if 1 <= best <= len(dictionary):
                ch = dictionary[best - 1]
            elif best == len(dictionary) + 1:
                ch = " "
            else:
                ch = ""
            if ch:
                chars.append(ch)
                indexes.append(best)
        prev = best
    return "".join(chars), indexes


def infer_contract(shape, dict_len):
    dims = [int(x) for x in shape]
    last = dims[-1]
    expected_no_space = dict_len + 1
    expected_with_space = dict_len + 2
    compatible = last in (expected_no_space, expected_with_space)
    candidate_axes = [i for i, d in enumerate(dims) if d in (expected_no_space, expected_with_space)]
    return {
        "outputDims": dims,
        "classCountLastAxis": last,
        "dictionaryLength": dict_len,
        "expectedNoSpaceClassCount": expected_no_space,
        "expectedUseSpaceClassCount": expected_with_space,
        "lastAxisCompatible": compatible,
        "candidateClassAxes": candidate_axes,
        "blankIndex": 0,
        "dictionaryIndexOffset": 1,
        "spaceIndexIfPresent": dict_len + 1,
        "inferredUseSpaceChar": last == expected_with_space,
        "offByOneEvidence": not compatible,
    }


def inspect_one(key, cfg):
    model_path = CACHE / f"{key}.onnx"
    dict_path = CACHE / f"{key}.txt"
    fetch(cfg["model"], model_path)
    fetch(cfg["dict"], dict_path)
    dictionary = read_dict(dict_path)
    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    out = sess.get_outputs()[0]

    samples = {}
    for label in ["", "12345", "ABC123"]:
        img = Image.new("RGB", (420, 84), "white") if label == "" else synthetic(label)
        y = sess.run([out.name], {inp.name: preprocess(img)})[0]
        contract = infer_contract(y.shape, len(dictionary))
        raw, indices = decode_like_a20(y, dictionary)
        samples[label or "WHITE"] = {
            "outputDims": [int(x) for x in y.shape],
            "finite": bool(np.isfinite(y).all()),
            "raw": raw,
            "rawLength": len(raw),
            "emittedIndexes": indices[:40],
        }

    result = {
        "model": key,
        "inputName": inp.name,
        "inputShape": [str(x) for x in inp.shape],
        "outputName": out.name,
        "declaredOutputShape": [str(x) for x in out.shape],
        "modelBytes": model_path.stat().st_size,
        "dictBytes": dict_path.stat().st_size,
        "dictLength": len(dictionary),
        "dictFirst": dictionary[:5],
        "dictLast": dictionary[-5:],
        "contract": infer_contract(sess.run([out.name], {inp.name: preprocess(synthetic("12345"))})[0].shape, len(dictionary)),
        "samples": samples,
    }
    return result


def main():
    results = {k: inspect_one(k, v) for k, v in MODELS.items()}
    failures = []
    for key, item in results.items():
        c = item["contract"]
        if not c["lastAxisCompatible"]:
            failures.append(f"{key}: output class count vs dictionary mismatch")
        for sample, s in item["samples"].items():
            if not s["finite"]:
                failures.append(f"{key}: non-finite output for {sample}")
    report = {
        "schema": "icb.parts-ocr.stage-a21-model-contract.v1",
        "a20DecoderAssumption": {
            "classAxis": "last",
            "blankIndex": 0,
            "dictionaryIndexOffset": 1,
            "optionalSpaceIndex": "dictLength+1",
        },
        "models": results,
        "pass": not failures,
        "failures": failures,
    }
    Path("stage-a21-model-contract.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        sys.exit(2)


if __name__ == "__main__":
    main()

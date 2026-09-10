/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

const ORT_VERSION = "1.22.0";
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const ORT_SCRIPT = `${ORT_DIST}ort.min.js`;

const MODELS = {
  ONNX_JA_LIGHT: {
    modelUrl: "https://huggingface.co/tobiichioriguchi/japan_PP-OCRv3_mobile_rec_onnx/resolve/main/inference.onnx?download=true",
    dictUrl: "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/japan_dict.txt",
  },
  ONNX_V5: {
    modelUrl: "https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ch_PP-OCRv5_rec_mobile_infer.onnx?download=true",
    dictUrl: "https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ppocrv5_dict.txt?download=true",
  },
} as const;

type ModelKey = keyof typeof MODELS;
let ortPromise: Promise<any> | null = null;
function getOrt() {
  if ((window as any).ort) {
    const ort = (window as any).ort;
    ort.env.wasm.wasmPaths = ORT_DIST;
    ort.env.wasm.numThreads = 1;
    return Promise.resolve(ort);
  }
  if (ortPromise) return ortPromise;
  ortPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ORT_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const ort = (window as any).ort;
      if (!ort) return reject(new Error("ONNX Runtime global missing"));
      ort.env.wasm.wasmPaths = ORT_DIST;
      ort.env.wasm.numThreads = 1;
      resolve(ort);
    };
    script.onerror = () => reject(new Error("ONNX Runtime script load failed"));
    document.head.appendChild(script);
  });
  return ortPromise;
}

function tensorFromCanvas(ort: any, src: HTMLCanvasElement) {
  const H = 48, W = 320;
  const ratio = src.width / Math.max(1, src.height);
  const resizedW = Math.max(8, Math.min(W, Math.ceil(H * ratio)));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("preprocess canvas unavailable");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, resizedW, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const out = new Float32Array(3 * H * W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, p = y * W + x;
    out[p] = (px[i] / 255 - .5) / .5;
    out[H * W + p] = (px[i + 1] / 255 - .5) / .5;
    out[2 * H * W + p] = (px[i + 2] / 255 - .5) / .5;
  }
  return new ort.Tensor("float32", out, [1, 3, H, W]);
}

function syntheticCanvas(text: string) {
  const c = document.createElement("canvas");
  c.width = 420; c.height = 84;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.font = "48px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.textBaseline = "middle";
  if (text) ctx.fillText(text, 12, 42);
  return c;
}

function decodeLikeA20(data: Float32Array, dims: readonly number[], dict: string[]) {
  const classes = dims[dims.length - 1];
  const steps = Math.floor(data.length / classes);
  let prev = -1, text = "";
  const emittedIndexes: number[] = [];
  for (let t = 0; t < steps; t++) {
    const off = t * classes;
    let best = 0, bv = -Infinity;
    for (let c = 0; c < classes; c++) if (data[off + c] > bv) { bv = data[off + c]; best = c; }
    if (best !== 0 && best !== prev) {
      const ch = dict[best - 1] ?? (best === dict.length + 1 ? " " : "");
      if (ch) { text += ch; emittedIndexes.push(best); }
    }
    prev = best;
  }
  return { text, emittedIndexes };
}

function contract(dims: readonly number[], dictLength: number) {
  const last = dims[dims.length - 1];
  const noSpace = dictLength + 1;
  const withSpace = dictLength + 2;
  const candidateClassAxes = dims.map((d, i) => ({ d, i })).filter((x) => x.d === noSpace || x.d === withSpace).map((x) => x.i);
  return {
    outputDims: [...dims],
    dictionaryLength: dictLength,
    classCount: last,
    expectedNoSpaceClassCount: noSpace,
    expectedUseSpaceClassCount: withSpace,
    candidateClassAxes,
    classAxisIsLast: candidateClassAxes.includes(dims.length - 1),
    blankIndex: 0,
    dictionaryIndexOffset: 1,
    spaceIndexIfPresent: dictLength + 1,
    inferredUseSpaceChar: last === withSpace,
    compatibleWithA20Decoder: last === noSpace || last === withSpace,
  };
}

async function inspect(key: ModelKey) {
  const cfg = MODELS[key];
  const ort = await getOrt();
  const [modelRes, dictRes] = await Promise.all([fetch(cfg.modelUrl, { cache: "force-cache" }), fetch(cfg.dictUrl, { cache: "force-cache" })]);
  if (!modelRes.ok || !dictRes.ok) throw new Error(`${key} asset load failed ${modelRes.status}/${dictRes.status}`);
  const [modelBytes, dictText] = await Promise.all([modelRes.arrayBuffer(), dictRes.text()]);
  const dict = dictText.replace(/\r/g, "").split("\n").filter(Boolean);
  const loadStart = performance.now();
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const loadMs = Math.round(performance.now() - loadStart);
  const samples: Record<string, any> = {};
  for (const label of ["WHITE", "12345", "ABC123", "テスト"]) {
    const canvas = syntheticCanvas(label === "WHITE" ? "" : label);
    const tensor = tensorFromCanvas(ort, canvas);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const st = performance.now();
    const outputs = await session.run({ [inputName]: tensor });
    const out = outputs[outputName] || outputs[Object.keys(outputs)[0]];
    const decoded = decodeLikeA20(out.data as Float32Array, out.dims as number[], dict);
    samples[label] = {
      outputDims: [...out.dims],
      inferenceMs: Math.round(performance.now() - st),
      raw: decoded.text,
      emittedIndexes: decoded.emittedIndexes.slice(0, 40),
      finite: Array.from((out.data as Float32Array).slice(0, Math.min(256, out.data.length))).every(Number.isFinite),
    };
  }
  const sampleDims = samples["12345"].outputDims as number[];
  return {
    key,
    runtime: `onnxruntime-web ${ORT_VERSION} / WASM / numThreads=1`,
    modelBytes: modelBytes.byteLength,
    dictBytes: new TextEncoder().encode(dictText).byteLength,
    loadMs,
    inputName: session.inputNames[0],
    outputName: session.outputNames[0],
    contract: contract(sampleDims, dict.length),
    dictFirst: dict.slice(0, 5),
    dictLast: dict.slice(-5),
    samples,
  };
}

export async function runBrowserModelDiagnostics() {
  const started = performance.now();
  const results: Record<string, any> = {};
  for (const key of Object.keys(MODELS) as ModelKey[]) {
    try { results[key] = await inspect(key); }
    catch (e: any) { results[key] = { key, error: String(e?.message || e) }; }
  }
  return {
    schema: "icb.parts-ocr.stage-a21-browser-model-diagnostic.v1",
    diagnosticOnly: true,
    recognitionParametersChanged: false,
    models: results,
    totalMs: Math.round(performance.now() - started),
  };
}

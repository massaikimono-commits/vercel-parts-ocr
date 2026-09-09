/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

export type FieldKey = "name" | "qty" | "retail" | "cost";
export type RecognitionResult = { raw:string; confidence:number|null; normalized:string; latencyMs:number };
export type ModelStats = {
  key:"ONNX_JA_LIGHT"|"ONNX_V5";
  modelUrl:string;
  dictUrl:string;
  declaredModelMb:number;
  downloadedBytes:number;
  firstLoadMs:number;
  warmReuseLoadMs:number;
  available:boolean;
  error:string;
  inputName:string;
  outputName:string;
};

type SessionBundle = { session:any; dict:string[]; stats:ModelStats; modelBytes:ArrayBuffer };

const MODELS = {
  ONNX_JA_LIGHT: {
    modelUrl:"https://huggingface.co/tobiichioriguchi/japan_PP-OCRv3_mobile_rec_onnx/resolve/main/inference.onnx?download=true",
    dictUrl:"https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/japan_dict.txt",
    declaredModelMb:9.8,
  },
  ONNX_V5: {
    modelUrl:"https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ch_PP-OCRv5_rec_mobile_infer.onnx?download=true",
    dictUrl:"https://huggingface.co/ogkalu/ppocr-v5-onnx/resolve/main/ppocrv5_dict.txt?download=true",
    declaredModelMb:16.6,
  },
} as const;

const cache:Partial<Record<keyof typeof MODELS,Promise<SessionBundle>>> = {};
let ortPromise:Promise<any>|null=null;
function getOrt(){
  if(!ortPromise)ortPromise=import("onnxruntime-web");
  return ortPromise;
}

function normalizeFinal(raw:string,key:FieldKey){
  const t=raw.normalize("NFKC").replace(/\r/g,"").replace(/\s+/g," ").trim();
  if(key==="name") return t.replace(/^[\s|:;.,・]+|[\s|:;.,・]+$/g,"").trim();
  const m=t.replace(/[|Il!]/g,"1").replace(/[Oo]/g,"0").match(/\d{1,3}(?:[,\.\s]\d{3})+|\d{1,7}/g);
  if(!m?.length)return"";
  return m.map(x=>x.replace(/\D/g,"")).find(Boolean)||"";
}

function softmaxConfidence(row:Float32Array|number[],best:number){
  let max=-Infinity; for(let i=0;i<row.length;i++)if(row[i]>max)max=row[i];
  let sum=0; for(let i=0;i<row.length;i++)sum+=Math.exp(row[i]-max);
  return sum?Math.exp(row[best]-max)/sum:0;
}

function decodeCtc(data:Float32Array,dims:number[],dict:string[]){
  const classes=dims[dims.length-1];
  const steps=Math.floor(data.length/classes);
  let prev=-1,text=""; const confs:number[]=[];
  for(let t=0;t<steps;t++){
    const off=t*classes; let best=0,bv=-Infinity;
    for(let c=0;c<classes;c++){const v=data[off+c];if(v>bv){bv=v;best=c;}}
    if(best!==0 && best!==prev){
      const ch=dict[best-1] ?? (best===dict.length+1?" ":"");
      if(ch){text+=ch; const row=data.subarray(off,off+classes); confs.push(softmaxConfidence(row,best));}
    }
    prev=best;
  }
  return {text,confidence:confs.length?confs.reduce((a,b)=>a+b,0)/confs.length:0};
}

function tensorFromCanvas(ort:any,src:HTMLCanvasElement){
  const H=48;
  const ratio=src.width/Math.max(1,src.height);
  const resizedW=Math.max(8,Math.min(320,Math.ceil(H*ratio)));
  const W=320;
  const c=document.createElement("canvas"); c.width=W;c.height=H;
  const ctx=c.getContext("2d",{willReadFrequently:true}); if(!ctx)throw new Error("ONNX preprocess canvas unavailable");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(src,0,0,src.width,src.height,0,0,resizedW,H);
  const px=ctx.getImageData(0,0,W,H).data;
  const out=new Float32Array(3*H*W);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=(y*W+x)*4,p=y*W+x;
    out[p]=(px[i]/255-.5)/.5;
    out[H*W+p]=(px[i+1]/255-.5)/.5;
    out[2*H*W+p]=(px[i+2]/255-.5)/.5;
  }
  return new ort.Tensor("float32",out,[1,3,H,W]);
}

async function loadModel(key:keyof typeof MODELS):Promise<SessionBundle>{
  if(cache[key])return cache[key]!;
  cache[key]=(async()=>{
    const cfg=MODELS[key]; const start=performance.now();
    const stats:ModelStats={key,modelUrl:cfg.modelUrl,dictUrl:cfg.dictUrl,declaredModelMb:cfg.declaredModelMb,downloadedBytes:0,firstLoadMs:0,warmReuseLoadMs:0,available:false,error:"",inputName:"",outputName:""};
    try{
      const ort:any=await getOrt();
      ort.env.wasm.numThreads=1;
      const [modelRes,dictRes]=await Promise.all([fetch(cfg.modelUrl,{cache:"force-cache"}),fetch(cfg.dictUrl,{cache:"force-cache"})]);
      if(!modelRes.ok)throw new Error(`model HTTP ${modelRes.status}`); if(!dictRes.ok)throw new Error(`dict HTTP ${dictRes.status}`);
      const [modelBytes,dictText]=await Promise.all([modelRes.arrayBuffer(),dictRes.text()]);
      stats.downloadedBytes=modelBytes.byteLength;
      const session=await ort.InferenceSession.create(modelBytes,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
      const dict=dictText.replace(/\r/g,"").split("\n").filter(Boolean);
      stats.firstLoadMs=Math.round(performance.now()-start); stats.available=true;stats.inputName=session.inputNames[0]||"x";stats.outputName=session.outputNames[0]||"softmax_0.tmp_0";
      const reuseStart=performance.now(); void session.inputNames; stats.warmReuseLoadMs=Math.max(0,Math.round(performance.now()-reuseStart));
      return{session,dict,stats,modelBytes};
    }catch(e:any){stats.firstLoadMs=Math.round(performance.now()-start);stats.error=String(e?.message||e);throw Object.assign(new Error(stats.error),{modelStats:stats});}
  })();
  return cache[key]!;
}

export async function getModelStats(key:"ONNX_JA_LIGHT"|"ONNX_V5"){
  try{return (await loadModel(key)).stats;}catch(e:any){return e.modelStats as ModelStats;}
}

export async function recognizeOnnx(key:"ONNX_JA_LIGHT"|"ONNX_V5",canvas:HTMLCanvasElement,field:FieldKey):Promise<RecognitionResult>{
  const bundle=await loadModel(key); const ort:any=await getOrt();
  const tensor=tensorFromCanvas(ort,canvas); const st=performance.now();
  const outputs=await bundle.session.run({[bundle.stats.inputName]:tensor});
  const output=outputs[bundle.stats.outputName] || outputs[Object.keys(outputs)[0]];
  if(!output)throw new Error("ONNX recognition output missing");
  const decoded=decodeCtc(output.data as Float32Array,output.dims as number[],bundle.dict);
  return{raw:decoded.text,confidence:decoded.confidence,normalized:normalizeFinal(decoded.text,field),latencyMs:Math.round(performance.now()-st)};
}

export async function recognizeTess(worker:any,tesseract:any,blob:Blob,field:FieldKey):Promise<RecognitionResult>{
  const st=performance.now();
  if(field==="name") await worker.setParameters({tessedit_pageseg_mode:tesseract.PSM?.SINGLE_LINE??"7",preserve_interword_spaces:"1",tessedit_char_whitelist:"",user_defined_dpi:"300"});
  else await worker.setParameters({tessedit_pageseg_mode:field==="qty"?(tesseract.PSM?.SINGLE_CHAR??"10"):(tesseract.PSM?.SINGLE_WORD??"8"),preserve_interword_spaces:"1",tessedit_char_whitelist:"0123456789,.|Il!Oo",user_defined_dpi:"300"});
  const r=await worker.recognize(blob); const raw=String(r.data.text||"").trim(); const confidence=typeof r.data.confidence==="number"?r.data.confidence/100:null;
  return{raw,confidence,normalized:normalizeFinal(raw,field),latencyMs:Math.round(performance.now()-st)};
}

"""Memory-only local/private PP-StructureV3 endpoint for ICB bakeoff P2."""

from __future__ import annotations

import io
import os
import time
import uuid
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from core import FIELDS, p2_safety_reasons, rows_from_structure, structure_diagnostics

CONTRACT = "icb.parts-ocr.bakeoff-prediction.v1"
CONFIG_HASH = "sha256:8bb8a7c290a28de6851ffe74b058339ebd5dedbc75a63ab768b63eaf335bbdff"
MAX_BYTES = 16 * 1024 * 1024
_pipeline: Any = None
_model_load_ms: int | None = None


def pipeline() -> Any:
    global _pipeline, _model_load_ms
    if _pipeline is not None:
        return _pipeline
    started = time.perf_counter()
    from paddleocr import PPStructureV3

    _pipeline = PPStructureV3(
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        text_recognition_model_name="PP-OCRv5_server_rec",
    )
    _model_load_ms = round((time.perf_counter() - started) * 1000)
    return _pipeline


def result_json(result: Any) -> Any:
    value = getattr(result, "json", result)
    return value() if callable(value) else value


def create_app() -> Any:
    app = FastAPI(title="ICB Parts OCR P2 local bakeoff", docs_url=None, redoc_url=None)
    origins = [item.strip() for item in os.getenv("ICB_P2_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if item.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["content-type"])

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "candidateId": "P2", "persistentImageStorage": False, "allowedOrigins": origins, "modelLoaded": _pipeline is not None}

    @app.post("/v1/predict")
    async def predict(image: UploadFile = File(...), runId: str = Form(...), imageId: str = Form(...), captureId: str = Form(...)) -> dict[str, Any]:
        started = time.perf_counter()
        raw = await image.read(MAX_BYTES + 1)
        await image.close()
        if len(raw) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="image exceeds 16 MiB")
        if not raw:
            raise HTTPException(status_code=400, detail="empty image")
        try:
            import numpy as np
            from PIL import Image

            decoded = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
            del raw
            outputs = [result_json(item) for item in pipeline().predict(decoded)]
            rows = rows_from_structure(outputs)
            diagnostics = structure_diagnostics(outputs)
            safety_reasons = p2_safety_reasons(outputs, rows)
            field_predictions = [{"rowId": row["rowId"], "field": field, "prediction": row["fields"][field]} for row in rows for field in FIELDS]
            return {
                "schema": CONTRACT,
                "runId": runId or str(uuid.uuid4()),
                "candidateId": "P2",
                "candidateVersion": "ppstructurev3-ppocrv5-server.v2",
                "configHash": CONFIG_HASH,
                "imageId": imageId,
                "captureId": captureId,
                "documentFamilyPrediction": {"family": "document-table", "confidence": None},
                "documentRegions": [],
                "qualityMetrics": {"width": int(decoded.shape[1]), "height": int(decoded.shape[0]), "documentCoverage": None, "blurScore": None, "glareRatio": None, "angleDeg": None, "perspectiveDelta": None, "accepted": True, "rejectionReasons": []},
                "rowPredictions": rows,
                "fieldPredictions": field_predictions,
                "confidence": None,
                "abstainReason": ";".join(safety_reasons) if safety_reasons else None,
                "manualReviewRequired": bool(safety_reasons),
                "processingTimeMs": round((time.perf_counter() - started) * 1000),
                "modelLoadTimeMs": _model_load_ms,
                "memoryBytes": None,
                "timeout": False,
                "error": None,
                "gtIncluded": False,
                "diagnostic": diagnostics,
            }
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"P2 inference failed: {type(error).__name__}") from error

    return app


app = create_app()

import logging
from fastapi import APIRouter, UploadFile, File, Form, Query, Depends
from fastapi.responses import JSONResponse
from services.inference_service import analyze_batch_xrays

router = APIRouter(prefix="/batch-analyze", tags=["Batch Inference"])
logger = logging.getLogger(__name__)

@router.post("")
async def batch_analyze_xray(
    files: list[UploadFile] = File(...),
    patient_id: str | None = Form(None),
    ai_model: str = Form("gemini"),
    source: str = Form("batch"),
    model_version: str | None = Form(None),
):
    """Endpoint xử lý phân tích hàng loạt ảnh X-quang."""
    if not files:
        return JSONResponse(status_code=400, content={"error": "No files uploaded"})
        
    if len(files) > 50:
        return JSONResponse(status_code=400, content={"error": "Max 50 files allowed per batch"})

    # Đọc bytes từ các upload files
    prepared_files = []
    for file in files:
        file_bytes = await file.read()
        prepared_files.append((file_bytes, file.filename, file.content_type or "image/jpeg"))

    try:
        results = await analyze_batch_xrays(
            files=prepared_files,
            patient_id=patient_id,
            ai_model=ai_model,
            source=source,
            model_version=model_version
        )
        return JSONResponse(results)
    except Exception as e:
        logger.error(f"Error in batch analysis: {e}")
        return JSONResponse(status_code=500, content={"error": f"Batch analysis failed: {str(e)}"})

import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from utils import preprocess_xray
from gradcam import predict, generate_heatmap
from llm import explain_results
from storage import ensure_bucket, upload_image, s3, BUCKET
from database import save_scan, get_scan, list_scans
from fastapi.responses import Response

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_bucket()
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/analyze")
async def analyze_xray(
    file: UploadFile = File(...),
    patient_id: str | None = Form(None),
    ai_model: str = Form("gemini"),
):
    scan_id = str(uuid.uuid4())
    file_bytes = await file.read()

    # Bước 1: Preprocess
    img_tensor = preprocess_xray(file_bytes)

    # Bước 2: Predict bệnh
    scores = predict(img_tensor)
    is_normal = len(scores) == 0
    top_disease = max(scores, key=scores.get) if scores else None

    # Bước 3: Grad-CAM
    heatmap_bytes = generate_heatmap(img_tensor, top_disease) if top_disease else b""

    # Bước 4: Upload ảnh gốc + heatmap lên MinIO
    image_key  = f"originals/{scan_id}.jpg"
    heatmap_key = f"heatmaps/{scan_id}.png"
    upload_image(image_key, file_bytes, content_type=file.content_type or "image/jpeg")
    if heatmap_bytes:
        upload_image(heatmap_key, heatmap_bytes, content_type="image/png")

    # Bước 5: Ollama/Gemini giải thích
    explanation = (
        explain_results(scores, heatmap_bytes, top_disease, ai_model)
        if top_disease else "Không phát hiện dấu hiệu bất thường rõ ràng nào trên ảnh X-quang này."
    )

    # Bước 6: Lưu vào PostgreSQL
    await save_scan(
        scan_id=scan_id,
        image_key=image_key,
        heatmap_key=heatmap_key,
        scores=scores,
        top_disease=top_disease,
        is_normal=is_normal,
        explanation=explanation,
        patient_id=patient_id,
    )

    # Bước 7: Trả về
    return JSONResponse({
        "scan_id": scan_id,
        "scores": scores,
        "top_disease": top_disease,
        "is_normal": is_normal,
        "image_url":   f"http://localhost:8000/images/{image_key}",
        "heatmap_url": f"http://localhost:8000/images/{heatmap_key}" if heatmap_bytes else None,
        "explanation": explanation,
    })

@app.get("/images/{key:path}")
async def serve_image(key: str):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=key)
        image_data = response['Body'].read()
        return Response(content=image_data, media_type=response['ContentType'])
    except Exception as e:
        return JSONResponse(status_code=404, content={"error": "Image not found"})


@app.get("/scans/{scan_id}")
async def get_scan_detail(scan_id: str):
    scan = await get_scan(scan_id)
    if not scan:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    
    scan_data = {k: v for k, v in scan.items() if k not in ["created_at"]} # Handle datetimes
    scan_data["created_at"] = scan["created_at"].isoformat()
    scan_data["image_url"]   = f"http://localhost:8000/images/{scan['image_key']}"
    scan_data["heatmap_url"] = f"http://localhost:8000/images/{scan['heatmap_key']}" if scan["heatmap_key"] else None
    
    return JSONResponse(scan_data)


@app.get("/scans")
async def get_all_scans(limit: int = 20, offset: int = 0):
    scans = await list_scans(limit=limit, offset=offset)
    scans_data = []
    for s in scans:
        s_d = {k: v for k, v in s.items() if k not in ["created_at"]}
        s_d["created_at"] = s["created_at"].isoformat()
        scans_data.append(s_d)
    return JSONResponse({"scans": scans_data, "limit": limit, "offset": offset})

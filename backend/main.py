import uuid
import time
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from utils import preprocess_xray
from gradcam import predict, generate_heatmap
from llm import explain_results
from storage import ensure_bucket, upload_image, s3, BUCKET
from database import save_scan, get_scan, list_scans, get_pool
from kafka_producer import publish_scan_event, stop_producer
from kafka_consumer import start_consumer, stop_consumer
from websocket_manager import ws_manager
import analytics

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_consumer_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _consumer_task
    # Startup
    ensure_bucket()
    await ws_manager.start_heartbeat()

    # Start Kafka consumer in background
    _consumer_task = asyncio.create_task(
        start_consumer(ws_manager, get_pool)
    )
    logger.info("XRay Data Engineering Platform started")

    yield

    # Shutdown
    await stop_consumer()
    await stop_producer()
    await ws_manager.stop_heartbeat()
    if _consumer_task:
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass
    logger.info("Platform shut down")


app = FastAPI(
    title="XRay Data Engineering Platform",
    description="High-throughput X-ray analysis with Kafka, Spark, and real-time analytics",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Core: X-Ray Analysis ────────────────────────────────────────

@app.post("/analyze")
async def analyze_xray(
    file: UploadFile = File(...),
    patient_id: str | None = Form(None),
    ai_model: str = Form("gemini"),
    source: str = Form("web"),
):
    scan_id = str(uuid.uuid4())
    start_time = time.time()
    file_bytes = await file.read()

    # Publish scan.submitted event
    await publish_scan_event("scan.submitted", scan_id, {
        "patient_id": patient_id,
        "source": source,
        "ai_model": ai_model,
        "file_size": len(file_bytes),
    })

    # Publish scan.processing event
    await publish_scan_event("scan.processing", scan_id, {})

    # Bước 1: Preprocess
    img_tensor = preprocess_xray(file_bytes)

    # Bước 2: Predict bệnh
    scores = predict(img_tensor)
    is_normal = len(scores) == 0
    top_disease = max(scores, key=scores.get) if scores else None
    top_score = scores.get(top_disease, 0) if top_disease else 0
    
    if top_score <= 0.75:
        top_disease = None
        is_normal = True

    # Bước 3: Grad-CAM
    heatmap_bytes = generate_heatmap(img_tensor, top_disease, file_bytes) if top_disease else b""

    # Bước 4: Upload ảnh gốc + heatmap lên MinIO
    image_key = f"originals/{scan_id}.jpg"
    heatmap_key = f"heatmaps/{scan_id}.png"
    upload_image(image_key, file_bytes, content_type=file.content_type or "image/jpeg")
    if heatmap_bytes:
        upload_image(heatmap_key, heatmap_bytes, content_type="image/png")

    # Bước 5: AI giải thích
    explanation = (
        explain_results(scores, heatmap_bytes, top_disease, ai_model)
        if top_disease else "Không phát hiện dấu hiệu bất thường rõ ràng nào trên ảnh X-quang này."
    )

    # Calculate processing time
    processing_time_ms = int((time.time() - start_time) * 1000)

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
        processing_time_ms=processing_time_ms,
        source=source,
        ai_model_used=ai_model,
    )

    # Bước 7: Publish scan.completed event to Kafka
    await publish_scan_event("scan.completed", scan_id, {
        "top_disease": top_disease,
        "is_normal": is_normal,
        "processing_time_ms": processing_time_ms,
        "scores": scores,
        "source": source,
        "patient_id": patient_id,
    })

    # Bước 8: Trả về
    return JSONResponse({
        "scan_id": scan_id,
        "scores": scores,
        "top_disease": top_disease,
        "is_normal": is_normal,
        "image_url": f"http://localhost:8000/images/{image_key}",
        "heatmap_url": f"http://localhost:8000/images/{heatmap_key}" if heatmap_bytes else None,
        "explanation": explanation,
        "processing_time_ms": processing_time_ms,
    })


# ── Image Proxy ─────────────────────────────────────────────────

@app.get("/images/{key:path}")
async def serve_image(key: str):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=key)
        image_data = response['Body'].read()
        return Response(content=image_data, media_type=response['ContentType'])
    except Exception:
        return JSONResponse(status_code=404, content={"error": "Image not found"})


# ── Scan CRUD ───────────────────────────────────────────────────

@app.get("/scans/{scan_id}")
async def get_scan_detail(scan_id: str):
    scan = await get_scan(scan_id)
    if not scan:
        return JSONResponse(status_code=404, content={"error": "Not found"})

    scan_data = {k: v for k, v in scan.items() if k not in ["created_at"]}
    scan_data["created_at"] = scan["created_at"].isoformat()
    scan_data["image_url"] = f"http://localhost:8000/images/{scan['image_key']}"
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


# ── Analytics Endpoints ─────────────────────────────────────────

@app.get("/analytics/overview")
async def analytics_overview():
    """Tổng quan: total scans, disease distribution, avg processing time."""
    pool = await get_pool()
    overview = await analytics.get_overview(pool)
    diseases = await analytics.get_disease_distribution(pool)
    proc_stats = await analytics.get_processing_time_stats(pool)
    sources = await analytics.get_source_distribution(pool)

    # Serialize
    serialized_overview = {}
    for k, v in overview.items():
        if hasattr(v, '__float__'):
            serialized_overview[k] = float(v)
        else:
            serialized_overview[k] = v

    serialized_proc = {}
    for k, v in proc_stats.items():
        if hasattr(v, '__float__'):
            serialized_proc[k] = float(v)
        else:
            serialized_proc[k] = v

    return JSONResponse({
        "overview": serialized_overview,
        "diseases": diseases,
        "processing_stats": serialized_proc,
        "sources": sources,
    })


@app.get("/analytics/timeline")
async def analytics_timeline(
    period: str = Query(default="24h", regex="^(24h|7d|30d)$"),
    granularity: str = Query(default="hour", regex="^(hour|day)$"),
):
    """Time series scan volume data."""
    pool = await get_pool()
    data = await analytics.get_timeline(pool, period, granularity)
    return JSONResponse({"timeline": data, "period": period, "granularity": granularity})


@app.get("/analytics/diseases")
async def analytics_diseases():
    """Disease distribution details."""
    pool = await get_pool()
    diseases = await analytics.get_disease_distribution(pool)
    return JSONResponse({"diseases": diseases})


@app.get("/analytics/hourly")
async def analytics_hourly(hours: int = Query(default=24, le=168)):
    """Pre-aggregated hourly metrics."""
    pool = await get_pool()
    data = await analytics.get_hourly_analytics(pool, hours)
    return JSONResponse({"hourly": data, "hours": hours})


@app.get("/analytics/daily")
async def analytics_daily(days: int = Query(default=30, le=365)):
    """Pre-aggregated daily metrics."""
    pool = await get_pool()
    data = await analytics.get_daily_analytics(pool, days)
    return JSONResponse({"daily": data, "days": days})


@app.get("/analytics/recent")
async def analytics_recent(limit: int = Query(default=20, le=100)):
    """Recent scan events for live feed."""
    pool = await get_pool()
    events = await analytics.get_recent_events(pool, limit)
    return JSONResponse({"events": events})


@app.get("/analytics/spark-reports")
async def analytics_spark_reports(
    report_type: str | None = None,
    limit: int = Query(default=10, le=50),
):
    """Spark batch analysis reports."""
    pool = await get_pool()
    reports = await analytics.get_spark_reports(pool, report_type, limit)
    return JSONResponse({"reports": reports})


# ── System Health ───────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Service health status."""
    health = {
        "status": "healthy",
        "services": {}
    }

    # Check PostgreSQL
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        health["services"]["postgres"] = {"status": "up"}
    except Exception as e:
        health["services"]["postgres"] = {"status": "down", "error": str(e)}

    # Check MinIO
    try:
        s3.head_bucket(Bucket=BUCKET)
        health["services"]["minio"] = {"status": "up"}
    except Exception as e:
        health["services"]["minio"] = {"status": "down", "error": str(e)}

    # Check Kafka
    try:
        from kafka_producer import get_producer
        producer = await get_producer()
        health["services"]["kafka"] = {"status": "up" if producer else "down"}
    except Exception as e:
        health["services"]["kafka"] = {"status": "down", "error": str(e)}

    # Check Redis
    try:
        import redis as redis_lib
        import os
        r = redis_lib.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        r.ping()
        health["services"]["redis"] = {"status": "up"}
        r.close()
    except Exception as e:
        health["services"]["redis"] = {"status": "down", "error": str(e)}

    # WebSocket clients
    health["websocket_clients"] = len(ws_manager.active_connections)

    any_down = any(
        s.get("status") == "down"
        for s in health["services"].values()
    )
    if any_down:
        health["status"] = "degraded"

    return JSONResponse(health)


# ── WebSocket ───────────────────────────────────────────────────

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """Real-time dashboard WebSocket endpoint."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive by reading (client can send ping)
            data = await websocket.receive_text()
            # Echo back heartbeat
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

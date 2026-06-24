import uuid
import time
import asyncio
import logging
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from storage import ensure_bucket, s3, BUCKET
from database import save_scan, get_scan, list_scans, get_pool
from kafka_producer import publish_scan_event, stop_producer
from kafka_consumer import start_consumer, stop_consumer
from websocket_manager import ws_manager
import analytics

from services.inference_service import analyze_single_xray
from services import model_registry
from routers import batch, review, training

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


# ── Register New Routers ────────────────────────────────────────
app.include_router(batch.router)
app.include_router(review.router)
app.include_router(training.router)


# ── Model Versions Management Endpoints ────────────────────────
@app.get("/model-versions")
async def list_versions():
    """Lấy danh sách các model versions từ MLflow."""
    versions = model_registry.list_model_versions()
    return JSONResponse({"versions": versions})

@app.post("/model-versions/{version}/promote")
async def promote_version(version: str):
    """Promote một version model lên Production."""
    success = model_registry.promote_to_production(version)
    if not success:
        return JSONResponse(status_code=500, content={"error": "Failed to promote model version"})
    return JSONResponse({"status": "success", "message": f"Version {version} promoted to Production"})


# ── Core: X-Ray Analysis ────────────────────────────────────────

@app.post("/analyze")
async def analyze_xray(
    file: UploadFile = File(...),
    patient_id: str | None = Form(None),
    ai_model: str = Form("gemini"),
    source: str = Form("web"),
    model_version: str | None = Form(None),
    skip_llm: bool = Form(False),
):
    """Endpoint xử lý phân tích đơn lẻ ảnh X-quang."""
    file_bytes = await file.read()
    try:
        result = await analyze_single_xray(
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type or "image/jpeg",
            patient_id=patient_id,
            ai_model=ai_model,
            source=source,
            model_version=model_version,
            skip_llm=skip_llm,
        )
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"Error analyzing single X-Ray scan: {e}")
        return JSONResponse(status_code=500, content={"error": f"Analysis failed: {str(e)}"})



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


@app.get("/ai-models")
async def list_ai_models():
    """Trả về danh sách mô hình AI khả dụng bao gồm Gemini (cloud) và các mô hình Ollama ở local."""
    models = [
        {"id": "gemini", "name": "Gemini 2.5 Flash", "type": "cloud", "description": "Google Cloud (Khuyến nghị)"}
    ]
    try:
        from llm import OLLAMA_BASE_URL
        # Gọi API tags của Ollama để lấy các model có sẵn ở máy local
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        if response.status_code == 200:
            data = response.json()
            for m in data.get("models", []):
                name = m.get("name", "")
                # Thêm vào danh sách model local
                models.append({
                    "id": name,
                    "name": name.split(":")[0].capitalize(),
                    "type": "local",
                    "description": f"Ollama Local Model ({m.get('details', {}).get('parameter_size', 'N/A')})"
                })
    except Exception as e:
        logger.warning(f"Không thể kết nối tới Ollama tại http://host.docker.internal:11434: {e}")
        # Nếu lỗi (ví dụ Ollama không chạy), vẫn trả về LLaVA mặc định
        models.append({"id": "llava", "name": "LLaVA", "type": "local", "description": "Ollama Local (Offline)"})
    
    return JSONResponse({"models": models})


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

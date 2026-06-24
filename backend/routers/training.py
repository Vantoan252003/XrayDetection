import logging
import os
import time
from fastapi import APIRouter, BackgroundTasks, Query, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from database import get_pool
from services.training_service import (
    run_training_pipeline, training_status_state, register_new_model
)

router = APIRouter(prefix="/training", tags=["Model Training"])
logger = logging.getLogger(__name__)

class RegisterModelPayload(BaseModel):
    version: str

async def execute_background_training(version_name: str, base_model_version: str = None):
    try:
        await run_training_pipeline(version_name, base_model_version)
    except Exception as e:
        logger.error(f"Error executing background training pipeline: {e}")

@router.post("/trigger")
async def trigger_training(
    background_tasks: BackgroundTasks, 
    min_scans: int = Query(50, ge=1),
    base_model_version: str | None = Query(None)
):
    """Trigger tiến trình fine-tune model (chạy local hoặc Kaggle tùy cấu hình)."""
    pool = await get_pool()
    count = await pool.fetchval(
        """SELECT COUNT(*) FROM labeled_scans 
           WHERE added_to_training = FALSE AND review_status IN ('approved', 'auto_approved')"""
    )
    
    if count == 0:
        raise HTTPException(status_code=400, detail="Không có dữ liệu mới để huấn luyện")
        
    version_name = str(int(time.time()))
    background_tasks.add_task(execute_background_training, version_name, base_model_version)
    return {
        "status": "success", 
        "message": "Training pipeline triggered in background", 
        "ready_scans": count,
        "version": version_name
    }

@router.get("/status")
async def get_training_status():
    """Kiểm tra trạng thái của tiến trình huấn luyện."""
    return JSONResponse({
        "status": training_status_state["status"],
        "mode": training_status_state["mode"],
        "progress": training_status_state["progress"],
        "error_message": training_status_state["error_message"],
        "notebook_ref": training_status_state["notebook_ref"],
        "is_running": training_status_state["status"] == "running",
        "last_run_time": training_status_state["last_run_time"]
    })

@router.post("/register")
async def manual_register_model(payload: RegisterModelPayload):
    """Đăng ký thủ công một version model mới từ MinIO vào MLflow."""
    success = await register_new_model(payload.version)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to register model version")
    return {"status": "success", "message": f"Model version {payload.version} registered"}


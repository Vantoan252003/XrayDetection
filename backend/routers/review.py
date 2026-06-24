import logging
import uuid
import json
from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Query, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder

from database import (
    list_pending_scans, get_total_pending_scan_count, 
    list_reviewed_scans, get_total_reviewed_scan_count,
    update_scan_review_status, save_labeled_scan, get_pool
)
from services.label_service import save_to_training_set

router = APIRouter(prefix="/review", tags=["Doctor Review"])
logger = logging.getLogger(__name__)

class LabelReviewPayload(BaseModel):
    verified_labels: dict

class CorrectionReviewPayload(BaseModel):
    corrected_labels: dict

class RejectionPayload(BaseModel):
    reason: str | None = None

@router.get("/pending")
async def get_pending_scans(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Lấy danh sách các ca quét đang chờ bác sĩ review."""
    try:
        scans = await list_pending_scans(limit=limit, offset=offset)
        total = await get_total_pending_scan_count()
        
        base_url = str(request.base_url).rstrip('/')
        for s in scans:
            s["image_url"] = f"{base_url}/images/{s['image_key']}"
            s["heatmap_url"] = f"{base_url}/images/{s['heatmap_key']}" if s["heatmap_key"] else None
            # Convert datetime to string
            if s.get("created_at"):
                s["created_at"] = s["created_at"].isoformat()
            if s.get("review_deadline"):
                s["review_deadline"] = s["review_deadline"].isoformat()
                
        return JSONResponse(jsonable_encoder({
            "scans": scans,
            "total": total,
            "limit": limit,
            "offset": offset
        }))
    except Exception as e:
        logger.error(f"Error listing pending scans: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to list pending scans: {str(e)}"})

@router.post("/{scan_id}/approve")
async def approve_scan(scan_id: str, payload: LabelReviewPayload):
    """Bác sĩ phê duyệt kết quả chẩn đoán của model."""
    success = await save_to_training_set(
        scan_id=scan_id,
        verified_labels=payload.verified_labels,
        review_status="approved",
        reviewed_by="doctor"
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to approve scan and save to training set")
    return {"status": "success", "message": "Scan approved and saved to training set"}

@router.post("/{scan_id}/correct")
async def correct_scan(scan_id: str, payload: CorrectionReviewPayload):
    """Bác sĩ điều chỉnh lại nhãn của model và phê duyệt."""
    success = await save_to_training_set(
        scan_id=scan_id,
        verified_labels=payload.corrected_labels,
        review_status="approved",  # Vẫn coi là approved nhưng nhãn đã sửa đổi
        reviewed_by="doctor"
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to correct scan and save to training set")
    return {"status": "success", "message": "Scan corrections saved to training set"}

@router.post("/{scan_id}/reject")
async def reject_scan(scan_id: str, payload: RejectionPayload):
    """Bác sĩ bác bỏ ảnh quét (do mờ, lỗi hoặc sai lệch hoàn toàn)."""
    try:
        # Lấy pool để làm việc trực tiếp nếu cần thiết
        pool = await get_pool()
        scan_row = await pool.fetchrow("SELECT image_key FROM scans WHERE id = $1", uuid.UUID(scan_id))
        
        if not scan_row:
            raise HTTPException(status_code=404, detail="Scan not found")
            
        # Không copy ảnh sang training set, chỉ lưu vào hoặc cập nhật labeled_scans với trạng thái rejected
        existing_row = await pool.fetchrow("SELECT id FROM labeled_scans WHERE scan_id = $1", uuid.UUID(scan_id))
        if existing_row:
            await pool.execute(
                """UPDATE labeled_scans
                   SET verified_labels = '{}', review_status = 'rejected', reviewed_by = 'doctor', reviewed_at = NOW(), added_to_training = False
                   WHERE scan_id = $1""",
                uuid.UUID(scan_id)
            )
        else:
            await save_labeled_scan(
                scan_id=scan_id,
                image_key=scan_row["image_key"],
                verified_labels={},  # Rỗng vì bị loại bỏ
                review_status="rejected",
                reviewed_by="doctor",
                added_to_training=False
            )
        
        # Cập nhật scans review_status = 'done'
        await update_scan_review_status(scan_id, "done")
        return {"status": "success", "message": "Scan rejected"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rejecting scan {scan_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/timeout-check")
async def review_timeout_check():
    """Endpoint được trigger bởi Airflow hàng ngày để tự động duyệt các ca quá hạn."""
    try:
        pool = await get_pool()
        # Lấy danh sách các scans hết hạn
        expired_scans = await pool.fetch(
            """SELECT id, image_key, scores 
               FROM scans 
               WHERE review_status = 'pending' AND review_deadline < NOW()"""
        )
        
        count = 0
        for s in expired_scans:
            scan_id = str(s["id"])
            import json
            scores = s["scores"]
            if isinstance(scores, str):
                scores = json.loads(scores)
                
            # Tạo verified_labels tự động từ scores > 0.5
            verified_labels = {disease: (score > 0.5) for disease, score in scores.items()}
            
            success = await save_to_training_set(
                scan_id=scan_id,
                verified_labels=verified_labels,
                review_status="auto_approved",
                reviewed_by="system_timeout"
            )
            if success:
                count += 1
                
        return {"status": "success", "auto_approved_count": count}
    except Exception as e:
        logger.error(f"Error running timeout check: {e}")
        return JSONResponse(status_code=500, content={"error": f"Timeout check failed: {str(e)}"})

@router.get("/reviewed")
async def get_reviewed_scans(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Lấy danh sách các ca quét đã được bác sĩ review (xác nhận hoặc sửa đổi)."""
    try:
        scans = await list_reviewed_scans(limit=limit, offset=offset)
        total = await get_total_reviewed_scan_count()
        
        base_url = str(request.base_url).rstrip('/')
        for s in scans:
            s["image_url"] = f"{base_url}/images/{s['image_key']}"
            s["heatmap_url"] = f"{base_url}/images/{s['heatmap_key']}" if s["heatmap_key"] else None
            if s.get("created_at"):
                s["created_at"] = s["created_at"].isoformat()
            if s.get("review_deadline"):
                s["review_deadline"] = s["review_deadline"].isoformat()
                
        return JSONResponse(jsonable_encoder({
            "scans": scans,
            "total": total,
            "limit": limit,
            "offset": offset
        }))
    except Exception as e:
        logger.error(f"Error listing reviewed scans: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to list reviewed scans: {str(e)}"})

@router.post("/approve-all")
async def approve_all_scans():
    """Bác sĩ phê duyệt toàn bộ các ca quét đang chờ duyệt bằng phán đoán của AI."""
    try:
        pool = await get_pool()
        # Lấy toàn bộ các scan đang chờ duyệt
        pending_scans = await pool.fetch(
            "SELECT id, scores FROM scans WHERE review_status = 'pending'"
        )
        
        count = 0
        for s in pending_scans:
            scan_id = str(s["id"])
            scores = s["scores"]
            if isinstance(scores, str):
                scores = json.loads(scores)
                
            # Tạo verified_labels tự động từ scores > 0.6
            verified_labels = {disease: (score > 0.6) for disease, score in scores.items()}
            
            success = await save_to_training_set(
                scan_id=scan_id,
                verified_labels=verified_labels,
                review_status="approved",
                reviewed_by="doctor"
            )
            if success:
                count += 1
                
        return {"status": "success", "approved_count": count}
    except Exception as e:
        logger.error(f"Error approving all scans: {e}")
        raise HTTPException(status_code=500, detail=str(e))

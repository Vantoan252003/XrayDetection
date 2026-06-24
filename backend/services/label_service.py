import logging
import asyncio
import json
import uuid
from database import get_scan, save_labeled_scan, update_scan_review_status, get_pool
from storage import copy_image

logger = logging.getLogger(__name__)

async def save_to_training_set(
    scan_id: str, 
    verified_labels: dict, 
    review_status: str = "approved", 
    reviewed_by: str = "doctor"
) -> bool:
    """Xác nhận nhãn của ảnh quét, lưu vào hoặc cập nhật bảng labeled_scans và copy ảnh gốc sang training bucket nếu cần."""
    try:
        pool = await get_pool()
        # 1. Kiểm tra xem đã có bản ghi trong labeled_scans chưa
        existing_row = await pool.fetchrow(
            "SELECT id, image_key FROM labeled_scans WHERE scan_id = $1",
            uuid.UUID(scan_id)
        )
        
        if existing_row:
            # 2. Cập nhật nhãn và review_status
            await pool.execute(
                """UPDATE labeled_scans
                   SET verified_labels = $2, review_status = $3, reviewed_by = $4, reviewed_at = NOW(), added_to_training = FALSE
                   WHERE scan_id = $1""",
                uuid.UUID(scan_id), json.dumps(verified_labels), review_status, reviewed_by
            )
            # Cập nhật review_status trên bảng scans
            await update_scan_review_status(scan_id, "done")
            logger.info(f"Scan {scan_id} successfully updated in training set.")
            return True
            
        # 3. Nếu chưa có, lấy thông tin scan và tạo mới
        scan = await get_scan(scan_id)
        if not scan:
            logger.error(f"Scan {scan_id} not found")
            return False
        
        image_key = scan["image_key"]
        
        # 4. Copy ảnh sang training bucket (originals/{scan_id}.jpg)
        dest_key = f"originals/{scan_id}.jpg"
        await asyncio.to_thread(copy_image, image_key, dest_key)
        
        # 5. Lưu vào bảng labeled_scans
        await save_labeled_scan(
            scan_id=scan_id,
            image_key=dest_key,
            verified_labels=verified_labels,
            review_status=review_status,
            reviewed_by=reviewed_by,
            added_to_training=False
        )
        
        # 6. Cập nhật scans review_status = 'done'
        await update_scan_review_status(scan_id, "done")
        logger.info(f"Scan {scan_id} successfully saved to training set (status: {review_status}).")
        return True
    except Exception as e:
        logger.error(f"Error saving to training set for scan {scan_id}: {e}")
        return False

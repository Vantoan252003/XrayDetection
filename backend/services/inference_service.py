import uuid
import time
import os
import asyncio
from datetime import datetime, timedelta
import logging

from utils import preprocess_xray
from gradcam import predict, generate_heatmap
from xray_model import model_manager
from llm import explain_results, parse_icd_from_text
from modules.icd_mapping import get_default_icd
from storage import upload_image
from database import save_scan
from kafka_producer import publish_scan_event

logger = logging.getLogger(__name__)

async def analyze_single_xray(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    patient_id: str | None = None,
    ai_model: str = "gemini",
    source: str = "web",
    model_version: str | None = None,
    skip_llm: bool = False,
    analysis_type: str = "lung",
) -> dict:
    scan_id = str(uuid.uuid4())
    start_time = time.time()

    # Publish scan.submitted event
    await publish_scan_event("scan.submitted", scan_id, {
        "patient_id": patient_id,
        "source": source,
        "ai_model": ai_model,
        "file_size": len(file_bytes),
    })

    # Publish scan.processing event
    await publish_scan_event("scan.processing", scan_id, {})

    heatmap_bytes = b""

    # ── Chạy TorchXRayVision phổi ──
    loaded_model = model_manager.get_model(model_version)
    target_res = getattr(loaded_model, "input_resolution", 224)

    # Bước 1: Preprocess
    img_tensor = preprocess_xray(file_bytes, target_resolution=target_res)

    # Bước 2: Predict bệnh
    scores = predict(img_tensor, loaded_model)
    is_normal = len(scores) == 0
    top_disease = max(scores, key=scores.get) if scores else None
    top_score = scores.get(top_disease, 0) if top_disease else 0
    
    if top_score <= 0.7:
        top_disease = None
        is_normal = True

    # Bước 3: Grad-CAM
    if top_disease:
        heatmap_bytes = await asyncio.to_thread(
            generate_heatmap, img_tensor, top_disease, file_bytes, loaded_model
        )

    # Bước 4: Upload ảnh gốc + heatmap lên MinIO kèm Auto-tagging
    image_key = f"originals/{scan_id}.jpg"
    heatmap_key = f"heatmaps/{scan_id}.png" if heatmap_bytes else ""
    
    tagging = {
        "top_disease": top_disease or "Normal",
        "is_normal": str(is_normal).lower(),
        "scan_id": scan_id
    }
    
    await asyncio.to_thread(
        upload_image, image_key, file_bytes, content_type=content_type, tagging=tagging
    )
    if heatmap_bytes:
        await asyncio.to_thread(
            upload_image, heatmap_key, heatmap_bytes, content_type="image/png"
        )

    # Ánh xạ ICD-10 mặc định
    icd_code, icd_group = None, None
    if is_normal:
        icd_code, icd_group = get_default_icd("Normal")
    elif top_disease:
        icd_code, icd_group = get_default_icd(top_disease)

    # Bước 5: AI giải thích
    explanation = "Không phát hiện dấu hiệu bất thường rõ ràng nào trên ảnh X-quang này."
    if top_disease:
        if skip_llm:
            explanation = "Bỏ qua phân tích giải thích từ LLM theo yêu cầu."
        else:
            explanation = await asyncio.to_thread(
                explain_results, scores, heatmap_bytes, top_disease, ai_model
            )
            parsed_code, parsed_group = parse_icd_from_text(explanation)
            if parsed_code:
                icd_code = parsed_code
            if parsed_group:
                icd_group = parsed_group

    # Calculate processing time
    processing_time_ms = int((time.time() - start_time) * 1000)
    actual_model_version = model_version or model_manager.production_version or "densenet121-res224-all"

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
        review_status="pending",
        review_deadline=None,
        ai_model_version=actual_model_version,
        icd_code=icd_code,
        icd_group=icd_group,
    )

    # Bước 7: Publish scan.completed event to Kafka
    await publish_scan_event("scan.completed", scan_id, {
        "top_disease": top_disease,
        "is_normal": is_normal,
        "processing_time_ms": processing_time_ms,
        "scores": scores,
        "source": source,
        "patient_id": patient_id,
        "ai_model_version": actual_model_version,
        "icd_code": icd_code,
        "icd_group": icd_group,
    })

    # Bước 8: Trả về
    return {
        "scan_id": scan_id,
        "scores": scores,
        "top_disease": top_disease,
        "is_normal": is_normal,
        "image_url": f"http://localhost:8000/images/{image_key}",
        "heatmap_url": f"http://localhost:8000/images/{heatmap_key}" if heatmap_bytes else None,
        "explanation": explanation,
        "processing_time_ms": processing_time_ms,
        "ai_model_version": actual_model_version,
        "icd_code": icd_code,
        "icd_group": icd_group,
    }

async def analyze_batch_xrays(
    files: list[tuple[bytes, str, str]], # list of (file_bytes, filename, content_type)
    patient_id: str | None = None,
    ai_model: str = "gemini",
    source: str = "batch",
    model_version: str | None = None,
) -> list[dict]:
    # Lấy model theo version chỉ định
    loaded_model = model_manager.get_model(model_version)
    target_res = getattr(loaded_model, "input_resolution", 224)
    actual_model_version = model_version or model_manager.production_version or "densenet121-res224-all"
    
    timeout_hours = int(os.getenv("REVIEW_TIMEOUT_HOURS", "48"))
    review_deadline = datetime.utcnow() + timedelta(hours=timeout_hours)

    async def process_single(file_bytes: bytes, filename: str, content_type: str) -> dict:
        scan_id = str(uuid.uuid4())
        start_time = time.time()

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
        img_tensor = preprocess_xray(file_bytes, target_resolution=target_res)

        # Bước 2: Predict bệnh
        scores = predict(img_tensor, loaded_model)
        is_normal = len(scores) == 0
        top_disease = max(scores, key=scores.get) if scores else None
        top_score = scores.get(top_disease, 0) if top_disease else 0
        
        # Chỉ nhận bệnh lý khi score > 0.7 đối với Batch mode
        if top_score <= 0.7:
            top_disease = None
            is_normal = True

        # Bước 3: Grad-CAM (nếu phát hiện bệnh lý > 0.75)
        heatmap_bytes = b""
        if top_disease:
            heatmap_bytes = await asyncio.to_thread(
                generate_heatmap, img_tensor, top_disease, file_bytes, loaded_model
            )

        # Bước 4: Upload ảnh gốc + heatmap lên MinIO kèm Auto-tagging
        image_key = f"originals/{scan_id}.jpg"
        heatmap_key = f"heatmaps/{scan_id}.png" if heatmap_bytes else ""
        
        tagging = {
            "top_disease": top_disease or "Normal",
            "is_normal": str(is_normal).lower(),
            "scan_id": scan_id
        }
        
        await asyncio.to_thread(
            upload_image, image_key, file_bytes, content_type=content_type, tagging=tagging
        )
        if heatmap_bytes:
            await asyncio.to_thread(
                upload_image, heatmap_key, heatmap_bytes, content_type="image/png"
            )

        # Bỏ qua LLM report trong batch mode để tránh chi phí & chậm trễ
        explanation = "Kết quả đang chờ bác sĩ xác nhận. Báo cáo chi tiết sẽ được tạo sau."

        # Ánh xạ ICD-10 mặc định từ top_disease trong batch mode
        b_icd_code, b_icd_group = None, None
        if is_normal:
            b_icd_code, b_icd_group = get_default_icd("Normal")
        elif top_disease:
            b_icd_code, b_icd_group = get_default_icd(top_disease)

        processing_time_ms = int((time.time() - start_time) * 1000)

        # Bước 6: Lưu vào PostgreSQL với review_status = 'pending'
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
            review_status="pending",
            review_deadline=review_deadline,
            ai_model_version=actual_model_version,
            status="completed",
            icd_code=b_icd_code,
            icd_group=b_icd_group,
        )

        # Bước 7: Publish scan.completed event to Kafka
        await publish_scan_event("scan.completed", scan_id, {
            "top_disease": top_disease,
            "is_normal": is_normal,
            "processing_time_ms": processing_time_ms,
            "scores": scores,
            "source": source,
            "patient_id": patient_id,
            "ai_model_version": actual_model_version,
            "review_status": "pending",
            "icd_code": b_icd_code,
            "icd_group": b_icd_group,
        })

        return {
            "scan_id": scan_id,
            "scores": scores,
            "top_disease": top_disease,
            "is_normal": is_normal,
            "image_url": f"http://localhost:8000/images/{image_key}",
            "heatmap_url": f"http://localhost:8000/images/{heatmap_key}" if heatmap_bytes else None,
            "explanation": explanation,
            "processing_time_ms": processing_time_ms,
            "ai_model_version": actual_model_version,
            "icd_code": b_icd_code,
            "icd_group": b_icd_group,
        }

    # Chạy song song tất cả các files trong batch
    tasks = [process_single(f[0], f[1], f[2]) for f in files]
    results = await asyncio.gather(*tasks)

    # Gửi sự kiện Kafka tổng hợp batch.submitted
    batch_scan_ids = [res["scan_id"] for res in results]
    await publish_scan_event("batch.submitted", str(uuid.uuid4()), {
        "scan_ids": batch_scan_ids,
        "count": len(files),
        "ai_model_version": actual_model_version
    })

    return results

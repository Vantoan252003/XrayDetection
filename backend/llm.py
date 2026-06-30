import os
import requests
import base64
import logging

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

import re

SYSTEM_PROMPT = """Bạn là trợ lý y khoa hỗ trợ đọc ảnh X-ray. Nhiệm vụ của bạn là:
- Trả lời bằng tiếng Việt, ngôn ngữ dễ hiểu và trình bày theo đúng định dạng sau:
1. Dấu hiệu bất thường nổi bật: (Mô tả chi tiết những gì phát hiện được trên ảnh)
2. Ý nghĩa bệnh lý: (Đánh giá mức độ và nguyên nhân có thể)
3. Cách phòng tránh và hướng xử lý: (Khuyến nghị người bệnh nên làm gì tiếp theo)
4. Mã ICD-10 và Nhóm bệnh: [Mã ICD-10] - [Tên nhóm bệnh ICD-10] (Ví dụ: J18.9 - Bệnh hệ hô hấp (J00-J99))
- Luôn có câu nhắc nhở ở cuối: "Lưu ý: Đây chỉ là kết quả phân tích sơ bộ bằng AI, không thể thay thế chẩn đoán y khoa chính thức. Vui lòng tham khảo ý kiến bác sĩ."
"""

def parse_icd_from_text(explanation: str) -> tuple[str | None, str | None]:
    """Trích xuất mã ICD-10 và tên nhóm bệnh từ văn bản giải thích của LLM.
    
    Định dạng kỳ vọng:
    4. Mã ICD-10 và Nhóm bệnh: J18.9 - Bệnh hệ hô hấp (J00-J99)
    """
    if not explanation:
        return None, None
        
    # Tìm dòng chứa thông tin ICD-10
    match = re.search(
        r'(?:4\.\s*)?Mã\s*ICD-10\s*(?:và\s*Nhóm\s*bệnh)?\s*:\s*([A-Z][0-9][0-9A-Z\.]*)\s*-\s*([^\n\r]+)',
        explanation,
        re.IGNORECASE
    )
    if match:
        icd_code = match.group(1).strip()
        icd_group = match.group(2).strip()
        return icd_code, icd_group
        
    # Thử tìm kiếm đơn giản hơn
    match_simple = re.search(r'ICD-10\s*:\s*([A-Z][0-9][0-9A-Z\.]*)', explanation, re.IGNORECASE)
    if match_simple:
        return match_simple.group(1).strip(), None
        
    return None, None

def _build_prompt(scores: dict, top_disease: str) -> str:
    findings_text = "\n".join(
        [f"- {disease}: {round(conf * 100, 1)}%" for disease, conf in scores.items()]
    )
    return f"""{SYSTEM_PROMPT}

Kết quả phân tích ảnh X-ray ngực:
{findings_text}

Bệnh có khả năng cao nhất: {top_disease}

Ảnh heatmap đính kèm thể hiện vùng model tập trung phân tích (vùng màu đỏ/vàng = vùng nghi ngờ bất thường).

Hãy giải thích kết quả này bằng tiếng Việt."""


def _explain_with_ollama(prompt: str, model_name: str, heatmap_bytes: bytes) -> str:
    """Gọi một mô hình cục bộ qua Ollama (hỗ trợ cả text-only và vision)."""
    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False
    }

    # Chỉ đính kèm ảnh nếu là model hỗ trợ vision và có heatmap
    is_vision = any(kw in model_name.lower() for kw in ["llava", "vision", "bakllava", "minicpm", "moondream", "llama3.2-vision", "paligemma"])
    if is_vision and heatmap_bytes:
        heatmap_b64 = base64.b64encode(heatmap_bytes).decode('utf-8')
        payload["images"] = [heatmap_b64]

    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json=payload,
        timeout=300
    )
    response.raise_for_status()
    return response.json().get("response", "Không thể tạo lời giải thích.")


def _explain_with_gemini(prompt: str, heatmap_bytes: bytes) -> str:
    """Gọi Gemini qua REST API của Google."""
    models_to_try = ["gemini-2.5-flash", "gemini-3.1-flash-lite"]
    last_err = None

    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        parts = []

        # Thêm ảnh heatmap nếu có
        if heatmap_bytes:
            heatmap_b64 = base64.b64encode(heatmap_bytes).decode('utf-8')
            parts.append({
                "inline_data": {
                    "mime_type": "image/png",
                    "data": heatmap_b64
                }
            })

        parts.append({"text": prompt})
        payload = {
            "contents": [{
                "parts": parts
            }]
        }

        try:
            logger.info(f"Trying to call Gemini API with model: {model}...")
            response = requests.post(url, json=payload, timeout=60)
            response.raise_for_status()
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            logger.warning(f"Error calling {model} API: {e}")
            last_err = e

    if last_err:
        raise last_err
    return "Không thể tạo lời giải thích bằng Gemini."


def explain_results(scores: dict, heatmap_bytes: bytes, top_disease: str, ai_model: str = "gemini") -> str:
    prompt = _build_prompt(scores, top_disease)

    try:
        if ai_model == "gemini":
            return _explain_with_gemini(prompt, heatmap_bytes)
        else:
            # Bất kỳ model nào khác gemini sẽ gọi qua Ollama local (e.g. gemma, llava, etc.)
            return _explain_with_ollama(prompt, ai_model, heatmap_bytes)
    except Exception as e:
        print(f"Lỗi khi gọi AI ({ai_model}): {e}")
        return f"Đã xảy ra lỗi khi tạo lời giải thích bằng AI: {str(e)}"


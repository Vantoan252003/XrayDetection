import os
import requests
import base64

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = """Bạn là trợ lý y khoa hỗ trợ đọc ảnh X-ray. Nhiệm vụ của bạn là:
- Trả lời bằng tiếng Việt, ngôn ngữ dễ hiểu và trình bày theo đúng định dạng sau:
1. Dấu hiệu bất thường nổi bật: (Mô tả chi tiết những gì phát hiện được trên ảnh)
2. Ý nghĩa bệnh lý: (Đánh giá mức độ và nguyên nhân có thể)
3. Cách phòng tránh và hướng xử lý: (Khuyến nghị người bệnh nên làm gì tiếp theo)
- Luôn có câu nhắc nhở ở cuối: "Lưu ý: Đây chỉ là kết quả phân tích sơ bộ bằng AI, không thể thay thế chẩn đoán y khoa chính thức. Vui lòng tham khảo ý kiến bác sĩ."
"""

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
    is_vision = any(kw in model_name.lower() for kw in ["llava", "vision", "bakllava", "minicpm","gemma", "moondream", "llama3.2-vision"])
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
    """Gọi Gemini 2.5 Flash qua REST API của Google."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

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

    response = requests.post(url, json=payload, timeout=60)
    response.raise_for_status()
    
    data = response.json()
    # Parse Gemini response format
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return f"Phản hồi không hợp lệ từ Gemini: {data}"


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


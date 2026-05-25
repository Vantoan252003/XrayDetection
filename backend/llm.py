import os
import requests
import base64

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = """Bạn là trợ lý hỗ trợ đọc ảnh X-ray. Nhiệm vụ của bạn là:
- Giải thích kết quả phân tích bằng tiếng Việt, ngôn ngữ dễ hiểu
- Mô tả vùng bất thường trong ảnh heatmap (nếu có)
- Khuyến nghị bệnh nhân gặp bác sĩ chuyên khoa nào
- Luôn nhắc nhở đây chỉ là hỗ trợ sơ bộ, không thay thế chẩn đoán y tế"""

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


def _explain_with_llava(prompt: str, heatmap_bytes: bytes) -> str:
    """Gọi LLaVA qua Ollama (hỗ trợ Vision)."""
    payload = {
        "model": "llava",
        "prompt": prompt,
        "stream": False
    }

    if heatmap_bytes:
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
        if ai_model == "llava":
            return _explain_with_llava(prompt, heatmap_bytes)
        else:
            return _explain_with_gemini(prompt, heatmap_bytes)
    except Exception as e:
        print(f"Lỗi khi gọi AI ({ai_model}): {e}")
        return f"Đã xảy ra lỗi khi tạo lời giải thích bằng AI: {str(e)}"

# X-Ray Diagnosis Pipeline — Implementation Plan

## Tổng quan

Pipeline nhận ảnh X-ray đầu vào, dùng TorchXRayVision để phát hiện bệnh và tạo Grad-CAM heatmap, sau đó gửi kết quả cho Gemma 4 để giải thích bằng ngôn ngữ tự nhiên. Toàn bộ kết quả được lưu vào database + object storage để phục vụ data pipeline.

```
Ảnh X-ray (upload)
    └── Preprocessing
            └── TorchXRayVision (DenseNet121)
                    ├── Disease scores  ──┐
                    └── Grad-CAM heatmap ─┴── Gemma 4 → Giải thích
                                                  │
                                    ┌─────────────┴──────────────┐
                                    ▼                            ▼
                             PostgreSQL                    MinIO (S3)
                          (metadata + scores)        (ảnh gốc + heatmap)
```

---

## Tech Stack

| Thành phần | Công nghệ |
|---|---|
| Backend | FastAPI + Python 3.11+ |
| X-ray model | TorchXRayVision (`densenet121-res224-all`) |
| Heatmap | Grad-CAM (built-in trong TorchXRayVision) |
| LLM | Gemma 4 — local qua Ollama hoặc Google AI API |
| Database | PostgreSQL (metadata, scores, explanation) |
| Object storage | MinIO (self-hosted S3 — lưu ảnh gốc + heatmap) |
| Frontend | Next.js / React |
| Containerization | Docker + Docker Compose |
| Deploy | GPU instance (nếu cần inference nhanh) |

---

## Cài đặt (`backend/requirements.txt`)

```txt
fastapi
uvicorn[standard]
python-multipart
torchxrayvision
torch
torchvision
scikit-image
matplotlib
numpy
# Database
asyncpg
sqlalchemy[asyncio]
# Object storage
boto3
minio
# LLM
google-generativeai
# Utils
python-dotenv
pillow
pydicom
```

---

## Biến môi trường (`.env`)

```env
# PostgreSQL
POSTGRES_USER=xray
POSTGRES_PASSWORD=secret
POSTGRES_DB=xraydb
DATABASE_URL=postgresql+asyncpg://xray:secret@postgres:5432/xraydb

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=xray-data

# Gemma 4
GOOGLE_AI_API_KEY=your_key_here
# hoặc nếu dùng Ollama local:
OLLAMA_BASE_URL=http://ollama:11434
```

---

## Docker

### `backend/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgomp1 libglib2.0-0 libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

### `docker-compose.yml`

```yaml
version: "3.9"

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env
    volumes:
      - model_cache:/root/.torchxrayvision   # cache model weights, tránh download lại
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    depends_on:
      - backend
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      retries: 5
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Web console — xem/quản lý ảnh lưu trữ
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      retries: 5
    restart: unless-stopped

  # Bỏ qua service này nếu dùng Google AI API
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  postgres_data:
  minio_data:
  ollama_data:
  model_cache:
```

---

## Database Schema (`db/init.sql`)

```sql
CREATE TABLE scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- File locations trên MinIO
    image_key       TEXT NOT NULL,    -- originals/{id}.jpg
    heatmap_key     TEXT NOT NULL,    -- heatmaps/{id}.png

    -- Kết quả model
    top_disease     TEXT,
    scores          JSONB NOT NULL,   -- {"Pneumonia": 0.82, "Effusion": 0.45}
    is_normal       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Giải thích từ Gemma 4
    explanation     TEXT,

    -- Metadata tuỳ chọn
    patient_id      TEXT,
    notes           TEXT
);

-- Index để query nhanh theo thời gian và bệnh
CREATE INDEX idx_scans_created_at  ON scans (created_at DESC);
CREATE INDEX idx_scans_top_disease ON scans (top_disease);
CREATE INDEX idx_scans_scores      ON scans USING GIN (scores);
```

---

## Data Pipeline — Storage Layer

### `storage.py` — Upload ảnh lên MinIO

```python
import boto3
from botocore.client import Config
import os

s3 = boto3.client(
    "s3",
    endpoint_url=f"http://{os.getenv('MINIO_ENDPOINT')}",
    aws_access_key_id=os.getenv("MINIO_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("MINIO_SECRET_KEY"),
    config=Config(signature_version="s3v4"),
)

BUCKET = os.getenv("MINIO_BUCKET", "xray-data")

def ensure_bucket():
    """Tạo bucket nếu chưa có — chạy khi startup."""
    existing = [b["Name"] for b in s3.list_buckets()["Buckets"]]
    if BUCKET not in existing:
        s3.create_bucket(Bucket=BUCKET)

def upload_image(key: str, data: bytes, content_type: str = "image/jpeg") -> str:
    s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)
    return key

def get_presigned_url(key: str, expires: int = 3600) -> str:
    """URL tạm để frontend load ảnh trực tiếp từ MinIO (không qua backend)."""
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires,
    )
```

### `database.py` — Lưu metadata vào PostgreSQL

```python
import asyncpg
import os, json, uuid

_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(os.getenv("DATABASE_URL"))
    return _pool

async def save_scan(scan_id, image_key, heatmap_key,
                    scores, top_disease, is_normal, explanation, patient_id=None):
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO scans
           (id, image_key, heatmap_key, scores, top_disease, is_normal, explanation, patient_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
        uuid.UUID(scan_id), image_key, heatmap_key,
        json.dumps(scores), top_disease, is_normal, explanation, patient_id,
    )

async def get_scan(scan_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM scans WHERE id=$1", uuid.UUID(scan_id))
    return dict(row) if row else None

async def list_scans(limit=20, offset=0) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM scans ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit, offset,
    )
    return [dict(r) for r in rows]
```

---

## Cấu trúc thư mục

```
project/
├── backend/
│   ├── main.py           # FastAPI app
│   ├── model.py          # Load TorchXRayVision
│   ├── gradcam.py        # Grad-CAM + overlay
│   ├── llm.py            # Gọi Gemma 4
│   ├── storage.py        # MinIO client (upload ảnh)
│   ├── database.py       # PostgreSQL — lưu metadata + scores
│   ├── schemas.py        # Pydantic models
│   ├── utils.py          # Helpers (base64, image processing)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── ...               # Next.js app
│   └── Dockerfile
├── db/
│   └── init.sql          # Schema khởi tạo PostgreSQL
├── .env                  # Biến môi trường
└── docker-compose.yml
```

---

## Backend Implementation

### 1. Load model (`model.py`)

```python
import torch
import torchxrayvision as xrv

# Load một lần khi khởi động server
model = xrv.models.DenseNet(weights="densenet121-res224-all")
model.eval()

# 18 pathologies model hỗ trợ:
# Atelectasis, Cardiomegaly, Consolidation, Edema, Effusion,
# Emphysema, Fibrosis, Hernia, Infiltration, Mass, Nodule,
# Pleural Thickening, Pneumonia, Pneumothorax, ...
```

### 2. Preprocessing ảnh (`utils.py`)

```python
import skimage.io
import skimage.transform
import numpy as np
import torch

def preprocess_xray(file_bytes: bytes) -> torch.Tensor:
    import io
    img = skimage.io.imread(io.BytesIO(file_bytes))

    # Chuyển về grayscale nếu ảnh màu
    if len(img.shape) == 3:
        img = img.mean(axis=2)

    # Normalize về range [-1024, 1024] theo chuẩn TorchXRayVision
    img = xrv.datasets.normalize(img, 255)

    # Resize về 224x224
    img = skimage.transform.resize(img, (224, 224))

    # Thêm batch + channel dimension: (1, 1, 224, 224)
    img = img[None, None]
    return torch.from_numpy(img).float()
```

### 3. Predict bệnh + Grad-CAM (`gradcam.py`)

```python
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import base64
import io
from model import model

THRESHOLD = 0.3   # chỉ report bệnh có confidence > 30%

def predict(img_tensor: torch.Tensor) -> dict:
    with torch.no_grad():
        preds = model(img_tensor)[0]
    scores = dict(zip(model.pathologies, preds.numpy().tolist()))
    # Lọc bệnh có confidence cao
    return {k: round(v, 3) for k, v in scores.items() if v > THRESHOLD}


def generate_heatmap(img_tensor: torch.Tensor, disease: str) -> bytes:
    """
    Tạo Grad-CAM heatmap cho bệnh có score cao nhất.
    Trả về bytes PNG để upload thẳng lên MinIO.
    """
    disease_idx = model.pathologies.index(disease)
    cam = xrv.utils.GradCAM(model, img_tensor)
    heatmap = cam.generate(disease_idx)

    img_np = img_tensor[0, 0].numpy()
    img_norm = (img_np - img_np.min()) / (img_np.max() - img_np.min())

    fig, ax = plt.subplots(figsize=(5, 5))
    ax.imshow(img_norm, cmap="gray")
    ax.imshow(heatmap, alpha=0.45, cmap="jet")
    ax.axis("off")

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close()
    buf.seek(0)
    return buf.read()   # bytes — caller tự upload hoặc encode base64
```

### 4. Gọi Gemma 4 (`llm.py`)

```python
import google.generativeai as genai
import base64

genai.configure(api_key="YOUR_GOOGLE_AI_API_KEY")
gemma = genai.GenerativeModel("gemma-3-27b-it")   # Gemma 4 multimodal

SYSTEM_PROMPT = """Bạn là trợ lý hỗ trợ đọc ảnh X-ray. Nhiệm vụ của bạn là:
- Giải thích kết quả phân tích bằng ngôn ngữ dễ hiểu
- Mô tả vùng bất thường trong ảnh heatmap (vùng đỏ/vàng)
- Khuyến nghị bệnh nhân gặp bác sĩ chuyên khoa nào
- Luôn nhắc nhở đây chỉ là hỗ trợ sơ bộ, không thay thế chẩn đoán y tế"""


def explain_results(scores: dict, heatmap_b64: str, top_disease: str) -> str:
    findings_text = "\n".join(
        [f"- {disease}: {round(conf * 100, 1)}%" for disease, conf in scores.items()]
    )

    prompt = f"""{SYSTEM_PROMPT}

Kết quả phân tích ảnh X-ray ngực:
{findings_text}

Bệnh có khả năng cao nhất: {top_disease}

Ảnh heatmap đính kèm thể hiện vùng model tập trung phân tích (vùng màu đỏ/vàng = vùng nghi ngờ bất thường).

Hãy giải thích kết quả này."""

    # Đính kèm ảnh heatmap để Gemma 4 nhìn vào
    image_part = {
        "mime_type": "image/png",
        "data": heatmap_b64
    }

    response = gemma.generate_content([prompt, image_part])
    return response.text
```

### 5. FastAPI endpoint (`main.py`)

```python
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.responses import JSONResponse

from utils import preprocess_xray
from gradcam import predict, generate_heatmap
from llm import explain_results
from storage import ensure_bucket, upload_image, get_presigned_url
from database import save_scan, get_scan, list_scans

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_bucket()   # tạo MinIO bucket khi startup nếu chưa có
    yield

app = FastAPI(lifespan=lifespan)


@app.post("/analyze")
async def analyze_xray(
    file: UploadFile = File(...),
    patient_id: str | None = None,
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
    upload_image(image_key, file_bytes, content_type="image/jpeg")
    if heatmap_bytes:
        upload_image(heatmap_key, heatmap_bytes, content_type="image/png")

    # Bước 5: Gemma 4 giải thích
    explanation = (
        explain_results(scores, heatmap_bytes, top_disease)
        if top_disease else "Không phát hiện bất thường."
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

    # Bước 7: Trả về presigned URL — frontend load ảnh thẳng từ MinIO
    return JSONResponse({
        "scan_id": scan_id,
        "scores": scores,
        "top_disease": top_disease,
        "is_normal": is_normal,
        "image_url":   get_presigned_url(image_key),
        "heatmap_url": get_presigned_url(heatmap_key) if heatmap_bytes else None,
        "explanation": explanation,
    })


@app.get("/scans/{scan_id}")
async def get_scan_detail(scan_id: str):
    scan = await get_scan(scan_id)
    if not scan:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    scan["image_url"]   = get_presigned_url(scan["image_key"])
    scan["heatmap_url"] = get_presigned_url(scan["heatmap_key"])
    return JSONResponse(scan)


@app.get("/scans")
async def get_all_scans(
    limit: int = Query(default=20, le=100),
    offset: int = 0,
):
    """Lấy danh sách scan — dùng để build dashboard / data export."""
    scans = await list_scans(limit=limit, offset=offset)
    return JSONResponse({"scans": scans, "limit": limit, "offset": offset})
```

---

## Frontend (Next.js)

```tsx
export default function XRayPage() {
  const [result, setResult] = useState(null)

  async function handleUpload(file: File) {
    const form = new FormData()
    form.append("file", file)

    const res = await fetch("http://localhost:8000/analyze", {
      method: "POST",
      body: form,
    })
    setResult(await res.json())
  }

  return (
    <div>
      <input type="file" accept="image/*" onChange={e => handleUpload(e.target.files[0])} />

      {result && (
        <>
          {/* Ảnh heatmap load thẳng từ MinIO qua presigned URL */}
          {result.heatmap_url && <img src={result.heatmap_url} />}

          {/* Disease scores */}
          {Object.entries(result.scores).map(([disease, conf]) => (
            <div key={disease}>{disease}: {((conf as number) * 100).toFixed(1)}%</div>
          ))}

          {/* Giải thích từ Gemma 4 */}
          <p>{result.explanation}</p>

          {/* Link xem lại scan */}
          <a href={`/scans/${result.scan_id}`}>Xem chi tiết</a>
        </>
      )}
    </div>
  )
}
```

---

## Lưu ý quan trọng

### Threshold scores
Chỉ report bệnh có confidence > 30%. Dưới ngưỡng này thường là noise, dễ gây hiểu lầm cho người dùng.

### Gemma 4: local vs cloud
- **Cloud (Google AI API):** Dễ setup, nhưng dữ liệu ảnh X-ray gửi lên server Google — cần xem xét vấn đề bảo mật/HIPAA.
- **Local (Ollama):** Dữ liệu không ra ngoài, phù hợp với dữ liệu y tế nhạy cảm. Cần máy có GPU ≥ 16GB VRAM cho Gemma 4 27B.

```bash
# Chạy Gemma 4 local bằng Ollama
ollama pull gemma3:27b
ollama serve
```

### Disclaimer bắt buộc
App y tế phải hiển thị rõ ràng: **"Kết quả này chỉ mang tính hỗ trợ tham khảo, không thay thế chẩn đoán của bác sĩ."**

### DICOM support (nếu cần)
Ảnh X-ray thực tế trong bệnh viện thường ở định dạng DICOM. Cần thêm `pydicom` để đọc:

```python
import pydicom
ds = pydicom.dcmread("scan.dcm")
img = ds.pixel_array
```

---

## Chạy

```bash
# Khởi động toàn bộ stack
docker compose up --build

# Pull Gemma 4 nếu dùng Ollama local (chạy sau khi ollama container up)
docker compose exec ollama ollama pull gemma3:27b
```

Các service sau khi chạy:

| Service | URL |
|---|---|
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| Frontend | http://localhost:3000 |
| MinIO Console | http://localhost:9001 |

```bash
# Test API bằng curl
curl -X POST http://localhost:8000/analyze \
  -F "file=@chest_xray.jpg" \
  -F "patient_id=P001"

# Xem danh sách scan
curl http://localhost:8000/scans

# Xem chi tiết 1 scan
curl http://localhost:8000/scans/{scan_id}
```

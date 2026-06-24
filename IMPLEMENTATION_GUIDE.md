# Hướng Dẫn Implement 6 Tính Năng Mới — X-Ray Diagnosis Pipeline

> **Dành cho AI Agent:** Đọc kỹ toàn bộ tài liệu này trước khi sinh code. Đọc thêm `PROJECT_SUMMARY.md` để nắm cấu trúc project hiện tại. Không tự ý thay đổi các file hiện có nếu không được chỉ định. Mọi API key đều được đọc từ biến môi trường `.env` — KHÔNG hardcode.

---

## Tổng Quan Kiến Trúc Hiện Tại

```
XRayDetection/
├── backend/        # FastAPI (Python 3.11+)
├── frontend/       # Next.js 14
├── spark/          # Apache Spark jobs
├── db/             # PostgreSQL schema & migrations
├── scripts/        # Seed & admin scripts
└── docker-compose.yml
```

Stack: FastAPI · PostgreSQL 16 · MinIO (S3) · Redis 7 · Apache Kafka · Apache Spark · Next.js 14 · TorchXRayVision (DenseNet121) · Grad-CAM++ · Gemini LLM · Docker Compose.

---

## Biến Môi Trường Cần Bổ Sung vào `.env`

> **Lưu ý cho AI Agent:** Người dùng sẽ tự điền các giá trị sau. Chỉ cần đọc từ `os.environ` hoặc `python-dotenv`. KHÔNG đặt giá trị mặc định cho các key bảo mật.

```env
# ── Kaggle (Tính năng ②⑥: Train lại qua Kaggle) ──────────────────────────
KAGGLE_USERNAME=          # Tên tài khoản Kaggle
KAGGLE_KEY=               # API key từ kaggle.com > Account > API > Create Token
KAGGLE_DATASET_NAME=      # Tên dataset trên Kaggle để upload ảnh + labels.csv
KAGGLE_NOTEBOOK_SLUG=     # Slug của notebook Kaggle sẽ được trigger (vd: username/xray-finetune)

# ── MLflow (Tính năng ④: Tracking & Model Registry) ──────────────────────
MLFLOW_TRACKING_URI=      # URI của MLflow server (vd: http://mlflow:5000)
MLFLOW_EXPERIMENT_NAME=   # Tên experiment trong MLflow (vd: xray-finetune)
MLFLOW_S3_ENDPOINT_URL=   # Dùng lại MinIO: http://minio:9000
# (Dùng lại AWS_ACCESS_KEY_ID và AWS_SECRET_ACCESS_KEY của MinIO bên dưới)

# ── MinIO (đã có, kiểm tra lại đủ bucket) ────────────────────────────────
MINIO_ENDPOINT=           # vd: minio:9000
MINIO_ACCESS_KEY=         # MinIO access key
MINIO_SECRET_KEY=         # MinIO secret key
MINIO_BUCKET_XRAY=        # Bucket chứa ảnh gốc + heatmap (đã có)
MINIO_BUCKET_MODELS=      # Bucket mới: lưu file model.pt các version
MINIO_BUCKET_TRAINING=    # Bucket mới: lưu ảnh đã được bác sĩ xác nhận dùng để train

# ── Apache Airflow (Tính năng ②③: Scheduler cuối tuần) ──────────────────
AIRFLOW_ADMIN_USER=       # Tài khoản admin Airflow UI
AIRFLOW_ADMIN_PASSWORD=   # Mật khẩu admin Airflow UI

# ── Review timeout (Tính năng ③) ─────────────────────────────────────────
REVIEW_TIMEOUT_HOURS=48   # Sau bao nhiêu giờ tự động thêm vào training set nếu bác sĩ không trả lời

# ── Các key hiện có (kiểm tra đã có trong .env chưa) ─────────────────────
GEMINI_API_KEY=           # Google Gemini API key (đã có)
DATABASE_URL=             # PostgreSQL connection string (đã có)
REDIS_URL=                # Redis connection string (đã có)
KAFKA_BOOTSTRAP_SERVERS=  # Kafka broker address (đã có)
```

---

## Cấu Trúc Thư Mục Sau Khi Implement

```
XRayDetection/
├── backend/
│   ├── main.py                    # Thêm router mới: /batch-analyze, /review, /training
│   ├── xray_model.py              # Mở rộng: hỗ trợ load nhiều model version
│   ├── gradcam.py                 # Không thay đổi
│   ├── llm.py                     # Không thay đổi
│   ├── database.py                # Không thay đổi
│   ├── storage.py                 # Mở rộng: thêm hàm upload/download model.pt
│   ├── kafka_producer.py          # Thêm event: review-events, train-trigger
│   ├── kafka_consumer.py          # Không thay đổi
│   ├── analytics.py               # Không thay đổi
│   ├── routers/                   # MỚI: Tách router theo tính năng
│   │   ├── __init__.py
│   │   ├── batch.py               # Tính năng ①②: Batch inference & import hàng loạt
│   │   ├── review.py              # Tính năng ③: Bác sĩ review kết quả
│   │   └── training.py            # Tính năng ②⑥: Trigger train lại
│   ├── services/                  # MỚI: Business logic tách khỏi router
│   │   ├── __init__.py
│   │   ├── label_service.py       # Xử lý logic gán nhãn & lưu labeled_scans
│   │   ├── model_registry.py      # Kết nối MLflow Model Registry
│   │   └── kaggle_service.py      # Upload data & trigger Kaggle notebook
│   └── tasks/                     # MỚI: Background tasks
│       ├── __init__.py
│       └── review_timeout.py      # Cronjob kiểm tra timeout review
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── batch/             # MỚI: Trang import hàng loạt (Tính năng ②)
│       │   │   └── page.tsx
│       │   ├── review/            # MỚI: Trang bác sĩ review (Tính năng ③)
│       │   │   └── page.tsx
│       │   └── models/            # MỚI: Trang quản lý model versions (Tính năng ④⑤)
│       │       └── page.tsx
│       └── components/
│           ├── BatchUploader.tsx   # MỚI: Upload nhiều ảnh cùng lúc
│           ├── ReviewTable.tsx     # MỚI: Bảng review kết quả từng ảnh
│           ├── DiseaseCheckbox.tsx # MỚI: Checkbox 18 bệnh lý để bác sĩ xác nhận
│           ├── ModelSelector.tsx   # MỚI: Dropdown chọn model version (Tính năng ⑤)
│           └── TrainingStatus.tsx  # MỚI: Hiển thị trạng thái train (Tính năng ②)
│
├── airflow/                       # MỚI: Apache Airflow DAGs (Tính năng ②③)
│   ├── dags/
│   │   ├── weekly_training_dag.py # DAG chạy cuối tuần: gom data → upload Kaggle → trigger train
│   │   └── review_timeout_dag.py  # DAG chạy hàng ngày: tự thêm ảnh timeout vào training set
│   └── Dockerfile                 # Airflow custom image
│
├── kaggle/                        # MỚI: Kaggle Notebook source (Tính năng ⑥)
│   ├── notebook.ipynb             # Notebook fine-tune DenseNet121
│   └── kernel-metadata.json       # Kaggle metadata để push notebook
│
├── db/
│   ├── init.sql                   # Không thay đổi
│   └── migrations/                # MỚI: Migration files cho schema mới
│       └── 001_add_training_tables.sql
│
└── docker-compose.yml             # Mở rộng: thêm service MLflow, Airflow
```

---

## Chi Tiết Từng Tính Năng

---

### Tính năng ① — Auto-tag bệnh vào MinIO

**Mục tiêu:** Sau mỗi lần inference, AI tự động gán nhãn bệnh lý vào metadata của file ảnh trên MinIO, không cần thao tác tay.

**Nơi implement:** `backend/storage.py` và flow hiện tại trong `backend/main.py`.

**Logic:**
- Sau khi DenseNet121 trả về `scores` (dict 18 bệnh lý), trích xuất các bệnh có score > 0.5.
- Lưu metadata này vào MinIO object tags khi upload ảnh gốc lên bucket.
- MinIO S3 SDK hỗ trợ `put_object_tags()` — dùng để gắn tag dạng key-value vào object.
- Tag format: `{"top_disease": "Pneumonia", "is_normal": "false", "scan_id": "<uuid>"}`.
- Đây là bước bổ sung nhỏ vào flow hiện tại, không thay đổi logic inference.

**Không cần:** Tạo file mới. Chỉ mở rộng hàm upload trong `storage.py`.

---

### Tính năng ② — Import hàng loạt & Batch Inference

**Mục tiêu:** Bác sĩ upload nhiều ảnh X-quang cùng lúc, model tự dự đoán toàn bộ, trả về bảng kết quả để bác sĩ review từng ảnh.

**Backend — `backend/routers/batch.py`:**

Tạo endpoint `POST /batch-analyze`:
- Nhận `multipart/form-data` với nhiều file ảnh.
- Chạy inference song song (dùng `asyncio.gather` hoặc `ThreadPoolExecutor`) cho từng ảnh.
- Mỗi ảnh: chạy DenseNet121 → Grad-CAM nếu score > 0.75 → lưu ảnh gốc + heatmap vào MinIO → lưu bản ghi vào bảng `scans` với `review_status = 'pending'`.
- Trả về list kết quả: `[{scan_id, image_url, heatmap_url, scores, top_disease}]`.
- Gửi Kafka event `batch.submitted` với danh sách `scan_ids`.

**Frontend — `frontend/src/app/batch/page.tsx`:**
- Khu vực drag-and-drop upload nhiều file (tối đa 50 ảnh/lần).
- Hiển thị progress bar tổng thể khi đang inference.
- Sau khi xong, chuyển hướng sang trang Review (Tính năng ③).

**Lưu ý quan trọng:** Không sinh LLM report trong batch mode để tránh chậm và tốn chi phí API. LLM chỉ chạy khi bác sĩ xác nhận kết quả đúng (tùy chọn).

---

### Tính năng ③ — Bác sĩ Review kết quả

**Mục tiêu:** Sau batch inference, bác sĩ xem từng ảnh và xác nhận/sửa kết quả. Dữ liệu đúng được đưa vào training set.

#### 3.1 Schema Database mới

File migration: `db/migrations/001_add_training_tables.sql`

Tạo bảng `labeled_scans`:
```
id              UUID PRIMARY KEY
scan_id         UUID REFERENCES scans(id)
image_key       TEXT        -- key ảnh gốc trên MinIO
verified_labels JSONB       -- {"Pneumonia": true, "Effusion": false, ...} 18 bệnh lý
review_status   TEXT        -- 'pending' | 'approved' | 'rejected' | 'auto_approved'
reviewed_by     TEXT        -- 'doctor' | 'system_timeout'
reviewed_at     TIMESTAMPTZ
created_at      TIMESTAMPTZ DEFAULT NOW()
added_to_training BOOLEAN DEFAULT FALSE  -- đã đưa vào MinIO training bucket chưa
```

Thêm cột vào bảng `scans` hiện tại:
```
review_status   TEXT DEFAULT 'none'  -- 'none' | 'pending' | 'done'
review_deadline TIMESTAMPTZ          -- created_at + REVIEW_TIMEOUT_HOURS
```

Index cần tạo:
- `idx_labeled_scans_status` trên `review_status`
- `idx_scans_review_deadline` trên `review_deadline` WHERE `review_status = 'pending'`

#### 3.2 Backend — `backend/routers/review.py`

Các endpoint cần tạo:

`GET /review/pending` — Lấy danh sách scan đang chờ review (status = 'pending'), trả về ảnh gốc + heatmap URL presigned từ MinIO + scores model dự đoán.

`POST /review/{scan_id}/approve` — Body: `{verified_labels: {disease: bool}}`. Logic:
  - Lưu vào `labeled_scans` với `review_status = 'approved'`, `reviewed_by = 'doctor'`.
  - Copy ảnh gốc từ bucket xray sang `MINIO_BUCKET_TRAINING`.
  - Gọi `label_service.save_to_training_set(scan_id, verified_labels)`.
  - Cập nhật `scans.review_status = 'done'`.

`POST /review/{scan_id}/reject` — Body: `{reason: str}`. Lưu vào `labeled_scans` với `review_status = 'rejected'`. Không copy ảnh sang training bucket.

`POST /review/{scan_id}/correct` — Body: `{corrected_labels: {disease: bool}}`. Bác sĩ sửa lại label sai của model. Lưu `corrected_labels` thay vì dùng model scores. Sau đó xử lý như `approve`.

#### 3.3 Logic Timeout — `backend/tasks/review_timeout.py`

Chạy như background task hoặc Airflow DAG (`airflow/dags/review_timeout_dag.py`) mỗi giờ:
- Query: `SELECT * FROM scans WHERE review_status = 'pending' AND review_deadline < NOW()`.
- Với mỗi scan timeout: tự động tạo bản ghi `labeled_scans` với `review_status = 'auto_approved'`, `reviewed_by = 'system_timeout'`, dùng model scores làm `verified_labels` (chỉ lấy bệnh có score > 0.5).
- Copy ảnh sang training bucket.
- Cập nhật `scans.review_status = 'done'`.

#### 3.4 Frontend — `frontend/src/app/review/page.tsx`

Layout giao diện review từng ảnh:
- Hiển thị song song: ảnh gốc bên trái, ảnh Grad-CAM overlay bên phải.
- Bên dưới: grid 18 checkbox bệnh lý, checked = model dự đoán. Bác sĩ có thể tích/bỏ tích.
- Ba nút hành động: `[✓ Xác nhận đúng]` `[✎ Sửa rồi lưu]` `[✗ Bỏ qua]`.
- Navigation: Trước / Tiếp theo để đi qua từng ảnh trong batch.
- Badge hiển thị: "X ảnh đang chờ review" ở header.

**Component `DiseaseCheckbox.tsx`:** Nhận vào `scores` từ model và `verifiedLabels` (state). Render 18 checkbox, highlight các bệnh model tự tin cao (score > 0.75) bằng màu khác để bác sĩ dễ nhận biết.

---

### Tính năng ④ — MLflow Tracking & Model Registry

**Mục tiêu:** Mỗi lần train lại, log AUC/Loss vào MLflow. Quản lý version model. Bác sĩ/admin so sánh các phiên bản.

#### 4.1 Thêm service MLflow vào Docker Compose

Thêm service `mlflow` vào `docker-compose.yml`:
- Image: `ghcr.io/mlflow/mlflow:latest`
- Port: `5000:5000`
- Backend store: PostgreSQL (dùng lại DB hiện tại, tạo thêm database `mlflow`).
- Artifact store: MinIO bucket `mlflow-artifacts` (dùng `MLFLOW_S3_ENDPOINT_URL`).
- Command: `mlflow server --backend-store-uri postgresql://... --default-artifact-root s3://mlflow-artifacts/ --host 0.0.0.0`

#### 4.2 Backend — `backend/services/model_registry.py`

Service này xử lý:
- `get_production_model()` — Query MLflow Registry lấy model đang ở stage `Production`. Dùng để load khi FastAPI khởi động.
- `list_model_versions()` — Trả về danh sách tất cả version kèm metrics AUC, trạng thái (Staging/Production/Archived).
- `promote_to_production(version)` — Chuyển một version lên Production, tự động archive version cũ.
- `load_model_from_registry(version)` — Download file `model.pt` từ MinIO về memory thông qua MLflow artifact path.

#### 4.3 Mở rộng `backend/xray_model.py`

Hiện tại chỉ load model mặc định từ TorchXRayVision. Cần mở rộng:
- Singleton `ModelManager` thay vì single model.
- `ModelManager` có dict `{version_name: model_instance}`.
- Khi khởi động: load model Production từ MLflow nếu có, fallback về `densenet121-res224-all` từ TorchXRayVision nếu chưa có version nào.
- Method `get_model(version=None)`: nếu `version=None` thì trả về Production model.
- Method `reload_production()`: gọi sau khi train xong để load model mới vào memory mà không restart server.

#### 4.4 Frontend — `frontend/src/app/models/page.tsx`

Trang quản lý model:
- Bảng danh sách versions: cột Version, Ngày train, Số ảnh train, AUC trung bình, Trạng thái (badge màu).
- Nút `[Promote to Production]` cho version đang ở Staging.
- Card "Model hiện tại đang dùng" với metrics chi tiết từng bệnh lý.

**Component `ModelSelector.tsx`:** Dropdown dùng ở trang Upload ảnh đơn lẻ. Hiển thị danh sách versions, mặc định chọn Production. Truyền `model_version` xuống khi gọi `/analyze`.

---

### Tính năng ⑤ — Chọn Model ở Giao Diện Upload

**Mục tiêu:** Bác sĩ có thể chọn dùng model version nào khi phân tích ảnh.

**Backend:** Thêm optional param `model_version: str = None` vào endpoint `/analyze` và `/batch-analyze` hiện tại. Nếu `None`, dùng Production model. Nếu có, dùng `ModelManager.get_model(version)`.

**Frontend:** Tích hợp component `ModelSelector.tsx` vào trang Upload. Lưu selection vào state, gửi kèm khi POST.

**Cột bổ sung trong `scans`:** `ai_model_version TEXT` — lưu lại version model đã dùng để phân tích ca quét đó (quan trọng cho audit trail y tế).

---

### Tính năng ⑥ — Fine-tune qua Kaggle Notebook

**Mục tiêu:** Cuối tuần Airflow tự gom data đã label, upload lên Kaggle, trigger notebook fine-tune, sau đó model mới được upload về MinIO và đăng ký vào MLflow.

#### 6.1 Chuẩn bị dữ liệu — `backend/services/kaggle_service.py`

Method `prepare_training_data()`:
- Query `labeled_scans` WHERE `added_to_training = FALSE` AND `review_status IN ('approved', 'auto_approved')`.
- Tạo file `labels.csv` với schema:
  ```
  filename, Atelectasis, Cardiomegaly, Effusion, ...(18 cột bệnh lý)...
  abc.jpg,  1,           0,            0,         ...
  ```
- Download từng ảnh từ `MINIO_BUCKET_TRAINING` về `/tmp/training_data/images/`.
- Zip toàn bộ thư mục `images/` + `labels.csv`.

Method `upload_to_kaggle(zip_path)`:
- Dùng Kaggle Python SDK (`kaggle` package).
- Authenticate bằng `KAGGLE_USERNAME` + `KAGGLE_KEY`.
- Upload lên dataset `KAGGLE_DATASET_NAME` dưới dạng version mới.

Method `trigger_notebook()`:
- Gọi `kaggle.api.kernels_push()` với `KAGGLE_NOTEBOOK_SLUG`.
- Poll trạng thái notebook mỗi 5 phút (Kaggle API: `kernels_status`).
- Khi hoàn thành: notebook tự upload model.pt lên MinIO (xem Kaggle Notebook bên dưới).

Method `register_new_model(model_version)`:
- Sau khi Kaggle xong, download model.pt từ MinIO bucket `models`.
- Đăng ký vào MLflow Model Registry với stage `Staging`.
- Log metrics AUC đã được Kaggle notebook tính và ghi vào file `metrics.json` trên MinIO.
- Cập nhật cột `added_to_training = TRUE` trong `labeled_scans` cho các bản ghi vừa dùng.

#### 6.2 Kaggle Notebook — `kaggle/notebook.ipynb`

Notebook gồm các cell theo thứ tự:

**Cell 1 — Setup & Import:**
- Install: `torchxrayvision`, `mlflow`, `boto3`, `scikit-learn`.
- Import libraries.

**Cell 2 — Load data từ Kaggle Dataset:**
- Đọc `/kaggle/input/{KAGGLE_DATASET_NAME}/labels.csv`.
- Load ảnh từ `/kaggle/input/{KAGGLE_DATASET_NAME}/images/`.

**Cell 3 — Load model:**
- Kiểm tra MinIO có file `models/latest_model.pt` không.
- Nếu có: download về và `model.load_state_dict(torch.load(...))` — tiếp tục fine-tune từ version trước.
- Nếu không: load model gốc `xrv.models.DenseNet(weights="densenet121-res224-all")` — lần đầu train.

**Cell 4 — Fine-tune:**
- Chiến lược Linear Probing trước (đóng băng toàn bộ, chỉ train lớp cuối) nếu số ảnh < 500.
- Chiến lược Fine-tune toàn bộ nếu số ảnh >= 500.
- Loss function: `BCEWithLogitsLoss` (phù hợp multi-label classification).
- Optimizer: `Adam`, learning rate `1e-4`.
- Scheduler: `ReduceLROnPlateau`.
- Tính AUC trên validation set (20% data) sau mỗi epoch.

**Cell 5 — Lưu kết quả:**
- Lưu model: `torch.save(model.state_dict(), "/kaggle/working/model.pt")`.
- Lưu metrics: `json.dump({"avg_auc": ..., "per_disease_auc": {...}}, open("metrics.json", "w"))`.
- Upload cả 2 file lên MinIO bucket `models` với tên `model_v{timestamp}.pt` và `metrics_v{timestamp}.json`.

**File `kaggle/kernel-metadata.json`:**
- `id`: `{KAGGLE_USERNAME}/{notebook-slug}`
- `language`: `python`
- `kernel_type`: `notebook`
- `enable_gpu`: `true`
- `enable_internet`: `true` (cần để connect MinIO qua ngrok nếu local, hoặc URL public)

#### 6.3 Airflow DAG — `airflow/dags/weekly_training_dag.py`

DAG `xray_weekly_training`:
- Schedule: `0 2 * * 0` (2 giờ sáng Chủ nhật)
- Tasks theo thứ tự:
  1. `check_labeled_data` — Kiểm tra có đủ ảnh chưa (tối thiểu 50 ảnh mới). Nếu không đủ, skip DAG.
  2. `prepare_data` — Gọi `kaggle_service.prepare_training_data()`.
  3. `upload_to_kaggle` — Gọi `kaggle_service.upload_to_kaggle()`.
  4. `trigger_notebook` — Gọi `kaggle_service.trigger_notebook()` và đợi.
  5. `register_model` — Gọi `kaggle_service.register_new_model()`.
  6. `notify_completion` — Gửi Kafka event `training.completed` để FastAPI reload model.

#### 6.4 Thêm Airflow vào Docker Compose

Thêm services: `airflow-webserver`, `airflow-scheduler`, `airflow-init`.
- Image: `apache/airflow:2.8.0`
- Port webserver: `8080:8080`
- Dùng chung PostgreSQL (tạo database riêng `airflow`).
- Mount thư mục `./airflow/dags` vào `/opt/airflow/dags`.
- Biến môi trường Airflow đọc từ `.env`.

---

## Luồng Kết Nối Giữa Các Tính Năng

```
[Upload hàng loạt ②]
        │
        ▼
[Batch Inference → lưu scans với review_status='pending']
        │
        ▼
[Bác sĩ Review ③]
   ├── Approve/Correct → labeled_scans (approved) → copy ảnh sang MINIO_BUCKET_TRAINING
   ├── Reject          → labeled_scans (rejected)  → không lưu
   └── Timeout         → labeled_scans (auto_approved) → copy ảnh sang MINIO_BUCKET_TRAINING
        │
        ▼ (cuối tuần)
[Airflow trigger ②]
        │
        ▼
[Kaggle fine-tune ⑥]
  ├── Load model.pt cũ từ MinIO (nếu có)
  ├── Train với ảnh đã label
  └── Upload model.pt mới + metrics.json về MinIO
        │
        ▼
[FastAPI nhận event training.completed]
        │
        ▼
[MLflow đăng ký version mới ④ → stage: Staging]
        │
        ▼
[Admin/Bác sĩ vào trang /models ④ → xem AUC, promote lên Production ⑤]
        │
        ▼
[ModelManager.reload_production() → dùng model mới cho inference tiếp theo]
```

---

## Nguyên Tắc Clean Architecture Cần Tuân Thủ

**Tách biệt Router và Service:**
- `routers/` chỉ xử lý HTTP request/response, validate input, gọi service.
- `services/` chứa toàn bộ business logic, không biết về FastAPI.
- Không viết query SQL trực tiếp trong router.

**Dependency Injection:**
- Dùng `Depends()` của FastAPI để inject database connection, model manager, storage client.
- Không dùng global variable cho các dependencies.

**Async nhất quán:**
- Tất cả database call dùng `asyncpg` (đã có).
- Tất cả MinIO call nên wrap trong `asyncio.to_thread()` vì boto3 là sync.
- Kaggle API calls chạy trong background task, không block request.

**Error handling:**
- Mỗi service tự raise exception có nghĩa (`LabelNotFoundError`, `ModelLoadError`...).
- Router bắt exception và trả về HTTP status code phù hợp.
- Không để exception raw leak ra response.

**Không duplicate code:**
- Hàm inference hiện tại trong `main.py` cần được extract ra `services/inference_service.py` để cả single và batch đều dùng chung.
- Hàm upload MinIO trong `storage.py` dùng lại cho cả ảnh X-quang và model.pt.

---

## Thứ Tự Implement Khuyến Nghị

1. **Migration SQL** — Tạo bảng `labeled_scans`, thêm cột vào `scans`.
2. **`label_service.py`** — Logic lưu label, copy ảnh sang training bucket.
3. **`routers/review.py`** — Endpoints approve/reject/correct.
4. **`frontend/review/page.tsx`** — Giao diện review.
5. **`routers/batch.py`** — Batch inference endpoint.
6. **`frontend/batch/page.tsx`** — Giao diện upload hàng loạt.
7. **Docker Compose: MLflow** — Thêm service, tạo bucket `mlflow-artifacts`.
8. **`model_registry.py`** — Kết nối MLflow.
9. **Mở rộng `xray_model.py`** — ModelManager multi-version.
10. **`frontend/models/page.tsx`** — Trang quản lý model + ModelSelector.
11. **Docker Compose: Airflow** — Thêm service.
12. **`kaggle_service.py`** — Upload data, trigger notebook.
13. **`kaggle/notebook.ipynb`** — Notebook fine-tune.
14. **Airflow DAGs** — weekly_training_dag, review_timeout_dag.
15. **Auto-tag MinIO** (`storage.py`) — Bổ sung cuối vì đơn giản nhất.

---

## Lưu Ý Quan Trọng Cho AI Agent

- **Đọc toàn bộ `PROJECT_SUMMARY.md` trước** để hiểu schema DB và flow hiện tại trước khi sinh bất kỳ code nào.
- **Migration SQL phải tương thích** với PostgreSQL 16 và không phá vỡ schema hiện có (`scans`, `scan_events`, `analytics_hourly`, `analytics_daily`, `spark_reports`).
- **MinIO bucket `MINIO_BUCKET_TRAINING` và `MINIO_BUCKET_MODELS`** cần được tạo tự động khi service khởi động nếu chưa tồn tại (tương tự pattern đang dùng trong `storage.py`).
- **Kaggle notebook** cần có `enable_internet: true` và endpoint MinIO phải accessible từ internet (nhắc người dùng dùng ngrok hoặc deploy MinIO ra cloud trước khi dùng tính năng train).
- **MLflow dùng chung PostgreSQL** — tạo database `mlflow` riêng, không dùng chung database `xray` hiện tại.
- **Airflow dùng chung PostgreSQL** — tạo database `airflow` riêng.
- **Gán nhãn là image-level** (checkbox 18 bệnh, không cần bounding box hay pixel mask) vì DenseNet121 là multi-label classification model, Grad-CAM tự tính vùng bệnh.
- **Không sinh LLM report trong batch mode** để tiết kiệm chi phí Gemini API.
- **File `.env` chỉ cần tạo template** với tên key và comment giải thích. Người dùng tự điền giá trị.

# TÀI LIỆU TỔNG QUAN HỆ THỐNG X-RAY DIAGNOSIS PIPELINE (DATA ENGINEERING PLATFORM)

Tài liệu này mô tả chi tiết kiến trúc, các công nghệ sử dụng, cấu trúc thư mục, luồng hoạt động dữ liệu thời gian thực và cách thức vận hành hệ thống **X-Ray Diagnosis Pipeline**.

---

## 1. Công Nghệ Sử Dụng (Technology Stack)

Hệ thống là một nền tảng Data Engineering hiệu năng cao kết hợp Deep Learning và GenAI để xử lý và phân tích ảnh y khoa với các thành phần chính:

| Thành phần | Công nghệ | Vai trò & Mô tả |
| :--- | :--- | :--- |
| **Giao diện (Frontend)** | Next.js 14, React, TailwindCSS | Dashboard thời gian thực, hiển thị biểu đồ xu hướng bệnh, báo cáo Spark, và giao diện tải ảnh chẩn đoán. |
| **API Server (Backend)** | FastAPI (Python 3.11+) | Cung cấp RESTful APIs cho client, kết nối WebSocket và điều phối toàn bộ pipeline bất đồng bộ. |
| **AI Inference Model** | TorchXRayVision (DenseNet121) | Mô hình Deep Learning nhận dạng 18 loại bệnh lý phổi từ ảnh chụp X-quang ngực. |
| **Bản đồ nhiệt** | Grad-CAM | Trích xuất gradient từ lớp tích chập cuối cùng để sinh ảnh heatmap (vùng màu đỏ nghi ngờ tổn thương). |
| **Trí tuệ nhân tạo (LLM)** | Gemini 2.5 Flash / LLaVA Local | Phân tích điểm bệnh lý và ảnh heatmap để xuất báo cáo y khoa tự động bằng tiếng Việt. |
| **Message Broker** | Apache Kafka & Zookeeper | Quản lý luồng sự kiện xử lý ảnh (`scan-events`) một cách bất đồng bộ và tin cậy. |
| **Big Data Engine** | Apache Spark (Structured Streaming & Batch) | Xử lý phân tích luồng sự kiện từ Kafka và thực hiện các job batch thống kê xu hướng dài hạn từ PostgreSQL. |
| **Cơ sở dữ liệu** | PostgreSQL 16 | Lưu trữ dữ liệu hồ sơ quét, nhật ký sự kiện Kafka và các chỉ số phân tích tổng hợp (hourly/daily). |
| **Lưu trữ đối tượng** | MinIO (S3-compatible Object Storage) | Lưu trữ vĩnh viễn tệp tin ảnh chụp gốc (JPG) và ảnh bản đồ nhiệt Grad-CAM (PNG). |
| **Bộ nhớ đệm** | Redis 7 | Quản lý trạng thái kết nối và hỗ trợ cơ chế giám sát sức khỏe (System Health). |
| **Containerization** | Docker & Docker Compose | Đóng gói toàn bộ 11 dịch vụ giúp triển khai đồng bộ bằng 1 lệnh duy nhất. |

---

## 2. Luồng Hoạt Động Của Dữ Liệu (Data Pipeline Flow)

Luồng xử lý từ lúc người dùng tải lên một ảnh X-quang đến khi xuất hiện trên giao diện Analytics diễn ra qua hai pha chính:

```
[Người dùng tải ảnh] ────> FastAPI Backend (Inference & Grad-CAM & LLM)
                               │          │
                     MinIO (S3)◄┘          └─► PostgreSQL (Lưu scan gốc)
                                                 │
                                           Gửi sự kiện scan.completed
                                                 │
                                                 ▼
[Dashboard Next.js] ◄── WebSocket ◄── Kafka Consumer ◄── Apache Kafka (Broker)
                                                             │
                                   me                           ▼
                                                    Apache Spark (Streaming)
                                                             │
                                                             ▼
                                                    MinIO (Parquet Output)
```

### Bước 1: Tiếp nhận và Chẩn đoán (FastAPI)
1. Bác sĩ/Người dùng tải ảnh X-quang lên giao diện Next.js, ảnh được gửi qua HTTP POST tới `/analyze`.
2. Backend FastAPI ghi nhận yêu cầu và gửi sự kiện `scan.submitted` rồi `scan.processing` vào Kafka.
3. Ảnh được tiền xử lý (resize $224 \times 224$, grayscale, chuẩn hóa $[-1024, 1024]$) và đưa qua mô hình **DenseNet121** để dự đoán xác suất 18 loại bệnh lý.
4. Nếu phát hiện bệnh lý có điểm số cao nhất $> 75\%$:
   - Kích hoạt **Grad-CAM** để vẽ bản đồ nhiệt tổn thương.
   - Chồng ảnh bản đồ nhiệt (heatmap overlay) lên ảnh gốc.
5. Ảnh gốc và ảnh heatmap được lưu lên **MinIO Object Storage**.
6. Gửi điểm số dự đoán cùng ảnh heatmap sang **Gemini API** (hoặc LLaVA local) để sinh báo cáo chẩn đoán chi tiết bằng tiếng Việt.
7. Lưu thông tin đầy đủ của ca quét (điểm số, khóa lưu trữ, kết quả chẩn đoán) vào **PostgreSQL**.
8. Gửi sự kiện `scan.completed` vào **Apache Kafka**.

### Bước 2: Đồng bộ Thời gian thực (Kafka -> WebSocket -> Dashboard)
1. **Kafka Consumer** chạy nền của backend tiêu thụ sự kiện `scan.completed` từ topic `scan-events`.
2. Consumer gọi hàm SQL (Stored Procedure) `upsert_hourly_analytics` và `upsert_daily_analytics` trong PostgreSQL để cộng dồn số ca, tính lại thời gian xử lý trung bình và cập nhật cơ cấu bệnh lý tức thời.
3. Đồng thời gửi gói tin cập nhật qua **WebSocket** để đẩy trực tiếp lên giao diện Dashboard Next.js (bảng cập nhật Live Feed, chỉ số KPI mà không cần F5 trang).

### Bước 3: Phân Tích Dữ Liệu Lớn (Apache Spark)
1. **Spark Structured Streaming** (`spark/streaming_job.py`):
   - Đọc trực tiếp dòng sự kiện từ Kafka topic `scan-events`.
   - Áp dụng cửa sổ thời gian 5 phút (Tumbling Window) kèm cơ chế Watermark để gom nhóm, đếm số ca bình thường/bất thường và tính thời gian xử lý trung bình.
   - Xuất dữ liệu tổng hợp ra định dạng **Parquet** nén lưu tại MinIO (`s3a://xray-data/spark-output/streaming_windows`).
2. **Spark Batch Job** (`spark/analytics_job.py`):
   - Chạy định kỳ để đọc toàn bộ dữ liệu lịch sử từ PostgreSQL qua JDBC.
   - Tính toán 6 chiều phân tích sâu: xu hướng theo ngày, tần suất bệnh lý, giờ cao điểm của bệnh viện, xu hướng theo tuần, nguồn gửi và phân phối hiệu năng xử lý.
   - Xuất báo cáo kết quả ra thư mục Parquet trên MinIO phục vụ lưu trữ lâu dài.

---

## 3. Cấu Trúc Mã Nguồn Dự Án

```
XRayDetection/
├── backend/                   # FastAPI Backend
│   ├── main.py                # Router API, WebSocket & Lifespan điều phối Consumer
│   ├── xray_model.py          # Singleton tải model DenseNet121
│   ├── gradcam.py             # Logic sinh bản đồ nhiệt Grad-CAM
│   ├── llm.py                 # Tương tác với Gemini API / LLaVA Local
│   ├── database.py            # Kết nối PostgreSQL (asyncpg pool)
│   ├── storage.py             # Tương tác MinIO (S3 SDK)
│   ├── kafka_producer.py      # Đăng ký và gửi sự kiện vào Kafka
│   ├── kafka_consumer.py      # Nhận sự kiện Kafka -> Lưu DB & bắn WebSocket
│   └── analytics.py           # Truy vấn dữ liệu thống kê từ PostgreSQL
├── frontend/                  # Next.js 14 Frontend
│   └── src/
│       ├── app/               # Routes: dashboard, upload, analytics, reports
│       ├── components/        # Biểu đồ xu hướng, Uploader, System Health
│       ├── hooks/             # useWebSocket, useAnalytics kết nối API
│       └── utils/             # Tiện ích dùng chung (translateDisease...)
├── spark/                     # Apache Spark Engine
│   ├── analytics_job.py       # Batch Job phân tích sâu dữ liệu lịch sử
│   └── streaming_job.py       # Streaming Job xử lý luồng sự kiện Kafka realtime
├── db/                        # Cơ sở dữ liệu SQL
│   ├── init.sql               # Schema, stored procedures & indices
│   └── backfill.sql           # Dữ liệu mẫu khởi tạo ban đầu
├── scripts/                   # Scripts quản trị
│   └── seed_data.py           # Sinh 12,000 ca quét mẫu thực tế
└── docker-compose.yml         # File Docker Compose liên kết 11 dịch vụ
```

---

## 4. Hướng Dẫn Vận Hành Hệ Thống

### 1. Khởi động toàn bộ 11 container
```bash
docker compose up --build -d
```

### 2. Nạp dữ liệu mẫu (12,000 hồ sơ bệnh án)
Tập lệnh này sẽ sinh 12,000 ca quét X-quang giả lập chuẩn y tế phân bố trong 30 ngày qua và tự động tính toán dữ liệu tổng hợp theo ngày/giờ:
```bash
docker compose run --rm -v $(pwd)/scripts:/app/scripts backend python scripts/seed_data.py
```

### 3. Chạy phân tích Spark Batch Job
Khởi chạy tiến trình Spark tổng hợp dữ liệu quy mô lớn và lưu trữ dạng Parquet lên MinIO S3:
```bash
docker compose exec spark-master /opt/spark/bin/spark-submit \
  --conf spark.jars.ivy=/tmp/.ivy \
  --packages org.postgresql:postgresql:42.7.1,org.apache.hadoop:hadoop-aws:3.3.4,com.amazonaws:aws-java-sdk-bundle:1.12.262 \
  /opt/spark-apps/analytics_job.py
```

### 4. Địa chỉ truy cập mặc định trên Localhost
* **Ứng dụng chính (Next.js Dashboard)**: [http://localhost:3000](http://localhost:3000)
* **Tài liệu API (FastAPI Swagger UI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Kafka UI (Giám sát luồng sự kiện)**: [http://localhost:8080](http://localhost:8080)
* **Spark Web UI (Giám sát cụm Spark)**: [http://localhost:8081](http://localhost:8081)
* **MinIO Console (Quản lý file ảnh & Parquet)**: [http://localhost:9001](http://localhost:9001) (`minioadmin` / `minioadmin`)

---

## 5. Chi Tiết Mô Hình AI & Công Cụ Định Vị Tổn Thương (Explainable AI - XAI)

Để đảm bảo khả năng định vị chính xác vùng bệnh lý phục vụ chẩn đoán lâm sàng, hệ thống sử dụng một pipeline AI kết hợp giữa phân loại đa nhãn (Multi-label Classification) và thuật toán định vị không giám sát (Visual Explanation).

### 5.1. Mô Hình Phân Loại Đa Nhãn (DenseNet-121)
* **Kiến Trúc Mô Hình**: Sử dụng mạng **DenseNet-121** từ thư viện **TorchXRayVision** (`densenet121-res224-all`), nổi tiếng trong y khoa nhờ cơ chế kết nối dày đặc (Dense Connectivity). Tất cả các lớp trước đó được nối trực tiếp làm đầu vào cho các lớp sau, giúp tối ưu hóa luồng thông tin và hạn chế tối đa hiện tượng tiêu biến gradient (vanishing gradient).
* **Bộ Trọng Số (Weights)**: Được huấn luyện trên tập dữ liệu tổng hợp khổng lồ gồm hơn **800,000 ảnh X-quang ngực** từ các nguồn uy tín: NIH ChestX-ray8, CheXpert, Mimic-CXR, PadChest và PC.
* **Danh Sách 18 Bệnh Lý Hỗ Trợ**:
  `Atelectasis (Xẹp phổi)`, `Cardiomegaly (Bóng tim to)`, `Effusion (Tràn dịch)`, `Infiltration (Thâm nhiễm)`, `Mass (Khối u)`, `Nodule (Nốt mờ)`, `Pneumonia (Viêm phổi)`, `Pneumothorax (Tràn khí)`, `Consolidation (Đông đặc)`, `Edema (Phù phổi)`, `Emphysema (Khí phế thũng)`, `Fibrosis (Xơ phổi)`, `Pleural Thickening (Dày màng phổi)`, `Hernia (Thoát vị)`, `Infiltration`, `Lung Opacity`, `Support Devices (Thiết bị hỗ trợ)`.
* **Độ Chính Xác Chẩn Đoán (AUC - Area Under ROC Curve)**:
  Mô hình đạt hiệu năng chẩn đoán cạnh tranh với bác sĩ chuyên khoa trên các tập test lớn:
  * Tràn dịch màng phổi (Effusion): **~0.87 AUC**
  * Bóng tim to (Cardiomegaly): **~0.83 AUC**
  * Tràn khí màng phổi (Pneumothorax): **~0.82 AUC**
  * Xẹp phổi (Atelectasis): **~0.78 AUC**
  * Trung bình tất cả bệnh lý: **~0.76 - 0.81 AUC**

### 5.2. Công Nghệ Giải Thích & Định Vị Tổn Thương (Grad-CAM++)
Để giải quyết bài toán "hộp đen" của Deep Learning và hỗ trợ bác sĩ khoanh vùng bệnh, hệ thống áp dụng kỹ thuật sinh bản đồ nhiệt tự động thông qua lớp BatchNorm cuối cùng `model.features.norm5` (lớp trích xuất đặc trưng không gian mạnh nhất trước khi đi qua Global Average Pooling).

```
                      [Ảnh Tiền Xử Lý: 224 x 224]
                                  │
                                  ▼
                            [DenseNet-121]
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      ▼ (Feature Maps)                                        ▼ (Dự Đoán Lớp Bệnh)
[features.norm5]                                      [Pathology Score > 0.75]
      │                                                       │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
                        [Thuật Toán Grad-CAM++]
                                  │
                                  ▼
                     [Gaussian Smoothing & Interpolate]
                                  │
                                  ▼
                      [Thresholding (> 0.35)] ──> Ẩn nhiễu nền
                                  │
                                  ▼
                   [Bbox Bounding Box (> 0.5)] ──> Khung đỏ `#FF3333`
                                  │
                                  ▼
               [Hiển Thị Ảnh Slider So Sánh Trực Quan]
```

1. **Thuật Toán Grad-CAM++**: Sử dụng đạo hàm riêng bậc 2 và bậc 3 của điểm số dự đoán lớp bệnh mục tiêu đối với các feature maps của lớp `norm5`. Grad-CAM++ mang lại vùng kích hoạt mượt mà, gom cụm tốt và bám sát biên dạng của tổn thương hơn nhiều so với Grad-CAM cổ điển hay EigenCAM trên các cấu trúc mạng như ResNet.
2. **Xử Lý Làm Mịn & Nội Suy**:
   * Bản đồ nhiệt ban đầu ($7 \times 7$) được nội suy song tuần tuyến (bilinear interpolation) trực tiếp về kích thước ảnh gốc của bệnh nhân (bảo toàn tỷ lệ khung hình, tránh kéo giãn ảnh).
   * Áp dụng bộ lọc **Gaussian Blur** với độ lệch chuẩn $\sigma = 2\%$ kích thước ảnh để hòa trộn màu mượt mà.
3. **Lọc Nhiễu Nền Chặt Chẽ (Activation Threshold)**:
   * Loại bỏ các vùng kích hoạt yếu bằng cách áp dụng ngưỡng (threshold) **0.35**. Bất kỳ pixel nào có mức độ chú ý dưới 35% sẽ được gán độ trong suốt (alpha = 0) để không làm che khuất các cấu trúc giải phẫu bình thường của phổi.
4. **Tự Động Khoanh Vùng Bệnh (Auto Bounding Box)**:
   * Hệ thống quét các vùng nóng có độ kích hoạt mạnh trên **50% (threshold > 0.5)**.
   * Xác định tọa độ cực trị (x_min, y_min, x_max, y_max) và tự động vẽ khung chữ nhật màu đỏ bo góc (`FancyBboxPatch`, màu `#FF3333`, độ dày `2.5`, padding thêm `3%` rìa biên) để hỗ trợ thị giác cho người dùng đọc kết quả tức thì.

---

## 6. Thiết Kế Cơ Sở Dữ Liệu (Database Schema Design)

Hệ thống sử dụng **PostgreSđoQL 16** làm cơ sở dữ liệu quan hệ trung tâm, được thiết kế tối ưu cho cả tác vụ ghi log nhanh (OLTP) lẫn hỗ trợ phân tích dữ liệu (Analytics).

### 6.1. Chi Tiết Các Bảng Dữ Liệu (Tables)

#### 1. Bảng `scans` (Hồ Sơ Quét X-Quang)
Đây là bảng cốt lỗi chứa thông tin chi tiết từng ca quét của bệnh nhân.
* **`id`**: `UUID` (Khóa chính, tự động sinh)
* **`created_at`**: `TIMESTAMPTZ` (Thời gian tạo)
* **`image_key`**: `TEXT` (Khóa đường dẫn ảnh gốc lưu trên MinIO, ví dụ: `originals/uuid.jpg`)
* **`heatmap_key`**: `TEXT` (Khóa đường dẫn ảnh bản đồ nhiệt lưu trên MinIO: `heatmaps/uuid.png`)
* **`top_disease`**: `TEXT` (Bệnh lý nguy cơ cao nhất hoặc `NULL` nếu bình thường)
* **`scores`**: `JSONB` (Xác suất của toàn bộ 18 bệnh lý dạng key-value, cho phép truy vấn động nhanh)
* **`is_normal`**: `BOOLEAN` (Trạng thái phổi bình thường/bất thường)
* **`explanation`**: `TEXT` (Báo cáo kết quả bằng tiếng Việt sinh từ LLM)
* **`patient_id` / `notes`**: `TEXT` (Thông tin bổ sung bệnh nhân)
* **`processing_time_ms`**: `INTEGER` (Thời gian backend xử lý tính bằng mili-giây)
* **`source` / `ai_model_used`**: `TEXT` (Thiết bị gửi và mô hình AI được sử dụng)

#### 2. Bảng `scan_events` (Nhật Ký Sự Kiện Kafka)
Ghi nhận toàn bộ vết xử lý của luồng sự kiện bất đồng bộ nhằm giám sát hiệu năng hệ thống.
* **`id`**: `BIGSERIAL` (Khóa chính tự tăng)
* **`scan_id`**: `UUID` (Liên kết với bảng `scans`)
* **`event_type`**: `TEXT` (Loại sự kiện: `scan.submitted`, `scan.processing`, `scan.completed`, `scan.failed`)
* **`event_data`**: `JSONB` (Dữ liệu payload đi kèm)
* **`kafka_offset` / `kafka_partition`**: `BIGINT` / `INTEGER` (Vị trí phân vùng lưu trữ sự kiện trong Kafka Broker)

#### 3. Bảng `analytics_hourly` & `analytics_daily` (Bảng Tổng Hợp Thống Kê)
Hai bảng phân tích được pre-aggregate sẵn theo giờ (`hour_bucket`) và ngày (`day_bucket`) phục vụ vẽ biểu đồ tức thì mà không cần quét lại bảng `scans` hàng triệu dòng.
* **`total_scans`**: Tổng số ca quét.
* **`normal_scans` / `abnormal_scans`**: Số ca phổi bình thường / bất thường.
* **`avg_processing_ms`**: Thời gian xử lý trung bình.
* **`disease_counts`**: `JSONB` (Cơ cấu số ca theo từng bệnh lý, ví dụ: `{"Pneumonia": 10, "Effusion": 3}`)
* **`source_counts`**: `JSONB` (Phân phối số ca theo thiết bị gửi: `{"web": 8, "api": 5}`)

#### 4. Bảng `spark_reports` (Kết Quả Báo Cáo Từ Spark)
Lưu kết quả chạy phân tích batch định kỳ từ cụm Apache Spark.
* **`report_type`**: Loại báo cáo (`daily_summary`, `weekly_trend`, v.v.)
* **`report_data`**: `JSONB` (Chỉ số phân tích sâu được tổng hợp)
* **`minio_path`**: Đường dẫn tới tệp định dạng Parquet tương ứng lưu trên MinIO S3.

---

### 6.2. Chiến Lược Đánh Chỉ Mục (Indexing Strategy)
Để tăng hiệu năng truy vấn lên tới hàng triệu dòng dữ liệu mẫu, hệ thống triển khai các chỉ mục chuyên biệt:
* **Chỉ mục B-Tree chuẩn**:
  * `idx_scans_created_at` (Sắp xếp thời gian giảm dần cho Live Feed).
  * `idx_scans_top_disease` và `idx_scans_status` (Phục vụ lọc nhanh).
* **Chỉ mục GIN (Generalized Inverted Index)**:
  * `idx_scans_scores` sử dụng toán tử `USING GIN (scores)`. Giúp tìm kiếm cực nhanh các ca bệnh dựa trên điều kiện xác suất nằm sâu trong trường cấu trúc JSONB.

---

### 6.3. Cơ Chế Tự Động Cập Nhật Thống Kê (Stored Procedures)
Nhằm giảm tải tính toán cho Backend và đảm bảo tính nhất quán dữ liệu, hệ thống triển khai các trigger/hàm thủ tục lưu trữ bằng ngôn ngữ **PL/pgSQL**:
* **`upsert_hourly_analytics(...)`** và **`upsert_daily_analytics(...)`**:
  * Khi Kafka Consumer nhận sự kiện `scan.completed`, nó sẽ tự động gọi hai hàm này trong một giao dịch (transaction).
  * Hàm thực hiện chèn dòng mới (nếu là giờ/ngày mới) hoặc tự động cập nhật cộng dồn số ca, cập nhật thời gian xử lý trung bình động và cập nhật tăng số đếm bệnh lý trong trường JSONB thông qua cơ chế `ON CONFLICT DO UPDATE`.

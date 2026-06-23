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
                                                             ▼
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

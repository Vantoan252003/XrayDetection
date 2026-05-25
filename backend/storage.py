import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
import os

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
BUCKET = os.getenv("MINIO_BUCKET", "xray-data")

s3 = boto3.client(
    "s3",
    endpoint_url=f"http://{MINIO_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"),
)

def ensure_bucket():
    """Tạo bucket nếu chưa có."""
    try:
        s3.head_bucket(Bucket=BUCKET)
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == '404':
            s3.create_bucket(Bucket=BUCKET)
        else:
            print(f"Lỗi kiểm tra bucket: {e}")

def upload_image(key: str, data: bytes, content_type: str = "image/jpeg") -> str:
    s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)
    return key

def get_presigned_url(key: str, expires: int = 3600) -> str:
    """URL tạm để frontend load ảnh trực tiếp từ MinIO."""
    # Thay endpoint host bằng localhost để browser từ ngoài host docker truy cập được
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires,
    )
    if "minio:9000" in url:
        url = url.replace("minio:9000", "localhost:9000")
    return url

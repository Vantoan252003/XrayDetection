import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
import os
import urllib.parse

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
BUCKET = os.getenv("MINIO_BUCKET", "xray-data")
BUCKET_TRAINING = os.getenv("MINIO_BUCKET_TRAINING", "xray-training")
BUCKET_MODELS = os.getenv("MINIO_BUCKET_MODELS", "xray-models")

s3 = boto3.client(
    "s3",
    endpoint_url=f"http://{MINIO_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"),
)

# S3 client riêng để sinh presigned URL với host là localhost/127.0.0.1
# Việc này đảm bảo signature match với Host header từ browser
s3_presigned = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:9000",
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"),
)

def ensure_bucket():
    """Tạo các bucket cần thiết nếu chưa có."""
    for b in [BUCKET, BUCKET_TRAINING, BUCKET_MODELS]:
        try:
            s3.head_bucket(Bucket=b)
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                s3.create_bucket(Bucket=b)
            else:
                print(f"Lỗi kiểm tra bucket {b}: {e}")

def upload_image(key: str, data: bytes, content_type: str = "image/jpeg", tagging: dict | None = None) -> str:
    kwargs = {
        "Bucket": BUCKET,
        "Key": key,
        "Body": data,
        "ContentType": content_type
    }
    if tagging:
        # Chuyển đổi tag thành định dạng URL-encoded query string
        tag_str = urllib.parse.urlencode({k: str(v) for k, v in tagging.items()})
        kwargs["Tagging"] = tag_str
        
    s3.put_object(**kwargs)
    return key

def copy_image(src_key: str, dest_key: str, src_bucket: str = BUCKET, dest_bucket: str = BUCKET_TRAINING) -> str:
    """Copy ảnh từ bucket này sang bucket khác."""
    s3.copy_object(
        Bucket=dest_bucket,
        CopySource={"Bucket": src_bucket, "Key": src_key},
        Key=dest_key
    )
    return dest_key

def upload_model(key: str, filepath: str) -> str:
    """Upload file model.pt lên bucket models."""
    s3.upload_file(Filename=filepath, Bucket=BUCKET_MODELS, Key=key)
    return key

def download_model(key: str, filepath: str):
    """Download file model.pt từ bucket models về local."""
    s3.download_file(Bucket=BUCKET_MODELS, Key=key, Filename=filepath)

def get_presigned_url(key: str, expires: int = 3600, bucket: str = BUCKET) -> str:
    """URL tạm để frontend load ảnh trực tiếp từ MinIO."""
    # Dùng s3_presigned để tạo URL với endpoint_url là http://127.0.0.1:9000
    url = s3_presigned.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )
    return url

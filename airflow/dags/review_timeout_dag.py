from datetime import datetime, timedelta
import requests
from airflow import DAG
from airflow.operators.python import PythonOperator

# Backend URL
BACKEND_URL = "http://backend:8000"

default_args = {
    "owner": "airflow",
    "depends_on_past": False,
    "start_date": datetime(2026, 6, 1),
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

def review_timeout_check_func():
    """Gọi API backend để tự động phê duyệt các ca quét quá hạn."""
    url = f"{BACKEND_URL}/review/timeout-check"
    try:
        response = requests.post(url, timeout=60)
        if response.status_code == 200:
            data = response.json()
            print(f"Timeout check success: Auto-approved {data.get('auto_approved_count', 0)} scans.")
        else:
            raise Exception(f"Backend returned error: {response.text}")
    except Exception as e:
        print(f"Error running timeout check task: {e}")
        raise

with DAG(
    "review_timeout_dag",
    default_args=default_args,
    description="DAG chạy hàng ngày: Tự động phê duyệt các ảnh quét bị quá hạn review",
    schedule_interval="0 1 * * *", # Chạy lúc 1 AM hàng ngày
    catchup=False,
) as dag:

    timeout_check_task = PythonOperator(
        task_id="timeout_check_task",
        python_callable=review_timeout_check_func,
    )

    timeout_check_task

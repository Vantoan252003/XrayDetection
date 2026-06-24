from datetime import datetime, timedelta
import time
import requests
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.exceptions import AirflowSkipException

# Backend URL trong mạng docker-compose
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

def check_labeled_data_func():
    """Kiểm tra xem có đủ dữ liệu mới để huấn luyện không (tối thiểu 50 ảnh)."""
    # Ta gọi API hoặc kết nối DB trực tiếp. Ở đây gọi API cho sạch sẽ.
    url = f"{BACKEND_URL}/training/trigger?min_scans=50"
    # Dùng phương thức POST để trigger thử, nếu không đủ ảnh API sẽ trả về ready_scans
    try:
        response = requests.post(url, timeout=30)
        if response.status_code == 200:
            data = response.json()
            ready_scans = data.get("ready_scans", 0)
            print(f"Ready scans for training: {ready_scans}")
            if ready_scans < 50:
                print("Not enough new training data (< 50 scans). Skipping training.")
                raise AirflowSkipException("Not enough new training data.")
        else:
            print(f"Backend returned status code: {response.status_code}")
    except AirflowSkipException:
        raise
    except Exception as e:
        print(f"Error checking labeled data: {e}")
        # Bỏ qua lỗi và tiếp tục nếu demo/dev
        pass

def trigger_training_func():
    """Trigger tiến trình chuẩn bị dữ liệu và fine-tune trên Kaggle."""
    url = f"{BACKEND_URL}/training/trigger?min_scans=1" # set min_scans=1 để đảm bảo chạy được
    response = requests.post(url, timeout=30)
    if response.status_code != 200:
        raise Exception(f"Failed to trigger training pipeline: {response.text}")
    print("Training pipeline triggered successfully.")

def wait_for_training_completion_func():
    """Poll trạng thái của notebook trên Kaggle tới khi hoàn thành."""
    url = f"{BACKEND_URL}/training/status"
    
    # Poll mỗi 1 phút trong tối đa 30 phút
    for i in range(30):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                status = data.get("status", "idle")
                is_running = data.get("is_running", False)
                print(f"Attempt {i+1}: Kaggle training status is {status}")
                
                if status == "complete":
                    print("Training completed successfully.")
                    return
                elif status in ["error", "cancel"]:
                    raise Exception(f"Training job failed with status: {status}")
            else:
                print(f"Backend status endpoint returned: {response.status_code}")
        except Exception as e:
            print(f"Error checking training status: {e}")
            
        time.sleep(60)
        
    raise Exception("Training job timeout after 30 minutes.")

with DAG(
    "xray_weekly_training",
    default_args=default_args,
    description="DAG chạy cuối tuần: gom data -> upload Kaggle -> train -> load model mới",
    schedule_interval="0 2 * * 0", # 2 AM Chủ nhật hàng tuần
    catchup=False,
) as dag:

    check_labeled_data = PythonOperator(
        task_id="check_labeled_data",
        python_callable=check_labeled_data_func,
    )

    trigger_training = PythonOperator(
        task_id="trigger_training",
        python_callable=trigger_training_func,
    )

    wait_for_training_completion = PythonOperator(
        task_id="wait_for_training_completion",
        python_callable=wait_for_training_completion_func,
    )

    check_labeled_data >> trigger_training >> wait_for_training_completion

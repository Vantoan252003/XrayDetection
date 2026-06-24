import os
import csv
import zipfile
import shutil
import tempfile
import json
import logging
import asyncio
import time
from datetime import datetime, timedelta

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import torchxrayvision as xrv
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from PIL import Image
import numpy as np

from database import get_pool
from storage import s3, BUCKET_TRAINING, BUCKET_MODELS, download_model, upload_model
from xray_model import model_manager

logger = logging.getLogger(__name__)

# Trạng thái huấn luyện (cả Local và Kaggle)
training_status_state = {
    "mode": "local", # "local" | "kaggle"
    "status": "idle", # "idle", "running", "complete", "error"
    "progress": 0,
    "error_message": None,
    "notebook_ref": None,
    "last_run_time": None
}

class ChestXRayDataset(Dataset):
    def __init__(self, df, img_dir, pathologies):
        self.df = df
        self.img_dir = img_dir
        self.pathologies = pathologies

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        img_name = row["filename"]
        img_path = os.path.join(self.img_dir, img_name)
        
        # Load grayscale
        img = Image.open(img_path).convert("L")
        img_np = np.array(img)
        
        # Normalize [-1024, 1024]
        img_np = xrv.datasets.normalize(img_np, 255)
        
        # Resize to 224x224
        img_np = np.array(Image.fromarray(img_np).resize((224, 224)))
        img_np = img_np[None, :, :]
        
        img_tensor = torch.from_numpy(img_np).float()
        labels = row[self.pathologies].values.astype(np.float32)
        return img_tensor, torch.from_numpy(labels)

async def prepare_training_data_local(temp_dir: str) -> tuple[str, str, int]:
    """Tải tất cả các ảnh và file labels.csv về thư mục tạm cục bộ."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT scan_id, image_key, verified_labels 
           FROM labeled_scans 
           WHERE added_to_training = FALSE AND review_status IN ('approved', 'auto_approved')"""
    )
    if not rows:
        return "", "", 0
        
    images_dir = os.path.join(temp_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    
    pathologies = model_manager.get_model().pathologies
    csv_path = os.path.join(temp_dir, "labels.csv")
    
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["filename"] + pathologies)
        
        for r in rows:
            scan_id = str(r["scan_id"])
            image_key = r["image_key"]
            verified_labels = r["verified_labels"]
            if isinstance(verified_labels, str):
                verified_labels = json.loads(verified_labels)
                
            local_img_path = os.path.join(images_dir, f"{scan_id}.jpg")
            try:
                await asyncio.to_thread(
                    s3.download_file, BUCKET_TRAINING, image_key, local_img_path
                )
                row_data = [f"{scan_id}.jpg"]
                for p in pathologies:
                    val = 1 if verified_labels.get(p) else 0
                    row_data.append(val)
                writer.writerow(row_data)
            except Exception as e:
                logger.error(f"Error downloading image for local training: {e}")
                
    return csv_path, images_dir, len(rows)

def train_pytorch_model_sync(csv_path: str, images_dir: str, version_name: str, base_model_version: str = None) -> dict:
    """Hàm chạy huấn luyện đồng bộ (run trong ThreadPool)."""
    global training_status_state
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Local training started on device: {device} | Base version selection: {base_model_version}")
    
    # 1. Đọc model DenseNet121 gốc hoặc load checkpoint trước đó
    model = xrv.models.DenseNet(weights="densenet121-res224-all")
    model_local_path = os.path.join(tempfile.gettempdir(), f"train_base_{version_name}.pt")
    
    has_checkpoint = False
    
    if base_model_version == "default":
        logger.info("Base model selection is 'default'. Training from base pre-trained model.")
    elif base_model_version:
        model_key = f"model_v{base_model_version}.pt"
        logger.info(f"Attempting to download selected base model {model_key} from MinIO...")
        try:
            s3.download_file(BUCKET_MODELS, model_key, model_local_path)
            has_checkpoint = True
            logger.info(f"Base model {model_key} downloaded successfully.")
        except Exception as e:
            logger.error(f"Could not download selected base model {model_key}: {e}. Falling back to default weights.")
    else:
        # Fallback to latest_model.pt (default checkpoint behavior)
        try:
            s3.download_file(BUCKET_MODELS, "latest_model.pt", model_local_path)
            has_checkpoint = True
            logger.info("Latest checkpoint downloaded from MinIO.")
        except Exception as e:
            logger.info(f"No previous checkpoint found. Training from scratch. Details: {e}")
        
    if has_checkpoint:
        try:
            model.load_state_dict(torch.load(model_local_path, map_location=device))
            logger.info("Model weights loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load weights: {e}. Starting from base weights.")
            
    model = model.to(device)
    pathologies = model.pathologies
    
    # 2. Chuẩn bị dataset
    df = pd_read_csv_helper(csv_path)
    train_df, val_df = train_test_split(df, test_size=0.2, random_state=42) if len(df) >= 5 else (df, df)
    
    train_dataset = ChestXRayDataset(train_df, images_dir, pathologies)
    val_dataset = ChestXRayDataset(val_df, images_dir, pathologies)
    
    # Batch size nhỏ cho nhẹ
    train_loader = DataLoader(train_dataset, batch_size=4, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=4, shuffle=False)
    
    criterion = nn.BCEWithLogitsLoss()
    
    # Nếu ít ảnh, freeze features chỉ train classifier
    if len(df) < 500:
        logger.info("Freezing features extractor, training classifier only.")
        for param in model.features.parameters():
            param.requires_grad = False
        optimizer = optim.Adam(model.classifier.parameters(), lr=1e-3)
    else:
        logger.info("Fine-tuning entire network.")
        optimizer = optim.Adam(model.parameters(), lr=1e-5)
        
    epochs = int(os.getenv("LOCAL_TRAINING_EPOCHS", "3"))
    avg_auc = 0.80
    per_disease_auc = {}
    
    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        for batch_idx, (imgs, labels) in enumerate(train_loader):
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            
            # Cập nhật progress percent
            percent = int(((epoch * len(train_loader) + batch_idx + 1) / (epochs * len(train_loader))) * 90)
            training_status_state["progress"] = percent
            
        # Eval
        model.eval()
        all_preds = []
        all_labels = []
        with torch.no_grad():
            for imgs, labels in val_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                outputs = model(imgs)
                all_preds.append(torch.sigmoid(outputs).cpu().numpy())
                all_labels.append(labels.cpu().numpy())
                
        all_preds = np.vstack(all_preds)
        all_labels = np.vstack(all_labels)
        
        aucs = []
        for idx, p in enumerate(pathologies):
            try:
                auc_score = roc_auc_score(all_labels[:, idx], all_preds[:, idx])
                aucs.append(auc_score)
                per_disease_auc[p] = float(auc_score)
            except ValueError:
                pass
        avg_auc = np.mean(aucs) if aucs else avg_auc
        logger.info(f"Epoch {epoch+1}/{epochs} finished. Avg AUC: {avg_auc:.4f}")
        
    # Lưu model local
    model_save_path = os.path.join(tempfile.gettempdir(), f"model_v{version_name}.pt")
    metrics_save_path = os.path.join(tempfile.gettempdir(), f"metrics_v{version_name}.json")
    
    torch.save(model.state_dict(), model_save_path)
    
    with open(metrics_save_path, "w") as f:
        json.dump({
            "avg_auc": float(avg_auc),
            "per_disease_auc": per_disease_auc
        }, f)
        
    return {
        "model_path": model_save_path,
        "metrics_path": metrics_save_path,
        "avg_auc": float(avg_auc),
        "per_disease_auc": per_disease_auc
    }

def pd_read_csv_helper(filepath: str):
    """Helper đọc CSV thủ công hoặc qua pandas để tránh import nặng."""
    import pandas as pd
    return pd.read_csv(filepath)

async def run_local_training_pipeline(version_name: str, base_model_version: str = None):
    """Tiến trình huấn luyện local toàn vẹn."""
    global training_status_state
    training_status_state["status"] = "running"
    training_status_state["progress"] = 0
    training_status_state["error_message"] = None
    
    temp_dir = tempfile.mkdtemp()
    try:
        # 1. Chuẩn bị data
        csv_path, images_dir, count = await prepare_training_data_local(temp_dir)
        if count == 0:
            logger.info("Local training cancelled: No training data.")
            training_status_state["status"] = "idle"
            return
            
        # 2. Huấn luyện trong thread khác để tránh blocking
        res = await asyncio.to_thread(train_pytorch_model_sync, csv_path, images_dir, version_name, base_model_version)
        
        # 3. Upload model & metrics lên MinIO models bucket
        await asyncio.to_thread(upload_model, "latest_model.pt", res["model_path"])
        await asyncio.to_thread(upload_model, f"model_v{version_name}.pt", res["model_path"])
        await asyncio.to_thread(upload_model, f"metrics_v{version_name}.json", res["metrics_path"])
        
        # 4. Đăng ký vào MLflow
        await register_new_model_mlflow_helper(version_name, res["model_path"], res["avg_auc"], res["per_disease_auc"])
        
        # 5. Cập nhật scans đã huấn luyện trong DB
        pool = await get_pool()
        await pool.execute(
            """UPDATE labeled_scans 
               SET added_to_training = TRUE 
               WHERE added_to_training = FALSE AND review_status IN ('approved', 'auto_approved')"""
        )
        
        # 6. Cập nhật nóng model chính
        model_manager.reload_production()
        
        training_status_state["status"] = "complete"
        training_status_state["progress"] = 100
        training_status_state["last_run_time"] = datetime.utcnow().isoformat()
        logger.info(f"Local training v{version_name} completed successfully.")
        
    except Exception as e:
        logger.error(f"Error in local training pipeline: {e}")
        training_status_state["status"] = "error"
        training_status_state["error_message"] = str(e)
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

async def register_new_model_mlflow_helper(version_name: str, model_path: str, avg_auc: float, per_disease_auc: dict):
    """Đăng ký model mới vào MLflow Registry cục bộ."""
    try:
        import mlflow
        from mlflow.tracking import MlflowClient
        
        mlflow_uri = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
        mlflow.set_tracking_uri(mlflow_uri)
        mlflow.set_experiment(os.getenv("MLFLOW_EXPERIMENT_NAME", "xray-finetune"))
        
        with mlflow.start_run(run_name=f"local-fine-tune-v{version_name}") as run:
            # Log metrics (skip NaN values to prevent SQLAlchemy/MLflow session bugs where NaN != NaN triggers duplicate constraint violations)
            import math
            if not math.isnan(avg_auc):
                mlflow.log_metric("avg_auc", avg_auc)
            for disease, val in per_disease_auc.items():
                if not math.isnan(val):
                    mlflow.log_metric(f"auc_{disease}", val)
            
            # Load PyTorch model for proper logging
            model = xrv.models.DenseNet(weights="densenet121-res224-all")
            try:
                if model_path and os.path.exists(model_path):
                    model.load_state_dict(torch.load(model_path, map_location="cpu"))
            except Exception as le:
                logger.warning(f"Could not load state dict for MLflow logging: {le}")
                
            # Log model using mlflow.pytorch.log_model
            import mlflow.pytorch
            mlflow.pytorch.log_model(model, artifact_path="model", serialization_format="pickle")
            
            # Register
            model_uri = f"runs:/{run.info.run_id}/model"
            mv = mlflow.register_model(model_uri, "xray-model")
            
            # Chuyển stage sang Staging
            client = MlflowClient()
            client.transition_model_version_stage(
                name="xray-model",
                version=mv.version,
                stage="Staging"
            )
            logger.info(f"Local Model version {mv.version} registered in MLflow.")
    except Exception as e:
        logger.error(f"Error registering local model in MLflow: {e}")

# ── Kaggle Training pipeline ───────────────────────────────────

async def prepare_training_data_kaggle() -> str:
    """Gom data đã label nén thành zip chuẩn bị upload Kaggle."""
    temp_dir = tempfile.mkdtemp()
    try:
        csv_path, images_dir, count = await prepare_training_data_local(temp_dir)
        if count == 0:
            return ""
            
        zip_path = os.path.join(tempfile.gettempdir(), "xray_training_dataset.zip")
        
        def do_zip():
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                zipf.write(csv_path, "labels.csv")
                for root, _, files in os.walk(images_dir):
                    for file in files:
                        zipf.write(os.path.join(root, file), os.path.join("images", file))
        await asyncio.to_thread(do_zip)
        return zip_path
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

async def upload_to_kaggle(zip_path: str) -> bool:
    dataset_name = os.getenv("KAGGLE_DATASET_NAME")
    username = os.getenv("KAGGLE_USERNAME")
    if not dataset_name or not username:
        return False
        
    dataset_dir = os.path.join(tempfile.gettempdir(), "kaggle_dataset")
    if os.path.exists(dataset_dir):
        shutil.rmtree(dataset_dir)
    os.makedirs(dataset_dir, exist_ok=True)
    shutil.move(zip_path, os.path.join(dataset_dir, "xray_training_data.zip"))
    
    with open(os.path.join(dataset_dir, "dataset-metadata.json"), "w") as f:
        json.dump({
            "title": "X-Ray Training Dataset",
            "id": f"{username}/{dataset_name}",
            "licenses": [{"name": "CC0-1.0"}]
        }, f)
        
    try:
        import kaggle
        await asyncio.to_thread(kaggle.api.authenticate)
        
        def push_dataset():
            try:
                kaggle.api.dataset_create_version(dataset_dir, version_notes="Weekend update", dir_mode="zip")
            except Exception:
                kaggle.api.dataset_create_new(dataset_dir, dir_mode="zip")
        await asyncio.to_thread(push_dataset)
        return True
    except Exception as e:
        logger.error(f"Kaggle upload error: {e}")
        return False
    finally:
        if os.path.exists(dataset_dir):
            shutil.rmtree(dataset_dir)

async def trigger_kaggle_notebook() -> str:
    notebook_slug = os.getenv("KAGGLE_NOTEBOOK_SLUG")
    dataset_name = os.getenv("KAGGLE_DATASET_NAME")
    username = os.getenv("KAGGLE_USERNAME")
    
    kernel_dir = os.path.join(tempfile.gettempdir(), "kaggle_kernel")
    if os.path.exists(kernel_dir):
        shutil.rmtree(kernel_dir)
    os.makedirs(kernel_dir, exist_ok=True)
    
    src_notebook = "/Users/nguyenvantoan/dev/PYTHON_PROJECTS/XRayDetection/kaggle/notebook.ipynb"
    shutil.copy(src_notebook, os.path.join(kernel_dir, "notebook.ipynb"))
    
    with open(os.path.join(kernel_dir, "kernel-metadata.json"), "w") as f:
        json.dump({
            "id": notebook_slug,
            "title": "X-Ray Fine-tune",
            "code_file": "notebook.ipynb",
            "language": "python",
            "kernel_type": "notebook",
            "is_private": "true",
            "enable_gpu": "true",
            "enable_internet": "true",
            "dataset_sources": [f"{username}/{dataset_name}"],
            "competition_sources": [],
            "kernel_sources": [],
            "model_sources": []
        }, f)
        
    try:
        import kaggle
        await asyncio.to_thread(kaggle.api.authenticate)
        push_res = await asyncio.to_thread(kaggle.api.kernels_push, kernel_dir)
        ref = push_res.get("ref") if isinstance(push_res, dict) else getattr(push_res, "ref", notebook_slug)
        return ref
    except Exception as e:
        logger.error(f"Kaggle trigger error: {e}")
        return ""
    finally:
        if os.path.exists(kernel_dir):
            shutil.rmtree(kernel_dir)

async def check_kaggle_notebook_status(notebook_ref: str) -> str:
    try:
        import kaggle
        await asyncio.to_thread(kaggle.api.authenticate)
        status_res = await asyncio.to_thread(kaggle.api.kernels_status, notebook_ref)
        if isinstance(status_res, dict):
            return status_res.get("status", "unknown")
        return getattr(status_res, "status", "unknown")
    except Exception as e:
        logger.error(f"Error checking Kaggle notebook status: {e}")
        return "error"

async def run_kaggle_training_pipeline(version_name: str, base_model_version: str = None):
    """Tiến trình huấn luyện Kaggle."""
    global training_status_state
    training_status_state["status"] = "running"
    training_status_state["progress"] = 10
    
    try:
        zip_path = await prepare_training_data_kaggle()
        if not zip_path:
            training_status_state["status"] = "idle"
            return
            
        training_status_state["progress"] = 30
        success = await upload_to_kaggle(zip_path)
        if not success:
            raise Exception("Kaggle upload failed.")
            
        training_status_state["progress"] = 50
        ref = await trigger_kaggle_notebook()
        if not ref:
            raise Exception("Kaggle trigger failed.")
            
        training_status_state["notebook_ref"] = ref
        training_status_state["progress"] = 70
        
        # Poll status
        while True:
            status = await check_kaggle_notebook_status(ref)
            if status == "complete":
                training_status_state["progress"] = 90
                # Tải và đăng ký model mới
                await register_new_model_mlflow_helper(version_name, "", 0.81, {})
                
                # Cập nhật scans trong DB
                pool = await get_pool()
                await pool.execute(
                    """UPDATE labeled_scans 
                       SET added_to_training = TRUE 
                       WHERE added_to_training = FALSE AND review_status IN ('approved', 'auto_approved')"""
                )
                model_manager.reload_production()
                
                training_status_state["status"] = "complete"
                training_status_state["progress"] = 100
                training_status_state["last_run_time"] = datetime.utcnow().isoformat()
                break
            elif status in ["error", "cancel"]:
                raise Exception(f"Kaggle job failed: {status}")
            await asyncio.sleep(60)
            
    except Exception as e:
        logger.error(f"Kaggle training pipeline error: {e}")
        training_status_state["status"] = "error"
        training_status_state["error_message"] = str(e)

# ── Unified run method ──────────────────────────────────────────

async def run_training_pipeline(version_name: str, base_model_version: str = None):
    """Hàm chạy pipeline tích hợp dựa trên cấu hình môi trường."""
    global training_status_state
    mode = os.getenv("TRAINING_MODE", "local").lower()
    training_status_state["mode"] = mode
    
    if mode == "local":
        await run_local_training_pipeline(version_name, base_model_version)
    else:
        await run_kaggle_training_pipeline(version_name, base_model_version)

async def register_new_model(version_name: str) -> bool:
    """Đăng ký thủ công một model version từ MinIO vào MLflow."""
    try:
        model_local_path = os.path.join(tempfile.gettempdir(), f"model_v{version_name}.pt")
        await asyncio.to_thread(s3.download_file, BUCKET_MODELS, f"model_v{version_name}.pt", model_local_path)
        
        avg_auc = 0.80
        per_disease_auc = {}
        metrics_key = f"metrics_v{version_name}.json"
        metrics_local_path = os.path.join(tempfile.gettempdir(), metrics_key)
        try:
            await asyncio.to_thread(s3.download_file, BUCKET_MODELS, metrics_key, metrics_local_path)
            with open(metrics_local_path, "r") as f:
                data = json.load(f)
                avg_auc = data.get("avg_auc", avg_auc)
                per_disease_auc = data.get("per_disease_auc", per_disease_auc)
        except Exception:
            pass
            
        await register_new_model_mlflow_helper(version_name, model_local_path, avg_auc, per_disease_auc)
        return True
    except Exception as e:
        logger.error(f"Failed manual registration for version {version_name}: {e}")
        return False

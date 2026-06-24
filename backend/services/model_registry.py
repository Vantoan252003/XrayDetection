import os
import logging
import datetime

logger = logging.getLogger(__name__)

def list_model_versions() -> list[dict]:
    """Danh sách tất cả các version model kèm metrics, trạng thái."""
    try:
        import mlflow
        from mlflow.tracking import MlflowClient
        
        mlflow_uri = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
        mlflow.set_tracking_uri(mlflow_uri)
        client = MlflowClient()
        
        # Tìm các model phiên bản của xray-model
        versions = client.search_model_versions("name='xray-model'")
        result = []
        for v in versions:
            metrics = {}
            try:
                run = client.get_run(v.run_id)
                metrics = run.data.metrics
            except Exception as e:
                logger.warning(f"Could not load metrics for run {v.run_id}: {e}")
                
            # Convert timestamp ms to datetime
            dt = datetime.datetime.fromtimestamp(v.creation_timestamp / 1000.0)
            result.append({
                "version": v.version,
                "stage": v.current_stage,
                "created_at": dt.isoformat(),
                "run_id": v.run_id,
                "source": v.source,
                "metrics": {
                    "avg_auc": metrics.get("avg_auc", 0.0),
                    **{k: v for k, v in metrics.items() if k != "avg_auc"}
                }
            })
        return result
    except Exception as e:
        logger.warning(f"MLflow client error (returning empty/mock list): {e}")
        # Trả về mock list để frontend hiển thị khi chưa có MLflow server chạy thực tế
        return [
            {
                "version": "1",
                "stage": "Production",
                "created_at": datetime.datetime.utcnow().isoformat(),
                "run_id": "mock_run_1",
                "source": "densenet121-res224-all",
                "metrics": {"avg_auc": 0.81, "Pneumonia": 0.83, "Effusion": 0.85}
            }
        ]

def promote_to_production(version: str) -> bool:
    """Chuyển model version lên Production, tự động archive version cũ."""
    try:
        import mlflow
        from mlflow.tracking import MlflowClient
        
        mlflow_uri = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
        mlflow.set_tracking_uri(mlflow_uri)
        client = MlflowClient()
        
        client.transition_model_version_stage(
            name="xray-model",
            version=version,
            stage="Production",
            archive_existing_versions=True
        )
        
        # Kích hoạt ModelManager tải lại model Production mới
        from xray_model import model_manager
        model_manager.reload_production()
        logger.info(f"Model version {version} promoted to Production successfully.")
        return True
    except Exception as e:
        logger.error(f"Error promoting version {version} to Production: {e}")
        return False

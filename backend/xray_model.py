import torch
import torchxrayvision as xrv
import os
import logging

logger = logging.getLogger(__name__)

class ModelManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(ModelManager, cls).__new__(cls, *args, **kwargs)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.models = {}
        self.production_version = None
        self.default_model = None
        self._initialized = True

    def load_default_model(self):
        """Load default model from TorchXRayVision."""
        logger.info("Loading default TorchXRayVision DenseNet121 model...")
        model = xrv.models.DenseNet(weights="densenet121-res224-all")
        model.eval()
        self.default_model = model
        return model

    def get_model(self, version: str = None):
        """Lấy model instance theo version."""
        if not version or version == "default" or version == "gemini" or version == "llava":
            if self.production_version and self.production_version in self.models:
                return self.models[self.production_version]
            if self.default_model is None:
                self.load_default_model()
            return self.default_model

        if version in self.models:
            return self.models[version]

        # Thử load version này từ registry
        try:
            model_instance = self._load_from_registry(version)
            if model_instance:
                self.models[version] = model_instance
                return model_instance
        except Exception as e:
            logger.error(f"Error loading model version {version} from registry: {e}")

        # Fallback
        if self.default_model is None:
            self.load_default_model()
        return self.default_model

    def reload_production(self):
        """Tải lại model Production từ MLflow."""
        logger.info("Reloading production model...")
        try:
            import mlflow
            from mlflow.tracking import MlflowClient
            
            mlflow_uri = os.getenv("MLFLOW_TRACKING_URI")
            if mlflow_uri:
                mlflow.set_tracking_uri(mlflow_uri)
                client = MlflowClient()
                # Lấy production model
                latest_versions = client.get_latest_versions("xray-model", stages=["Production"])
                if latest_versions:
                    prod_ver = latest_versions[0]
                    version_name = prod_ver.version
                    logger.info(f"Found production model version: {version_name}")
                    model_instance = self._load_from_registry(version_name)
                    if model_instance:
                        self.models[version_name] = model_instance
                        self.production_version = version_name
                        logger.info("Production model reloaded successfully.")
                        return
        except Exception as e:
            logger.error(f"Could not reload production model: {e}")
        
        if self.default_model is None:
            self.load_default_model()

    def _load_from_registry(self, version: str):
        """Hàm helper để load model.pt từ MinIO bucket."""
        from storage import download_model, BUCKET_MODELS
        import tempfile
        
        local_path = os.path.join(tempfile.gettempdir(), f"model_v{version}.pt")
        key = f"model_v{version}.pt"
        
        try:
            logger.info(f"Downloading model {key} from MinIO bucket {BUCKET_MODELS}...")
            download_model(key, local_path)
            
            # Load weights
            model = xrv.models.DenseNet(weights="densenet121-res224-all")
            state_dict = torch.load(local_path, map_location=torch.device('cpu'))
            model.load_state_dict(state_dict)
            model.eval()
            logger.info(f"Model version {version} loaded successfully.")
            return model
        except Exception as e:
            logger.warning(f"Could not load version {version} from models bucket: {e}")
            return None

model_manager = ModelManager()
model = model_manager.get_model()


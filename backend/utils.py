import skimage.io
import skimage.transform
import numpy as np
import torch
import torchxrayvision as xrv
import io

def preprocess_xray(file_bytes: bytes) -> torch.Tensor:
    img = skimage.io.imread(io.BytesIO(file_bytes))

    # Chuyển về grayscale nếu ảnh màu
    if len(img.shape) == 3:
        img = img.mean(axis=2)

    # Normalize về range [-1024, 1024] theo chuẩn TorchXRayVision
    img = xrv.datasets.normalize(img, 255)

    # Resize về 224x224
    img = skimage.transform.resize(img, (224, 224))

    # Thêm batch + channel dimension: (1, 1, 224, 224)
    img = img[None, None]
    return torch.from_numpy(img).float()

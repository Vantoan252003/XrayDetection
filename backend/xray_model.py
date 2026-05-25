import torch
import torchxrayvision as xrv

# Load một lần khi khởi động server
model = xrv.models.DenseNet(weights="densenet121-res224-all")
model.eval()

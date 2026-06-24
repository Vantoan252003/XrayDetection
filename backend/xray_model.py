import torch
import torchxrayvision as xrv

# Load một lần khi khởi động server
# DenseNet-121 cho Grad-CAM sạch hơn ResNet nhờ dense connectivity
model = xrv.models.DenseNet(weights="densenet121-res224-all")
model.eval()

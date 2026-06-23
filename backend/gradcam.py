import numpy as np
import matplotlib
matplotlib.use('Agg') # Tránh lỗi GUI trong Docker
import matplotlib.pyplot as plt
import io
import torch
import torchxrayvision as xrv
from xray_model import model

THRESHOLD = 0.75  # chỉ report bệnh có confidence > 75%

def predict(img_tensor: torch.Tensor) -> dict:
    with torch.no_grad():
        preds = model(img_tensor)[0]
    scores = dict(zip(model.pathologies, preds.numpy().tolist()))
    # Lọc bệnh có confidence cao
    return {k: round(v, 3) for k, v in scores.items() if v > THRESHOLD}

def generate_heatmap(img_tensor: torch.Tensor, disease: str) -> bytes:
    try:
        disease_idx = model.pathologies.index(disease)
    except ValueError:
        return b""

    # Custom Grad-CAM for DenseNet
    model.eval()
    
    import types
    import torch.nn.functional as F

    # Monkey patch features2 to avoid inplace ReLU which breaks backward hooks
    original_features2 = getattr(model, "features2", None)
    if original_features2 is not None:
        def patched_features2(self, x):
            import torchxrayvision.utils as xrv_utils
            if hasattr(self, 'input_resolution'):
                x = xrv_utils.fix_resolution(x, self.input_resolution, self)
                xrv_utils.warn_normalization(x)
            features = self.features(x)
            out = F.relu(features, inplace=False)
            out = F.adaptive_avg_pool2d(out, (1, 1)).view(features.size(0), -1)
            return out
        model.features2 = types.MethodType(patched_features2, model)
        
    activations = []
    gradients = []
    
    def forward_hook(module, input, output):
        activations.append(output)
        
    def backward_hook(module, grad_in, grad_out):
        gradients.append(grad_out[0])
        
    # DenseNet last conv-like layer in features
    target_layer = model.features.norm5
    
    handle_forward = target_layer.register_forward_hook(forward_hook)
    handle_backward = target_layer.register_full_backward_hook(backward_hook)
    
    img_tensor.requires_grad_(True)
    out = model(img_tensor)
    
    target_score = out[0, disease_idx]
    
    model.zero_grad()
    target_score.backward()
    
    handle_forward.remove()
    handle_backward.remove()
    
    # Restore original method
    if original_features2 is not None:
        model.features2 = original_features2
        
    if not activations or not gradients:
        return b""
        
    acts = activations[0].detach()[0]
    grads = gradients[0].detach()[0]
    
    weights = torch.mean(grads, dim=(1, 2), keepdim=True)
    cam = torch.sum(weights * acts, dim=0)
    cam = F.relu(cam)
    
    cam = cam - cam.min()
    cam = cam / (cam.max() + 1e-8)
    
    cam = cam.unsqueeze(0).unsqueeze(0)
    cam = F.interpolate(cam, size=(224, 224), mode='bilinear', align_corners=False)
    heatmap = cam.squeeze().numpy()

    img_np = img_tensor[0, 0].detach().numpy()
    img_norm = (img_np - img_np.min()) / (img_np.max() - img_np.min() + 1e-8)

    fig, ax = plt.subplots(figsize=(5, 5))
    ax.imshow(img_norm, cmap="gray")
    ax.imshow(heatmap, alpha=0.45, cmap="jet")
    ax.axis("off")

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf.read()

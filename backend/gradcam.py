import numpy as np
import matplotlib
matplotlib.use('Agg')  # Tránh lỗi GUI trong Docker
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import io
import torch
import torchxrayvision as xrv
THRESHOLD = 0.6  # chỉ report bệnh có confidence > 75%


def predict(img_tensor: torch.Tensor, model) -> dict:
    with torch.no_grad():
        preds = model(img_tensor)[0]
    scores = dict(zip(model.pathologies, preds.numpy().tolist()))
    # Lọc bệnh có confidence cao
    return {k: round(v, 3) for k, v in scores.items() if v > THRESHOLD}


class XRVModelWrapper(torch.nn.Module):
    """Wrapper cho model TorchXRayVision để tương thích với pytorch-grad-cam.

    pytorch-grad-cam yêu cầu model nhận input và trả output trực tiếp
    qua forward(). Wrapper này bọc lại model gốc.
    """

    def __init__(self, xrv_model):
        super().__init__()
        self.xrv_model = xrv_model

    def forward(self, x):
        return self.xrv_model(x)


def generate_heatmap(img_tensor: torch.Tensor, disease: str, original_image_bytes: bytes, model) -> bytes:
    try:
        disease_idx = model.pathologies.index(disease)
    except ValueError:
        return b""

    import torch.nn.functional as F
    from pytorch_grad_cam import GradCAMPlusPlus
    from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget

    model.eval()

    # ── Chọn target layer ──
    # DenseNet-121: norm5 là BatchNorm cuối cùng sau denseblock4,
    # trước global average pooling → cho spatial features rõ ràng nhất
    if hasattr(model, "features") and hasattr(model.features, "norm5"):
        target_layers = [model.features.norm5]
    elif hasattr(model, "model") and hasattr(model.model, "layer4"):
        # Fallback cho ResNet
        target_layers = [model.model.layer4[-1]]
    else:
        return b""

    try:
        # ── Chạy GradCAM++ ──
        # GradCAM++ tốt hơn GradCAM gốc cho localization vì sử dụng
        # weighted combination of positive partial derivatives
        wrapper = XRVModelWrapper(model)
        cam = GradCAMPlusPlus(model=wrapper, target_layers=target_layers)

        targets = [ClassifierOutputTarget(disease_idx)]
        grayscale_cam = cam(input_tensor=img_tensor, targets=targets)
        heatmap = grayscale_cam[0]  # shape: (H_model, W_model), range [0, 1]

    except Exception as e:
        print(f"GradCAM++ error: {e}")
        return b""

    # ── Đọc ảnh gốc ──
    import skimage.io
    from scipy.ndimage import gaussian_filter

    try:
        orig_img = skimage.io.imread(io.BytesIO(original_image_bytes))
        h, w = orig_img.shape[:2]
    except Exception:
        orig_img = img_tensor[0, 0].detach().numpy()
        orig_img = (orig_img - orig_img.min()) / (orig_img.max() - orig_img.min() + 1e-8)
        h, w = orig_img.shape[:2]

    # ── Nội suy heatmap lên kích thước ảnh gốc ──
    heatmap_tensor = torch.from_numpy(heatmap).unsqueeze(0).unsqueeze(0).float()
    heatmap_resized = F.interpolate(heatmap_tensor, size=(h, w), mode='bilinear', align_corners=False)
    heatmap_np = heatmap_resized.squeeze().numpy()

    # Gaussian smoothing nhẹ để mượt hơn
    heatmap_np = gaussian_filter(heatmap_np, sigma=min(h, w) * 0.02)

    # Re-normalize về [0, 1]
    hm_min, hm_max = heatmap_np.min(), heatmap_np.max()
    if hm_max - hm_min > 1e-8:
        heatmap_np = (heatmap_np - hm_min) / (hm_max - hm_min)
    else:
        heatmap_np = np.zeros_like(heatmap_np)

    # ── Threshold: chỉ hiện vùng activation mạnh (> 0.35) ──
    # Loại bỏ noise yếu, chỉ giữ vùng model thực sự chú ý
    heatmap_display = np.copy(heatmap_np)
    heatmap_display[heatmap_display < 0.35] = 0

    # ── Tìm bounding box quanh vùng nóng nhất (threshold > 0.5) ──
    hot_mask = heatmap_np > 0.5
    bbox = None
    if hot_mask.any():
        rows = np.any(hot_mask, axis=1)
        cols = np.any(hot_mask, axis=0)
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        # Padding 3% để box không sát quá
        pad_h = int(h * 0.03)
        pad_w = int(w * 0.03)
        rmin = max(0, rmin - pad_h)
        rmax = min(h - 1, rmax + pad_h)
        cmin = max(0, cmin - pad_w)
        cmax = min(w - 1, cmax + pad_w)
        bbox = (cmin, rmin, cmax - cmin, rmax - rmin)

    # ── Vẽ hình ──
    if w > h:
        fig_w = 6.0
        fig_h = 6.0 * (h / w)
    else:
        fig_h = 6.0
        fig_w = 6.0 * (w / h)

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)

    # Hiển thị ảnh gốc
    ax.imshow(orig_img, cmap="gray")

    # Overlay heatmap — dùng masked array để vùng yếu hoàn toàn trong suốt
    masked_heatmap = np.ma.masked_where(heatmap_display < 0.01, heatmap_display)
    ax.imshow(masked_heatmap, alpha=0.55, cmap="jet", vmin=0, vmax=1)

    # Vẽ bounding box đỏ khoanh vùng bệnh
    if bbox:
        rect = patches.FancyBboxPatch(
            (bbox[0], bbox[1]), bbox[2], bbox[3],
            linewidth=2.5,
            edgecolor='#FF3333',
            facecolor='none',
            boxstyle="round,pad=3",
        )
        ax.add_patch(rect)

    ax.axis("off")

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", pad_inches=0, dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf.read()

import XRayUploader from "@/components/XRayUploader";
import { Upload } from "lucide-react";

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <Upload className="w-5 h-5" style={{ color: "var(--indigo-500)" }} />
            Upload X-Ray
          </h1>
          <p className="page-subtitle">Tải ảnh X-quang và phân tích tự động bằng AI</p>
        </div>
      </div>
      <XRayUploader />
      <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
        ⚠️ Kết quả AI chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa từ bác sĩ chuyên khoa.
      </p>
    </div>
  );
}

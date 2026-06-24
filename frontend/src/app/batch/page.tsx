"use client";

import BatchUploader from "@/components/BatchUploader";
import { Files } from "lucide-react";

export default function BatchPage() {
  return (
    <div className="space-y-6">
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <Files className="w-5 h-5" style={{ color: "var(--indigo-500)" }} />
            Phân Tích Hàng Loạt
          </h1>
          <p className="page-subtitle">Tải lên danh sách nhiều ảnh X-quang để phân tích đồng thời</p>
        </div>
      </div>
      <BatchUploader />
      <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
        ⚠️ Batch mode không tạo báo cáo tự động từ LLM (Gemini) nhằm tối ưu hiệu năng. Bác sĩ có thể tạo báo cáo riêng lẻ sau khi review.
      </p>
    </div>
  );
}

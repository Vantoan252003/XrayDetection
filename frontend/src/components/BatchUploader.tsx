"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Loader2, FileImage, CheckCircle, AlertCircle, Trash2 } from "lucide-react";
import ModelSelector from "./ModelSelector";

export default function BatchUploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [modelVersion, setModelVersion] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const onFilesSelected = (selectedFiles: FileList) => {
    const validFiles: File[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles[i];
      if (f.type.startsWith("image/")) {
        validFiles.push(f);
      }
    }
    
    if (files.length + validFiles.length > 50) {
      setError("Chỉ được upload tối đa 50 ảnh một lần.");
      return;
    }

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
      setError(null);
      setResultCount(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAndAnalyze = () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setProgress(0);

    const fd = new FormData();
    files.forEach((file) => {
      fd.append("files", file);
    });
    fd.append("ai_model", "gemini"); // model giải thích mặc định
    fd.append("source", "batch");
    if (modelVersion) {
      fd.append("model_version", modelVersion);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/batch-analyze`, true);

    // Theo dõi tiến trình upload
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        // Giới hạn upload progress tối đa 90%, 10% còn lại để server xử lý inference
        setProgress(Math.round(percentComplete * 0.9));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        setProgress(100);
        try {
          const res = JSON.parse(xhr.responseText);
          setResultCount(res.length);
          setFiles([]);
          // Tự động chuyển qua trang review sau 2 giây
          setTimeout(() => {
            router.push("/review");
          }, 2000);
        } catch (e) {
          setError("Lỗi parse dữ liệu trả về từ server.");
        }
      } else {
        try {
          const errRes = JSON.parse(xhr.responseText);
          setError(errRes.detail || errRes.error || "Có lỗi xảy ra khi phân tích batch.");
        } catch {
          setError("Lỗi kết nối hoặc xử lý phía máy chủ.");
        }
      }
      setLoading(false);
    };

    xhr.onerror = () => {
      setError("Lỗi mạng, vui lòng kiểm tra kết nối.");
      setLoading(false);
    };

    // Giả lập xử lý model trong lúc server phân tích (từ 90% -> 99%)
    let fakeProgressInterval: NodeJS.Timeout;
    fakeProgressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90 && prev < 98 && loading) {
          return prev + 1;
        }
        if (!loading) {
          clearInterval(fakeProgressInterval);
        }
        return prev;
      });
    }, 1500);

    xhr.send(fd);
  };

  const clearAll = () => {
    setFiles([]);
    setError(null);
    setResultCount(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {!loading && resultCount === null && (
        <>
          {/* Dropzone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all border-2 border-dashed p-8 text-center"
            style={{
              minHeight: 220,
              borderColor: "var(--border-medium)",
              background: "var(--bg-subtle)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--indigo-50)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
            />
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "var(--indigo-100)" }}
            >
              <UploadCloud className="w-7 h-7" style={{ color: "var(--indigo-500)" }} />
            </div>
            <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Kéo thả hoặc click để chọn danh sách ảnh X-quang
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Hỗ trợ tải lên nhiều file đồng thời (Tối đa 50 ảnh)
            </p>
          </div>

          {/* Model Selector */}
          {files.length > 0 && (
            <div className="chart-card">
              <ModelSelector selectedVersion={modelVersion} onChange={setModelVersion} />
            </div>
          )}

          {/* Files List */}
          {files.length > 0 && (
            <div className="chart-card">
              <div className="flex justify-between items-center mb-4 pb-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
                <p className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  <FileImage className="w-4 h-4 text-indigo-500" />
                  Danh sách file đã chọn ({files.length})
                </p>
                <button onClick={clearAll} className="text-xs font-semibold text-rose-500 hover:underline">
                  Xóa tất cả
                </button>
              </div>
              
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center p-2.5 rounded-xl text-xs"
                    style={{ border: "1px solid var(--border-light)", background: "var(--bg-card)" }}
                  >
                    <span className="font-semibold truncate max-w-md" style={{ color: "var(--text-secondary)" }}>
                      {f.name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span style={{ color: "var(--text-muted)" }}>
                        {(f.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(i);
                        }}
                        className="p-1 rounded-md text-rose-500 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-center gap-3 pt-4">
                <button onClick={clearAll} className="btn-secondary">
                  Hủy bỏ
                </button>
                <button onClick={uploadAndAnalyze} className="btn-primary">
                  🔬 Bắt đầu phân tích batch
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Loading overlay & progress bar */}
      {loading && (
        <div className="chart-card text-center py-10 space-y-4">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-indigo-500" />
          <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            Đang tải lên và phân tích ảnh...
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            AI đang chạy DenseNet121 chẩn đoán & vẽ Grad-CAM cho từng ảnh
          </p>
          
          <div className="max-w-md mx-auto">
            <div className="flex justify-between text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
              <span>Tiến trình</span>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progress}%`, background: "var(--grad-indigo)" }} />
            </div>
          </div>
        </div>
      )}

      {/* Results success state */}
      {resultCount !== null && (
        <div className="chart-card text-center py-10 space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Phân tích hoàn tất!
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Đã xử lý xong <strong>{resultCount}</strong> ảnh X-quang. Đang chuyển hướng bác sĩ tới trang phê duyệt...
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: "var(--rose-50)", border: "1px solid var(--rose-100)" }}
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--rose-500)" }} />
          <p className="text-sm text-rose-500">{error}</p>
        </div>
      )}
    </div>
  );
}

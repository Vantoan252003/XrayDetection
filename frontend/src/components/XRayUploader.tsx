"use client";

import { translateDisease } from "@/utils/disease";
import ImageSlider from "@/components/ImageSlider";
import ModelSelector from "@/components/ModelSelector";
import DiseaseCheckbox from "@/components/DiseaseCheckbox";
import { useState, useRef, useEffect } from "react";
import {
  UploadCloud, Loader2, AlertCircle,
  CheckCircle2, Cpu, Cloud, FileImage,
} from "lucide-react";

type Result = {
  scan_id: string;
  scores: Record<string, number>;
  top_disease: string | null;
  is_normal: boolean;
  image_url: string;
  heatmap_url: string | null;
  explanation: string;
  processing_time_ms?: number;
  icd_code?: string | null;
  icd_group?: string | null;
};

type AIModel = {
  id: string;
  name: string;
  type: "cloud" | "local";
  description: string;
};

export default function XRayUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string>("medgemma1.5:latest");
  const [modelVersion, setModelVersion] = useState<string>("");
  const [skipLlm, setSkipLlm] = useState(false);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [editingLabels, setEditingLabels] = useState(false);
  const [verifiedLabels, setVerifiedLabels] = useState<Record<string, boolean>>({});
  const [savingReview, setSavingReview] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);

  const [models, setModels] = useState<AIModel[]>([
    { id: "gemini", name: "Gemini 2.5 Flash", type: "cloud", description: "Google Cloud (Khuyến nghị)" },
    { id: "medgemma1.5:latest", name: "Medgemma1.5", type: "local", description: "Ollama Local (Offline)" },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/ai-models`;
        const r = await fetch(url);
        if (r.ok) {
          const data = await r.json();
          if (data.models && data.models.length > 0) {
            setModels(data.models);
          }
        }
      } catch (e) {
        console.error("Failed to fetch AI models:", e);
      }
    };
    fetchModels();
  }, []);

  const onFile = (f: File) => {
    if (!f.type.startsWith("image/")) { setError("Vui lòng chọn file hình ảnh hợp lệ."); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  };

  const analyze = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("ai_model", aiModel);
    fd.append("skip_llm", String(skipLlm));
    if (modelVersion) {
      fd.append("model_version", modelVersion);
    }
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/analyze`, { method: "POST", body: fd });
      if (!r.ok) throw new Error("Lỗi khi phân tích ảnh. Vui lòng thử lại.");
      const data = await r.json();
      setResult(data);
      
      const initialLabels: Record<string, boolean> = {};
      if (data.scores) {
        Object.entries(data.scores).forEach(([d, s]) => {
          if ((s as number) > 0.6) initialLabels[d] = true;
        });
      }
      setVerifiedLabels(initialLabels);
      setShowReviewPrompt(true);
      setReviewSaved(false);
      setEditingLabels(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Đã xảy ra lỗi không xác định.");
    } finally { setLoading(false); }
  };

  const submitImmediateReview = async () => {
    if (!result) return;
    setSavingReview(true);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/review/${result.scan_id}/approve`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified_labels: verifiedLabels }),
      });
      if (r.ok) {
        setReviewSaved(true);
        setShowReviewPrompt(false);
        setEditingLabels(false);
      } else {
        const err = await r.json();
        setError(err.detail || "Không thể lưu xác nhận của bác sĩ.");
      }
    } catch (e) {
      setError("Lỗi kết nối khi lưu xác nhận.");
    } finally {
      setSavingReview(false);
    }
  };

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); setShowReviewPrompt(false); setEditingLabels(false); };

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {!result && (
        <>
          {/* Drop zone */}
          <div
            onClick={() => !loading && inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            className="relative flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all"
            style={{
              minHeight: 220,
              border: `2px dashed ${preview ? "var(--indigo-400)" : "var(--border-medium)"}`,
              background: preview ? "var(--indigo-50)" : "var(--bg-subtle)",
            }}
            onMouseEnter={e => { if (!preview) e.currentTarget.style.background = "var(--indigo-50)"; }}
            onMouseLeave={e => { if (!preview) e.currentTarget.style.background = "var(--bg-subtle)"; }}
          >
            <input ref={inputRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />

            {preview ? (
              <div className="relative w-full max-w-xs aspect-square rounded-xl overflow-hidden shadow-md">
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                {loading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
                    <Loader2 className="w-10 h-10 animate-spin mb-2" style={{ color: "var(--indigo-500)" }} />
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Đang phân tích...</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {aiModel === "gemini" ? "Gemini Flash — ~5-15s" : `Mô hình Local (${models.find(m => m.id === aiModel)?.name || "Ollama"}) — ~30-60s`}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-10">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{ background: "var(--indigo-100)" }}>
                  <UploadCloud className="w-7 h-7" style={{ color: "var(--indigo-500)" }} />
                </div>
                <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Kéo thả hoặc click để chọn ảnh</p>
                <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Hỗ trợ JPEG, PNG, WEBP — tối đa 20MB</p>
              </div>
            )}
          </div>

          {/* Model selector */}
          {file && (
            <div className="chart-card space-y-4">
              <div>
                <p className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>Chọn mô hình LLM giải thích báo cáo</p>
                <div className="grid grid-cols-2 gap-3">
                  {models.map(m => {
                    const IconComponent = m.type === "cloud" ? Cloud : Cpu;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setAiModel(m.id)}
                        className="flex items-center gap-3 p-4 rounded-xl text-left transition-all"
                        style={{
                          border: `2px solid ${aiModel === m.id ? "var(--indigo-400)" : "var(--border-light)"}`,
                          background: aiModel === m.id ? "var(--indigo-50)" : "var(--bg-card)",
                        }}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: aiModel === m.id ? "var(--indigo-100)" : "var(--bg-subtle)" }}>
                          <IconComponent className="w-5 h-5" style={{ color: aiModel === m.id ? "var(--indigo-500)" : "var(--text-muted)" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{m.name}</p>
                            {m.type === "cloud" && <span className="badge badge-indigo text-[10px]">Khuyến nghị</span>}
                          </div>
                          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{m.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "16px" }}>
                <ModelSelector selectedVersion={modelVersion} onChange={setModelVersion} />
              </div>
            </div>
          )}

          {/* Actions */}
          {file && (
            <div className="flex flex-col items-center gap-4 mt-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input 
                  type="checkbox" 
                  checked={skipLlm} 
                  onChange={e => setSkipLlm(e.target.checked)} 
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" 
                />
                Chỉ phân tích ảnh, bỏ qua AI giải thích (Nhanh hơn)
              </label>
              <div className="flex justify-center gap-3">
                <button onClick={reset} className="btn-secondary">Hủy bỏ</button>
                <button onClick={analyze} disabled={loading} className="btn-primary" style={{ opacity: loading ? 0.7 : 1 }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang xử lý...</> : "🔬 Phân tích ngay"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: "var(--rose-50)", border: "1px solid var(--rose-100)" }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--rose-500)" }} />
          <p className="text-sm" style={{ color: "var(--rose-500)" }}>{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="animate-fade-in-up space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 gap-4" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <CheckCircle2 className="w-5 h-5" style={{ color: "var(--emerald-500)" }} />
              Kết quả phân tích
              {result.processing_time_ms && (
                <span className="badge badge-info text-xs">{(result.processing_time_ms / 1000).toFixed(1)}s</span>
              )}
            </h2>
            <button onClick={reset} className="btn-secondary text-sm" style={{ padding: "7px 14px", alignSelf: "flex-start" }}>
              ← Phân tích ảnh mới
            </button>
          </div>

          {/* Immediate Review Prompt */}
          {showReviewPrompt && !reviewSaved && (
            <div className="p-4 rounded-xl border-2" style={{ background: "var(--indigo-50)", borderColor: "var(--indigo-200)" }}>
              <h3 className="text-sm font-bold text-indigo-800 mb-3">Phán đoán của AI đã chính xác chưa thưa bác sĩ?</h3>
              
              {!editingLabels ? (
                <div className="flex gap-3">
                  <button 
                    onClick={submitImmediateReview} 
                    disabled={savingReview}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                  >
                    {savingReview ? "Đang lưu..." : "Đúng, lưu kết quả này"}
                  </button>
                  <button 
                    onClick={() => setEditingLabels(true)}
                    className="flex-1 py-2 bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-200 rounded-lg text-sm font-bold transition-all"
                  >
                    Chưa đúng, tôi muốn tự chọn bệnh
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <DiseaseCheckbox 
                    scores={result.scores} 
                    verifiedLabels={verifiedLabels} 
                    onChange={(d, checked) => setVerifiedLabels(prev => ({ ...prev, [d]: checked }))} 
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingLabels(false)} className="btn-secondary text-xs px-3 py-1.5">Hủy</button>
                    <button 
                      onClick={submitImmediateReview}
                      disabled={savingReview}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {savingReview ? "Đang lưu..." : "Xác nhận & Lưu vào hệ thống"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {reviewSaved && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold">
              <CheckCircle2 className="w-5 h-5" />
              Đã xác nhận và lưu nhãn thành công. Kết quả này đã được đánh dấu an toàn để huấn luyện AI sau này.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Image */}
            <div className="chart-card p-3">
              {result.heatmap_url ? (
                <ImageSlider originalUrl={result.image_url} heatmapUrl={result.heatmap_url} />
              ) : (
                <div className="aspect-square rounded-xl overflow-hidden"
                  style={{ background: "#f8fafc" }}>
                  <img
                    src={result.image_url}
                    alt="Ảnh X-quang gốc"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              <p className="text-center text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                {result.heatmap_url ? "Kéo thanh trượt để so sánh ảnh gốc và bản đồ nhiệt Grad-CAM" : "Ảnh X-quang gốc"}
              </p>
            </div>

            {/* Scores + AI */}
            <div className="space-y-4">
              {/* Scores */}
              <div className="chart-card">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  <FileImage className="w-4 h-4" style={{ color: "var(--indigo-500)" }} />
                  Dự đoán bệnh lý
                </h3>

                {result.icd_code && (
                  <div className="p-3 mb-4 rounded-xl text-xs flex flex-col gap-1 animate-fadeIn"
                    style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-light)" }}>
                    <p className="font-semibold text-slate-400" style={{ textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.05em" }}>
                      Phân loại ICD-10
                    </p>
                    <p style={{ color: "var(--text-primary)" }} className="flex items-center gap-2 mt-0.5">
                      <span className="font-extrabold text-indigo-600 px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-100 tabular-nums">
                        {result.icd_code}
                      </span>
                      <span className="font-semibold text-sm">{result.icd_group || "Chưa xác định nhóm bệnh"}</span>
                    </p>
                  </div>
                )}

                {result.is_normal || !Object.keys(result.scores).length ? (
                  <div className="flex items-center gap-3 p-4 rounded-xl"
                    style={{ background: "var(--emerald-50)", border: "1px solid var(--emerald-100)" }}>
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: "var(--emerald-500)" }} />
                    <p className="text-sm font-medium" style={{ color: "var(--emerald-600)" }}>
                      Không phát hiện dấu hiệu bất thường — X-quang bình thường.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(result.scores)
                      .filter(([, score]) => score >= 0.7)
                      .sort(([, a], [, b]) => b - a)
                      .map(([disease, score]) => (
                        <div key={disease}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className={`font-medium ${disease === result.top_disease ? "font-bold" : ""}`}
                              style={{ color: disease === result.top_disease ? "var(--indigo-600)" : "var(--text-secondary)" }}>
                              {disease === result.top_disease && "⭐ "}{translateDisease(disease)}
                            </span>
                            <span className="font-bold tabular-nums"
                              style={{ color: disease === result.top_disease ? "var(--indigo-600)" : "var(--text-secondary)" }}>
                              {(score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-bar-fill"
                              style={{
                                width: `${score * 100}%`,
                                background: disease === result.top_disease ? "var(--grad-indigo)" : "var(--border-medium)",
                              }} />
                          </div>
                        </div>
                      ))}
                    {Object.entries(result.scores).filter(([, score]) => score >= 0.7).length === 0 && (
                      <p className="text-sm text-center py-2" style={{ color: "var(--text-muted)" }}>
                        Không có bệnh lý nào vượt quá 70% độ tin cậy.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* AI explanation */}
              <div className="chart-card" style={{ background: "var(--indigo-50)", border: "1px solid var(--indigo-100)" }}>
                <h3 className="text-sm font-bold mb-3" style={{ color: "var(--indigo-600)" }}>
                  💬 AI Giải thích
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                  {result.explanation}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

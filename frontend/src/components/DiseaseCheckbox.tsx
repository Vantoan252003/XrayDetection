"use client";

import { diseaseTranslation } from "@/utils/disease";

interface DiseaseCheckboxProps {
  scores: Record<string, number>;
  verifiedLabels: Record<string, boolean>;
  onChange: (disease: string, checked: boolean) => void;
}

export default function DiseaseCheckbox({ scores, verifiedLabels, onChange }: DiseaseCheckboxProps) {
  // Lấy toàn bộ danh sách 18 bệnh lý (và bất cứ bệnh nào có trong translations)
  const diseases = Object.keys(diseaseTranslation).filter(d => d !== "Normal");

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {diseases.map((d) => {
        const isVerified = !!verifiedLabels[d];
        const aiScore = scores[d] || 0;
        const isHighConfidence = aiScore > 0.75;
        const hasSomeConfidence = aiScore > 0.5;

        // Custom styling based on AI confidence
        let borderStyle = "1px solid var(--border-light)";
        let bgStyle = "var(--bg-card)";
        
        if (isVerified) {
          borderStyle = "2px solid var(--indigo-500)";
          bgStyle = "var(--indigo-50)";
        } else if (isHighConfidence) {
          borderStyle = "1px dashed var(--rose-400)";
          bgStyle = "var(--rose-50)";
        } else if (hasSomeConfidence) {
          borderStyle = "1px dashed var(--amber-400)";
          bgStyle = "var(--amber-50)";
        }

        return (
          <label
            key={d}
            className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:shadow-sm"
            style={{
              border: borderStyle,
              background: bgStyle,
            }}
          >
            <input
              type="checkbox"
              checked={isVerified}
              onChange={(e) => onChange(d, e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
                {diseaseTranslation[d] || d}
              </p>
              {aiScore > 0 && (
                <span 
                  className="text-[10px] font-bold" 
                  style={{ 
                    color: isHighConfidence ? "var(--rose-600)" : hasSomeConfidence ? "var(--amber-600)" : "var(--text-muted)" 
                  }}
                >
                  AI: {(aiScore * 100).toFixed(1)}% {isHighConfidence ? "🔥" : ""}
                </span>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

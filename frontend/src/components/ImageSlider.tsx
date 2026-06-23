"use client";

import { useState } from "react";

type Props = {
  originalUrl: string;
  heatmapUrl: string;
};

export default function ImageSlider({ originalUrl, heatmapUrl }: Props) {
  const [sliderPos, setSliderPos] = useState(50);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSliderPos(Number(e.target.value));
  };

  return (
    <div className="relative w-full aspect-square rounded-xl overflow-hidden select-none bg-slate-100 border border-slate-200 shadow-inner">
      {/* Original Image (Background) */}
      <img
        src={originalUrl}
        alt="Ảnh X-Quang gốc"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Heatmap Image (Foreground, clipped) */}
      <div
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
          WebkitClipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
        }}
      >
        <img
          src={heatmapUrl}
          alt="Bản đồ nhiệt Grad-CAM"
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>

      {/* Slider Line Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize pointer-events-none shadow-[0_0_8px_rgba(0,0,0,0.4)] z-10"
        style={{ left: `${sliderPos}%` }}
      >
        {/* Slider Handle Button */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white text-indigo-600 shadow-xl border border-slate-200 flex items-center justify-center select-none z-20 font-semibold text-sm transition-transform active:scale-95">
          ↔
        </div>
      </div>

      {/* Invisible Input Range for dragging */}
      <input
        type="range"
        min="0"
        max="100"
        value={sliderPos}
        onChange={handleSliderChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30"
        style={{ WebkitAppearance: "none" }}
      />
    </div>
  );
}

import { Loader2, MoveHorizontal } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useCallback, useRef, useState } from 'react';

interface BeforeAfterSliderProps {
  beforeUrl: string | null;
  afterUrl: string;
  methodShortLabel: string;
  intensity: number;
  width: number;
  height: number;
  isUpdating?: boolean;
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  methodShortLabel,
  intensity,
  width,
  height,
  isUpdating = false,
}: BeforeAfterSliderProps) {
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(0, Math.min(100, pct));
    setSliderPos(clamped);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!beforeUrl) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !beforeUrl) {
      return;
    }
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!beforeUrl) {
      return;
    }
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSliderPos((prev) => Math.max(0, prev - step));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSliderPos((prev) => Math.min(100, prev + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSliderPos(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSliderPos(100);
    }
  };

  const safeWidth = width > 0 ? width : 3;
  const safeHeight = height > 0 ? height : 2;
  const safeAspect = safeWidth / safeHeight;

  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-3 overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0C0C0F] p-3 md:p-5">
      {/* Dedicated Non-Overlapping Header Strip */}
      <div className="flex w-full max-w-4xl items-center justify-between gap-3">
        {beforeUrl ? (
          <span className="shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-900/95 px-2.5 py-1 text-[11px] font-semibold text-zinc-200">
            Original
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {isUpdating && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#722ED1]/50 bg-[#722ED1]/15 px-2.5 py-1 text-[11px] font-medium text-[#FAF5FF]">
              <Loader2 className="h-3 w-3 animate-spin text-[#A855F7]" />
              <span>Updating…</span>
            </span>
          )}
          <span className="shrink-0 rounded-lg border border-[#722ED1]/60 bg-[#722ED1] px-2.5 py-1 text-[11px] font-semibold text-[#FAF5FF] shadow-sm">
            Matched · {methodShortLabel} · {Math.round(intensity)}%
          </span>
        </div>
      </div>

      {/* Responsive Generously Scaled Comparison Stage Preserving Exact Aspect Ratio */}
      <div className="flex w-full max-w-4xl flex-1 items-center justify-center">
        <div
          ref={stageRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            aspectRatio: `${safeWidth} / ${safeHeight}`,
            width: `min(100%, calc(64vh * ${safeAspect.toFixed(4)}))`,
          }}
          className={`relative max-h-[64vh] max-w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl select-none ${
            beforeUrl ? 'cursor-ew-resize touch-none' : ''
          }`}
        >
          {/* Base Layer: Matched Result */}
          <img
            src={afterUrl}
            alt={`Matched output (${width}x${height})`}
            draggable={false}
            style={{ imageRendering: 'auto' }}
            className="block h-full w-full object-contain select-none pointer-events-none"
          />

          {/* Overlay Layer: Original Source clipped to identical bounding box */}
          {beforeUrl && (
            <img
              src={beforeUrl}
              alt="Original source"
              draggable={false}
              style={{
                clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                imageRendering: 'auto',
              }}
              className="absolute inset-0 h-full w-full object-contain select-none pointer-events-none"
            />
          )}

          {/* Interactive Split Divider & Accessible Slider Handle */}
          {beforeUrl && (
            <div
              role="slider"
              tabIndex={0}
              aria-label="Before and after comparison"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(sliderPos)}
              aria-valuetext={`${Math.round(sliderPos)}% Original`}
              onKeyDown={handleKeyDown}
              style={{ left: `${sliderPos}%` }}
              className="group absolute inset-y-0 -translate-x-1/2 focus:outline-none"
            >
              <div className="h-full w-0.5 bg-[#FAF5FF] shadow-[0_0_8px_rgba(0,0,0,0.8)]" />
              <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#FAF5FF] bg-[#722ED1] text-[#FAF5FF] shadow-lg transition group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-[#FAF5FF]/40">
                <MoveHorizontal className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

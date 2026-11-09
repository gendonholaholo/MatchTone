import { AlertTriangle, FileImage, ImagePlus, Palette, RefreshCw, X } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { extractFilesFromDataTransfer, formatBytes, type ImageAsset } from '../lib/api';

interface DropzoneCardProps {
  stepLabel: string;
  title: string;
  subtitle?: string;
  emptyActionLabel: string;
  formatHint: string;
  variant: 'source' | 'reference';
  asset: ImageAsset | null;
  isActivePasteTarget: boolean;
  disabled?: boolean;
  onActivateTarget: () => void;
  onSelectClick: () => void;
  onDropFile: (file: File) => void;
  onClear: () => void;
}

export function DropzoneCard({
  stepLabel,
  title,
  subtitle,
  emptyActionLabel,
  formatHint,
  variant,
  asset,
  isActivePasteTarget,
  disabled = false,
  onActivateTarget,
  onSelectClick,
  onDropFile,
  onClear,
}: DropzoneCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (disabled) {
      return;
    }
    onActivateTarget();
    const files = await extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length > 0) {
      onDropFile(files[0]);
    }
  };

  const EmptyIcon = variant === 'source' ? ImagePlus : Palette;
  const isUnreadable = Boolean(asset?.isUnreadable);

  return (
    <section
      aria-label={title}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex min-h-[260px] flex-col overflow-hidden rounded-2xl border transition-all md:min-h-[340px] ${
        isDragging
          ? 'border-[#722ED1] bg-[#722ED1]/10 shadow-[0_0_0_2px_rgba(114,46,209,0.35)]'
          : isUnreadable
            ? 'border-[#E11D48]/70 bg-[#121215]'
            : isActivePasteTarget
              ? 'border-[#722ED1]/60 bg-[#121215]'
              : 'border-zinc-800/90 bg-[#121215] hover:border-zinc-700'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-[#722ED1]/20 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#FAF5FF]">
            {stepLabel}
          </span>
          <div className="flex min-w-0 items-baseline gap-1.5">
            <h2 className="truncate text-sm font-semibold text-zinc-100">{title}</h2>
            {subtitle && (
              <span className="hidden truncate text-[11px] text-zinc-400 sm:inline">
                · {subtitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isActivePasteTarget && (
            <span className="hidden rounded-md border border-[#722ED1]/40 bg-[#722ED1]/15 px-2 py-0.5 text-[10px] font-medium text-[#FAF5FF] sm:inline-flex">
              Cmd+V Slot
            </span>
          )}
          {asset && (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onActivateTarget();
                  onSelectClick();
                }}
                aria-label={`Replace ${title}`}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Replace</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onClear}
                aria-label={`Clear ${title}`}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Card Body */}
      {asset ? (
        <div className="relative flex flex-1 flex-col items-center justify-center p-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onActivateTarget();
              if (asset.isUnreadable) {
                onSelectClick();
              }
            }}
            aria-label={`Focus ${title}`}
            className="flex h-full w-full flex-1 flex-col items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#722ED1]"
          >
            {asset.previewUrl ? (
              <img
                src={asset.previewUrl}
                alt={asset.name}
                className="max-h-[340px] w-auto max-w-full rounded-lg object-contain shadow-lg"
              />
            ) : asset.isTiff ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-6 py-8 text-center">
                <FileImage className="h-10 w-10 text-[#A855F7]" />
                <span className="text-xs font-semibold text-zinc-200">{asset.name}</span>
                <span className="rounded-md border border-zinc-700/80 bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                  TIFF · Preview on Match
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/10 px-6 py-8 text-center">
                <AlertTriangle className="h-10 w-10 text-[#E11D48]" />
                <span className="text-xs font-semibold text-zinc-100">{asset.name}</span>
                <span className="rounded-md border border-[#E11D48]/50 bg-[#E11D48]/20 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-100">
                  Unreadable File — Replace
                </span>
              </div>
            )}
          </button>

          <div
            className={`mt-3 flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs ${
              isUnreadable
                ? 'border-[#E11D48]/50 bg-[#E11D48]/10'
                : 'border-zinc-800/80 bg-zinc-950/80'
            }`}
          >
            <span className="truncate font-medium text-zinc-200" title={asset.name}>
              {asset.name}
            </span>
            <span
              className={`shrink-0 text-[11px] ${
                isUnreadable ? 'font-medium text-[#E11D48]' : 'text-zinc-400'
              }`}
            >
              {isUnreadable
                ? `Unreadable · ${formatBytes(asset.sizeBytes)}`
                : `${asset.width && asset.height ? `${asset.width}×${asset.height} px · ` : ''}${formatBytes(asset.sizeBytes)}`}
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onFocus={onActivateTarget}
          onClick={() => {
            onActivateTarget();
            onSelectClick();
          }}
          className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#722ED1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/90 text-[#A855F7] transition group-hover:scale-105 group-hover:border-[#722ED1]/60 group-hover:bg-[#722ED1]/15 group-hover:text-[#FAF5FF]">
            <EmptyIcon className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-100">{emptyActionLabel}</p>
            {subtitle && <p className="text-xs font-medium text-zinc-300">{subtitle}</p>}
            <p className="text-[11px] text-zinc-400">{formatHint}</p>
          </div>
          <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1 text-[11px] font-medium text-zinc-300 transition group-hover:border-[#722ED1]/60 group-hover:text-[#FAF5FF]">
            Browse or Drop
          </span>
        </button>
      )}
    </section>
  );
}

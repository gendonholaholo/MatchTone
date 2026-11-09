import type { BatchMatchResponse, PickedDirectoryResult } from '@shared/types';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FolderOpen,
  FolderPlus,
  Images,
  Trash2,
  X,
} from 'lucide-react';
import { type DragEvent, type Ref, useState } from 'react';
import {
  extractFilesFromDataTransfer,
  formatBytes,
  type ImageAsset,
  triggerBrowserDownload,
} from '../lib/api';
import { DropzoneCard } from './DropzoneCard';

interface BatchStageProps {
  isDesktop: boolean;
  isProcessing: boolean;
  batchFiles: ImageAsset[];
  batchDir: PickedDirectoryResult | null;
  reference: ImageAsset | null;
  batchResult: BatchMatchResponse | null;
  isResultStale?: boolean;
  onRerunBatch?: () => void;
  resultsRef?: Ref<HTMLElement>;
  isReferencePasteTarget: boolean;
  onActivateBatchTarget: () => void;
  onActivateReferenceTarget: () => void;
  onSelectBatchFilesClick: () => void;
  onSelectBatchFolderClick: () => void;
  onDropBatchFiles: (files: File[]) => void;
  onRemoveBatchFile: (id: string) => void;
  onClearBatch: () => void;
  onSelectReferenceClick: () => void;
  onDropReferenceFile: (file: File) => void;
  onClearReference: () => void;
  onDownloadZip: () => void;
  onOpenOutputFolder: (dirPath: string) => void;
}

export function BatchStage({
  isDesktop,
  isProcessing,
  batchFiles,
  batchDir,
  reference,
  batchResult,
  isResultStale = false,
  onRerunBatch,
  resultsRef,
  isReferencePasteTarget,
  onActivateBatchTarget,
  onActivateReferenceTarget,
  onSelectBatchFilesClick,
  onSelectBatchFolderClick,
  onDropBatchFiles,
  onRemoveBatchFile,
  onClearBatch,
  onSelectReferenceClick,
  onDropReferenceFile,
  onClearReference,
  onDownloadZip,
  onOpenOutputFolder,
}: BatchStageProps) {
  const [isDraggingQueue, setIsDraggingQueue] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isProcessing) {
      setIsDraggingQueue(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingQueue(false);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingQueue(false);
    if (isProcessing) {
      return;
    }
    onActivateBatchTarget();
    const files = await extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length > 0) {
      onDropBatchFiles(files);
    }
  };

  const totalQueuedCount = batchDir ? batchDir.imageCount : batchFiles.length;
  const hasQueue = Boolean(batchDir) || batchFiles.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: Batch Queue Dropzone & File List */}
        <section
          aria-label="Batch Queue"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex min-h-[260px] flex-col overflow-hidden rounded-2xl border transition-all md:min-h-[340px] ${
            isDraggingQueue
              ? 'border-[#722ED1] bg-[#722ED1]/10 shadow-[0_0_0_2px_rgba(114,46,209,0.35)]'
              : !isReferencePasteTarget
                ? 'border-[#722ED1]/60 bg-[#121215]'
                : 'border-zinc-800/90 bg-[#121215] hover:border-zinc-700'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-md bg-[#722ED1]/20 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#FAF5FF]">
                Step 1
              </span>
              <h2 className="truncate text-sm font-semibold text-zinc-100">Batch Queue</h2>
              {hasQueue && (
                <span className="rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                  {totalQueuedCount} {totalQueuedCount === 1 ? 'image' : 'images'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  onActivateBatchTarget();
                  onSelectBatchFilesClick();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-50"
              >
                <Images className="h-3.5 w-3.5" />
                <span>{hasQueue ? 'Add More' : 'Add Images'}</span>
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  onActivateBatchTarget();
                  onSelectBatchFolderClick();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-50"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>Folder</span>
              </button>
              {hasQueue && (
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={onClearBatch}
                  aria-label="Clear batch queue"
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {hasQueue ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
              {batchDir ? (
                <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-[#A855F7]" />
                      <span
                        className="truncate text-xs font-semibold text-zinc-100"
                        title={batchDir.path}
                      >
                        {batchDir.name}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-md bg-[#722ED1]/20 px-2 py-0.5 text-[11px] font-medium text-[#FAF5FF]">
                      {batchDir.imageCount} files
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-zinc-500" title={batchDir.path}>
                    {batchDir.path}
                  </p>
                  {batchDir.imageNames.length > 0 && (
                    <div className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto border-t border-zinc-800/80 pt-2">
                      {batchDir.imageNames.map((imgName) => (
                        <div
                          key={imgName}
                          className="flex items-center justify-between rounded-lg bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-300"
                        >
                          <span className="truncate">{imgName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                batchFiles.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 ${
                      item.isUnreadable
                        ? 'border-[#E11D48]/50 bg-[#E11D48]/10'
                        : 'border-zinc-800/80 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className="h-9 w-9 shrink-0 rounded-md border border-zinc-800 object-cover"
                        />
                      ) : item.isTiff ? (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-[10px] font-bold text-[#A855F7]">
                          TIFF
                        </div>
                      ) : (
                        <div
                          title="Unreadable file"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#E11D48]/50 bg-[#E11D48]/20 text-[#E11D48]"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p
                            className="truncate text-xs font-medium text-zinc-200"
                            title={item.name}
                          >
                            {item.name}
                          </p>
                          {item.isUnreadable && (
                            <span className="shrink-0 rounded border border-[#E11D48]/50 bg-[#E11D48]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#E11D48]">
                              Unreadable
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {item.width && item.height ? `${item.width}×${item.height} px · ` : ''}
                          {formatBytes(item.sizeBytes)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => onRemoveBatchFile(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/90 text-[#A855F7]">
                <Images className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-zinc-100">
                  Drop Multiple Photos or Folder
                </p>
                <p className="text-xs font-medium text-zinc-300">Photos to Recolor</p>
                <p className="text-[11px] text-zinc-400">PNG · JPG · WEBP · TIFF · BMP</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    onActivateBatchTarget();
                    onSelectBatchFilesClick();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#722ED1]/60 bg-[#722ED1]/20 px-3 py-1.5 text-xs font-semibold text-[#FAF5FF] transition hover:bg-[#722ED1]/35 disabled:opacity-50"
                >
                  <Images className="h-3.5 w-3.5" />
                  <span>Select Images</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    onActivateBatchTarget();
                    onSelectBatchFolderClick();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-50"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span>Select Folder</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right: Shared Color Reference Dropzone */}
        <DropzoneCard
          stepLabel="Step 2"
          title="Color Reference"
          subtitle="Style to Copy"
          emptyActionLabel="Drop Color Reference"
          formatHint="PNG · JPG · WEBP · TIFF · BMP"
          variant="reference"
          asset={reference}
          isActivePasteTarget={isReferencePasteTarget}
          disabled={isProcessing}
          onActivateTarget={onActivateReferenceTarget}
          onSelectClick={onSelectReferenceClick}
          onDropFile={onDropReferenceFile}
          onClear={onClearReference}
        />
      </div>

      {/* Batch Output Summary & Visual Item Thumbnails */}
      {batchResult && (
        <section
          ref={resultsRef}
          aria-label="Batch Match Results"
          className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#121215]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  batchResult.failed_count === 0
                    ? 'border border-[#10B981]/40 bg-[#10B981]/15 text-[#10B981]'
                    : 'border border-[#E11D48]/40 bg-[#E11D48]/15 text-[#E11D48]'
                }`}
              >
                {batchResult.failed_count === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                <span>
                  {batchResult.succeeded_count}/{batchResult.total_count} Done ·{' '}
                  {Math.round(batchResult.total_ms)} ms
                </span>
              </span>
              <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                {batchResult.format.toUpperCase()} · {Math.round(batchResult.intensity)}%
              </span>
              {isResultStale && (
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={onRerunBatch}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#722ED1]/60 bg-[#722ED1]/20 px-2.5 py-0.5 text-[11px] font-semibold text-[#FAF5FF] transition hover:bg-[#722ED1]/35 disabled:opacity-50"
                >
                  <span>Settings Changed · Re-run Batch</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {batchResult.zip_data_url && (
                <button
                  type="button"
                  onClick={onDownloadZip}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#722ED1] px-3.5 py-1.5 text-xs font-semibold text-[#FAF5FF] shadow-sm transition hover:bg-[#7E22CE]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Batch ZIP</span>
                </button>
              )}
              {isDesktop && batchResult.output_dir && (
                <button
                  type="button"
                  onClick={() => {
                    if (batchResult.output_dir) {
                      onOpenOutputFolder(batchResult.output_dir);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Open Output Folder</span>
                </button>
              )}
            </div>
          </div>

          <div className="max-h-72 divide-y divide-zinc-800/60 overflow-y-auto">
            {batchResult.items.map((item) => {
              const sourceAsset = batchFiles.find((f) => f.name === item.filename) ?? null;
              return (
                <div
                  key={`${item.filename}-${item.output_filename ?? 'err'}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {item.status === 'ok' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#10B981]" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#E11D48]" />
                    )}

                    {/* Before -> Matched Visual Thumbnails */}
                    {item.status === 'ok' && (sourceAsset?.previewUrl || item.preview_data_url) && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {sourceAsset?.previewUrl && (
                          <img
                            src={sourceAsset.previewUrl}
                            alt={`Original ${item.filename}`}
                            className="h-10 w-10 rounded-md border border-zinc-800 object-cover"
                          />
                        )}
                        {sourceAsset?.previewUrl && item.preview_data_url && (
                          <ArrowRight className="h-3 w-3 shrink-0 text-zinc-500" />
                        )}
                        {item.preview_data_url && (
                          <img
                            src={item.preview_data_url}
                            alt={`Matched ${item.filename}`}
                            className="h-10 w-10 rounded-md border border-[#722ED1]/60 object-cover"
                          />
                        )}
                      </div>
                    )}

                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-200">{item.filename}</p>
                      {item.output_filename && (
                        <p className="truncate text-[11px] text-zinc-500">{item.output_filename}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5 text-[11px] text-zinc-400">
                    {item.status === 'ok' ? (
                      <>
                        <span>
                          {item.width && item.height ? `${item.width}×${item.height} px · ` : ''}
                          {Math.round(item.duration_ms)} ms
                        </span>
                        {item.download_data_url && (
                          <button
                            type="button"
                            onClick={() => {
                              if (item.download_data_url) {
                                triggerBrowserDownload(
                                  item.download_data_url,
                                  item.output_filename || item.filename,
                                );
                              }
                            }}
                            aria-label={`Save ${item.output_filename ?? item.filename}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/90 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:bg-[#722ED1]/20 hover:text-[#FAF5FF]"
                          >
                            <Download className="h-3 w-3 text-[#A855F7]" />
                            <span>Save</span>
                          </button>
                        )}
                        {isDesktop && item.output_path && (
                          <button
                            type="button"
                            onClick={() => {
                              if (item.output_path) {
                                onOpenOutputFolder(item.output_path);
                              }
                            }}
                            aria-label={`Reveal ${item.output_filename ?? item.filename}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/90 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>Reveal</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="font-medium text-[#E11D48]">{item.error ?? 'Failed'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

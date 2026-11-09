import {
  APP_VERSION,
  type BatchMatchResponse,
  type EngineHealthResponse,
  type MainProcessTelemetry,
  OUTPUT_FORMATS,
  type OutputFormat,
  type PickedDirectoryResult,
  type SingleMatchResponse,
} from '@shared/types';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ChevronLeft,
  Download,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Images,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { extractBasename, formatBytes, type ImageAsset } from '../lib/api';
import { BrandMark } from './BrandMark';

export type SidebarTab = 'match' | 'settings';

interface SidebarProps {
  isDesktop: boolean;
  isMacDesktop: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onCollapse: () => void;
  engineOnline: boolean | null;
  health: EngineHealthResponse | null;
  mainTelemetry: MainProcessTelemetry | null;
  onRefreshHealth: () => void;
  batchMode: boolean;
  onToggleBatchMode: (next: boolean) => void;
  source: ImageAsset | null;
  reference: ImageAsset | null;
  batchFiles: ImageAsset[];
  batchDir: PickedDirectoryResult | null;
  strength: number;
  onStrengthChange: (strength: number) => void;
  outputFormat: OutputFormat;
  onOutputFormatChange: (fmt: OutputFormat) => void;
  filenameSuffix: string;
  onFilenameSuffixChange: (suffix: string) => void;
  outputDir: string;
  onPickOutputDir: () => void;
  onClearOutputDir: () => void;
  autoSaveDesktop: boolean;
  onToggleAutoSaveDesktop: (next: boolean) => void;
  isProcessing: boolean;
  isAutoUpdating: boolean;
  singleResult: SingleMatchResponse | null;
  batchResult: BatchMatchResponse | null;
  onSelectSource: () => void;
  onClearSource: () => void;
  onSelectBatchFiles: () => void;
  onSelectBatchFolder: () => void;
  onClearBatch: () => void;
  onSelectReference: () => void;
  onClearReference: () => void;
  onSwapSourceReference: () => void;
  onRunMatch: () => void;
  onSaveSingleResult: () => void;
  onRevealPath: (targetPath: string) => void;
  onDownloadBatchZip: () => void;
  onResetDefaults: () => void;
  onResetAll: () => void;
}

export function Sidebar({
  isDesktop,
  isMacDesktop,
  activeTab,
  onTabChange,
  onCollapse,
  engineOnline,
  health,
  mainTelemetry,
  onRefreshHealth,
  batchMode,
  onToggleBatchMode,
  source,
  reference,
  batchFiles,
  batchDir,
  strength,
  onStrengthChange,
  outputFormat,
  onOutputFormatChange,
  filenameSuffix,
  onFilenameSuffixChange,
  outputDir,
  onPickOutputDir,
  onClearOutputDir,
  autoSaveDesktop,
  onToggleAutoSaveDesktop,
  isProcessing,
  isAutoUpdating,
  singleResult,
  batchResult,
  onSelectSource,
  onClearSource,
  onSelectBatchFiles,
  onSelectBatchFolder,
  onClearBatch,
  onSelectReference,
  onClearReference,
  onSwapSourceReference,
  onRunMatch,
  onSaveSingleResult,
  onRevealPath,
  onDownloadBatchZip,
  onResetDefaults,
  onResetAll,
}: SidebarProps) {
  const matchTabRef = useRef<HTMLButtonElement | null>(null);
  const settingsTabRef = useRef<HTMLButtonElement | null>(null);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SidebarTab) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const nextTab: SidebarTab = current === 'match' ? 'settings' : 'match';
      onTabChange(nextTab);
      if (nextTab === 'match') {
        matchTabRef.current?.focus();
      } else {
        settingsTabRef.current?.focus();
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      onTabChange('match');
      matchTabRef.current?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      onTabChange('settings');
      settingsTabRef.current?.focus();
    }
  };

  const batchCount = batchDir ? batchDir.imageCount : batchFiles.length;
  const hasBatchSource = batchDir ? batchDir.imageCount > 0 : batchFiles.length > 0;
  const canRun = batchMode
    ? hasBatchSource && Boolean(reference) && !isProcessing && engineOnline !== false
    : Boolean(source) && Boolean(reference) && !isProcessing && engineOnline !== false;

  let readinessHint: string | null = null;
  if (engineOnline === false) {
    readinessHint = 'Engine Offline';
  } else if (batchMode) {
    if (!hasBatchSource && !reference) readinessHint = 'Add Queue & Reference';
    else if (!hasBatchSource) readinessHint = 'Add Batch Images';
    else if (!reference) readinessHint = 'Select Reference';
  } else {
    if (!source && !reference) readinessHint = 'Select Source & Reference';
    else if (!source) readinessHint = 'Select Source';
    else if (!reference) readinessHint = 'Select Reference';
  }

  const canSwap = !batchMode && Boolean(source) && Boolean(reference) && !isProcessing;

  const memoryStats = singleResult?.memory ?? batchResult?.memory ?? health?.memory ?? null;
  const latencyStats = singleResult?.latency ?? batchResult?.latency ?? health?.latency ?? null;
  const breakdown = singleResult?.breakdown_ms ?? null;

  return (
    <aside
      aria-label="Controls sidebar"
      className="flex w-full shrink-0 flex-col border-b border-zinc-800/90 bg-[#121215] md:h-screen md:w-80 md:border-r md:border-b-0"
    >
      {/* Top Brand Header */}
      <div
        className={`flex items-center justify-between gap-2 border-b border-zinc-800/80 px-4 pb-3 ${
          isMacDesktop ? 'app-drag-region pt-9' : 'pt-3.5'
        }`}
      >
        <div className="app-no-drag flex min-w-0 items-center gap-2.5">
          <BrandMark className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold tracking-tight text-zinc-100">
                MatchTone
              </span>
              <span className="rounded-md border border-[#722ED1]/40 bg-[#722ED1]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#FAF5FF]">
                {APP_VERSION}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
              <span
                className={`h-2 w-2 rounded-full ${
                  engineOnline === true
                    ? 'bg-[#10B981]'
                    : engineOnline === false
                      ? 'bg-[#E11D48]'
                      : 'bg-zinc-500'
                }`}
              />
              <span
                className={
                  engineOnline === true
                    ? 'font-medium text-[#10B981]'
                    : engineOnline === false
                      ? 'font-medium text-[#E11D48]'
                      : 'text-zinc-400'
                }
              >
                {engineOnline === true
                  ? 'Ready'
                  : engineOnline === false
                    ? 'Offline'
                    : 'Connecting'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="app-no-drag hidden h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 md:inline-flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* 2-Tab Switcher */}
      <div className="px-3.5 pt-3">
        <div
          role="tablist"
          aria-label="Control sections"
          className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800/90 bg-[#09090B] p-1"
        >
          <button
            ref={matchTabRef}
            id="tab-match"
            type="button"
            role="tab"
            aria-selected={activeTab === 'match'}
            aria-controls="panel-match"
            tabIndex={activeTab === 'match' ? 0 : -1}
            onClick={() => onTabChange('match')}
            onKeyDown={(e) => handleTabKeyDown(e, 'match')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'match'
                ? 'bg-[#722ED1] text-[#FAF5FF] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Match</span>
          </button>

          <button
            ref={settingsTabRef}
            id="tab-settings"
            type="button"
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="panel-settings"
            tabIndex={activeTab === 'settings' ? 0 : -1}
            onClick={() => onTabChange('settings')}
            onKeyDown={(e) => handleTabKeyDown(e, 'settings')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'settings'
                ? 'bg-[#722ED1] text-[#FAF5FF] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'match' ? (
        <div
          id="panel-match"
          role="tabpanel"
          aria-labelledby="tab-match"
          className="flex flex-1 flex-col justify-between gap-3 overflow-y-auto px-3.5 py-3"
        >
          <div className="space-y-2.5">
            {/* Batch Mode Switch */}
            <div className="flex items-center justify-between rounded-xl border border-zinc-800/90 bg-[#18181B] px-3 py-2">
              <div className="flex items-center gap-2">
                <Images className="h-3.5 w-3.5 text-[#A855F7]" />
                <span className="text-xs font-semibold text-zinc-200">Batch Mode</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={batchMode}
                aria-label="Batch Mode"
                disabled={isProcessing}
                onClick={() => onToggleBatchMode(!batchMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                  batchMode ? 'bg-[#722ED1]' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#FAF5FF] transition ${
                    batchMode ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Step 1: Your Photo / Batch Queue */}
            <div className="rounded-xl border border-zinc-800/90 bg-[#18181B] p-3">
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                  Step 1 · {batchMode ? 'Batch Queue' : 'Your Photo'}
                </span>
                {!batchMode && source && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={onClearSource}
                    aria-label="Clear source image"
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {batchMode && hasBatchSource && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={onClearBatch}
                    aria-label="Clear batch queue"
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {!batchMode ? (
                <>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={onSelectSource}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:bg-[#722ED1]/15 hover:text-[#FAF5FF] disabled:opacity-50"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-[#A855F7]" />
                    <span>{source ? 'Replace Photo' : 'Select Photo'}</span>
                  </button>
                  {source && (
                    <div
                      className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                        source.isUnreadable
                          ? 'border-[#E11D48]/50 bg-[#E11D48]/10'
                          : 'border-zinc-800 bg-zinc-950/70'
                      }`}
                    >
                      {source.previewUrl ? (
                        <img
                          src={source.previewUrl}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded object-cover"
                        />
                      ) : source.isUnreadable ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-[#E11D48]" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-xs font-medium text-zinc-200"
                          title={source.name}
                        >
                          {source.name}
                        </p>
                        <p
                          className={`text-[10px] ${
                            source.isUnreadable ? 'font-medium text-[#E11D48]' : 'text-zinc-400'
                          }`}
                        >
                          {source.isUnreadable
                            ? `Unreadable · ${formatBytes(source.sizeBytes)}`
                            : `${source.width && source.height ? `${source.width}×${source.height} px · ` : ''}${formatBytes(source.sizeBytes)}`}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={onSelectBatchFiles}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700/90 bg-zinc-900 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:bg-[#722ED1]/15 hover:text-[#FAF5FF] disabled:opacity-50"
                    >
                      <Images className="h-3.5 w-3.5 text-[#A855F7]" />
                      <span>{hasBatchSource ? 'Add More' : 'Select Images'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={onSelectBatchFolder}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700/90 bg-zinc-900 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:bg-[#722ED1]/15 hover:text-[#FAF5FF] disabled:opacity-50"
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-[#A855F7]" />
                      <span>Folder</span>
                    </button>
                  </div>
                  {hasBatchSource && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs">
                      <span className="truncate font-medium text-zinc-200">
                        {batchDir ? batchDir.name : 'Queued Files'}
                      </span>
                      <span className="shrink-0 rounded bg-[#722ED1]/20 px-1.5 py-0.5 text-[11px] font-semibold text-[#FAF5FF]">
                        {batchCount} {batchCount === 1 ? 'file' : 'files'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Step 2: Color Reference */}
            <div className="rounded-xl border border-zinc-800/90 bg-[#18181B] p-3">
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                  Step 2 · Color Reference
                </span>
                <div className="flex items-center gap-1">
                  {!batchMode && (
                    <button
                      type="button"
                      disabled={!canSwap}
                      onClick={onSwapSourceReference}
                      title={
                        canSwap ? 'Swap Your Photo & Color Reference' : 'Load both photos to swap'
                      }
                      aria-label="Swap Source and Reference"
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowLeftRight className="h-3 w-3" />
                      <span>Swap</span>
                    </button>
                  )}
                  {reference && (
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={onClearReference}
                      aria-label="Clear reference image"
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={onSelectReference}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:bg-[#722ED1]/15 hover:text-[#FAF5FF] disabled:opacity-50"
              >
                <Palette className="h-3.5 w-3.5 text-[#A855F7]" />
                <span>{reference ? 'Change Reference' : 'Select Reference'}</span>
              </button>

              {reference && (
                <div
                  className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                    reference.isUnreadable
                      ? 'border-[#E11D48]/50 bg-[#E11D48]/10'
                      : 'border-zinc-800 bg-zinc-950/70'
                  }`}
                >
                  {reference.previewUrl ? (
                    <img
                      src={reference.previewUrl}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : reference.isUnreadable ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-[#E11D48]" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-xs font-medium text-zinc-200"
                      title={reference.name}
                    >
                      {reference.name}
                    </p>
                    <p
                      className={`text-[10px] ${
                        reference.isUnreadable ? 'font-medium text-[#E11D48]' : 'text-zinc-400'
                      }`}
                    >
                      {reference.isUnreadable
                        ? `Unreadable · ${formatBytes(reference.sizeBytes)}`
                        : `${reference.width && reference.height ? `${reference.width}×${reference.height} px · ` : ''}${formatBytes(reference.sizeBytes)}`}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Output & Strength */}
            <div className="space-y-3 rounded-xl border border-zinc-800/90 bg-[#18181B] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                  Step 3 · Output & Strength
                </span>
                <span className="truncate text-[11px] text-zinc-400">
                  {isDesktop
                    ? `Folder: ${outputDir ? extractBasename(outputDir) : 'Source Folder'}`
                    : 'Manual Download'}
                </span>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="strength-slider" className="text-xs font-medium text-zinc-300">
                    Strength
                  </label>
                  <div className="flex items-center gap-1.5">
                    {strength !== 100 && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => onStrengthChange(100)}
                        className="text-[10px] font-medium text-zinc-400 hover:text-[#FAF5FF]"
                      >
                        Reset
                      </button>
                    )}
                    <span className="rounded-md bg-[#722ED1]/20 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#FAF5FF]">
                      {strength}%
                    </span>
                  </div>
                </div>
                <input
                  id="strength-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={isProcessing}
                  value={strength}
                  onChange={(e) => onStrengthChange(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, #722ED1 0%, #722ED1 ${strength}%, #27272A ${strength}%, #27272A 100%)`,
                  }}
                  className="matchtone-slider w-full disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {OUTPUT_FORMATS.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => onOutputFormatChange(fmt)}
                    aria-pressed={outputFormat === fmt}
                    className={`rounded-md py-1 text-[11px] font-semibold uppercase transition ${
                      outputFormat === fmt
                        ? 'bg-[#722ED1] text-[#FAF5FF]'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>

              {isDesktop && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={onPickOutputDir}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700/90 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#A855F7]" />
                    <span className="truncate">
                      {outputDir ? extractBasename(outputDir) : 'Choose Folder'}
                    </span>
                  </button>
                  {outputDir && (
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={onClearOutputDir}
                      aria-label="Reset output folder"
                      className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Primary Action Footer */}
          <div className="space-y-2 border-t border-zinc-800/80 pt-3">
            {(readinessHint || (isAutoUpdating && !batchMode)) && (
              <div className="flex items-center justify-end">
                {readinessHint ? (
                  <span className="rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                    {readinessHint}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-[#722ED1]/50 bg-[#722ED1]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FAF5FF]">
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-[#A855F7]" />
                    <span>Updating…</span>
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!canRun}
              onClick={onRunMatch}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#722ED1] px-4 py-2.5 text-sm font-semibold text-[#FAF5FF] shadow-[0_4px_16px_rgba(114,46,209,0.35)] transition hover:bg-[#7E22CE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FAF5FF] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{batchMode ? 'Matching Batch...' : 'Matching...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {batchMode ? 'Match Batch' : singleResult ? 'Re-run Match' : 'Match Tone'}
                  </span>
                </>
              )}
            </button>

            {!batchMode && singleResult && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onSaveSingleResult}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                >
                  <Download className="h-3.5 w-3.5 text-[#A855F7]" />
                  <span>
                    {isDesktop
                      ? `Save ${singleResult.format.toUpperCase()}`
                      : `Download ${singleResult.format.toUpperCase()}`}
                  </span>
                </button>
                {isDesktop && singleResult.output_path && (
                  <button
                    type="button"
                    onClick={() => {
                      if (singleResult.output_path) {
                        onRevealPath(singleResult.output_path);
                      }
                    }}
                    aria-label="Reveal output file in Finder"
                    title="Reveal in Folder"
                    className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {batchMode && batchResult && (batchResult.zip_data_url || batchResult.output_dir) && (
              <button
                type="button"
                onClick={() => {
                  if (batchResult.zip_data_url) {
                    onDownloadBatchZip();
                  } else if (batchResult.output_dir) {
                    onRevealPath(batchResult.output_dir);
                  }
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
              >
                {batchResult.zip_data_url ? (
                  <>
                    <Download className="h-3.5 w-3.5 text-[#A855F7]" />
                    <span>Download Batch ZIP</span>
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-3.5 w-3.5 text-[#A855F7]" />
                    <span>Open Output Folder</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Settings Tab */
        <div
          id="panel-settings"
          role="tabpanel"
          aria-labelledby="tab-settings"
          className="flex flex-1 flex-col justify-between gap-3 overflow-y-auto px-3.5 py-3"
        >
          <div className="space-y-3">
            {/* Export Naming & Save Preferences */}
            <div className="space-y-2.5 rounded-xl border border-zinc-800/90 bg-[#18181B] p-3">
              <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Export Preferences
              </span>

              <div className="space-y-1.5">
                <label
                  htmlFor="filename-suffix-input"
                  className="block text-xs font-medium text-zinc-200"
                >
                  Filename Suffix
                </label>
                <input
                  id="filename-suffix-input"
                  type="text"
                  value={filenameSuffix}
                  onChange={(e) => onFilenameSuffixChange(e.target.value)}
                  placeholder="_matchtone"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-[#722ED1] focus:outline-none"
                />
              </div>

              {isDesktop ? (
                <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2.5">
                  <span className="text-xs font-medium text-zinc-200">Auto-Save to Folder</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSaveDesktop}
                    aria-label="Auto-Save to Folder"
                    onClick={() => onToggleAutoSaveDesktop(!autoSaveDesktop)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                      autoSaveDesktop ? 'bg-[#722ED1]' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#FAF5FF] transition ${
                        autoSaveDesktop ? 'translate-x-4.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2 text-xs">
                  <span className="text-zinc-400">Save Mode</span>
                  <span className="font-medium text-zinc-200">Manual Download</span>
                </div>
              )}
            </div>

            {/* Live Telemetry Card */}
            <div className="space-y-2 rounded-xl border border-zinc-800/90 bg-[#18181B] p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-[#A855F7]" />
                  <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                    Live Telemetry
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onRefreshHealth}
                  aria-label="Refresh telemetry"
                  className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <dl className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">Engine</dt>
                  <dd
                    className={`font-semibold ${
                      engineOnline === true
                        ? 'text-[#10B981]'
                        : engineOnline === false
                          ? 'text-[#E11D48]'
                          : 'text-zinc-300'
                    }`}
                  >
                    {engineOnline === true
                      ? `Ready · color-matcher ${health?.engine_version ?? '0.6.0'}`
                      : engineOnline === false
                        ? 'Offline'
                        : 'Checking'}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">Memory (Current / Peak)</dt>
                  <dd className="font-mono text-[11px] text-zinc-200">
                    {memoryStats
                      ? `${memoryStats.rss_mb.toFixed(1)} / ${memoryStats.peak_rss_mb.toFixed(1)} MB`
                      : '—'}
                  </dd>
                </div>

                {mainTelemetry && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-zinc-400">App Memory</dt>
                    <dd className="font-mono text-[11px] text-zinc-200">
                      {mainTelemetry.rssMb.toFixed(1)} / {mainTelemetry.peakRssMb.toFixed(1)} MB
                    </dd>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">Startup Warmup</dt>
                  <dd className="font-mono text-[11px] text-zinc-200">
                    {health ? `${health.warmup_ms.toFixed(1)} ms` : '—'}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">Speed (Median / P95)</dt>
                  <dd className="font-mono text-[11px] text-zinc-200">
                    {latencyStats
                      ? `${latencyStats.p50_ms.toFixed(1)} / ${latencyStats.p95_ms.toFixed(1)} ms`
                      : '—'}
                  </dd>
                </div>

                <div className="border-t border-zinc-800/80 pt-1.5">
                  <dt className="mb-0.5 text-[11px] text-zinc-400">Last Breakdown</dt>
                  <dd className="font-mono text-[11px] text-zinc-200">
                    {breakdown
                      ? `Dec ${breakdown.decode_ms.toFixed(1)} · Map ${breakdown.transfer_ms.toFixed(1)} · Enc ${breakdown.encode_ms.toFixed(1)} ms`
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-zinc-800/80 pt-3">
            <button
              type="button"
              disabled={isProcessing}
              onClick={onResetDefaults}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-50"
            >
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={onResetAll}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-[#E11D48]/60 hover:bg-[#E11D48]/10 hover:text-zinc-100 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset All</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

# Changelog

All notable changes to **MatchTone** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-09

### Added

- Native desktop application powered by Electron, `electron-vite`, React 19, TypeScript, and Tailwind CSS v4 with full standalone browser fallback mode.
- Local Python sidecar (`color-engine`) wrapping official [`hahnec/color-matcher`](https://github.com/hahnec/color-matcher) with zero cloud uploads and deterministic offline execution.
- Support for all 6 official color transfer methods:
  - `hm-mvgd-hm` (Histogram + Multivariate Gaussian Transfer — default)
  - `hm-mkl-hm` (Histogram + Monge-Kantorovitch Linear)
  - `mkl` (Monge-Kantorovitch Linear)
  - `mvgd` (Multivariate Gaussian Distribution)
  - `reinhard` (Reinhard Lab Transfer)
  - `hm` (Histogram Matching)
- Continuous blend strength control (`0%`–`100%`) and lossless/lossy output formats (`PNG`, `JPG`, `WEBP`, `TIFF` with browser-safe PNG preview fallback).
- Interactive Before/After split-comparison canvas (`clip-path` geometry-locked slider with pointer capture and keyboard navigation), dual drag-and-drop / clipboard paste inputs, and Source/Reference swap.
- Batch folder & multi-image processing mode with per-file telemetry and one-click ZIP archive download or direct folder output.
- Real-time memory (`RSS MB`, `Peak RSS MB`), warmup (`ms`), P50/P95 latency, and stage breakdown (`Decode` / `Transfer` / `Encode`) telemetry panel.

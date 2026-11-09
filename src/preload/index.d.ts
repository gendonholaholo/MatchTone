import type { MatchToneDesktopBridge } from '@shared/types';

declare global {
  interface Window {
    matchtone?: MatchToneDesktopBridge;
  }
}

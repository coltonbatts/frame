import { invoke } from '@tauri-apps/api/core';
import type { AnalysisResult, ProjectFile } from '../types/models';

export interface AnalysisPayload {
  analysis: AnalysisResult;
  thumbnailColor: string;
  tags: string[];
}

export function getProcessablePath(file?: ProjectFile): string | null {
  if (!file) {
    return null;
  }

  if (file.localPath) {
    return file.localPath;
  }

  return file.path.startsWith('/') ? file.path : null;
}

export async function analyzeMediaFile(
  path: string,
  sensitivity: number,
): Promise<AnalysisPayload> {
  return invoke<AnalysisPayload>('analyze_media', { path, sensitivity });
}

import { invoke } from '@tauri-apps/api/core';
import type {
  AnalyzeProvenanceRequest,
  DeleteProvenanceShotRequest,
  ProvenanceState,
  ProjectFile,
  ShotRecord,
  UpdateProvenanceShotRequest,
} from '../types/models';
import { getProcessablePath } from './analysis';

function invokeProvenance<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, payload);
}

export function getProvenanceVideoPath(file?: ProjectFile): string | null {
  return getProcessablePath(file);
}

export function canAnalyzeProvenance(file?: ProjectFile): boolean {
  return Boolean(file && getProvenanceVideoPath(file) && file.width > 0 && file.height > 0);
}

export async function loadProvenance(videoPath: string): Promise<ProvenanceState | null> {
  return invokeProvenance<ProvenanceState | null>('load_provenance', { videoPath });
}

export async function analyzeProvenance(
  request: AnalyzeProvenanceRequest,
): Promise<ProvenanceState> {
  return invokeProvenance<ProvenanceState>('analyze_provenance', { request });
}

export async function updateProvenanceShot(
  request: UpdateProvenanceShotRequest,
): Promise<ProvenanceState> {
  return invokeProvenance<ProvenanceState>('update_provenance_shot', { request });
}

export async function deleteProvenanceShot(
  request: DeleteProvenanceShotRequest,
): Promise<ProvenanceState> {
  return invokeProvenance<ProvenanceState>('delete_provenance_shot', { request });
}

export async function revealPathInFinder(path: string): Promise<void> {
  await invoke('show_in_finder', { path });
}

export function getSelectedShot(
  provenance: ProvenanceState | null,
  shotId: string | null,
): ShotRecord | undefined {
  if (!provenance || !shotId) {
    return undefined;
  }

  return provenance.shots.find((shot) => shot.id === shotId);
}

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { ProjectFile, ShotListState } from '../types/models';

const SHOT_LIST_PLUGIN = 'plugin:shot-list';

interface CaptureShotRequest {
  videoPath: string;
  timestampSeconds: number;
  fps: number;
  sceneLabel?: string;
}

interface UpdateShotLabelRequest {
  videoPath: string;
  shotNumber: number;
  sceneLabel: string;
}

interface DeleteShotRequest {
  videoPath: string;
  shotNumber: number;
}

interface SetShotOutputDirectoryRequest {
  videoPath: string;
  outputDir: string;
}

function invokeShotList<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return invoke<T>(`${SHOT_LIST_PLUGIN}|${command}`, payload);
}

export function getShotListVideoPath(file?: ProjectFile): string | null {
  const candidate = file?.localPath ?? file?.path;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export function canCaptureShots(file?: ProjectFile): boolean {
  return Boolean(file && getShotListVideoPath(file) && file.width > 0 && file.height > 0);
}

export async function loadShotList(videoPath: string): Promise<ShotListState> {
  return invokeShotList<ShotListState>('load_shot_list', { videoPath });
}

export async function captureShot(request: CaptureShotRequest): Promise<ShotListState> {
  return invokeShotList<ShotListState>('capture_shot', { request });
}

export async function updateShotLabel(request: UpdateShotLabelRequest): Promise<ShotListState> {
  return invokeShotList<ShotListState>('update_shot_label', { request });
}

export async function deleteShot(request: DeleteShotRequest): Promise<ShotListState> {
  return invokeShotList<ShotListState>('delete_shot', { request });
}

export async function setShotOutputDirectory(
  request: SetShotOutputDirectoryRequest,
): Promise<ShotListState> {
  return invokeShotList<ShotListState>('set_shot_output_directory', { request });
}

export async function exportShotListZip(videoPath: string): Promise<string> {
  return invokeShotList<string>('export_shot_list_zip', { videoPath });
}

export async function pickShotOutputDirectory(
  defaultPath?: string,
): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });

  return typeof result === 'string' ? result : null;
}

export async function revealPathInFinder(path: string): Promise<void> {
  await invoke('show_in_finder', { path });
}

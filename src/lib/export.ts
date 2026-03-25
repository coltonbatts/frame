import { join, dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import type { ExportPreset, ProjectFile } from '../types/models';

export interface ExportJob {
  queueId: string;
  inputPath: string;
  outputPath: string;
  duration: number;
  preset: ExportPreset;
}

export interface ExportProgressEvent {
  queueId: string;
  progress: number;
}

export interface ExportCompleteEvent {
  queueId: string;
  outputPath: string;
}

export interface ExportErrorEvent {
  queueId: string;
  error: string;
}

export const defaultExportPreset: ExportPreset = {
  id: 'preset-h265-4k',
  name: 'H.265 4K',
  container: 'mp4',
  videoCodec: 'h265',
  audioCodec: 'aac',
  bitrate: '14M',
  resolution: '3840x2160',
  fps: 24,
};

function getSourcePath(file: ProjectFile): string {
  return file.localPath ?? file.path;
}

function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function getExportExtension(container: ExportPreset['container']): string {
  return container;
}

export async function buildExportJob(
  file: ProjectFile,
  preset: ExportPreset,
  queueId: string,
): Promise<ExportJob> {
  const inputPath = getSourcePath(file);
  const outputDir = await join(await dirname(inputPath), 'Exports');
  const outputName = `${getBaseName(file.name)}_${preset.videoCodec}.${getExportExtension(preset.container)}`;

  return {
    queueId,
    inputPath,
    outputPath: await join(outputDir, outputName),
    duration: file.duration,
    preset,
  };
}

export function buildExportFileName(file: ProjectFile, preset: ExportPreset): string {
  return `${getBaseName(file.name)}_${preset.videoCodec}.${getExportExtension(preset.container)}`;
}

export async function runExportJob(job: ExportJob): Promise<string> {
  return invoke<string>('process_queue', { job });
}

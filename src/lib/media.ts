import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { ProjectFile } from '../types/models';
import { createAnalysisSeed } from '../data/mock';

const VIDEO_EXTENSIONS = new Set([
  'avi', 'm4v', 'mkv', 'mov', 'mp4',
  'mpeg', 'mpg', 'mxf', 'webm',
]);

const AUDIO_EXTENSIONS = new Set([
  'aac', 'aif', 'aiff', 'alac', 'flac',
  'm4a', 'mp3', 'oga', 'ogg', 'wav', 'wma',
]);

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function isPreviewableMedia(name: string, mimeType = ''): boolean {
  const ext = getFileExtension(name);
  return (
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    VIDEO_EXTENSIONS.has(ext) ||
    AUDIO_EXTENSIONS.has(ext) ||
    mimeType === 'application/ogg'
  );
}

interface FileMetadata {
  path: string;
  name: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
}

/**
 * Open native file dialog and return selected file paths.
 */
export async function openNativeFileDialog(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [
      {
        name: 'Video & Audio',
        extensions: [
          'mov', 'm4v', 'mp4', 'mkv', 'webm', 'avi', 'mxf', 'mpg', 'mpeg',
          'mp3', 'wav', 'flac', 'm4a', 'aac', 'aiff', 'aif', 'alac', 'ogg',
        ],
      },
      { name: 'Video', extensions: ['mov', 'm4v', 'mp4', 'mkv', 'webm', 'avi', 'mxf'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'aiff'] },
    ],
  });

  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/**
 * Import a file from a native file path (via Tauri dialog or direct path).
 * Reads the file, extracts real metadata via ffprobe, and creates a blob URL for playback.
 */
export async function createProjectFileFromPath(
  filePath: string,
  index: number,
): Promise<ProjectFile> {
  // Read file bytes and create blob URL for video playback
  const bytes = await readFile(filePath);
  const blob = new Blob([bytes]);
  const sourceUrl = URL.createObjectURL(blob);

  // Get real metadata from ffprobe via Rust backend
  let metadata: FileMetadata;
  try {
    metadata = await invoke<FileMetadata>('get_file_metadata', { path: filePath });
  } catch {
    // Fallback if ffprobe fails — derive what we can from filename
    const name = filePath.split('/').pop() ?? filePath;
    metadata = {
      path: filePath,
      name,
      size: bytes.byteLength,
      duration: 0,
      width: 0,
      height: 0,
      codec: getFileExtension(name).toUpperCase(),
      fps: 24,
    };
  }

  const seed = createAnalysisSeed(metadata.name, metadata.duration || 240);

  return {
    id: `local-${metadata.name}-${Date.now()}-${index}`,
    folder: 'raw',
    name: metadata.name,
    path: metadata.path,
    size: metadata.size,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    codec: metadata.codec,
    fps: metadata.fps,
    state: 'idle',
    thumbnailColor: seed.thumbnailColor,
    tags: seed.tags,
    analysis: seed.analysis,
    sourceUrl,
  };
}

/**
 * Import files from browser File objects (drag-drop or file input).
 * Uses browser metadata APIs and blob URLs — no Tauri needed.
 */
export async function createProjectFileFromUpload(
  file: File,
  index: number,
): Promise<ProjectFile> {
  const ext = getFileExtension(file.name);
  const isMedia = isPreviewableMedia(file.name, file.type);
  const sourceUrl = isMedia ? URL.createObjectURL(file) : undefined;

  let duration = 0;
  let width = 0;
  let height = 0;

  if (sourceUrl && (file.type.startsWith('video/') || file.type.startsWith('audio/'))) {
    const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    media.preload = 'metadata';
    media.src = sourceUrl;
    media.muted = true;

    await new Promise<void>((resolve) => {
      media.onloadedmetadata = () => {
        duration = Number.isFinite(media.duration) ? media.duration : 0;
        if (media instanceof HTMLVideoElement) {
          width = media.videoWidth;
          height = media.videoHeight;
        }
        resolve();
      };
      media.onerror = () => resolve();
      // Timeout fallback
      setTimeout(resolve, 3000);
    });

    // Clean up the element
    media.removeAttribute('src');
    media.load();
  }

  const seed = createAnalysisSeed(file.name, duration || 240);

  return {
    id: `upload-${file.name}-${file.lastModified}-${index}`,
    folder: 'raw',
    name: file.name,
    path: file.name,
    size: file.size,
    duration,
    width,
    height,
    codec: ext.toUpperCase(),
    fps: 24,
    state: 'idle',
    thumbnailColor: seed.thumbnailColor,
    tags: seed.tags,
    analysis: seed.analysis,
    sourceUrl,
  };
}

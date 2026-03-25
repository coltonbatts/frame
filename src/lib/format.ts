export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;

  return [hours, minutes, remaining]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

export function formatSmpte(totalSeconds: number, fps = 24): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 24;
  const wholeSeconds = Math.floor(safeSeconds);
  let hours = Math.floor(wholeSeconds / 3600);
  let minutes = Math.floor((wholeSeconds % 3600) / 60);
  let seconds = wholeSeconds % 60;
  let frames = Math.floor(((safeSeconds - wholeSeconds) * safeFps) + 1e-6);
  const frameSlots = Math.max(1, Math.ceil(safeFps));

  if (frames >= frameSlots) {
    frames = 0;
    seconds += 1;

    if (seconds >= 60) {
      seconds = 0;
      minutes += 1;

      if (minutes >= 60) {
        minutes = 0;
        hours += 1;
      }
    }
  }

  return [hours, minutes, seconds, frames]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

export function formatResolution(width: number, height: number): string {
  if (!width || !height) {
    return 'Unknown';
  }

  return `${width}×${height}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toTitleCase(value: string): string {
  return value
    .split(/[\s-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

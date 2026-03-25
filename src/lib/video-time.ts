const DEFAULT_FPS = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getSafeFps(fps?: number | null): number {
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
}

export function getFrameDuration(fps?: number | null): number {
  return 1 / getSafeFps(fps);
}

export function clampTimeToDuration(time: number, duration?: number | null): number {
  const safeTime = Number.isFinite(time) ? time : 0;
  const safeDuration =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : undefined;

  if (safeDuration === undefined) {
    return Math.max(0, safeTime);
  }

  return clamp(Math.max(0, safeTime), 0, safeDuration);
}

export function snapTimeToFrame(time: number, fps?: number | null): number {
  const safeFps = getSafeFps(fps);
  return Math.round(Math.max(0, Number.isFinite(time) ? time : 0) * safeFps) / safeFps;
}

export function alignTimeToVideo(
  time: number,
  fps?: number | null,
  duration?: number | null,
): number {
  return clampTimeToDuration(snapTimeToFrame(time, fps), duration);
}

export function stepTimeByFrames(
  time: number,
  direction: -1 | 1,
  fps?: number | null,
  duration?: number | null,
): number {
  return alignTimeToVideo(time + direction * getFrameDuration(fps), fps, duration);
}

export function stepTimeBySeconds(
  time: number,
  seconds: number,
  fps?: number | null,
  duration?: number | null,
): number {
  return alignTimeToVideo(time + seconds, fps, duration);
}

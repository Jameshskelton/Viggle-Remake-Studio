export const MIN_FRAMES = 90;
export const MAX_FRAMES = 345;
export const FRAME_STEP = 17;

export function clipFrames(seconds: number) {
  const n = Math.round((seconds * 24 - 5) / FRAME_STEP);
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, n * FRAME_STEP + 5));
}

export function validFrameCount(frames: number) {
  return Number.isInteger(frames) && frames >= MIN_FRAMES && frames <= MAX_FRAMES && (frames - 5) % FRAME_STEP === 0;
}

export function secondsForFrames(frames: number) {
  return frames / 24;
}

export function frameOptions() {
  return Array.from({ length: (MAX_FRAMES - MIN_FRAMES) / FRAME_STEP + 1 }, (_, i) => {
    const frames = MIN_FRAMES + i * FRAME_STEP;
    return { frames, seconds: secondsForFrames(frames) };
  });
}

export function candidateIndices(frames: number, count = 8) {
  const fractions = Array.from({ length: count }, (_, i) => 0.04 + (0.92 * i) / Math.max(1, count - 1));
  return [...new Set(fractions.map((fraction) => Math.min(frames - 1, Math.max(0, Math.round(fraction * (frames - 1))))))];
}

// Frames on the 24 fps working timeline for a source clip.
export function sourceFramesFor(duration: number) {
  return Math.max(1, Math.round(duration * 24));
}

// The longest valid Viggle Remake window that fits in the source. Shorter sources
// return MIN_FRAMES and are looped by the backend.
export function bestFitFrames(sourceFrames: number) {
  if (sourceFrames <= MIN_FRAMES) return MIN_FRAMES;
  const capped = Math.min(sourceFrames, MAX_FRAMES);
  const n = Math.floor((capped - 5) / FRAME_STEP);
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, n * FRAME_STEP + 5));
}


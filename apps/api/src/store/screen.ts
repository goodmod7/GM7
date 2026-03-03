import type { ScreenFrameMeta } from '@ai-operator/shared';

interface ScreenFrame {
  meta: ScreenFrameMeta;
  bytes: Buffer;
  updatedAt: number;
}

// In-memory store for latest screen frames only
const frames = new Map<string, ScreenFrame>();

// Rate limiting tracking: deviceId -> last frame timestamp
const lastFrameTime = new Map<string, number>();

// Constants
const FRAME_EXPIRY_MS = 60_000; // 60 seconds
const CLEANUP_INTERVAL_MS = 30_000; // 30 seconds
const MAX_FRAME_BYTES = 1_000_000; // 1MB decoded
const MIN_FRAME_INTERVAL_MS = 500; // Max 2 FPS (1000/2 = 500ms)

export const screenStore = {
  setFrame(deviceId: string, meta: ScreenFrameMeta, bytes: Buffer): boolean {
    // Check rate limit
    const now = Date.now();
    const lastTime = lastFrameTime.get(deviceId);
    if (lastTime && now - lastTime < MIN_FRAME_INTERVAL_MS) {
      return false; // Rate limited
    }

    // Check size limit
    if (bytes.length > MAX_FRAME_BYTES) {
      return false; // Too large
    }

    frames.set(deviceId, {
      meta,
      bytes,
      updatedAt: now,
    });

    lastFrameTime.set(deviceId, now);
    return true;
  },

  getFrame(deviceId: string): ScreenFrame | undefined {
    const frame = frames.get(deviceId);
    if (!frame) return undefined;

    // Check if expired
    if (Date.now() - frame.updatedAt > FRAME_EXPIRY_MS) {
      frames.delete(deviceId);
      return undefined;
    }

    return frame;
  },

  getMeta(deviceId: string): ScreenFrameMeta | undefined {
    return this.getFrame(deviceId)?.meta;
  },

  clearFrame(deviceId: string): void {
    frames.delete(deviceId);
    lastFrameTime.delete(deviceId);
  },

  count(): number {
    this.cleanup();
    return frames.size;
  },

  // Cleanup expired frames
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [deviceId, frame] of frames) {
      if (now - frame.updatedAt > FRAME_EXPIRY_MS) {
        frames.delete(deviceId);
        lastFrameTime.delete(deviceId);
        count++;
      }
    }

    return count;
  },

  // Check if device is rate limited
  isRateLimited(deviceId: string): boolean {
    const lastTime = lastFrameTime.get(deviceId);
    if (!lastTime) return false;
    return Date.now() - lastTime < MIN_FRAME_INTERVAL_MS;
  },
};

// Periodic cleanup
setInterval(() => {
  const cleaned = screenStore.cleanup();
  void cleaned;
}, CLEANUP_INTERVAL_MS);

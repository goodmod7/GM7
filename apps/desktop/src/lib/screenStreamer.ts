import { invoke } from '@tauri-apps/api/core';
import { createDeviceMessage, createScreenFrameMeta, type ScreenStreamState } from '@ai-operator/shared';
import type { WsClient } from './wsClient.js';

export interface DisplayInfo {
  displayId: string;
  name?: string;
  width: number;
  height: number;
}

export interface CaptureResult {
  pngBase64: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface CaptureError {
  message: string;
  needsPermission: boolean;
  permissionTarget?: 'screenRecording';
}

export interface ScreenStreamerOptions {
  wsClient: WsClient;
  deviceId: string;
  onStateChange?: (state: ScreenStreamState & { isStreaming: boolean }) => void;
  onFrameSent?: (meta: { width: number; height: number; byteLength: number; at: number }) => void;
  onError?: (error: CaptureError) => void;
}

export class ScreenStreamer {
  private state: ScreenStreamState & { isStreaming: boolean } = {
    enabled: false,
    fps: 1,
    isStreaming: false,
  };
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private options: ScreenStreamerOptions;
  private lastFrameTime = 0;

  constructor(options: ScreenStreamerOptions) {
    this.options = options;
  }

  getState(): ScreenStreamState & { isStreaming: boolean } {
    return { ...this.state };
  }

  async listDisplays(): Promise<DisplayInfo[]> {
    try {
      return await invoke<DisplayInfo[]>('list_displays');
    } catch (e) {
      console.error('[ScreenStreamer] Failed to list displays:', e);
      return [];
    }
  }

  async start(config: { displayId: string; fps: 1 | 2 }): Promise<boolean> {
    if (this.state.isStreaming) {
      console.log('[ScreenStreamer] Already streaming');
      return true;
    }

    // Check if WS is connected
    if (this.options.wsClient.getStatus() !== 'connected') {
      console.error('[ScreenStreamer] Cannot start: WebSocket not connected');
      return false;
    }

    // Send stream state to server
    this.state = {
      enabled: true,
      fps: config.fps,
      displayId: config.displayId,
      isStreaming: true,
    };

    const stateMsg = createDeviceMessage('device.screen.stream_state', {
      deviceId: this.options.deviceId,
      state: {
        enabled: true,
        fps: config.fps,
        displayId: config.displayId,
      },
    });
    this.options.wsClient.send(stateMsg);

    // Start capture loop
    const intervalMs = 1000 / config.fps;
    this.intervalId = setInterval(() => this.captureAndSend(config.displayId), intervalMs);

    this.options.onStateChange?.(this.state);
    console.log('[ScreenStreamer] Started streaming', config);
    return true;
  }

  stop(): void {
    if (!this.state.isStreaming) return;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Send disabled state to server
    this.state = {
      ...this.state,
      enabled: false,
      isStreaming: false,
    };

    const stateMsg = createDeviceMessage('device.screen.stream_state', {
      deviceId: this.options.deviceId,
      state: {
        enabled: false,
        fps: this.state.fps,
        displayId: this.state.displayId,
      },
    });
    this.options.wsClient.send(stateMsg);

    this.options.onStateChange?.(this.state);
    console.log('[ScreenStreamer] Stopped streaming');
  }

  private async captureAndSend(displayId: string): Promise<void> {
    // Check rate limit (simple check)
    const now = Date.now();
    if (now - this.lastFrameTime < 400) { // Max ~2.5 FPS actual
      return;
    }

    // Check WS connection
    if (this.options.wsClient.getStatus() !== 'connected') {
      console.warn('[ScreenStreamer] WS disconnected, pausing capture');
      return;
    }

    try {
      const result = await invoke<CaptureResult>('capture_display_png', {
        displayId,
        maxWidth: 1280,
      });

      // Create meta
      const meta = createScreenFrameMeta(result.width, result.height, result.byteLength);

      // Send frame
      const frameMsg = createDeviceMessage('device.screen.frame', {
        deviceId: this.options.deviceId,
        meta,
        dataBase64: result.pngBase64,
      });
      
      this.options.wsClient.send(frameMsg);
      this.lastFrameTime = now;

      this.options.onFrameSent?.({
        width: result.width,
        height: result.height,
        byteLength: result.byteLength,
        at: now,
      });
    } catch (e) {
      const error = e as CaptureError;
      console.error('[ScreenStreamer] Capture failed:', error.message);
      this.options.onError?.({
        ...error,
        permissionTarget: error.needsPermission ? 'screenRecording' : undefined,
      });
      
      // Stop streaming on permission error
      if (error.needsPermission) {
        this.stop();
      }
    }
  }
}

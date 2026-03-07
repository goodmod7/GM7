import { useState, useEffect, useCallback } from 'react';
import { ScreenStreamer, type DisplayInfo, type CaptureError } from '../lib/screenStreamer.js';
import { getPermissionInstructions, type NativePermissionStatus, type PermissionTarget } from '../lib/permissions.js';
import type { WsClient } from '../lib/wsClient.js';


interface ScreenPanelProps {
  wsClient: WsClient;
  deviceId: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onDisplayChange?: (displayId: string) => void;
  permissionStatus: NativePermissionStatus;
  onOpenPermissionSettings: (target: PermissionTarget) => void;
  onPermissionIssue?: (message: string) => void;
}

export function ScreenPanel({
  wsClient,
  deviceId,
  enabled,
  onToggle,
  onDisplayChange,
  permissionStatus,
  onOpenPermissionSettings,
  onPermissionIssue,
}: ScreenPanelProps) {
  const [streamer, setStreamer] = useState<ScreenStreamer | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [hasLoadedDisplays, setHasLoadedDisplays] = useState(false);
  const [selectedDisplay, setSelectedDisplay] = useState<string>('');
  const [fps, setFps] = useState<1 | 2>(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastFrame, setLastFrame] = useState<{ width: number; height: number; byteLength: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);

  // Initialize streamer
  useEffect(() => {
    const s = new ScreenStreamer({
      wsClient,
      deviceId,
      onStateChange: (state) => {
        setIsStreaming(state.isStreaming);
      },
      onFrameSent: (meta) => {
        setLastFrame(meta);
      },
      onError: (err: CaptureError) => {
        setError(err.message);
        setNeedsPermission(err.needsPermission);
        if (err.needsPermission) {
          onPermissionIssue?.(err.message);
        }
        if (err.needsPermission) {
          onToggle(false);
        }
      },
    });
    setStreamer(s);

    // Load displays
    s.listDisplays().then((d) => {
      setDisplays(d);
      setHasLoadedDisplays(true);
      if (d.length > 0) {
        setSelectedDisplay(d[0].displayId);
        onDisplayChange?.(d[0].displayId);
      }
    });

    return () => {
      s.stop();
    };
  }, [wsClient, deviceId, onDisplayChange, onToggle]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!streamer) {
        return;
      }

      const current = streamer.getState();
      if (!enabled) {
        if (current.isStreaming) {
          streamer.stop();
        }
        return;
      }

      if (!selectedDisplay) {
        if (hasLoadedDisplays) {
          setError('Please select a display');
          onToggle(false);
        }
        return;
      }

      setError(null);
      setNeedsPermission(false);

      const needsRestart =
        !current.isStreaming ||
        current.displayId !== selectedDisplay ||
        current.fps !== fps;

      if (!needsRestart) {
        return;
      }

      if (current.isStreaming) {
        streamer.stop();
      }

      const started = await streamer.start({ displayId: selectedDisplay, fps });
      if (!started && !cancelled) {
        setError('Failed to start streaming. Check WebSocket connection.');
        onToggle(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streamer, enabled, selectedDisplay, fps, hasLoadedDisplays, onToggle]);

  const handleDisplayChange = useCallback((displayId: string) => {
    setSelectedDisplay(displayId);
    onDisplayChange?.(displayId);
  }, [onDisplayChange]);

  const screenRecordingInstructions = getPermissionInstructions('screenRecording');

  return (
    <div
      style={{
        marginTop: '1.5rem',
        padding: '1rem',
        background: 'white',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Screen Preview</h3>

      {needsPermission && (
        <div
          style={{
            padding: '0.75rem',
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: '#92400e',
          }}
        >
          <strong>Permission Required:</strong> Screen Recording permission is needed. 
          Enable it in System Settings &gt; Privacy &amp; Security &gt; Screen Recording for this app.
          <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', lineHeight: 1.5 }}>
            {screenRecordingInstructions.map((step) => (
              <div key={step}>{step}</div>
            ))}
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <button
              onClick={() => onOpenPermissionSettings('screenRecording')}
              style={{
                padding: '0.5rem 0.75rem',
                backgroundColor: '#92400e',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              Open Screen Recording Settings
            </button>
          </div>
        </div>
      )}

      {error && !needsPermission && (
        <div
          style={{
            padding: '0.75rem',
            background: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: '#dc2626',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Display selector */}
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
            Display
          </label>
          <select
            value={selectedDisplay}
            onChange={(e) => handleDisplayChange(e.target.value)}
            disabled={isStreaming}
            style={{
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '0.875rem',
              minWidth: '150px',
            }}
          >
            {displays.length === 0 && <option value="">No displays</option>}
            {displays.map((d) => (
              <option key={d.displayId} value={d.displayId}>
                {d.name || d.displayId}
              </option>
            ))}
          </select>
        </div>

        {/* FPS selector */}
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
            FPS
          </label>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) as 1 | 2)}
            disabled={isStreaming}
            style={{
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '0.875rem',
            }}
          >
            <option value={1}>1 FPS</option>
            <option value={2}>2 FPS</option>
          </select>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => onToggle(!enabled)}
          disabled={!selectedDisplay}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: isStreaming ? '#ef4444' : selectedDisplay ? '#10b981' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '0.875rem',
            cursor: selectedDisplay ? 'pointer' : 'not-allowed',
            marginTop: '1rem',
          }}
        >
          {isStreaming ? 'Stop Sharing' : 'Share Screen Preview'}
        </button>
      </div>

      {/* Status */}
      <div style={{ marginTop: '1rem', fontSize: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isStreaming ? '#10b981' : '#9ca3af',
            }}
          />
          <span>{isStreaming ? 'Streaming active' : 'Preview off'}</span>
        </div>

        {isStreaming && lastFrame && (
          <div style={{ marginTop: '0.5rem', color: '#666', fontSize: '0.75rem' }}>
            Last frame: {lastFrame.width}x{lastFrame.height} ({(lastFrame.byteLength / 1024).toFixed(1)} KB) at{' '}
            {new Date(lastFrame.at).toLocaleTimeString()}
          </div>
        )}
      </div>

      <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#666' }}>
        Privacy: Screen preview is opt-in. Only the latest frame is stored on the server (expires in 60s).
        Max resolution: 1280px width. No recording or persistent storage.
      </p>

      <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#666' }}>
        Native permission status: Screen Recording is <strong>{permissionStatus.screenRecording}</strong>.
      </p>
    </div>
  );
}

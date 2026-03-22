import { invoke } from '@tauri-apps/api/core';
import type { InputAction } from '@ai-operator/shared';

export interface ActionResult {
  ok: boolean;
  error?: { code: string; message: string; permissionTarget?: 'accessibility' };
}

export async function executeAction(action: InputAction, displayId: string = 'display-0'): Promise<ActionResult> {
  try {
    switch (action.kind) {
      case 'click':
        await invoke('input_click', {
          xNorm: action.x,
          yNorm: action.y,
          button: action.button,
          displayId,
        });
        return { ok: true };

      case 'double_click':
        await invoke('input_double_click', {
          xNorm: action.x,
          yNorm: action.y,
          button: action.button,
          displayId,
        });
        return { ok: true };

      case 'scroll':
        await invoke('input_scroll', {
          dx: action.dx,
          dy: action.dy,
        });
        return { ok: true };

      case 'type':
        await invoke('input_type', {
          text: action.text,
        });
        return { ok: true };

      case 'hotkey':
        await invoke('input_hotkey', {
          key: action.key,
          modifiers: action.modifiers || [],
        });
        return { ok: true };

      case 'open_app':
        await invoke('open_application', {
          appName: action.appName,
        });
        return { ok: true };

      default:
        return {
          ok: false,
          error: { code: 'UNKNOWN_ACTION', message: 'Unknown action kind' },
        };
    }
  } catch (e) {
    const err = e as { message?: string };
    const msg = err.message || 'Action execution failed';
    
    // Check for permission errors
    const needsPermission = msg.includes('permission') || 
                           msg.includes('Accessibility') ||
                           msg.includes('denied');
    
    return {
      ok: false,
      error: {
        code: needsPermission ? 'PERMISSION_DENIED' : 'EXECUTION_FAILED',
        message: msg,
        permissionTarget: needsPermission ? 'accessibility' : undefined,
      },
    };
  }
}

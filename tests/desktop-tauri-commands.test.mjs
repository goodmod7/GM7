import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rustSrcRoot = 'apps/desktop/src-tauri/src';
const permissionPath = 'apps/desktop/src-tauri/permissions/desktop-ipc.toml';

function listRustFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listRustFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.rs') ? [fullPath] : [];
  });
}

function extractCommandNames() {
  const commandNames = new Set();
  const commandPattern = /#\s*\[\s*tauri::command(?:\([^)]*\))?\s*]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/g;

  for (const filePath of listRustFiles(rustSrcRoot)) {
    const source = readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(commandPattern)) {
      commandNames.add(match[1]);
    }
  }

  return [...commandNames].sort();
}

function extractAllowedCommands() {
  const source = readFileSync(permissionPath, 'utf8');
  const match = source.match(/commands\.allow\s*=\s*\[(.*?)\]/s);
  assert.ok(match, 'desktop IPC permission must define commands.allow');
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

test('desktop IPC permission allowlist matches exported Rust commands exactly', () => {
  const rustCommands = extractCommandNames();
  const allowedCommands = extractAllowedCommands();

  assert.deepEqual(allowedCommands, [
    'approve_agent_proposal',
    'autostart_is_enabled',
    'autostart_set_enabled',
    'autostart_supported',
    'cancel_agent_task',
    'capture_display_png',
    'clear_llm_api_key',
    'deny_agent_proposal',
    'desktop_auth_listen_cancel',
    'desktop_auth_listen_finish',
    'desktop_auth_listen_start',
    'device_token_clear',
    'device_token_get',
    'device_token_set',
    'get_agent_task_status',
    'has_llm_api_key',
    'has_provider_api_key',
    'input_click',
    'input_double_click',
    'input_hotkey',
    'input_scroll',
    'input_type',
    'local_ai_hardware_profile',
    'local_ai_install_progress',
    'local_ai_install_start',
    'local_ai_enable_vision_boost',
    'local_ai_recommended_tier',
    'local_ai_start',
    'local_ai_status',
    'local_ai_stop',
    'list_agent_providers',
    'list_displays',
    'llm_propose_next_action',
    'main_window_hide',
    'main_window_enter_overlay_mode',
    'main_window_exit_overlay_mode',
    'main_window_overlay_status',
    'main_window_show',
    'open_external_url',
    'permissions_get_status',
    'permissions_open_settings',
    'set_llm_api_key',
    'set_provider_api_key',
    'start_agent_task',
    'start_recording',
    'submit_agent_user_response',
    'test_provider',
    'tool_execute',
    'tray_update_state',
    'workspace_clear',
    'workspace_configure',
    'workspace_get_state',
    'workspace_select_directory',
  ].sort());

  assert.deepEqual(
    allowedCommands,
    rustCommands,
    'every exported tauri command must be explicitly allowlisted and no extra commands may be exposed'
  );
});

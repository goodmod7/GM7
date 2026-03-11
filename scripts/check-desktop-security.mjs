import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const tauriConfigPath = 'apps/desktop/src-tauri/tauri.conf.json';
const capabilityPath = 'apps/desktop/src-tauri/capabilities/default.json';
const permissionPath = 'apps/desktop/src-tauri/permissions/desktop-ipc.toml';
const cargoTomlPath = 'apps/desktop/src-tauri/Cargo.toml';
const desktopSrcRoot = 'apps/desktop/src';
const desktopRustRoot = 'apps/desktop/src-tauri/src';

const expectedCapabilityPermissions = [
  'core:app:allow-version',
  'core:event:allow-listen',
  'core:event:allow-unlisten',
  'desktop-ipc',
];

const expectedCommands = [
  'autostart_is_enabled',
  'autostart_set_enabled',
  'autostart_supported',
  'approve_agent_proposal',
  'cancel_agent_task',
  'capture_display_png',
  'clear_llm_api_key',
  'device_token_clear',
  'device_token_get',
  'device_token_set',
  'desktop_auth_listen_cancel',
  'desktop_auth_listen_finish',
  'desktop_auth_listen_start',
  'deny_agent_proposal',
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
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listFiles(dir, predicate) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath, predicate);
    }
    return entry.isFile() && predicate(entry.name) ? [fullPath] : [];
  });
}

function parseTomlStringArray(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedKey}\\s*=\\s*\\[(.*?)\\]`, 's'));
  if (!match) {
    return [];
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractRustCommands() {
  const commandPattern = /#\s*\[\s*tauri::command(?:\([^)]*\))?\s*]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/g;
  const commands = new Set();

  for (const filePath of listFiles(desktopRustRoot, (name) => name.endsWith('.rs'))) {
    const source = readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(commandPattern)) {
      commands.add(match[1]);
    }
  }

  return [...commands].sort();
}

function assertNoDirectPluginImports() {
  const tsFiles = listFiles(desktopSrcRoot, (name) => /\.(ts|tsx)$/.test(name));
  for (const filePath of tsFiles) {
    const source = readFileSync(filePath, 'utf8');
    assert.ok(
      !source.includes('@tauri-apps/plugin-opener'),
      `${filePath} must not import the opener plugin guest bindings directly`
    );
    assert.ok(
      !source.includes('@tauri-apps/plugin-dialog'),
      `${filePath} must not import the dialog plugin guest bindings directly`
    );
  }
}

function main() {
  assert.ok(existsSync(tauriConfigPath), `missing ${tauriConfigPath}`);
  assert.ok(existsSync(capabilityPath), `missing ${capabilityPath}`);
  assert.ok(existsSync(permissionPath), `missing ${permissionPath}`);
  assert.ok(existsSync(cargoTomlPath), `missing ${cargoTomlPath}`);

  const tauriConfig = readJson(tauriConfigPath);
  const capability = readJson(capabilityPath);
  const permissionSource = readFileSync(permissionPath, 'utf8');
  const cargoToml = readFileSync(cargoTomlPath, 'utf8');
  const libRs = readFileSync(path.join(desktopRustRoot, 'lib.rs'), 'utf8');

  assert.equal(tauriConfig.build?.removeUnusedCommands, true, 'build.removeUnusedCommands must be true');
  assert.equal(typeof tauriConfig.build?.devUrl, 'string', 'build.devUrl must be configured');
  assert.match(tauriConfig.build.devUrl, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/);
  assert.equal(typeof tauriConfig.build?.frontendDist, 'string', 'build.frontendDist must be configured');
  assert.ok(!/^https?:\/\//.test(tauriConfig.build.frontendDist), 'build.frontendDist must be local in production');

  assert.deepEqual(tauriConfig.app?.security?.capabilities, ['default']);

  const prodCsp = tauriConfig.app?.security?.csp;
  assert.equal(typeof prodCsp, 'string', 'production CSP must be a string');
  assert.match(prodCsp, /default-src 'self'/);
  assert.doesNotMatch(prodCsp, /\*/, 'production CSP must not contain wildcard sources');
  assert.doesNotMatch(prodCsp, /'unsafe-eval'/, 'production CSP must not allow unsafe-eval');
  assert.doesNotMatch(prodCsp, /http:\/\//, 'production CSP must not allow insecure HTTP origins');
  assert.doesNotMatch(prodCsp, /ws:\/\//, 'production CSP must not allow insecure WS origins');

  const devCsp = tauriConfig.app?.security?.devCsp;
  assert.equal(typeof devCsp, 'string', 'dev CSP must be configured');
  assert.match(devCsp, /http:\/\/localhost:\*/, 'dev CSP must allow localhost HTTP');
  assert.match(devCsp, /ws:\/\/localhost:\*/, 'dev CSP must allow localhost WS');

  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(capability.permissions, expectedCapabilityPermissions);

  const permissionIdentifiers = [...permissionSource.matchAll(/identifier\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(permissionIdentifiers, ['desktop-ipc']);

  const allowCommands = parseTomlStringArray(permissionSource, 'commands.allow').sort();
  const denyCommands = parseTomlStringArray(permissionSource, 'commands.deny');
  assert.deepEqual(allowCommands, [...expectedCommands].sort());
  assert.deepEqual(denyCommands, []);
  assert.deepEqual(allowCommands, extractRustCommands());

  const pluginConfig = tauriConfig.plugins ?? {};
  for (const forbiddenPlugin of ['shell', 'fs', 'cli', 'process']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(pluginConfig, forbiddenPlugin),
      false,
      `tauri.conf.json must not enable the ${forbiddenPlugin} plugin`
    );
    assert.ok(
      !cargoToml.includes(`tauri-plugin-${forbiddenPlugin}`),
      `Cargo.toml must not include tauri-plugin-${forbiddenPlugin}`
    );
  }

  assert.ok(
    libRs.includes('open_js_links_on_click(false)'),
    'lib.rs must disable automatic external opening for JS links'
  );
  assert.ok(
    libRs.includes('NewWindowResponse::Deny'),
    'lib.rs must deny webview new-window requests'
  );

  assertNoDirectPluginImports();

  console.log('Desktop security check passed');
}

try {
  main();
} catch (error) {
  console.error(`Desktop security check failed: ${error.message}`);
  process.exit(1);
}

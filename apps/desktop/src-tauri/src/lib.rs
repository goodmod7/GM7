use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tokio::sync::RwLock;
use enigo::{Enigo, MouseControllable, KeyboardControllable, Key as EnigoKey, MouseButton as EnigoMouseButton};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

mod llm;
mod workspace;
mod agent;

// Display info structure
#[derive(Serialize)]
struct DisplayInfo {
    display_id: String,
    name: Option<String>,
    width: u32,
    height: u32,
}

// Screen capture result
#[derive(Serialize)]
struct CaptureResult {
    png_base64: String,
    width: u32,
    height: u32,
    byte_length: usize,
}

#[derive(Serialize)]
struct CaptureError {
    message: String,
    needs_permission: bool,
}

// Input injection error
#[derive(Serialize)]
struct InputError {
    message: String,
    needs_permission: bool,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum PermissionState {
    Granted,
    Denied,
    Unknown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionStatusPayload {
    screen_recording: PermissionState,
    accessibility: PermissionState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum PermissionTarget {
    ScreenRecording,
    Accessibility,
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

fn is_permission_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("permission") || lower.contains("denied") || lower.contains("screen recording")
}

fn detect_screen_recording_status() -> PermissionState {
    #[cfg(target_os = "macos")]
    {
        match screenshots::Screen::all() {
            Ok(screens) => {
                let Some(screen) = screens.first() else {
                    return PermissionState::Unknown;
                };
                match screen.capture() {
                    Ok(_) => PermissionState::Granted,
                    Err(err) => {
                        let message = err.to_string();
                        if is_permission_error(&message) {
                            PermissionState::Denied
                        } else {
                            PermissionState::Unknown
                        }
                    }
                }
            }
            Err(err) => {
                let message = err.to_string();
                if is_permission_error(&message) {
                    PermissionState::Denied
                } else {
                    PermissionState::Unknown
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        PermissionState::Unknown
    }
}

fn detect_accessibility_status() -> PermissionState {
    #[cfg(target_os = "macos")]
    {
        if unsafe { AXIsProcessTrusted() } {
            PermissionState::Granted
        } else {
            PermissionState::Denied
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        PermissionState::Unknown
    }
}

fn open_permission_settings_url(app: &AppHandle, url: &str) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open settings: {}", e))
}

fn open_permission_settings_impl(app: &AppHandle, target: PermissionTarget) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let preferred = match target {
            PermissionTarget::ScreenRecording => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            PermissionTarget::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        };

        open_permission_settings_url(app, preferred)
            .or_else(|_| open_permission_settings_url(app, "x-apple.systempreferences:com.apple.preference.security?Privacy"))
    }

    #[cfg(target_os = "windows")]
    {
        let target_url = match target {
            PermissionTarget::ScreenRecording => "ms-settings:privacy",
            PermissionTarget::Accessibility => "ms-settings:easeofaccess-keyboard",
        };
        open_permission_settings_url(app, target_url)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        let _ = target;
        Ok(())
    }
}

// List all available displays
#[tauri::command]
fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;
    
    let displays: Vec<DisplayInfo> = screens
        .into_iter()
        .enumerate()
        .map(|(idx, screen)| {
            let info = screen.display_info;
            DisplayInfo {
                display_id: format!("display-{}", idx),
                name: Some(format!("Display {} ({}x{})", idx + 1, info.width, info.height)),
                width: info.width,
                height: info.height,
            }
        })
        .collect();
    
    Ok(displays)
}

// Capture a display and return PNG as base64
#[tauri::command]
fn capture_display_png(display_id: String, max_width: Option<u32>) -> Result<CaptureResult, CaptureError> {
    let screens = screenshots::Screen::all().map_err(|e| CaptureError {
        message: format!("Failed to get screens: {}", e),
        needs_permission: false,
    })?;
    
    let idx: usize = display_id
        .strip_prefix("display-")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| CaptureError {
            message: "Invalid display ID".to_string(),
            needs_permission: false,
        })?;
    
    let screen = screens.get(idx).ok_or_else(|| CaptureError {
        message: "Display not found".to_string(),
        needs_permission: false,
    })?;
    
    let image = screen.capture().map_err(|e| {
        let msg = format!("{}", e);
        let needs_perm = msg.contains("permission") || msg.contains("denied") || msg.contains("Screen Recording");
        CaptureError {
            message: msg,
            needs_permission: needs_perm,
        }
    })?;
    
    let width = image.width();
    let height = image.height();
    let rgba = image.into_raw();
    
    let (final_width, final_height, final_rgba) = if let Some(max_w) = max_width {
        if width > max_w {
            let ratio = max_w as f32 / width as f32;
            let new_height = (height as f32 * ratio) as u32;
            let resized = resize_rgba(&rgba, width, height, max_w, new_height);
            (max_w, new_height, resized)
        } else {
            (width, height, rgba)
        }
    } else {
        (width, height, rgba)
    };
    
    let png_bytes = rgba_to_png(&final_rgba, final_width, final_height).map_err(|e| CaptureError {
        message: format!("Failed to encode PNG: {}", e),
        needs_permission: false,
    })?;
    
    let png_base64 = base64::encode(&png_bytes);
    
    Ok(CaptureResult {
        png_base64,
        width: final_width,
        height: final_height,
        byte_length: png_bytes.len(),
    })
}

// Input injection commands
#[tauri::command]
fn input_click(x_norm: f64, y_norm: f64, button: String) -> Result<(), InputError> {
    let mut enigo = Enigo::new();
    
    // Get screen dimensions (use primary display)
    let screens = screenshots::Screen::all().map_err(|e| InputError {
        message: format!("Failed to get screen: {}", e),
        needs_permission: false,
    })?;
    
    let screen = screens.first().ok_or_else(|| InputError {
        message: "No display found".to_string(),
        needs_permission: false,
    })?;
    
    let width = screen.display_info.width as f64;
    let height = screen.display_info.height as f64;
    
    // Convert normalized to absolute
    let x = (x_norm * width) as i32;
    let y = (y_norm * height) as i32;
    
    let mouse_button = match button.as_str() {
        "right" => EnigoMouseButton::Right,
        "middle" => EnigoMouseButton::Middle,
        _ => EnigoMouseButton::Left,
    };
    
    enigo.mouse_move_to(x, y);
    enigo.mouse_click(mouse_button);
    
    Ok(())
}

#[tauri::command]
fn input_double_click(x_norm: f64, y_norm: f64, button: String) -> Result<(), InputError> {
    let mut enigo = Enigo::new();
    
    let screens = screenshots::Screen::all().map_err(|e| InputError {
        message: format!("Failed to get screen: {}", e),
        needs_permission: false,
    })?;
    
    let screen = screens.first().ok_or_else(|| InputError {
        message: "No display found".to_string(),
        needs_permission: false,
    })?;
    
    let width = screen.display_info.width as f64;
    let height = screen.display_info.height as f64;
    
    let x = (x_norm * width) as i32;
    let y = (y_norm * height) as i32;
    
    let mouse_button = match button.as_str() {
        "right" => EnigoMouseButton::Right,
        "middle" => EnigoMouseButton::Middle,
        _ => EnigoMouseButton::Left,
    };
    
    enigo.mouse_move_to(x, y);
    enigo.mouse_click(mouse_button);
    enigo.mouse_click(mouse_button);
    
    Ok(())
}

#[tauri::command]
fn input_scroll(dx: i32, dy: i32) -> Result<(), InputError> {
    let mut enigo = Enigo::new();
    enigo.mouse_scroll_y(dy);
    enigo.mouse_scroll_x(dx);
    Ok(())
}

#[tauri::command]
fn input_type(text: String) -> Result<(), InputError> {
    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
    Ok(())
}

#[tauri::command]
fn input_hotkey(key: String, modifiers: Vec<String>) -> Result<(), InputError> {
    let mut enigo = Enigo::new();
    
    // Parse key
    let enigo_key = match key.as_str() {
        "enter" => EnigoKey::Return,
        "tab" => EnigoKey::Tab,
        "escape" => EnigoKey::Escape,
        "backspace" => EnigoKey::Backspace,
        "up" => EnigoKey::UpArrow,
        "down" => EnigoKey::DownArrow,
        "left" => EnigoKey::LeftArrow,
        "right" => EnigoKey::RightArrow,
        _ => return Err(InputError {
            message: format!("Unknown key: {}", key),
            needs_permission: false,
        }),
    };
    
    // Hold modifiers
    for modifier in &modifiers {
        match modifier.as_str() {
            "shift" => enigo.key_down(EnigoKey::Shift),
            "ctrl" => enigo.key_down(EnigoKey::Control),
            "alt" => enigo.key_down(EnigoKey::Alt),
            "meta" => enigo.key_down(EnigoKey::Meta),
            _ => {}
        }
    }
    
    // Press key
    enigo.key_click(enigo_key);
    
    // Release modifiers
    for modifier in modifiers.iter().rev() {
        match modifier.as_str() {
            "shift" => enigo.key_up(EnigoKey::Shift),
            "ctrl" => enigo.key_up(EnigoKey::Control),
            "alt" => enigo.key_up(EnigoKey::Alt),
            "meta" => enigo.key_up(EnigoKey::Meta),
            _ => {}
        }
    }
    
    Ok(())
}

// ============================================================================
// Iteration 6: AI Assist - Secure Key Storage
// ============================================================================

#[derive(Serialize)]
struct KeyResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Default)]
struct TrayRuntimeState {
    menu: Mutex<TrayMenuState>,
}

#[derive(Clone)]
struct TrayMenuState {
    window_visible: bool,
    screen_preview_enabled: bool,
    allow_control_enabled: bool,
    ai_assist_active: bool,
    ai_assist_paused: bool,
    has_shown_tray_tip: bool,
}

impl Default for TrayMenuState {
    fn default() -> Self {
        Self {
            window_visible: true,
            screen_preview_enabled: false,
            allow_control_enabled: false,
            ai_assist_active: false,
            ai_assist_paused: false,
            has_shown_tray_tip: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayStatePayload {
    window_visible: bool,
    screen_preview_enabled: bool,
    allow_control_enabled: bool,
    ai_assist_active: bool,
    ai_assist_paused: bool,
}

fn device_token_account(device_id: &str) -> String {
    format!("device_token::{}", device_id)
}

fn keyring_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("ai-operator", account)
        .map_err(|e| format!("Failed to access secure storage: {}", e))
}

fn is_local_dev_host(host: Option<&str>) -> bool {
    matches!(host, Some("localhost" | "127.0.0.1"))
}

fn is_allowed_webview_url(url: &tauri::Url) -> bool {
    if url.scheme() == "tauri" {
        return true;
    }

    if url.host_str() == Some("tauri.localhost") {
        return true;
    }

    cfg!(dev) && matches!(url.scheme(), "http" | "https") && is_local_dev_host(url.host_str())
}

fn app_base_host() -> Option<String> {
    std::env::var("APP_BASE_URL")
        .ok()
        .and_then(|value| tauri::Url::parse(&value).ok())
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
}

fn is_allowed_external_url(url: &tauri::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }

    let Some(host) = url.host_str().map(|value| value.to_ascii_lowercase()) else {
        return false;
    };

    if host == "stripe.com" || host.ends_with(".stripe.com") {
        return true;
    }

    if host == "github.com" || host.ends_with(".github.com") {
        return true;
    }

    app_base_host()
        .map(|allowed_host| host == allowed_host)
        .unwrap_or(false)
}

fn create_main_window(app: &AppHandle) -> Result<(), tauri::Error> {
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .or_else(|| app.config().app.windows.first().cloned())
        .expect("main window config missing");

    WebviewWindowBuilder::from_config(app, &window_config)?
        .on_navigation(|url| is_allowed_webview_url(url))
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .build()?;

    Ok(())
}

fn create_autolaunch() -> Result<auto_launch::AutoLaunch, String> {
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to resolve current executable: {}", e))?;
    let app_path = current_exe
        .to_str()
        .ok_or_else(|| "Executable path is not valid UTF-8".to_string())?;

    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("AI Operator")
        .set_app_path(app_path)
        .build()
        .map_err(|e| format!("Failed to configure auto-start: {}", e))
}

fn build_tray_menu(app: &AppHandle, state: &TrayMenuState) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    let toggle_window = MenuItemBuilder::with_id(
        "toggle_window",
        if state.window_visible { "Hide App" } else { "Show App" },
    )
    .build(app)?;

    let toggle_screen = MenuItemBuilder::with_id(
        "toggle_screen_preview",
        if state.screen_preview_enabled {
            "Disable Screen Preview"
        } else {
            "Enable Screen Preview"
        },
    )
    .build(app)?;

    let toggle_control = MenuItemBuilder::with_id(
        "toggle_allow_control",
        if state.allow_control_enabled {
            "Disable Allow Control"
        } else {
            "Enable Allow Control"
        },
    )
    .build(app)?;

    let ai_label = if !state.ai_assist_active {
        "AI Assist Not Running"
    } else if state.ai_assist_paused {
        "Resume AI Assist"
    } else {
        "Pause AI Assist"
    };

    let toggle_ai = MenuItemBuilder::with_id("toggle_ai_pause", ai_label).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;

    MenuBuilder::new(app)
        .items(&[
            &toggle_window,
            &toggle_screen,
            &toggle_control,
            &toggle_ai,
            &separator,
            &quit,
        ])
        .build()
}

fn refresh_tray_menu(app: &AppHandle, state: &TrayMenuState) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "Tray icon not initialized".to_string())?;
    let menu = build_tray_menu(app, state).map_err(|e| format!("Failed to build tray menu: {}", e))?;
    tray.set_menu(Some(menu))
        .map_err(|e| format!("Failed to update tray menu: {}", e))?;
    Ok(())
}

fn hide_window_to_tray(window: &tauri::WebviewWindow, runtime: &TrayRuntimeState) {
    let _ = window.hide();
    let _ = window.emit("tray.hide", ());

    let mut guard = runtime.menu.lock().unwrap();
    guard.window_visible = false;

    if !guard.has_shown_tray_tip {
        guard.has_shown_tray_tip = true;
        let _ = window.emit("tray.tip", ());
    }

    let app = window.app_handle();
    let _ = refresh_tray_menu(&app, &guard.clone());
}

#[tauri::command]
fn tray_update_state(
    app: AppHandle,
    runtime: State<'_, TrayRuntimeState>,
    window_visible: bool,
    screen_preview_enabled: bool,
    allow_control_enabled: bool,
    ai_assist_active: bool,
    ai_assist_paused: bool,
) -> KeyResult {
    let mut guard = runtime.menu.lock().unwrap();
    guard.window_visible = window_visible;
    guard.screen_preview_enabled = screen_preview_enabled;
    guard.allow_control_enabled = allow_control_enabled;
    guard.ai_assist_active = ai_assist_active;
    guard.ai_assist_paused = ai_assist_paused;

    match refresh_tray_menu(&app, &guard.clone()) {
        Ok(()) => KeyResult { ok: true, error: None },
        Err(e) => KeyResult { ok: false, error: Some(e) },
    }
}

#[tauri::command]
fn main_window_show(app: AppHandle, runtime: State<'_, TrayRuntimeState>) -> KeyResult {
    let Some(window) = app.get_webview_window("main") else {
        return KeyResult { ok: false, error: Some("Main window not found".to_string()) };
    };

    if let Err(e) = window.show() {
        return KeyResult { ok: false, error: Some(format!("Failed to show window: {}", e)) };
    }
    let _ = window.set_focus();
    let _ = window.emit("tray.show", ());

    let mut guard = runtime.menu.lock().unwrap();
    guard.window_visible = true;
    let _ = refresh_tray_menu(&app, &guard.clone());

    KeyResult { ok: true, error: None }
}

#[tauri::command]
fn main_window_hide(app: AppHandle, runtime: State<'_, TrayRuntimeState>) -> KeyResult {
    let Some(window) = app.get_webview_window("main") else {
        return KeyResult { ok: false, error: Some("Main window not found".to_string()) };
    };

    hide_window_to_tray(&window, &runtime);
    let mut guard = runtime.menu.lock().unwrap();
    guard.window_visible = false;
    let _ = refresh_tray_menu(&app, &guard.clone());

    KeyResult { ok: true, error: None }
}

#[tauri::command]
fn permissions_get_status() -> PermissionStatusPayload {
    PermissionStatusPayload {
        screen_recording: detect_screen_recording_status(),
        accessibility: detect_accessibility_status(),
    }
}

#[tauri::command]
fn permissions_open_settings(app: AppHandle, target: PermissionTarget) -> KeyResult {
    match open_permission_settings_impl(&app, target) {
        Ok(()) => KeyResult { ok: true, error: None },
        Err(error) => KeyResult {
            ok: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> KeyResult {
    let parsed = match tauri::Url::parse(&url) {
        Ok(value) => value,
        Err(e) => {
            return KeyResult {
                ok: false,
                error: Some(format!("Invalid URL: {}", e)),
            }
        }
    };

    if !is_allowed_external_url(&parsed) {
        return KeyResult {
            ok: false,
            error: Some("External URL blocked by desktop allowlist".to_string()),
        };
    }

    match app.opener().open_url(parsed.as_str(), None::<&str>) {
        Ok(()) => KeyResult { ok: true, error: None },
        Err(e) => KeyResult {
            ok: false,
            error: Some(format!("Failed to open URL: {}", e)),
        },
    }
}

#[tauri::command]
fn autostart_supported() -> bool {
    cfg!(target_os = "macos") || cfg!(target_os = "windows")
}

#[tauri::command]
fn autostart_is_enabled() -> Result<bool, String> {
    if !autostart_supported() {
        return Ok(false);
    }

    let auto = create_autolaunch()?;
    auto.is_enabled()
        .map_err(|e| format!("Failed to read auto-start state: {}", e))
}

#[tauri::command]
fn autostart_set_enabled(enabled: bool) -> KeyResult {
    if !autostart_supported() {
        return KeyResult {
            ok: false,
            error: Some("Auto-start is not supported on this OS".to_string()),
        };
    }

    match create_autolaunch() {
        Ok(auto) => {
            let result = if enabled {
                auto.enable()
            } else {
                auto.disable()
            };

            match result {
                Ok(()) => KeyResult { ok: true, error: None },
                Err(e) => KeyResult {
                    ok: false,
                    error: Some(format!("Failed to update auto-start: {}", e)),
                },
            }
        }
        Err(e) => KeyResult { ok: false, error: Some(e) },
    }
}

#[tauri::command]
fn device_token_set(device_id: String, token: String) -> KeyResult {
    match keyring_entry(&device_token_account(&device_id)) {
        Ok(entry) => match entry.set_password(&token) {
            Ok(()) => KeyResult { ok: true, error: None },
            Err(e) => KeyResult {
                ok: false,
                error: Some(format!("Failed to store device token: {}", e)),
            },
        },
        Err(error) => KeyResult {
            ok: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn device_token_get(device_id: String) -> Option<String> {
    keyring_entry(&device_token_account(&device_id))
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

#[tauri::command]
fn device_token_clear(device_id: String) -> KeyResult {
    match keyring_entry(&device_token_account(&device_id)) {
        Ok(entry) => match entry.delete_password() {
            Ok(()) => KeyResult { ok: true, error: None },
            Err(e) => KeyResult {
                ok: false,
                error: Some(format!("Failed to clear device token: {}", e)),
            },
        },
        Err(error) => KeyResult {
            ok: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn set_llm_api_key(provider: String, key: String) -> KeyResult {
    match keyring_entry(&format!("llm_api_key:{}", provider)) {
        Ok(entry) => match entry.set_password(&key) {
            Ok(()) => KeyResult { ok: true, error: None },
            Err(e) => KeyResult {
                ok: false,
                error: Some(format!("Failed to store key: {}", e)),
            },
        },
        Err(error) => KeyResult {
            ok: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn has_llm_api_key(provider: String) -> bool {
    keyring_entry(&format!("llm_api_key:{}", provider))
        .map(|entry| entry.get_password().is_ok())
        .unwrap_or(false)
}

#[tauri::command]
fn clear_llm_api_key(provider: String) -> KeyResult {
    match keyring_entry(&format!("llm_api_key:{}", provider)) {
        Ok(entry) => match entry.delete_password() {
            Ok(()) => KeyResult { ok: true, error: None },
            Err(e) => KeyResult {
                ok: false,
                error: Some(format!("Failed to clear key: {}", e)),
            },
        },
        Err(error) => KeyResult {
            ok: false,
            error: Some(error),
        },
    }
}

// ============================================================================
// Iteration 6: AI Assist - LLM Proposal
// ============================================================================

#[derive(Deserialize)]
struct ProposalRequest {
    provider: String,
    base_url: String,
    model: String,
    goal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    screenshot_png_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    history: Option<llm::ActionHistory>,
    constraints: llm::RunConstraints,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_configured: Option<bool>,
}

#[derive(Serialize)]
struct ProposalResult {
    #[serde(flatten)]
    proposal: llm::AgentProposal,
}

#[derive(Serialize)]
struct ProposalError {
    code: String,
    message: String,
}

#[tauri::command]
async fn llm_propose_next_action(params: ProposalRequest) -> Result<ProposalResult, ProposalError> {
    // Retrieve API key from secure storage
    let entry = keyring_entry(&format!("llm_api_key:{}", params.provider)).map_err(|e| ProposalError {
        code: "KEYRING_ERROR".to_string(),
        message: e,
    })?;
    let api_key = entry.get_password().map_err(|e| ProposalError {
        code: "NO_API_KEY".to_string(),
        message: format!("No API key configured: {}", e),
    })?;

    // Get workspace configuration status
    let workspace_configured = params.workspace_configured.or_else(|| {
        let guard = workspace::WORKSPACE_ROOT.lock().unwrap();
        Some(guard.is_some())
    });

    let proposal_params = llm::ProposalParams {
        provider: params.provider,
        base_url: params.base_url,
        model: params.model,
        api_key,
        goal: params.goal,
        screenshot_png_base64: params.screenshot_png_base64,
        history: params.history,
        constraints: params.constraints,
        workspace_configured,
    };

    let provider = llm::create_provider(&proposal_params.provider).map_err(|e| ProposalError {
        code: e.code,
        message: e.message,
    })?;

    let proposal = provider.propose_next_action(&proposal_params).await.map_err(|e| ProposalError {
        code: e.code,
        message: e.message,
    })?;

    Ok(ProposalResult { proposal })
}

// Resize RGBA image
fn resize_rgba(rgba: &[u8], src_width: u32, src_height: u32, dst_width: u32, dst_height: u32) -> Vec<u8> {
    let mut result = vec![0u8; (dst_width * dst_height * 4) as usize];
    
    let x_ratio = src_width as f32 / dst_width as f32;
    let y_ratio = src_height as f32 / dst_height as f32;
    
    for y in 0..dst_height {
        for x in 0..dst_width {
            let src_x = (x as f32 * x_ratio) as u32;
            let src_y = (y as f32 * y_ratio) as u32;
            let src_idx = ((src_y * src_width + src_x) * 4) as usize;
            let dst_idx = ((y * dst_width + x) * 4) as usize;
            
            if src_idx + 3 < rgba.len() && dst_idx + 3 < result.len() {
                result[dst_idx] = rgba[src_idx];
                result[dst_idx + 1] = rgba[src_idx + 1];
                result[dst_idx + 2] = rgba[src_idx + 2];
                result[dst_idx + 3] = rgba[src_idx + 3];
            }
        }
    }
    
    result
}

// Convert RGBA to PNG
fn rgba_to_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    
    let mut output = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut output);
    encoder
        .write_image(rgba, width, height, image::ColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    
    Ok(output)
}

// Base64 encoding module
mod base64 {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    
    pub fn encode(input: &[u8]) -> String {
        let mut result = String::with_capacity((input.len() + 2) / 3 * 4);
        
        for chunk in input.chunks(3) {
            let buf = match chunk.len() {
                3 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32),
                2 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8),
                1 => (chunk[0] as u32) << 16,
                _ => continue,
            };
            
            result.push(TABLE[(buf >> 18) as usize] as char);
            result.push(TABLE[(buf >> 12) as usize & 0x3F] as char);
            
            if chunk.len() > 1 {
                result.push(TABLE[(buf >> 6) as usize & 0x3F] as char);
            } else {
                result.push('=');
            }
            
            if chunk.len() > 2 {
                result.push(TABLE[buf as usize & 0x3F] as char);
            } else {
                result.push('=');
            }
        }
        
        result
    }
}

// ============================================================================
// Iteration 31: Advanced Agent System - State and Commands
// ============================================================================

use agent::providers::{LlmProvider as _, ProviderRouter, ProviderType};
use agent::{AdvancedAgent, AgentConfig, AgentEvent};

/// State for the advanced agent
pub struct AgentState {
    router: Arc<ProviderRouter>,
    agent: Arc<RwLock<Option<AdvancedAgent>>>,
}

impl AgentState {
    pub fn new() -> Self {
        let router = Arc::new(ProviderRouter::new());
        Self {
            router,
            agent: Arc::new(RwLock::new(None)),
        }
    }
    
    pub fn router(&self) -> Arc<ProviderRouter> {
        self.router.clone()
    }
}

/// Provider info for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub provider_type: String,
    pub name: String,
    pub available: bool,
    pub is_free: bool,
    pub supports_vision: bool,
}

/// List available providers
#[tauri::command]
async fn list_agent_providers(state: State<'_, AgentState>) -> Result<Vec<ProviderInfo>, String> {
    let infos = state.router.list_providers().await;
    
    Ok(infos.into_iter().map(|p| ProviderInfo {
        provider_type: format!("{:?}", p.provider_type).to_lowercase(),
        name: p.name,
        available: p.available,
        is_free: p.is_free,
        supports_vision: p.capabilities.supports_vision,
    }).collect())
}

/// Test a provider connection
#[tauri::command]
async fn test_provider(provider_type: String) -> Result<bool, String> {
    let ptype = match provider_type.as_str() {
        "native_qwen_ollama" => ProviderType::NativeQwenOllama,
        "local_openai_compat" => ProviderType::LocalOpenAiCompat,
        "openai" => ProviderType::OpenAi,
        "claude" => ProviderType::Claude,
        _ => return Err(format!("Unknown provider: {}", provider_type)),
    };
    
    // Check availability based on provider type
    match ptype {
        ProviderType::NativeQwenOllama => {
            let provider = agent::providers::NativeOllamaProvider::new(None, None);
            Ok(provider.is_available().await)
        }
        ProviderType::LocalOpenAiCompat => {
            let provider = agent::providers::LocalCompatProvider::new(None, None);
            Ok(provider.is_available().await)
        }
        ProviderType::OpenAi | ProviderType::Claude => {
            // These require API keys, check if key exists
            let key_entry = keyring_entry(&format!("llm_api_key:{}", provider_type))?;
            Ok(key_entry.get_password().is_ok())
        }
    }
}

/// Set provider API key (stored in keychain)
#[tauri::command]
fn set_provider_api_key(provider_type: String, api_key: String) -> Result<(), String> {
    let entry = keyring_entry(&format!("llm_api_key:{}", provider_type))?;
    entry.set_password(&api_key)
        .map_err(|e| format!("Failed to store API key: {}", e))
}

/// Check if provider API key exists
#[tauri::command]
fn has_provider_api_key(provider_type: String) -> bool {
    keyring_entry(&format!("llm_api_key:{}", provider_type))
        .map(|entry| entry.get_password().is_ok())
        .unwrap_or(false)
}

/// Start a new agent task
#[tauri::command]
async fn start_agent_task(
    app: AppHandle,
    state: State<'_, AgentState>,
    goal: String,
    preferred_provider: Option<String>,
) -> Result<String, String> {
    // Create agent config
    let config = AgentConfig {
        primary_provider: match preferred_provider.as_deref() {
            Some("native_qwen_ollama") => ProviderType::NativeQwenOllama,
            Some("local_openai_compat") => ProviderType::LocalOpenAiCompat,
            Some("openai") => ProviderType::OpenAi,
            Some("claude") => ProviderType::Claude,
            _ => ProviderType::NativeQwenOllama,
        },
        ..Default::default()
    };

    // Create event callback
    let app_handle = app.clone();
    let callback = Box::new(move |event: AgentEvent| {
        let _ = app_handle.emit("agent:event", event);
    });

    let agent = AdvancedAgent::new(config, state.router.clone(), callback);
    let task_id = agent.start_task(goal).await.map_err(|e| e.to_string())?;
    
    // Store agent
    let mut guard = state.agent.write().await;
    *guard = Some(agent);
    
    Ok(task_id)
}

/// Get current task status
#[tauri::command]
async fn get_agent_task_status(state: State<'_, AgentState>) -> Result<Option<agent::AgentTask>, String> {
    let guard = state.agent.read().await;
    if let Some(agent) = guard.as_ref() {
        if let Some(task) = agent.get_current_task().await {
            return Ok(Some(task));
        }
    }
    Ok(None)
}

/// Cancel current task
#[tauri::command]
async fn cancel_agent_task(state: State<'_, AgentState>) -> Result<(), String> {
    let guard = state.agent.read().await;
    if let Some(agent) = guard.as_ref() {
        agent.cancel().await;
    }
    Ok(())
}

/// Start recording a demonstration
#[tauri::command]
fn start_recording(goal: String, description: String) -> Result<String, String> {
    // This would be implemented with a recorder instance
    Ok(format!("demo_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TrayRuntimeState::default())
        .manage(AgentState::new())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            list_displays, 
            capture_display_png,
            input_click,
            input_double_click,
            input_scroll,
            input_type,
            input_hotkey,
            device_token_set,
            device_token_get,
            device_token_clear,
            tray_update_state,
            main_window_show,
            main_window_hide,
            permissions_get_status,
            permissions_open_settings,
            open_external_url,
            autostart_supported,
            autostart_is_enabled,
            autostart_set_enabled,
            // Iteration 6: AI Assist
            set_llm_api_key,
            has_llm_api_key,
            clear_llm_api_key,
            llm_propose_next_action,
            // Iteration 7: Workspace Tools
            workspace::workspace_configure,
            workspace::workspace_get_state,
            workspace::workspace_select_directory,
            workspace::workspace_clear,
            workspace::tool_execute,
            // Iteration 31: Advanced Agent System
            list_agent_providers,
            test_provider,
            set_provider_api_key,
            has_provider_api_key,
            start_agent_task,
            get_agent_task_status,
            cancel_agent_task,
            start_recording,
        ])
        .setup(|app| {
            let app_handle = app.app_handle();
            create_main_window(&app_handle)?;

            let runtime = app.state::<TrayRuntimeState>();
            let initial_state = runtime.menu.lock().unwrap().clone();
            let tray_menu = build_tray_menu(&app_handle, &initial_state)?;

            TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .on_menu_event(|app: &AppHandle, event: MenuEvent| {
                    match event.id().as_ref() {
                        "toggle_window" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let runtime = app.state::<TrayRuntimeState>();
                                let visible = window.is_visible().unwrap_or(true);
                                if visible {
                                    hide_window_to_tray(&window, &runtime);
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = window.emit("tray.show", ());
                                    let mut guard = runtime.menu.lock().unwrap();
                                    guard.window_visible = true;
                                    let _ = refresh_tray_menu(app, &guard.clone());
                                }
                            }
                        }
                        "toggle_screen_preview" => {
                            let _ = app.emit("tray.toggle_screen_preview", ());
                        }
                        "toggle_allow_control" => {
                            let _ = app.emit("tray.toggle_allow_control", ());
                        }
                        "toggle_ai_pause" => {
                            let _ = app.emit("tray.toggle_ai_pause", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let runtime = window.state::<TrayRuntimeState>();
                if let Some(main_window) = window.app_handle().get_webview_window("main") {
                    hide_window_to_tray(&main_window, &runtime);
                } else {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

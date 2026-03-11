//! Action executor for UI automation and tool execution

use serde::{Deserialize, Serialize};

/// An action that can be executed
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action_type", rename_all = "snake_case")]
pub enum Action {
    /// Wait for a duration
    Wait { duration_ms: u64 },
    /// Click at normalized coordinates
    Click { x: f64, y: f64, button: MouseButton },
    /// Double click
    DoubleClick { x: f64, y: f64 },
    /// Scroll
    Scroll { dx: i32, dy: i32 },
    /// Type text
    Type { text: String },
    /// Press hotkey
    Hotkey { key: String, modifiers: Vec<String> },
    /// Open an application
    OpenApp { app_name: String },
    /// Take screenshot
    TakeScreenshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl Action {
    /// Get action type as string
    #[allow(dead_code)]
    pub fn action_type(&self) -> String {
        match self {
            Action::Wait { .. } => "wait".to_string(),
            Action::Click { .. } => "click".to_string(),
            Action::DoubleClick { .. } => "double_click".to_string(),
            Action::Scroll { .. } => "scroll".to_string(),
            Action::Type { .. } => "type".to_string(),
            Action::Hotkey { .. } => "hotkey".to_string(),
            Action::OpenApp { .. } => "open_app".to_string(),
            Action::TakeScreenshot => "screenshot".to_string(),
        }
    }

    /// Get a summary of the action for display
    pub fn summary(&self) -> String {
        match self {
            Action::Wait { duration_ms } => format!("Wait {}ms", duration_ms),
            Action::Click { x, y, button } => format!("Click {:?} at ({:.2}, {:.2})", button, x, y),
            Action::DoubleClick { x, y } => format!("Double-click at ({:.2}, {:.2})", x, y),
            Action::Scroll { dx, dy } => format!("Scroll dx={}, dy={}", dx, dy),
            Action::Type { text } => format!("Type {} chars", text.len()),
            Action::Hotkey { key, modifiers } => {
                let mods = modifiers.join("+");
                if mods.is_empty() {
                    format!("Press {}", key)
                } else {
                    format!("Press {}+{}", mods, key)
                }
            }
            Action::OpenApp { app_name } => format!("Open {}", app_name),
            Action::TakeScreenshot => "Take screenshot".to_string(),
        }
    }

    /// Check if this is a privileged action requiring approval
    #[allow(dead_code)]
    pub fn is_privileged(&self) -> bool {
        match self {
            Action::Wait { .. } => false,
            Action::TakeScreenshot => false,
            Action::Click { .. } => true,
            Action::DoubleClick { .. } => true,
            Action::Scroll { .. } => true,
            Action::Type { .. } => true,
            Action::Hotkey { .. } => true,
            Action::OpenApp { .. } => true,
        }
    }

    /// Check if this action is safe to repeat without approval
    #[allow(dead_code)]
    pub fn is_repeatable_safe(&self) -> bool {
        match self {
            // Scroll and wait are generally safe to repeat
            Action::Wait { .. } => true,
            Action::Scroll { dx, dy } => dx.abs() < 100 && dy.abs() < 100,
            // Everything else requires approval
            _ => false,
        }
    }
}

/// Executor for actions
pub struct ActionExecutor;

impl ActionExecutor {
    pub fn new() -> Self {
        Self
    }

    /// Execute an action
    pub async fn execute(&self, action: Action) -> Result<ActionResult, ExecuteError> {
        match action {
            Action::Wait { duration_ms } => {
                tokio::time::sleep(tokio::time::Duration::from_millis(duration_ms)).await;
                Ok(ActionResult::Success)
            }
            Action::Click { x, y, button } => {
                let button_str = match button {
                    MouseButton::Left => "left",
                    MouseButton::Right => "right",
                    MouseButton::Middle => "middle",
                };
                // Call into Tauri command
                crate::input_click(x, y, button_str.to_string())
                    .map_err(|e| ExecuteError::InputError(e.message))?;
                Ok(ActionResult::Success)
            }
            Action::DoubleClick { x, y } => {
                crate::input_double_click(x, y, "left".to_string())
                    .map_err(|e| ExecuteError::InputError(e.message))?;
                Ok(ActionResult::Success)
            }
            Action::Scroll { dx, dy } => {
                crate::input_scroll(dx, dy).map_err(|e| ExecuteError::InputError(e.message))?;
                Ok(ActionResult::Success)
            }
            Action::Type { text } => {
                crate::input_type(text).map_err(|e| ExecuteError::InputError(e.message))?;
                Ok(ActionResult::Success)
            }
            Action::Hotkey { key, modifiers } => {
                crate::input_hotkey(key, modifiers)
                    .map_err(|e| ExecuteError::InputError(e.message))?;
                Ok(ActionResult::Success)
            }
            Action::OpenApp { app_name } => {
                // Platform-specific app opening
                #[cfg(target_os = "macos")]
                {
                    let _ = std::process::Command::new("open")
                        .arg("-a")
                        .arg(&app_name)
                        .spawn();
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("cmd")
                        .args(&["/C", "start", "", &app_name])
                        .spawn();
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                let _ = &app_name;
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                Ok(ActionResult::Success)
            }
            Action::TakeScreenshot => {
                // Screenshot is taken by the vision engine
                Ok(ActionResult::Success)
            }
        }
    }
}

/// Result of executing an action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionResult {
    Success,
    Failed { reason: String },
    NeedsUserInput { question: String },
}

/// Error during execution
#[derive(Debug, thiserror::Error)]
pub enum ExecuteError {
    #[error("Input error: {0}")]
    InputError(String),
}

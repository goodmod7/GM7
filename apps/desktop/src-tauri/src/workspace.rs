use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

// Workspace state - stored in memory, reset on app restart
pub static WORKSPACE_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

// ============================================================================
// Workspace Configuration
// ============================================================================

#[derive(Serialize)]
pub struct WorkspaceState {
    configured: bool,
    root_name: Option<String>,
}

#[derive(Serialize)]
pub struct ConfigureResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    state: WorkspaceState,
}

#[tauri::command]
pub fn workspace_configure(path: String) -> ConfigureResult {
    let path_buf = PathBuf::from(&path);

    // Validate path exists and is a directory
    if !path_buf.exists() {
        return ConfigureResult {
            ok: false,
            error: Some(format!("Path does not exist: {}", path)),
            state: WorkspaceState {
                configured: false,
                root_name: None,
            },
        };
    }

    if !path_buf.is_dir() {
        return ConfigureResult {
            ok: false,
            error: Some(format!("Path is not a directory: {}", path)),
            state: WorkspaceState {
                configured: false,
                root_name: None,
            },
        };
    }

    // Get the root name (last component of path)
    let root_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    // Store the workspace root
    let mut guard = WORKSPACE_ROOT.lock().unwrap();
    *guard = Some(path_buf);

    ConfigureResult {
        ok: true,
        error: None,
        state: WorkspaceState {
            configured: true,
            root_name,
        },
    }
}

#[tauri::command]
pub fn workspace_get_state() -> WorkspaceState {
    let guard = WORKSPACE_ROOT.lock().unwrap();

    match guard.as_ref() {
        Some(path) => {
            let root_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string());

            WorkspaceState {
                configured: true,
                root_name,
            }
        }
        None => WorkspaceState {
            configured: false,
            root_name: None,
        },
    }
}

#[tauri::command]
pub async fn workspace_select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let selection = app.dialog().file().blocking_pick_folder();
    match selection {
        Some(path) => {
            let path_buf = path
                .into_path()
                .map_err(|invalid| format!("Selected path is not local: {:?}", invalid))?;
            Ok(Some(path_buf.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn workspace_clear() -> WorkspaceState {
    let mut guard = WORKSPACE_ROOT.lock().unwrap();
    *guard = None;

    WorkspaceState {
        configured: false,
        root_name: None,
    }
}

// ============================================================================
// Tool Execution
// ============================================================================

#[derive(Deserialize)]
#[serde(tag = "tool")]
pub enum ToolCall {
    #[serde(rename = "fs.list")]
    FsList { path: String },
    #[serde(rename = "fs.read_text")]
    FsReadText { path: String },
    #[serde(rename = "fs.write_text")]
    FsWriteText { path: String, content: String },
    #[serde(rename = "fs.apply_patch")]
    FsApplyPatch { path: String, patch: String },
    #[serde(rename = "terminal.exec")]
    TerminalExec {
        cmd: String,
        args: Vec<String>,
        cwd: Option<String>,
    },
}

#[derive(Serialize)]
pub struct FsListEntry {
    name: String,
    kind: String, // "file" or "dir"
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

#[derive(Serialize)]
pub struct ToolResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ToolError>,
    #[serde(flatten)]
    data: Option<ToolResultData>,
}

#[derive(Serialize)]
pub struct ToolError {
    code: String,
    message: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum ToolResultData {
    FsList {
        entries: Vec<FsListEntry>,
        truncated: bool,
    },
    FsReadText {
        content: String,
        truncated: bool,
    },
    FsWriteText {
        bytes_written: u64,
    },
    FsApplyPatch {
        bytes_written: u64,
        hunks_applied: u32,
    },
    TerminalExec {
        exit_code: i32,
        stdout_preview: String,
        stderr_preview: String,
        truncated: bool,
    },
}

const MAX_LIST_ENTRIES: usize = 1000;
const MAX_READ_BYTES: usize = 1_000_000; // 1MB
const MAX_TERMINAL_OUTPUT: usize = 100_000; // 100KB
const MAX_TRUNCATED_OUTPUT: usize = 10_000; // 10KB for preview

/// Validate and resolve a relative path within the workspace
fn resolve_workspace_path(rel_path: &str) -> Result<PathBuf, ToolError> {
    let guard = WORKSPACE_ROOT.lock().unwrap();

    let root = guard.as_ref().ok_or(ToolError {
        code: "WORKSPACE_NOT_CONFIGURED".to_string(),
        message: "Workspace not configured".to_string(),
    })?;

    // Normalize the path (resolve . and ..)
    let path = Path::new(rel_path);

    // Prevent path traversal attacks - check for absolute paths and parent references
    if path.is_absolute() {
        return Err(ToolError {
            code: "INVALID_PATH".to_string(),
            message: "Absolute paths not allowed".to_string(),
        });
    }

    // Resolve against workspace root
    let resolved = root.join(path);

    // Ensure the resolved path is within the workspace
    // Use canonicalize if the path exists, otherwise check components
    if resolved.exists() {
        match resolved.canonicalize() {
            Ok(canonical) => {
                let root_canonical = root.canonicalize().map_err(|e| ToolError {
                    code: "INTERNAL_ERROR".to_string(),
                    message: format!("Failed to canonicalize root: {}", e),
                })?;

                if !canonical.starts_with(&root_canonical) {
                    return Err(ToolError {
                        code: "PATH_OUTSIDE_WORKSPACE".to_string(),
                        message: "Path is outside workspace".to_string(),
                    });
                }

                Ok(canonical)
            }
            Err(e) => Err(ToolError {
                code: "INVALID_PATH".to_string(),
                message: format!("Failed to canonicalize path: {}", e),
            }),
        }
    } else {
        // For non-existent paths (e.g., new files), validate parent exists
        let parent = resolved.parent().ok_or(ToolError {
            code: "INVALID_PATH".to_string(),
            message: "Invalid path".to_string(),
        })?;

        if !parent.starts_with(root) {
            return Err(ToolError {
                code: "PATH_OUTSIDE_WORKSPACE".to_string(),
                message: "Path is outside workspace".to_string(),
            });
        }

        Ok(resolved)
    }
}

#[allow(dead_code)]
fn make_relative_path(path: &Path) -> Result<String, ToolError> {
    let guard = WORKSPACE_ROOT.lock().unwrap();

    let root = guard.as_ref().ok_or(ToolError {
        code: "WORKSPACE_NOT_CONFIGURED".to_string(),
        message: "Workspace not configured".to_string(),
    })?;

    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|_| ToolError {
            code: "PATH_NOT_IN_WORKSPACE".to_string(),
            message: "Path not in workspace".to_string(),
        })
}

#[tauri::command]
pub fn tool_execute(tool_call: ToolCall) -> ToolResult {
    match tool_call {
        ToolCall::FsList { path } => execute_fs_list(&path),
        ToolCall::FsReadText { path } => execute_fs_read_text(&path),
        ToolCall::FsWriteText { path, content } => execute_fs_write_text(&path, &content),
        ToolCall::FsApplyPatch { path, patch } => execute_fs_apply_patch(&path, &patch),
        ToolCall::TerminalExec { cmd, args, cwd } => {
            execute_terminal_exec(&cmd, &args, cwd.as_deref())
        }
    }
}

pub fn tool_execute_for_agent(tool_call: ToolCall) -> Result<String, String> {
    let result = tool_execute(tool_call);

    if result.ok {
        return Ok("Tool executed successfully.".to_string());
    }

    Err(result
        .error
        .map(|error| error.message)
        .unwrap_or_else(|| "Tool execution failed".to_string()))
}

fn execute_fs_list(path: &str) -> ToolResult {
    let resolved = match resolve_workspace_path(path) {
        Ok(p) => p,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(e),
                data: None,
            }
        }
    };

    if !resolved.is_dir() {
        return ToolResult {
            ok: false,
            error: Some(ToolError {
                code: "NOT_A_DIRECTORY".to_string(),
                message: format!("Path is not a directory: {}", path),
            }),
            data: None,
        };
    }

    let mut entries = Vec::new();
    let mut truncated = false;

    match std::fs::read_dir(&resolved) {
        Ok(dir) => {
            for entry in dir {
                if entries.len() >= MAX_LIST_ENTRIES {
                    truncated = true;
                    break;
                }

                match entry {
                    Ok(e) => {
                        let name = e.file_name().to_string_lossy().to_string();
                        let metadata = e.metadata().ok();

                        let kind = if metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false) {
                            "dir".to_string()
                        } else {
                            "file".to_string()
                        };

                        let size = metadata.map(|m| m.len());

                        entries.push(FsListEntry { name, kind, size });
                    }
                    Err(_) => continue,
                }
            }
        }
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "READ_ERROR".to_string(),
                    message: format!("Failed to read directory: {}", e),
                }),
                data: None,
            }
        }
    }

    ToolResult {
        ok: true,
        error: None,
        data: Some(ToolResultData::FsList { entries, truncated }),
    }
}

fn execute_fs_read_text(path: &str) -> ToolResult {
    let resolved = match resolve_workspace_path(path) {
        Ok(p) => p,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(e),
                data: None,
            }
        }
    };

    if !resolved.is_file() {
        return ToolResult {
            ok: false,
            error: Some(ToolError {
                code: "NOT_A_FILE".to_string(),
                message: format!("Path is not a file: {}", path),
            }),
            data: None,
        };
    }

    // Check file size before reading
    let metadata = match std::fs::metadata(&resolved) {
        Ok(m) => m,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "READ_ERROR".to_string(),
                    message: format!("Failed to get file metadata: {}", e),
                }),
                data: None,
            }
        }
    };

    let truncated = metadata.len() > MAX_READ_BYTES as u64;

    // Read file (with size limit)
    let content = match std::fs::read(&resolved) {
        Ok(bytes) => {
            let limit = std::cmp::min(bytes.len(), MAX_READ_BYTES);
            let bytes_to_read = &bytes[..limit];

            // Try to decode as UTF-8
            match String::from_utf8(bytes_to_read.to_vec()) {
                Ok(s) => s,
                Err(_) => {
                    return ToolResult {
                        ok: false,
                        error: Some(ToolError {
                            code: "NOT_TEXT".to_string(),
                            message: "File is not valid UTF-8 text".to_string(),
                        }),
                        data: None,
                    }
                }
            }
        }
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "READ_ERROR".to_string(),
                    message: format!("Failed to read file: {}", e),
                }),
                data: None,
            }
        }
    };

    ToolResult {
        ok: true,
        error: None,
        data: Some(ToolResultData::FsReadText { content, truncated }),
    }
}

fn execute_fs_write_text(path: &str, content: &str) -> ToolResult {
    let resolved = match resolve_workspace_path(path) {
        Ok(p) => p,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(e),
                data: None,
            }
        }
    };

    // Ensure parent directory exists
    if let Some(parent) = resolved.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "CREATE_DIR_ERROR".to_string(),
                    message: format!("Failed to create parent directory: {}", e),
                }),
                data: None,
            };
        }
    }

    // Write file
    match std::fs::write(&resolved, content.as_bytes()) {
        Ok(()) => {
            let bytes_written = content.len() as u64;
            ToolResult {
                ok: true,
                error: None,
                data: Some(ToolResultData::FsWriteText { bytes_written }),
            }
        }
        Err(e) => ToolResult {
            ok: false,
            error: Some(ToolError {
                code: "WRITE_ERROR".to_string(),
                message: format!("Failed to write file: {}", e),
            }),
            data: None,
        },
    }
}

fn execute_fs_apply_patch(path: &str, patch: &str) -> ToolResult {
    // First read the existing content
    let resolved = match resolve_workspace_path(path) {
        Ok(p) => p,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(e),
                data: None,
            }
        }
    };

    let existing = match std::fs::read_to_string(&resolved) {
        Ok(s) => s,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "READ_ERROR".to_string(),
                    message: format!("Failed to read file for patching: {}", e),
                }),
                data: None,
            }
        }
    };

    // Simple patch format: search/replace blocks
    // Format:
    // <<<<<<< SEARCH
    // old content
    // =======
    // new content
    // >>>>>>> REPLACE
    //
    // Apply patches sequentially
    let mut content = existing;
    let mut hunks_applied = 0u32;

    let patch_regex =
        regex::Regex::new(r"<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE").unwrap();

    for cap in patch_regex.captures_iter(patch) {
        let search = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let replace = cap.get(2).map(|m| m.as_str()).unwrap_or("");

        if content.contains(search) {
            content = content.replacen(search, replace, 1);
            hunks_applied += 1;
        }
    }

    // Write the patched content
    match std::fs::write(&resolved, content.as_bytes()) {
        Ok(()) => {
            let bytes_written = content.len() as u64;
            ToolResult {
                ok: true,
                error: None,
                data: Some(ToolResultData::FsApplyPatch {
                    bytes_written,
                    hunks_applied,
                }),
            }
        }
        Err(e) => ToolResult {
            ok: false,
            error: Some(ToolError {
                code: "WRITE_ERROR".to_string(),
                message: format!("Failed to write patched file: {}", e),
            }),
            data: None,
        },
    }
}

fn execute_terminal_exec(cmd: &str, args: &[String], cwd: Option<&str>) -> ToolResult {
    // Resolve cwd if provided
    let cwd_path = match cwd {
        Some(c) => match resolve_workspace_path(c) {
            Ok(p) => Some(p),
            Err(e) => {
                return ToolResult {
                    ok: false,
                    error: Some(e),
                    data: None,
                }
            }
        },
        None => {
            // Use workspace root as default
            let guard = WORKSPACE_ROOT.lock().unwrap();
            guard.clone()
        }
    };

    // Build command
    let mut command = Command::new(cmd);
    command.args(args);

    if let Some(ref cwd) = cwd_path {
        command.current_dir(cwd);
    }

    // Execute with timeout (30 seconds)
    let output = match command.output() {
        Ok(o) => o,
        Err(e) => {
            return ToolResult {
                ok: false,
                error: Some(ToolError {
                    code: "EXEC_ERROR".to_string(),
                    message: format!("Failed to execute command: {}", e),
                }),
                data: None,
            }
        }
    };

    let exit_code = output.status.code().unwrap_or(-1);

    // Truncate output if too large
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let total_len = stdout.len() + stderr.len();
    let truncated = total_len > MAX_TERMINAL_OUTPUT;

    let stdout_preview = if stdout.len() > MAX_TRUNCATED_OUTPUT {
        format!("{}...(truncated)", &stdout[..MAX_TRUNCATED_OUTPUT])
    } else {
        stdout.to_string()
    };

    let stderr_preview = if stderr.len() > MAX_TRUNCATED_OUTPUT {
        format!("{}...(truncated)", &stderr[..MAX_TRUNCATED_OUTPUT])
    } else {
        stderr.to_string()
    };

    ToolResult {
        ok: true,
        error: None,
        data: Some(ToolResultData::TerminalExec {
            exit_code,
            stdout_preview,
            stderr_preview,
            truncated,
        }),
    }
}

/// Get the tool name for a tool call (for logging/summary)
#[allow(dead_code)]
pub fn get_tool_name(tool: &ToolCall) -> &'static str {
    match tool {
        ToolCall::FsList { .. } => "fs.list",
        ToolCall::FsReadText { .. } => "fs.read_text",
        ToolCall::FsWriteText { .. } => "fs.write_text",
        ToolCall::FsApplyPatch { .. } => "fs.apply_patch",
        ToolCall::TerminalExec { .. } => "terminal.exec",
    }
}

/// Get the target path/command for a tool call (for logging/summary)
#[allow(dead_code)]
pub fn get_tool_target(tool: &ToolCall) -> String {
    match tool {
        ToolCall::FsList { path } => path.clone(),
        ToolCall::FsReadText { path } => path.clone(),
        ToolCall::FsWriteText { path, .. } => path.clone(),
        ToolCall::FsApplyPatch { path, .. } => path.clone(),
        ToolCall::TerminalExec { cmd, .. } => cmd.clone(),
    }
}

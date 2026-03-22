use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub mod claude;
pub mod native_ollama;
pub mod openai;
pub mod openai_compat;

/// Available tools for the AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool")]
pub enum ToolCall {
    // Workspace file-system tools
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
    // GORKH internal app tools (STEP 2)
    #[serde(rename = "app.get_state")]
    AppGetState,
    #[serde(rename = "settings.set")]
    SettingsSet { key: String, value: serde_json::Value },
    #[serde(rename = "free_ai.install")]
    FreeAiInstall { tier: String },
}

impl ToolCall {
    /// Returns true if this tool modifies state or executes commands (requires approval)
    #[allow(dead_code)]
    pub fn is_destructive(&self) -> bool {
        matches!(
            self,
            ToolCall::FsWriteText { .. }
                | ToolCall::FsApplyPatch { .. }
                | ToolCall::TerminalExec { .. }
                | ToolCall::SettingsSet { .. }
                | ToolCall::FreeAiInstall { .. }
        )
    }

    /// Get the target path or command for logging
    #[allow(dead_code)]
    pub fn target(&self) -> &str {
        match self {
            ToolCall::FsList { path } => path,
            ToolCall::FsReadText { path } => path,
            ToolCall::FsWriteText { path, .. } => path,
            ToolCall::FsApplyPatch { path, .. } => path,
            ToolCall::TerminalExec { cmd, .. } => cmd,
            ToolCall::AppGetState => "app",
            ToolCall::SettingsSet { key, .. } => key,
            ToolCall::FreeAiInstall { tier } => tier,
        }
    }
}

/// An action that can be proposed by the AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum InputAction {
    #[serde(rename = "click")]
    Click { x: f64, y: f64, button: String },
    #[serde(rename = "double_click")]
    DoubleClick { x: f64, y: f64, button: String },
    #[serde(rename = "scroll")]
    Scroll { dx: i32, dy: i32 },
    #[serde(rename = "type")]
    Type { text: String },
    #[serde(rename = "hotkey")]
    Hotkey {
        key: String,
        modifiers: Option<Vec<String>>,
    },
    #[serde(rename = "open_app")]
    OpenApp {
        app_name: String,
    },
}

/// A proposal from the AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum AgentProposal {
    #[serde(rename = "propose_action")]
    ProposeAction {
        action: InputAction,
        rationale: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f64>,
    },
    #[serde(rename = "propose_tool")]
    ProposeTool {
        tool_call: ToolCall,
        rationale: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f64>,
    },
    #[serde(rename = "ask_user")]
    AskUser { question: String },
    #[serde(rename = "done")]
    Done { summary: String },
}

/// Parameters for requesting a proposal from the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalParams {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub goal: String,
    pub screenshot_png_base64: Option<String>,
    pub history: Option<ActionHistory>,
    pub constraints: RunConstraints,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_configured: Option<bool>,
    /// Structured GORKH app state injected into the system prompt for grounding.
    /// Contains no sensitive data (no keys, paths, file contents, or typed text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_context: Option<String>,
}

/// A recent conversation turn used for the intake bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurnMessage {
    pub role: String,
    pub text: String,
}

/// Parameters for requesting a conversation/intake response from the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurnParams {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub messages: Vec<ConversationTurnMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_context: Option<String>,
}

/// The only allowed response shapes for the intake bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ConversationTurnResult {
    #[serde(rename = "reply")]
    Reply { message: String },
    #[serde(rename = "confirm_task")]
    ConfirmTask {
        goal: String,
        summary: String,
        prompt: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionHistory {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_actions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_user_messages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConstraints {
    #[serde(alias = "max_actions")]
    pub max_actions: u32,
    #[serde(alias = "max_runtime_minutes")]
    pub max_runtime_minutes: u32,
}

#[cfg(test)]
mod tests {
    use super::{build_conversation_user_prompt, ConversationTurnMessage, RunConstraints};

    #[test]
    fn run_constraints_deserialize_from_camel_case_fields() {
        let parsed: RunConstraints = serde_json::from_value(serde_json::json!({
            "maxActions": 1,
            "maxRuntimeMinutes": 2
        }))
        .expect("camelCase constraints should deserialize");

        assert_eq!(parsed.max_actions, 1);
        assert_eq!(parsed.max_runtime_minutes, 2);
    }

    #[test]
    fn conversation_prompt_keeps_the_latest_messages() {
        let messages = (0..15)
            .map(|index| ConversationTurnMessage {
                role: if index % 2 == 0 {
                    "user".to_string()
                } else {
                    "assistant".to_string()
                },
                text: format!("message-{index}"),
            })
            .collect::<Vec<_>>();

        let prompt = build_conversation_user_prompt(&messages);

        assert!(!prompt.contains("message-0"));
        assert!(!prompt.contains("message-1"));
        assert!(!prompt.contains("message-2"));
        assert!(prompt.contains("message-3"));
        assert!(prompt.contains("message-14"));
    }
}

/// Error type for LLM operations
#[derive(Debug, Clone, Serialize)]
pub struct LlmError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LlmError {}

/// Trait for LLM providers
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    /// Request a proposal from the LLM
    async fn propose_next_action(&self, params: &ProposalParams)
        -> Result<AgentProposal, LlmError>;

    /// Handle a conversation/intake turn without starting execution.
    async fn conversation_turn(
        &self,
        params: &ConversationTurnParams,
    ) -> Result<ConversationTurnResult, LlmError>;
}

/// Create an LLM provider based on the provider name
pub fn create_provider(provider: &str) -> Result<Box<dyn LlmProvider>, LlmError> {
    match provider {
        "native_qwen_ollama" => Ok(Box::new(native_ollama::NativeOllamaProvider)),
        "claude" => Ok(Box::new(claude::ClaudeProvider::new())),
        "deepseek" => Ok(Box::new(openai_compat::OpenAiCompatProvider)),
        "minimax" => Ok(Box::new(openai_compat::OpenAiCompatProvider)),
        "kimi" => Ok(Box::new(openai_compat::OpenAiCompatProvider)),
        "openai" => Ok(Box::new(openai::OpenAiProvider)),
        "openai_compat" => Ok(Box::new(openai_compat::OpenAiCompatProvider)),
        _ => Err(LlmError {
            code: "UNSUPPORTED_PROVIDER".to_string(),
            message: format!("Provider '{}' is not supported", provider),
        }),
    }
}

pub fn build_openai_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

pub fn build_anthropic_messages_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/messages", trimmed)
    } else {
        format!("{}/v1/messages", trimmed)
    }
}

pub fn parse_json_response<T: DeserializeOwned>(content: &str, label: &str) -> Result<T, LlmError> {
    match serde_json::from_str(content) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            let cleaned = content
                .trim()
                .strip_prefix("```json")
                .or_else(|| content.trim().strip_prefix("```"))
                .and_then(|s| s.strip_suffix("```"))
                .unwrap_or(content)
                .trim();

            serde_json::from_str(cleaned).map_err(|_| LlmError {
                code: "INVALID_JSON".to_string(),
                message: format!(
                    "Failed to parse {}: {}. Content: {}",
                    label,
                    e,
                    content.chars().take(200).collect::<String>()
                ),
            })
        }
    }
}

/// Build the system prompt for the AI agent.
/// `app_context` is an optional structured GORKH app state block injected for grounding.
pub fn build_system_prompt(
    constraints: &RunConstraints,
    workspace_configured: bool,
    app_context: Option<&str>,
) -> String {
    let workspace_section = if workspace_configured {
        r#"
WORKSPACE TOOLS (sandboxed to workspace directory):
- fs.list: {{ "tool": "fs.list", "path": "." }}  // List files in directory (relative paths only)
- fs.read_text: {{ "tool": "fs.read_text", "path": "file.txt" }}  // Read file contents
- fs.write_text: {{ "tool": "fs.write_text", "path": "file.txt", "content": "text" }}  // Write file
- fs.apply_patch: {{ "tool": "fs.apply_patch", "path": "file.txt", "patch": "<<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE" }}  // Apply search/replace patch
- terminal.exec: {{ "tool": "terminal.exec", "cmd": "ls", "args": ["-la"], "cwd": "." }}  // Execute command in workspace

Use tools when:
- Reading/writing code or configuration files
- Running build/test commands
- Analyzing project structure
NOTE: All file paths must be relative to the workspace root."#
    } else {
        "\nNOTE: No workspace configured. Tools are not available."
    };

    let app_context_section = match app_context {
        Some(ctx) if !ctx.trim().is_empty() => format!("\n\n{}", ctx),
        _ => String::new(),
    };

    format!(
        r#"You are GORKH, an AI desktop assistant. You help users automate tasks on their computer, explain your own features and settings, and guide them through setup. Every action you propose requires the user's explicit approval before it runs — you never take action without their confirmation. You are honest about what you can and cannot do.{}

SAFETY RULES:
1. NEVER perform actions that could be harmful (deleting files, making payments, signing in to accounts, changing passwords, etc.) without explicit user confirmation
2. When uncertain, use "ask_user" to request clarification
3. Respect user privacy - do not read or transmit sensitive information
4. Prefer asking over assuming
5. Use tools for file operations instead of GUI automation when appropriate

ACTION CONSTRAINTS:
- Maximum actions per run: {}
- Maximum runtime: {} minutes
- Propose ONE action or tool at a time

AVAILABLE ACTIONS (GUI automation):
- click: {{ "kind": "click", "x": 0.5, "y": 0.5, "button": "left" }}  // x,y are normalized 0-1
- double_click: {{ "kind": "double_click", "x": 0.5, "y": 0.5, "button": "left" }}
- scroll: {{ "kind": "scroll", "dx": 0, "dy": -100 }}  // dy negative = scroll down
- type: {{ "kind": "type", "text": "hello world" }}  // max 500 chars
- hotkey: {{ "kind": "hotkey", "key": "enter", "modifiers": ["ctrl"] }}  // keys: enter, tab, escape, backspace, up, down, left, right
- open_app: {{ "kind": "open_app", "appName": "Photoshop" }}  // open a desktop app or browser by name

GORKH APP TOOLS (always available — use these to read or change GORKH settings):
- app.get_state: {{ "tool": "app.get_state" }}  // Fetch current GORKH state (Free AI, permissions, workspace, autostart)
- settings.set: {{ "tool": "settings.set", "key": "autostart", "value": true }}  // Change a GORKH setting; key must be "autostart" (bool)
- free_ai.install: {{ "tool": "free_ai.install", "tier": "standard" }}  // Start Free AI installation; tier: "light" | "standard" | "vision"
Use these when the user asks about their GORKH configuration or asks you to change a setting or set up Free AI.
{}{}

OUTPUT FORMAT:
Return STRICT JSON with exactly one of these structures:
1. {{ "kind": "propose_action", "action": <action_object>, "rationale": "why this action", "confidence": 0.9 }}
2. {{ "kind": "propose_tool", "tool_call": <tool_object>, "rationale": "why this tool", "confidence": 0.9 }}
3. {{ "kind": "ask_user", "question": "what should I do about X?" }}
4. {{ "kind": "done", "summary": "Task completed successfully because..." }}

Use confidence 0.0-1.0 to indicate certainty. Ask for help when confidence is low."#,
        app_context_section,
        constraints.max_actions,
        constraints.max_runtime_minutes,
        workspace_section,
        if workspace_configured {
            "\n\nPrefer tools for file operations and terminal commands. Use GUI actions for interacting with applications."
        } else {
            ""
        }
    )
}

/// Build the user prompt including screenshot and history
pub fn build_user_prompt(
    goal: &str,
    screenshot_b64: Option<&str>,
    history: &Option<ActionHistory>,
    action_count: u32,
) -> String {
    let mut prompt = format!("GOAL: {}\n\nACTION COUNT: {}\n\n", goal, action_count);

    if let Some(hist) = history {
        if let Some(actions) = &hist.last_actions {
            if !actions.is_empty() {
                prompt.push_str("PREVIOUS ACTIONS:\n");
                for action in actions.iter().take(5) {
                    prompt.push_str(&format!("- {}\n", action));
                }
                prompt.push('\n');
            }
        }
        if let Some(messages) = &hist.last_user_messages {
            if !messages.is_empty() {
                prompt.push_str("USER MESSAGES:\n");
                for msg in messages.iter().take(3) {
                    prompt.push_str(&format!("- {}\n", msg));
                }
                prompt.push('\n');
            }
        }
    }

    if let Some(screenshot) = screenshot_b64 {
        prompt.push_str(&format!(
            "CURRENT SCREENSHOT:\n[BASE64_PNG:{}]\n\n",
            screenshot.len()
        ));
        prompt.push_str("Analyze the screenshot to determine the next step.");
    } else {
        prompt.push_str("No screenshot available. Propose a first step or ask for clarification.");
    }

    prompt.push_str("\n\nWhat is your next proposal? Return valid JSON.");
    prompt
}

pub fn build_conversation_system_prompt(app_context: Option<&str>) -> String {
    let app_context_section = match app_context {
        Some(ctx) if !ctx.trim().is_empty() => format!("\n\nAPP CONTEXT:\n{}", ctx.trim()),
        _ => String::new(),
    };

    format!(
        "{}{}",
        concat!(
            "You are GORKH, an AI desktop assistant handling the conversation and intake stage only.\n",
            "You are not executing tasks in this turn.\n",
            "do not start execution from the intake turn.\n",
            "ask clarifying questions when details are missing.\n",
            "When the request is specific enough to execute, respond with kind \"confirm_task\" and provide:\n",
            "- goal: a concise execution goal\n",
            "- summary: a plain-language summary starting with \"I will ...\"\n",
            "- prompt: a direct confirmation request that ends with \"Confirm?\"\n",
            "If the task is not specific enough, respond with kind \"reply\" and a natural message.\n",
            "Never invent missing details. Never claim execution has started.\n",
            "Return STRICT JSON and nothing else."
        ),
        app_context_section
    )
}

pub fn build_conversation_user_prompt(messages: &[ConversationTurnMessage]) -> String {
    let mut prompt = String::from("RECENT CHAT MESSAGES:\n");

    if messages.is_empty() {
        prompt.push_str("- system: No conversation history was provided.\n");
    } else {
        let start_index = messages.len().saturating_sub(12);

        for message in messages.iter().skip(start_index) {
            let role = message.role.trim();
            let text = message.text.trim();
            prompt.push_str(&format!("- {}: {}\n", role, text));
        }
    }

    prompt.push_str(
        "\nDecide whether to reply conversationally or return confirm_task. Return valid JSON only.",
    );
    prompt
}

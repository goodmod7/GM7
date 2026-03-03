use serde::{Deserialize, Serialize};

pub mod openai;

/// Available tools for the AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    TerminalExec { cmd: String, args: Vec<String>, cwd: Option<String> },
}

impl ToolCall {
    /// Returns true if this tool modifies files or executes commands
    pub fn is_destructive(&self) -> bool {
        matches!(self, 
            ToolCall::FsWriteText { .. } | 
            ToolCall::FsApplyPatch { .. } |
            ToolCall::TerminalExec { .. }
        )
    }
    
    /// Get the target path or command for logging
    pub fn target(&self) -> &str {
        match self {
            ToolCall::FsList { path } => path,
            ToolCall::FsReadText { path } => path,
            ToolCall::FsWriteText { path, .. } => path,
            ToolCall::FsApplyPatch { path, .. } => path,
            ToolCall::TerminalExec { cmd, .. } => cmd,
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
    Hotkey { key: String, modifiers: Option<Vec<String>> },
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionHistory {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_actions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_user_messages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConstraints {
    pub max_actions: u32,
    pub max_runtime_minutes: u32,
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
    async fn propose_next_action(&self, params: &ProposalParams) -> Result<AgentProposal, LlmError>;
}

/// Create an LLM provider based on the provider name
pub fn create_provider(provider: &str) -> Result<Box<dyn LlmProvider>, LlmError> {
    match provider {
        "openai" => Ok(Box::new(openai::OpenAiProvider)),
        _ => Err(LlmError {
            code: "UNSUPPORTED_PROVIDER".to_string(),
            message: format!("Provider '{}' is not supported", provider),
        }),
    }
}

/// Build the system prompt for the AI agent
pub fn build_system_prompt(constraints: &RunConstraints, workspace_configured: bool) -> String {
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

    format!(r#"You are an AI assistant helping a user accomplish tasks on their computer.

SAFETY RULES:
1. NEVER perform actions that could be harmful (deleting files, making payments, changing passwords, etc.) without explicit user confirmation
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
{}{}

OUTPUT FORMAT:
Return STRICT JSON with exactly one of these structures:
1. {{ "kind": "propose_action", "action": <action_object>, "rationale": "why this action", "confidence": 0.9 }}
2. {{ "kind": "propose_tool", "tool_call": <tool_object>, "rationale": "why this tool", "confidence": 0.9 }}
3. {{ "kind": "ask_user", "question": "what should I do about X?" }}
4. {{ "kind": "done", "summary": "Task completed successfully because..." }}

Use confidence 0.0-1.0 to indicate certainty. Ask for help when confidence is low."#,
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
    let mut prompt = format!(
        "GOAL: {}\n\nACTION COUNT: {}\n\n",
        goal,
        action_count
    );

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

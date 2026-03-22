//! Native Qwen model provider via Ollama
//!
//! This is the free, local-first provider that uses Ollama to run Qwen2.5-VL.

use super::*;
use serde_json::json;

/// Native Ollama provider for local Qwen models
pub struct NativeOllamaProvider {
    endpoint: String,
    model: String,
    client: reqwest::Client,
}

impl NativeOllamaProvider {
    pub fn new(endpoint: Option<String>, model: Option<String>) -> Self {
        Self {
            endpoint: endpoint.unwrap_or_else(|| "http://127.0.0.1:11434".to_string()),
            model: model.unwrap_or_else(|| "qwen2.5-vl:7b".to_string()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Generate a response from Ollama
    async fn generate(
        &self,
        system: &str,
        user: &str,
        image: Option<&str>,
    ) -> Result<LlmResponse, ProviderError> {
        let url = format!("{}/api/generate", self.endpoint);

        let prompt = if system.is_empty() {
            user.to_string()
        } else {
            format!("{system}\n\n{user}")
        };

        let mut request_body = json!({
            "model": self.model,
            "prompt": prompt,
            "stream": false,
            "options": {
                "temperature": 0.2,
                "num_predict": 2048,
            }
        });

        // Add image if provided (for vision models)
        if let Some(img_b64) = image {
            request_body["images"] = json!([img_b64]);
        }

        let response = self
            .client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ProviderError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Failed to connect to Ollama: {}", e),
                is_retryable: true,
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError {
                code: "OLLAMA_ERROR".to_string(),
                message: format!("Ollama returned {}: {}", status, text),
                is_retryable: status.is_server_error(),
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| ProviderError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse Ollama response: {}", e),
            is_retryable: false,
        })?;

        let content = result["response"].as_str().unwrap_or("").to_string();

        let prompt_tokens = result["prompt_eval_count"].as_u64().unwrap_or(0) as usize;
        let completion_tokens = result["eval_count"].as_u64().unwrap_or(0) as usize;

        Ok(LlmResponse {
            content,
            input_tokens: prompt_tokens,
            output_tokens: completion_tokens,
            model: self.model.clone(),
            finish_reason: result["done_reason"].as_str().unwrap_or("stop").to_string(),
        })
    }

    fn model_supports_vision(&self) -> bool {
        let normalized = self.model.trim().to_ascii_lowercase();
        normalized.contains("vl") || normalized.contains("vision") || normalized.contains("llava")
    }
}

#[async_trait]
impl LlmProvider for NativeOllamaProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::NativeQwenOllama
    }

    fn name(&self) -> &str {
        "GORKH Native (Qwen via Ollama)"
    }

    async fn is_available(&self) -> bool {
        // Check if Ollama is running by listing models
        let url = format!("{}/api/tags", self.endpoint);
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_vision: self.model_supports_vision(),
            supports_streaming: true,
            supports_functions: false,
            max_context_tokens: 32768,
            max_output_tokens: 4096,
        }
    }

    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError> {
        let system = r#"You are GORKH, an AI desktop assistant. Break down the user's goal into a step-by-step plan.

Output format: Return a JSON array of steps, where each step has:
- id: unique step identifier
- title: brief description
- description: detailed description
- type: one of ["ui_action", "tool", "ask_user", "verification"]

Example:
[
  {"id": "1", "title": "Open Chrome", "description": "Click Chrome icon to open browser", "type": "ui_action"},
  {"id": "2", "title": "Navigate to Gmail", "description": "Type gmail.com in address bar", "type": "ui_action"}
]

Rules:
- Be specific about UI actions (mention element names, coordinates if known)
- Use "tool" type for file operations or terminal commands
- Use "ui_action" with open_app when the task requires launching a desktop app or browser by name
- Use "ask_user" when you need clarification
- Keep steps atomic (one action per step)"#;

        let user = format!(
            "Goal: {}\n\nContext: {}\n\nCreate a detailed plan:",
            request.goal,
            request.context.as_deref().unwrap_or("None")
        );

        let response = self.generate(system, &user, None).await?;
        Ok(response.content)
    }

    async fn analyze_screen(
        &self,
        request: ScreenAnalysisRequest,
    ) -> Result<String, ProviderError> {
        let system = r#"You are GORKH, an AI desktop assistant with vision. Analyze the screenshot and provide a structured observation.

Output format: Return valid JSON with this structure:
{
  "screen_summary": "Brief description of what's visible",
  "ui_elements": [
    {
      "label": "button text or description",
      "type": "button|input|menu|dialog|canvas|text|icon|other",
      "bounds": {"x": 0.5, "y": 0.3, "width": 0.1, "height": 0.05},
      "interactable": true
    }
  ],
  "notable_warnings": ["any error messages, popups, or issues"],
  "inferred_app": "Name of the active application"
}

Guidelines:
- Bounds are normalized (0-1) coordinates
- Include all interactable elements you can see
- Note any error states or blocking dialogs
- Be specific about text visible on buttons/labels"#;

        let user = format!(
            "Goal: {}\n\nPrevious actions: {:?}\n\nAnalyze this screenshot:",
            request.goal, request.previous_actions
        );

        let response = self
            .generate(system, &user, Some(&request.screenshot_base64))
            .await?;
        Ok(response.content)
    }

    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError> {
        let system = r#"You are GORKH, an AI desktop assistant. Based on the current screen observation, propose the next action.

Output format: Return valid JSON with ONE of these structures:

1. UI Action:
{
  "action_type": "click|double_click|type|hotkey|scroll|wait|open_app",
  "params": {"x": 0.5, "y": 0.3} or {"text": "hello"} or {"key": "enter", "modifiers": ["ctrl"]} or {"app_name": "Photoshop"},
  "rationale": "Why this action",
  "confidence": 0.9
}

2. Tool Call:
{
  "action_type": "tool",
  "tool": "fs.list|fs.read_text|fs.write_text|terminal.exec",
  "params": {"path": "..."} or {"cmd": "..."},
  "rationale": "Why this tool",
  "confidence": 0.9
}

3. Ask User:
{
  "action_type": "ask_user",
  "question": "What should I do about...?"
}

4. Done:
{
  "action_type": "done",
  "summary": "Task completed successfully"
}

Guidelines:
- Use normalized coordinates (0-1) for UI actions
- Be precise about element locations
- Use open_app when the next action is to launch a desktop app or browser by name
- Ask for help if confidence is low (< 0.7)"#;

        let user = format!(
            "Goal: {}\n\nStep: {}\n\nScreen observation: {}\n\nWhat should I do next?",
            request.goal, request.step_description, request.observation
        );

        let response = self.generate(system, &user, None).await?;
        Ok(response.content)
    }

    async fn summarize_result(&self, result_text: &str) -> Result<String, ProviderError> {
        let system = "Summarize the task result in 1-2 sentences for the user.";
        let user = format!("Result:\n{}\n\nProvide a brief summary:", result_text);

        let response = self.generate(system, &user, None).await?;
        Ok(response.content)
    }

    fn estimate_cost(&self, _input_tokens: usize, _output_tokens: usize) -> f64 {
        0.0 // Always free
    }
}

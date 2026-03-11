//! OpenAI API provider (paid)

use super::*;
use serde_json::json;

/// OpenAI API provider
pub struct OpenAiProvider {
    api_key: String,
    base_url: String,
    model: String,
    client: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(api_key: String, base_url: Option<String>, model: Option<String>) -> Self {
        Self {
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            model: model.unwrap_or_else(|| "gpt-4o".to_string()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Call OpenAI chat completions API
    async fn chat_completion(
        &self,
        system: &str,
        user: &str,
        image: Option<&str>,
    ) -> Result<LlmResponse, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);

        let mut messages = vec![json!({"role": "system", "content": system})];

        // Build user message
        let user_message = if let Some(img_b64) = image {
            json!({
                "role": "user",
                "content": [
                    {"type": "text", "text": user},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/png;base64,{}", img_b64),
                            "detail": "high"
                        }
                    }
                ]
            })
        } else {
            json!({"role": "user", "content": user})
        };
        messages.push(user_message);

        let request_body = json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 2048,
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ProviderError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Failed to connect to OpenAI: {}", e),
                is_retryable: true,
            })?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError {
                code: if status.as_u16() == 429 {
                    "RATE_LIMITED".to_string()
                } else {
                    "OPENAI_ERROR".to_string()
                },
                message: format!("OpenAI returned {}: {}", status, text),
                is_retryable: status.is_server_error() || status.as_u16() == 429,
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| ProviderError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse OpenAI response: {}", e),
            is_retryable: false,
        })?;

        let content = result["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let input_tokens = result["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as usize;
        let output_tokens = result["usage"]["completion_tokens"].as_u64().unwrap_or(0) as usize;

        Ok(LlmResponse {
            content,
            input_tokens,
            output_tokens,
            model: self.model.clone(),
            finish_reason: result["choices"][0]["finish_reason"]
                .as_str()
                .unwrap_or("stop")
                .to_string(),
        })
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::OpenAi
    }

    fn name(&self) -> &str {
        "OpenAI"
    }

    async fn is_available(&self) -> bool {
        // Test with a simple request
        self.chat_completion("You are a test.", "Say 'ok' only.", None)
            .await
            .is_ok()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_vision: self.model.starts_with("gpt-4") && self.model.contains("o"),
            supports_streaming: true,
            supports_functions: true,
            max_context_tokens: 128000,
            max_output_tokens: 4096,
        }
    }

    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError> {
        let system = r#"You are a computer automation agent. Break down the user's goal into a step-by-step plan.

Output format: Return a JSON array of steps, where each step has:
- id: unique step identifier
- title: brief description
- description: detailed description
- type: one of ["ui_action", "tool", "ask_user", "verification"]

Rules:
- Be specific about UI actions
- Use "tool" type for file operations or terminal commands
- Use "ask_user" when you need clarification
- Keep steps atomic (one action per step)"#;

        let user = format!(
            "Goal: {}\n\nContext: {}\n\nCreate a detailed plan:",
            request.goal,
            request.context.as_deref().unwrap_or("None")
        );

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    async fn analyze_screen(
        &self,
        request: ScreenAnalysisRequest,
    ) -> Result<String, ProviderError> {
        if !self.capabilities().supports_vision {
            return Err(ProviderError {
                code: "VISION_NOT_SUPPORTED".to_string(),
                message: format!("Model {} does not support vision", self.model),
                is_retryable: false,
            });
        }

        let system = r#"Analyze the screenshot and provide a structured observation.

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
}"#;

        let user = format!(
            "Goal: {}\n\nPrevious actions: {:?}\n\nAnalyze this screenshot:",
            request.goal, request.previous_actions
        );

        let response = self
            .chat_completion(system, &user, Some(&request.screenshot_base64))
            .await?;
        Ok(response.content)
    }

    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError> {
        let system = r#"Based on the current screen observation, propose the next action.

Output format: Return valid JSON with ONE action structure. Be precise about coordinates (normalized 0-1)."#;

        let user = format!(
            "Goal: {}\n\nStep: {}\n\nScreen observation: {}\n\nWhat should I do next?",
            request.goal, request.step_description, request.observation
        );

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    async fn summarize_result(&self, result_text: &str) -> Result<String, ProviderError> {
        let system = "Summarize the task result in 1-2 sentences.";
        let user = format!("Result:\n{}\n\nSummarize:", result_text);

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    fn estimate_cost(&self, input_tokens: usize, output_tokens: usize) -> f64 {
        // GPT-4o pricing: $5/M input, $15/M output
        let input_cost = input_tokens as f64 / 1_000_000.0 * 5.0;
        let output_cost = output_tokens as f64 / 1_000_000.0 * 15.0;
        input_cost + output_cost
    }
}

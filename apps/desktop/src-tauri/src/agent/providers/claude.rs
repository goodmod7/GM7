//! Anthropic Claude API provider (paid)

use super::*;
use serde_json::json;

/// Claude API provider
pub struct ClaudeProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl ClaudeProvider {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            api_key,
            model: model.unwrap_or_else(|| "claude-3-5-sonnet-20241022".to_string()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Call Claude Messages API
    async fn messages(
        &self,
        system: &str,
        user: &str,
        image: Option<&str>,
    ) -> Result<LlmResponse, ProviderError> {
        let url = "https://api.anthropic.com/v1/messages";

        // Build content
        let content = if let Some(img_b64) = image {
            json!([
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": img_b64
                    }
                },
                {
                    "type": "text",
                    "text": user
                }
            ])
        } else {
            json!([{"type": "text", "text": user}])
        };

        let request_body = json!({
            "model": self.model,
            "max_tokens": 4096,
            "temperature": 0.2,
            "system": system,
            "messages": [
                {"role": "user", "content": content}
            ]
        });

        let response = self
            .client
            .post(url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ProviderError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Failed to connect to Claude: {}", e),
                is_retryable: true,
            })?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError {
                code: if status.as_u16() == 429 {
                    "RATE_LIMITED".to_string()
                } else {
                    "CLAUDE_ERROR".to_string()
                },
                message: format!("Claude returned {}: {}", status, text),
                is_retryable: status.is_server_error() || status.as_u16() == 429,
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| ProviderError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse Claude response: {}", e),
            is_retryable: false,
        })?;

        let content = result["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let input_tokens = result["usage"]["input_tokens"].as_u64().unwrap_or(0) as usize;
        let output_tokens = result["usage"]["output_tokens"].as_u64().unwrap_or(0) as usize;

        Ok(LlmResponse {
            content,
            input_tokens,
            output_tokens,
            model: self.model.clone(),
            finish_reason: result["stop_reason"].as_str().unwrap_or("stop").to_string(),
        })
    }
}

#[async_trait]
impl LlmProvider for ClaudeProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Claude
    }

    fn name(&self) -> &str {
        "Claude 3.5 Sonnet"
    }

    async fn is_available(&self) -> bool {
        self.messages("You are a test.", "Say 'ok' only.", None)
            .await
            .is_ok()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_vision: true,
            supports_streaming: false,
            supports_functions: false,
            max_context_tokens: 200000,
            max_output_tokens: 8192,
        }
    }

    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError> {
        let system = r#"You are a computer automation agent. Break down the user's goal into a step-by-step plan.

Output format: Return a JSON array of steps with id, title, description, and type fields."#;

        let user = format!(
            "Goal: {}\n\nContext: {}\n\nCreate a detailed plan:",
            request.goal,
            request.context.as_deref().unwrap_or("None")
        );

        let response = self.messages(system, &user, None).await?;
        Ok(response.content)
    }

    async fn analyze_screen(
        &self,
        request: ScreenAnalysisRequest,
    ) -> Result<String, ProviderError> {
        let system = r#"Analyze the screenshot and provide structured observations in JSON format with screen_summary, ui_elements, notable_warnings, and inferred_app fields."#;

        let user = format!(
            "Goal: {}\n\nPrevious actions: {:?}\n\nAnalyze this screenshot:",
            request.goal, request.previous_actions
        );

        let response = self
            .messages(system, &user, Some(&request.screenshot_base64))
            .await?;
        Ok(response.content)
    }

    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError> {
        let system = r#"Based on the screen observation, propose the next action in JSON format."#;

        let user = format!(
            "Goal: {}\n\nStep: {}\n\nObservation: {}\n\nPropose next action:",
            request.goal, request.step_description, request.observation
        );

        let response = self.messages(system, &user, None).await?;
        Ok(response.content)
    }

    async fn summarize_result(&self, result_text: &str) -> Result<String, ProviderError> {
        let system = "Summarize the task result briefly.";
        let user = format!("Result:\n{}\n\nSummarize:", result_text);

        let response = self.messages(system, &user, None).await?;
        Ok(response.content)
    }

    fn estimate_cost(&self, input_tokens: usize, output_tokens: usize) -> f64 {
        // Claude 3.5 Sonnet pricing: $3/M input, $15/M output
        let input_cost = input_tokens as f64 / 1_000_000.0 * 3.0;
        let output_cost = output_tokens as f64 / 1_000_000.0 * 15.0;
        input_cost + output_cost
    }
}

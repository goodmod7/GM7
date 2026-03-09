//! Local OpenAI-compatible provider (e.g., llama.cpp, vLLM)
//!
//! Similar to OpenAI provider but defaults to localhost and no API key required.

use super::*;
use serde_json::json;

/// Local OpenAI-compatible provider
pub struct LocalCompatProvider {
    endpoint: String,
    model: String,
    client: reqwest::Client,
}

impl LocalCompatProvider {
    pub fn new(endpoint: Option<String>, model: Option<String>) -> Self {
        Self {
            endpoint: endpoint.unwrap_or_else(|| "http://127.0.0.1:8000/v1".to_string()),
            model: model.unwrap_or_else(|| "local-model".to_string()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Call local OpenAI-compatible API
    async fn chat_completion(
        &self,
        system: &str,
        user: &str,
        image: Option<&str>,
    ) -> Result<LlmResponse, ProviderError> {
        let url = format!("{}/chat/completions", self.endpoint);

        let mut messages = vec![
            json!({"role": "system", "content": system}),
        ];

        // Build user message
        let user_message = if let Some(img_b64) = image {
            // Many local servers don't support vision, but try anyway
            json!({
                "role": "user",
                "content": [
                    {"type": "text", "text": user},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/png;base64,{}", img_b64)
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
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ProviderError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Failed to connect to local server: {}", e),
                is_retryable: true,
            })?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError {
                code: "LOCAL_API_ERROR".to_string(),
                message: format!("Local API returned {}: {}", status, text),
                is_retryable: status.is_server_error(),
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| ProviderError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse response: {}", e),
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
impl LlmProvider for LocalCompatProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::LocalOpenAiCompat
    }

    fn name(&self) -> &str {
        "Local (OpenAI-compatible)"
    }

    async fn is_available(&self) -> bool {
        // Check if server is running
        let url = format!("{}/models", self.endpoint);
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    fn capabilities(&self) -> ProviderCapabilities {
        // Assume local models have limited capabilities by default
        ProviderCapabilities {
            supports_vision: false, // Most local servers don't support vision
            supports_streaming: true,
            supports_functions: false,
            max_context_tokens: 8192,
            max_output_tokens: 2048,
        }
    }

    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError> {
        let system = "You are a computer automation agent. Break down the user's goal into a step-by-step plan. Return JSON array of steps.";

        let user = format!(
            "Goal: {}\n\nContext: {}\n\nCreate a detailed plan:",
            request.goal,
            request.context.as_deref().unwrap_or("None")
        );

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    async fn analyze_screen(&self, request: ScreenAnalysisRequest) -> Result<String, ProviderError> {
        // Most local servers don't support vision, so we describe the image in text
        let system = r#"Analyze the described screenshot and provide structured observations in JSON format.
Since you cannot see the image directly, the user has described it for you."#;

        let user = format!(
            "Goal: {}\n\nPrevious actions: {:?}\n\nScreenshot description: [Base64 image: {} bytes]\n\nProvide JSON analysis:",
            request.goal,
            request.previous_actions,
            request.screenshot_base64.len()
        );

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError> {
        let system = "Based on the screen observation, propose the next action in JSON format.";

        let user = format!(
            "Goal: {}\n\nStep: {}\n\nObservation: {}\n\nPropose next action:",
            request.goal, request.step_description, request.observation
        );

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    async fn summarize_result(&self, result_text: &str) -> Result<String, ProviderError> {
        let system = "Summarize the task result briefly.";
        let user = format!("Result:\n{}\n\nSummarize:", result_text);

        let response = self.chat_completion(system, &user, None).await?;
        Ok(response.content)
    }

    fn estimate_cost(&self, _input_tokens: usize, _output_tokens: usize) -> f64 {
        0.0 // Local = free
    }
}

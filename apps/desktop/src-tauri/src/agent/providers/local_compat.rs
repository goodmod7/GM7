//! Local OpenAI-compatible provider (e.g., llama.cpp, vLLM)
//!
//! Similar to the OpenAI provider but defaults to localhost and only sends
//! Authorization when a runtime-specific bearer token is configured.

use super::*;
use serde_json::json;

fn is_hosted_free_ai_fallback_endpoint(endpoint: &str) -> bool {
    endpoint
        .trim_end_matches('/')
        .ends_with("/desktop/free-ai/v1")
}

fn build_local_compat_client(endpoint: &str) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120));

    // Keep the authenticated desktop fallback on HTTP/1.1 to avoid the packaged macOS
    // transport failures seen against the Render proxy edge.
    if is_hosted_free_ai_fallback_endpoint(endpoint) {
        builder = builder.http1_only();
    }

    builder.build().unwrap_or_default()
}

fn local_compat_connection_message(endpoint: &str, error: &reqwest::Error) -> String {
    if is_hosted_free_ai_fallback_endpoint(endpoint) {
        format!("Failed to connect to Hosted Free AI fallback: {}", error)
    } else {
        format!("Failed to connect to local server: {}", error)
    }
}

fn local_compat_api_error_message(
    endpoint: &str,
    status: reqwest::StatusCode,
    text: &str,
) -> String {
    if is_hosted_free_ai_fallback_endpoint(endpoint) {
        if status.as_u16() == 401 {
            "Hosted Free AI fallback requires desktop sign-in. Sign out and sign back in, then try again."
                .to_string()
        } else if status.as_u16() == 404 {
            format!(
                "Hosted Free AI fallback returned 404. Ensure the desktop API exposes /desktop/free-ai/v1/chat/completions. Error: {}",
                text
            )
        } else {
            format!("Hosted Free AI fallback error {}: {}", status, text)
        }
    } else {
        format!("Local API returned {}: {}", status, text)
    }
}

fn local_compat_parse_error_message(endpoint: &str, error: &reqwest::Error) -> String {
    if is_hosted_free_ai_fallback_endpoint(endpoint) {
        format!("Failed to parse Hosted Free AI fallback response: {}", error)
    } else {
        format!("Failed to parse response: {}", error)
    }
}

/// Local OpenAI-compatible provider
pub struct LocalCompatProvider {
    endpoint: String,
    model: String,
    api_key: Option<String>,
    supports_vision: bool,
    client: reqwest::Client,
}

impl LocalCompatProvider {
    pub fn new(
        endpoint: Option<String>,
        model: Option<String>,
        api_key: Option<String>,
        supports_vision: Option<bool>,
    ) -> Self {
        let resolved_endpoint = endpoint.unwrap_or_else(|| "http://127.0.0.1:8000/v1".to_string());
        Self {
            endpoint: resolved_endpoint.clone(),
            model: model.unwrap_or_else(|| "local-model".to_string()),
            api_key,
            supports_vision: supports_vision.unwrap_or(false),
            client: build_local_compat_client(&resolved_endpoint),
        }
    }

    fn auth_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.api_key.as_deref() {
            Some(value) if !value.trim().is_empty() => {
                request.header("Authorization", format!("Bearer {}", value))
            }
            _ => request,
        }
    }

    /// Call OpenAI-compatible chat completions API
    async fn chat_completion(
        &self,
        system: &str,
        user: &str,
        image: Option<&str>,
    ) -> Result<LlmResponse, ProviderError> {
        let url = format!("{}/chat/completions", self.endpoint);

        let mut messages = vec![json!({"role": "system", "content": system})];

        let user_message = if let Some(img_b64) = image {
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
            .auth_request(self.client.post(&url))
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ProviderError {
                code: "NETWORK_ERROR".to_string(),
                message: local_compat_connection_message(&self.endpoint, &e),
                is_retryable: true,
            })?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError {
                code: "LOCAL_API_ERROR".to_string(),
                message: local_compat_api_error_message(&self.endpoint, status, &text),
                is_retryable: status.is_server_error(),
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| ProviderError {
            code: "PARSE_ERROR".to_string(),
            message: local_compat_parse_error_message(&self.endpoint, &e),
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
        let url = format!("{}/models", self.endpoint);
        match self.auth_request(self.client.get(&url)).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_vision: self.supports_vision,
            supports_streaming: true,
            supports_functions: false,
            max_context_tokens: 8192,
            max_output_tokens: 2048,
        }
    }

    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError> {
        let system = "You are a computer automation agent. Break down the user's goal into a step-by-step plan. Return JSON array of steps. Use open_app when the task requires launching a desktop app or browser by name.";

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
        if !self.supports_vision {
            return Err(ProviderError {
                code: "VISION_NOT_SUPPORTED".to_string(),
                message: format!("Model {} does not support vision", self.model),
                is_retryable: false,
            });
        }

        let system = r#"Analyze the screenshot and provide structured observations in JSON format."#;
        let user = format!(
            "Goal: {}\n\nPrevious actions: {:?}\n\nAnalyze this screenshot and return JSON observations:",
            request.goal, request.previous_actions
        );

        let response = self
            .chat_completion(system, &user, Some(&request.screenshot_base64))
            .await?;
        Ok(response.content)
    }

    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError> {
        let system = "Based on the screen observation, propose the next action in JSON format. Use open_app when the next step is to launch a desktop app or browser by name.";

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
        0.0
    }
}

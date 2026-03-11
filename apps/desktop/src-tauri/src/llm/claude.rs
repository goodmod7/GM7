use super::{AgentProposal, LlmError, LlmProvider, ProposalParams};
use reqwest::Client;
use serde_json::json;

pub struct ClaudeProvider {
    client: Client,
}

impl ClaudeProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }
}

#[async_trait::async_trait]
impl LlmProvider for ClaudeProvider {
    async fn propose_next_action(
        &self,
        params: &ProposalParams,
    ) -> Result<AgentProposal, LlmError> {
        let system_prompt = super::build_system_prompt(
            &params.constraints,
            params.workspace_configured.unwrap_or(false),
        );
        let user_prompt = super::build_user_prompt(
            &params.goal,
            params.screenshot_png_base64.as_deref(),
            &params.history,
            0,
        );

        let content = if let Some(screenshot_b64) = &params.screenshot_png_base64 {
            let clean_b64 = screenshot_b64
                .strip_prefix("data:image/png;base64,")
                .unwrap_or(screenshot_b64);
            json!([
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": clean_b64
                    }
                },
                {
                    "type": "text",
                    "text": user_prompt
                }
            ])
        } else {
            json!([{ "type": "text", "text": user_prompt }])
        };

        let request_body = json!({
            "model": params.model,
            "max_tokens": 1000,
            "temperature": 0.2,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": content
                }
            ]
        });

        let response = self
            .client
            .post(super::build_anthropic_messages_url(&params.base_url))
            .header("x-api-key", &params.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                let code = if e.is_connect() {
                    "CONNECTION_FAILED"
                } else if e.is_timeout() {
                    "TIMEOUT"
                } else {
                    "REQUEST_FAILED"
                };
                LlmError {
                    code: code.to_string(),
                    message: format!("Failed to connect to Claude: {}", e),
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(LlmError {
                code: "API_ERROR".to_string(),
                message: format!("Claude API error {}: {}", status, text),
            });
        }

        let result: serde_json::Value = response.json().await.map_err(|e| LlmError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse Claude response: {}", e),
        })?;

        let content = result["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let proposal: AgentProposal = match serde_json::from_str(&content) {
            Ok(proposal) => proposal,
            Err(e) => {
                let cleaned = content
                    .trim()
                    .strip_prefix("```json")
                    .or_else(|| content.trim().strip_prefix("```"))
                    .and_then(|s| s.strip_suffix("```"))
                    .unwrap_or(&content)
                    .trim();

                serde_json::from_str(cleaned).map_err(|_| LlmError {
                    code: "INVALID_JSON".to_string(),
                    message: format!(
                        "Failed to parse proposal: {}. Content: {}",
                        e,
                        content.chars().take(200).collect::<String>()
                    ),
                })?
            }
        };

        Ok(proposal)
    }
}

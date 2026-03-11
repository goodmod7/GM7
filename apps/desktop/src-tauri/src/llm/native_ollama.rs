use super::{AgentProposal, LlmError, LlmProvider, ProposalParams};
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct NativeOllamaProvider;

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    options: OllamaOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    response: String,
}

#[async_trait::async_trait]
impl LlmProvider for NativeOllamaProvider {
    async fn propose_next_action(&self, params: &ProposalParams) -> Result<AgentProposal, LlmError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| LlmError {
                code: "CLIENT_INIT_FAILED".to_string(),
                message: format!("Failed to create HTTP client: {}", e),
            })?;

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
        let prompt = format!("{system_prompt}\n\n{user_prompt}");
        let clean_image = params
            .screenshot_png_base64
            .as_deref()
            .map(|value| {
                value
                    .strip_prefix("data:image/png;base64,")
                    .unwrap_or(value)
                    .to_string()
            });

        let request_body = OllamaRequest {
            model: params.model.clone(),
            prompt,
            stream: false,
            options: OllamaOptions {
                temperature: 0.2,
                num_predict: 1000,
            },
            images: clean_image.map(|image| vec![image]),
        };

        let response = client
            .post(format!("{}/api/generate", params.base_url.trim_end_matches('/')))
            .header("Content-Type", "application/json")
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
                    message: format!(
                        "Failed to connect to Ollama at {}: {}. Start Ollama and ensure it is listening on that address.",
                        params.base_url, e
                    ),
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = if status.as_u16() == 404 {
                format!(
                    "Ollama could not find model '{}'. Run `ollama pull {}` and try again.",
                    params.model, params.model
                )
            } else {
                format!("Ollama error {}: {}", status, text)
            };

            return Err(LlmError {
                code: "OLLAMA_ERROR".to_string(),
                message,
            });
        }

        let ollama_response: OllamaResponse = response.json().await.map_err(|e| LlmError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse Ollama response: {}", e),
        })?;

        let content = ollama_response.response;
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

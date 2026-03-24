use super::{
    AgentProposal, ConversationTurnParams, ConversationTurnResult, LlmError, LlmProvider,
    ProposalParams,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct OpenAiCompatProvider;

const OPEN_APP_PROMPT_HINT: &str = "Use open_app with {\"kind\":\"open_app\",\"appName\":\"Photoshop\"} when the next step is to launch a desktop app or browser by name.";

const CONVERSATION_INTAKE_PROMPT_RULES: &str = concat!(
    "do not start execution from the intake turn.\n",
    "ask clarifying questions when details are missing.\n",
    "Return either reply or confirm_task JSON.\n",
    "Before confirm_task, provide a plain-language summary in the form \"I will ...\" and ask \"Confirm?\".\n",
    "If the task includes opening an app or browser, mention it as open_app in the summary rather than starting execution.\n"
);

#[derive(Debug, Serialize)]
struct OpenAiCompatMessage {
    role: String,
    content: Vec<OpenAiCompatContent>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OpenAiCompatContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct OpenAiCompatRequest {
    model: String,
    messages: Vec<OpenAiCompatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatResponse {
    choices: Vec<OpenAiCompatChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatChoice {
    message: OpenAiCompatResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatResponseMessage {
    content: String,
}

fn is_hosted_free_ai_fallback(base_url: &str) -> bool {
    base_url.trim_end_matches('/').ends_with("/desktop/free-ai/v1")
}

fn openai_compat_connection_message(base_url: &str, error: &reqwest::Error) -> String {
    if is_hosted_free_ai_fallback(base_url) {
        format!("Failed to connect to Hosted Free AI fallback: {}", error)
    } else {
        format!("Failed to connect to local LLM server: {}", error)
    }
}

fn openai_compat_api_error_message(base_url: &str, status: reqwest::StatusCode, text: &str) -> String {
    if is_hosted_free_ai_fallback(base_url) {
        if status.as_u16() == 404 {
            format!(
                "Hosted Free AI fallback returned 404. Ensure the desktop API exposes /desktop/free-ai/v1/chat/completions. Error: {}",
                text
            )
        } else if status.as_u16() == 401 {
            "Hosted Free AI fallback requires desktop sign-in. Sign out and sign back in, then try again."
                .to_string()
        } else {
            format!("Hosted Free AI fallback error {}: {}", status, text)
        }
    } else if status.as_u16() == 404 {
        format!("Local server returned 404. Ensure the server supports OpenAI-compatible endpoints at /v1/chat/completions. Error: {}", text)
    } else if status.as_u16() == 401 {
        "Local server requires authentication. If your server needs an API key, enter it above.".to_string()
    } else {
        format!("Local server error {}: {}", status, text)
    }
}

fn openai_compat_parse_error_message(base_url: &str, error: &reqwest::Error) -> String {
    if is_hosted_free_ai_fallback(base_url) {
        format!("Failed to parse response from Hosted Free AI fallback: {}", error)
    } else {
        format!("Failed to parse response from local server: {}", error)
    }
}

fn openai_compat_empty_response_message(base_url: &str) -> String {
    if is_hosted_free_ai_fallback(base_url) {
        "Hosted Free AI fallback returned no response".to_string()
    } else {
        "No response from local LLM".to_string()
    }
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn propose_next_action(
        &self,
        params: &ProposalParams,
    ) -> Result<AgentProposal, LlmError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| LlmError {
                code: "CLIENT_INIT_FAILED".to_string(),
                message: format!("Failed to create HTTP client: {}", e),
            })?;

        let system_prompt = format!(
            "{}\n\n{}",
            super::build_system_prompt(
                &params.constraints,
                params.workspace_configured.unwrap_or(false),
                params.app_context.as_deref(),
            ),
            OPEN_APP_PROMPT_HINT
        );
        let user_prompt = super::build_user_prompt(
            &params.goal,
            params.screenshot_png_base64.as_deref(),
            &params.history,
            0,
        );

        // Build messages
        let mut messages = vec![OpenAiCompatMessage {
            role: "system".to_string(),
            content: vec![OpenAiCompatContent::Text {
                text: system_prompt,
            }],
        }];

        // Add user message with text and optionally image
        let mut user_content = vec![OpenAiCompatContent::Text { text: user_prompt }];

        // If we have a screenshot, add it as an image
        if let Some(screenshot_b64) = &params.screenshot_png_base64 {
            // Ensure the base64 doesn't include data URI prefix
            let clean_b64 = screenshot_b64
                .strip_prefix("data:image/png;base64,")
                .unwrap_or(screenshot_b64);

            user_content.push(OpenAiCompatContent::ImageUrl {
                image_url: ImageUrl {
                    url: format!("data:image/png;base64,{}", clean_b64),
                },
            });
        }

        messages.push(OpenAiCompatMessage {
            role: "user".to_string(),
            content: user_content,
        });

        let request_body = OpenAiCompatRequest {
            model: params.model.clone(),
            messages,
            max_tokens: Some(1000),
        };

        let url = super::build_openai_chat_completions_url(&params.base_url);

        let mut request_builder = client.post(&url).header("Content-Type", "application/json");

        // Only add Authorization header if API key is provided and non-empty
        // For local servers, the key is typically not required
        if !params.api_key.is_empty() {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", params.api_key));
        }

        let response = request_builder
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
                    message: openai_compat_connection_message(&params.base_url, &e),
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = openai_compat_api_error_message(&params.base_url, status, &text);

            return Err(LlmError {
                code: "API_ERROR".to_string(),
                message,
            });
        }

        let compat_response: OpenAiCompatResponse =
            response.json().await.map_err(|e| LlmError {
                code: "PARSE_ERROR".to_string(),
                message: openai_compat_parse_error_message(&params.base_url, &e),
            })?;

        let content = compat_response
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| LlmError {
                code: "EMPTY_RESPONSE".to_string(),
                message: openai_compat_empty_response_message(&params.base_url),
            })?;

        // Parse the JSON response
        let proposal = super::parse_json_response::<AgentProposal>(&content, "proposal")?;

        Ok(proposal)
    }

    async fn conversation_turn(
        &self,
        params: &ConversationTurnParams,
    ) -> Result<ConversationTurnResult, LlmError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| LlmError {
                code: "CLIENT_INIT_FAILED".to_string(),
                message: format!("Failed to create HTTP client: {}", e),
            })?;

        let system_prompt = format!(
            "{}\n\n{}",
            super::build_conversation_system_prompt(params.app_context.as_deref()),
            CONVERSATION_INTAKE_PROMPT_RULES
        );
        let user_prompt = super::build_conversation_user_prompt(&params.messages);
        let request_body = OpenAiCompatRequest {
            model: params.model.clone(),
            messages: vec![
                OpenAiCompatMessage {
                    role: "system".to_string(),
                    content: vec![OpenAiCompatContent::Text {
                        text: system_prompt,
                    }],
                },
                OpenAiCompatMessage {
                    role: "user".to_string(),
                    content: vec![OpenAiCompatContent::Text { text: user_prompt }],
                },
            ],
            max_tokens: Some(600),
        };

        let url = super::build_openai_chat_completions_url(&params.base_url);
        let mut request_builder = client.post(&url).header("Content-Type", "application/json");

        if !params.api_key.is_empty() {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", params.api_key));
        }

        let response = request_builder
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
                    message: openai_compat_connection_message(&params.base_url, &e),
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = openai_compat_api_error_message(&params.base_url, status, &text);

            return Err(LlmError {
                code: "API_ERROR".to_string(),
                message,
            });
        }

        let compat_response: OpenAiCompatResponse =
            response.json().await.map_err(|e| LlmError {
                code: "PARSE_ERROR".to_string(),
                message: openai_compat_parse_error_message(&params.base_url, &e),
            })?;

        let content = compat_response
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| LlmError {
                code: "EMPTY_RESPONSE".to_string(),
                message: openai_compat_empty_response_message(&params.base_url),
            })?;

        super::parse_json_response::<ConversationTurnResult>(&content, "conversation turn")
    }
}

/// Create a fallback "ask_user" proposal when the local server is unreachable
#[allow(dead_code)]
pub fn create_server_unreachable_proposal() -> AgentProposal {
    AgentProposal::AskUser {
        question: "Unable to connect to the local LLM server. Please ensure your local model is running and try again. If you haven't set up a local model yet, check the documentation for instructions on running Qwen or another OpenAI-compatible model locally.".to_string(),
    }
}

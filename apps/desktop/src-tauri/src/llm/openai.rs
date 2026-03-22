use super::{
    AgentProposal, ConversationTurnParams, ConversationTurnResult, LlmError, LlmProvider,
    ProposalParams,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct OpenAiProvider;

const OPEN_APP_PROMPT_HINT: &str = "Use open_app with {\"kind\":\"open_app\",\"appName\":\"Photoshop\"} when the next step is to launch a desktop app or browser by name.";

const CONVERSATION_INTAKE_PROMPT_RULES: &str = concat!(
    "do not start execution from the intake turn.\n",
    "ask clarifying questions when details are missing.\n",
    "Return either reply or confirm_task JSON.\n",
    "Before confirm_task, provide a plain-language summary in the form \"I will ...\" and ask \"Confirm?\".\n",
    "If the task includes opening an app or browser, mention it as open_app in the summary rather than starting execution.\n"
);

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    content: Vec<OpenAiContent>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OpenAiContent {
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
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseMessage {
    content: String,
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiProvider {
    async fn propose_next_action(
        &self,
        params: &ProposalParams,
    ) -> Result<AgentProposal, LlmError> {
        let client = Client::new();

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
            0, // Action count is tracked separately
        );

        // Build messages
        let mut messages = vec![OpenAiMessage {
            role: "system".to_string(),
            content: vec![OpenAiContent::Text {
                text: system_prompt,
            }],
        }];

        // Add user message with text and optionally image
        let mut user_content = vec![OpenAiContent::Text { text: user_prompt }];

        // If we have a screenshot, add it as an image
        if let Some(screenshot_b64) = &params.screenshot_png_base64 {
            // Ensure the base64 doesn't include data URI prefix
            let clean_b64 = screenshot_b64
                .strip_prefix("data:image/png;base64,")
                .unwrap_or(screenshot_b64);

            user_content.push(OpenAiContent::ImageUrl {
                image_url: ImageUrl {
                    url: format!("data:image/png;base64,{}", clean_b64),
                },
            });
        }

        messages.push(OpenAiMessage {
            role: "user".to_string(),
            content: user_content,
        });

        let request_body = OpenAiRequest {
            model: params.model.clone(),
            messages,
            max_tokens: Some(1000),
        };

        let response = client
            .post(super::build_openai_chat_completions_url(&params.base_url))
            .header("Authorization", format!("Bearer {}", params.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| LlmError {
                code: "REQUEST_FAILED".to_string(),
                message: format!("Failed to send request: {}", e),
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(LlmError {
                code: "API_ERROR".to_string(),
                message: format!("API error {}: {}", status, text),
            });
        }

        let openai_response: OpenAiResponse = response.json().await.map_err(|e| LlmError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse response: {}", e),
        })?;

        let content = openai_response
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| LlmError {
                code: "EMPTY_RESPONSE".to_string(),
                message: "No response from LLM".to_string(),
            })?;

        // Parse the JSON response
        let proposal = super::parse_json_response::<AgentProposal>(&content, "proposal")?;

        Ok(proposal)
    }

    async fn conversation_turn(
        &self,
        params: &ConversationTurnParams,
    ) -> Result<ConversationTurnResult, LlmError> {
        let client = Client::new();
        let system_prompt = format!(
            "{}\n\n{}",
            super::build_conversation_system_prompt(params.app_context.as_deref()),
            CONVERSATION_INTAKE_PROMPT_RULES
        );
        let user_prompt = super::build_conversation_user_prompt(&params.messages);

        let request_body = OpenAiRequest {
            model: params.model.clone(),
            messages: vec![
                OpenAiMessage {
                    role: "system".to_string(),
                    content: vec![OpenAiContent::Text {
                        text: system_prompt,
                    }],
                },
                OpenAiMessage {
                    role: "user".to_string(),
                    content: vec![OpenAiContent::Text { text: user_prompt }],
                },
            ],
            max_tokens: Some(600),
        };

        let response = client
            .post(super::build_openai_chat_completions_url(&params.base_url))
            .header("Authorization", format!("Bearer {}", params.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| LlmError {
                code: "REQUEST_FAILED".to_string(),
                message: format!("Failed to send request: {}", e),
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(LlmError {
                code: "API_ERROR".to_string(),
                message: format!("API error {}: {}", status, text),
            });
        }

        let openai_response: OpenAiResponse = response.json().await.map_err(|e| LlmError {
            code: "PARSE_ERROR".to_string(),
            message: format!("Failed to parse response: {}", e),
        })?;

        let content = openai_response
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| LlmError {
                code: "EMPTY_RESPONSE".to_string(),
                message: "No response from LLM".to_string(),
            })?;

        super::parse_json_response::<ConversationTurnResult>(&content, "conversation turn")
    }
}

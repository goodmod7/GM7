//! Vision engine for screen observation

use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// A UI element observed on screen
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiElement {
    pub label: Option<String>,
    pub element_type: UiElementType,
    pub bounds: Option<Bounds>,
    pub interactable: bool,
    pub confidence: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UiElementType {
    Button,
    Input,
    Menu,
    Dialog,
    Canvas,
    Text,
    Icon,
    Window,
    Other,
}

/// Bounding box in normalized coordinates (0-1)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Screen observation result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenObservation {
    pub screen_summary: String,
    pub ui_elements: Vec<UiElement>,
    pub notable_warnings: Vec<String>,
    pub inferred_app: Option<String>,
}

impl ScreenObservation {
    /// Create an empty observation
    pub fn empty() -> Self {
        Self {
            screen_summary: "No observation available".to_string(),
            ui_elements: vec![],
            notable_warnings: vec![],
            inferred_app: None,
        }
    }

    /// Find element by label (fuzzy match)
    pub fn find_element(&self, label: &str) -> Option<&UiElement> {
        let label_lower = label.to_lowercase();
        self.ui_elements.iter().find(|e| {
            e.label
                .as_ref()
                .map(|l| l.to_lowercase().contains(&label_lower))
                .unwrap_or(false)
        })
    }

    /// Find all buttons
    pub fn find_buttons(&self) -> Vec<&UiElement> {
        self.ui_elements
            .iter()
            .filter(|e| matches!(e.element_type, UiElementType::Button) && e.interactable)
            .collect()
    }

    /// Find all inputs
    pub fn find_inputs(&self) -> Vec<&UiElement> {
        self.ui_elements
            .iter()
            .filter(|e| matches!(e.element_type, UiElementType::Input) && e.interactable)
            .collect()
    }
}

/// Vision engine for analyzing screens
pub struct VisionEngine {
    provider_router: Arc<super::providers::ProviderRouter>,
}

impl VisionEngine {
    pub fn new(provider_router: Arc<super::providers::ProviderRouter>) -> Self {
        Self { provider_router }
    }

    /// Observe the current screen
    pub async fn observe(&self) -> Result<ScreenObservation, VisionError> {
        // 1. Capture screenshot
        let screenshot = self.capture_screenshot().await?;

        // 2. Get provider
        let provider = self
            .provider_router
            .get_default_provider()
            .await
            .ok_or(VisionError::NoProviderAvailable)?;

        // 3. Analyze with LLM
        let request = super::providers::ScreenAnalysisRequest {
            screenshot_base64: screenshot,
            goal: "Observe current screen state".to_string(),
            previous_actions: vec![],
        };

        let response = provider
            .analyze_screen(request)
            .await
            .map_err(|e| VisionError::AnalysisError(e.message))?;

        // 4. Parse response
        let observation: ScreenObservation =
            serde_json::from_str(&response).map_err(|e| VisionError::ParseError(e.to_string()))?;

        Ok(observation)
    }

    /// Observe with specific goal context
    pub async fn observe_for_goal(
        &self,
        goal: &str,
        previous_actions: Vec<String>,
    ) -> Result<ScreenObservation, VisionError> {
        let screenshot = self.capture_screenshot().await?;

        let provider = self
            .provider_router
            .get_default_provider()
            .await
            .ok_or(VisionError::NoProviderAvailable)?;

        let request = super::providers::ScreenAnalysisRequest {
            screenshot_base64: screenshot,
            goal: goal.to_string(),
            previous_actions,
        };

        let response = provider
            .analyze_screen(request)
            .await
            .map_err(|e| VisionError::AnalysisError(e.message))?;

        let observation: ScreenObservation =
            serde_json::from_str(&response).map_err(|e| VisionError::ParseError(e.to_string()))?;

        Ok(observation)
    }

    /// Capture a screenshot
    async fn capture_screenshot(&self) -> Result<String, VisionError> {
        // Use the existing Tauri command
        let result = crate::capture_display_png("display-0".to_string(), Some(1280))
            .map_err(|e| VisionError::CaptureError(e.message))?;

        Ok(result.png_base64)
    }
}

/// Error during vision processing
#[derive(Debug, thiserror::Error)]
pub enum VisionError {
    #[error("No provider available")]
    NoProviderAvailable,
    #[error("Screenshot capture failed: {0}")]
    CaptureError(String),
    #[error("Analysis failed: {0}")]
    AnalysisError(String),
    #[error("Parse error: {0}")]
    ParseError(String),
}

/// Optional OmniParser adapter
pub mod omniparser {
    use super::*;

    /// OmniParser client for enhanced UI element detection
    pub struct OmniParserClient {
        endpoint: String,
        client: reqwest::Client,
    }

    impl OmniParserClient {
        pub fn new(endpoint: Option<String>) -> Self {
            Self {
                endpoint: endpoint.unwrap_or_else(|| "http://127.0.0.1:7861".to_string()),
                client: reqwest::Client::new(),
            }
        }

        pub async fn is_available(&self) -> bool {
            let url = format!("{}/health", self.endpoint);
            match self.client.get(&url).send().await {
                Ok(resp) => resp.status().is_success(),
                Err(_) => false,
            }
        }

        /// Parse screenshot with OmniParser
        pub async fn parse(&self, screenshot_base64: &str) -> Result<Vec<UiElement>, String> {
            let url = format!("{}/parse", self.endpoint);

            let request_body = serde_json::json!({
                "image": screenshot_base64,
                "box_threshold": 0.05,
                "iou_threshold": 0.1,
            });

            let response = self
                .client
                .post(&url)
                .json(&request_body)
                .send()
                .await
                .map_err(|e| format!("Failed to call OmniParser: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("OmniParser returned error: {}", response.status()));
            }

            let result: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            // Convert OmniParser output to UiElement format
            let elements = result["parsed_content_list"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let bbox = item["bbox"].as_array()?;
                            if bbox.len() < 4 {
                                return None;
                            }

                            let x1 = bbox[0].as_f64()?;
                            let y1 = bbox[1].as_f64()?;
                            let x2 = bbox[2].as_f64()?;
                            let y2 = bbox[3].as_f64()?;

                            let element_type = match item["type"].as_str()? {
                                "button" => UiElementType::Button,
                                "input" | "text_field" => UiElementType::Input,
                                "menu" => UiElementType::Menu,
                                "dialog" => UiElementType::Dialog,
                                "icon" => UiElementType::Icon,
                                _ => UiElementType::Other,
                            };

                            Some(UiElement {
                                label: item["text"]
                                    .as_str()
                                    .map(|s| s.to_string())
                                    .or_else(|| item["content"].as_str().map(|s| s.to_string())),
                                element_type,
                                bounds: Some(Bounds {
                                    x: x1,
                                    y: y1,
                                    width: x2 - x1,
                                    height: y2 - y1,
                                }),
                                interactable: true,
                                confidence: item["confidence"].as_f64().unwrap_or(0.5),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok(elements)
        }
    }
}

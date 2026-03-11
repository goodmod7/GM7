//! Multi-provider LLM support for the advanced agent

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

pub mod native_ollama;
pub mod openai;
pub mod claude;
pub mod local_compat;

pub use native_ollama::NativeOllamaProvider;
pub use openai::OpenAiProvider;
pub use claude::ClaudeProvider;
pub use local_compat::LocalCompatProvider;

/// Provider types supported by the agent
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    /// Native Qwen model via Ollama (free, local)
    NativeQwenOllama,
    /// Local OpenAI-compatible server (e.g., llama.cpp)
    LocalOpenAiCompat,
    /// OpenAI API (paid)
    OpenAi,
    /// Anthropic Claude API (paid)
    Claude,
}

impl ProviderType {
    pub fn name(&self) -> &'static str {
        match self {
            ProviderType::NativeQwenOllama => "GORKH Native",
            ProviderType::LocalOpenAiCompat => "Local (OpenAI-compatible)",
            ProviderType::OpenAi => "OpenAI",
            ProviderType::Claude => "Claude",
        }
    }

    pub fn is_free(&self) -> bool {
        matches!(self, ProviderType::NativeQwenOllama | ProviderType::LocalOpenAiCompat)
    }

    pub fn is_cloud(&self) -> bool {
        !self.is_free()
    }
}

/// Capabilities of an LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    /// Supports vision (screenshot analysis)
    pub supports_vision: bool,
    /// Supports streaming responses
    pub supports_streaming: bool,
    /// Supports function calling
    pub supports_functions: bool,
    /// Maximum context tokens
    pub max_context_tokens: usize,
    /// Maximum output tokens
    pub max_output_tokens: usize,
}

/// Request for planning a task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanRequest {
    pub goal: String,
    pub context: Option<String>,
}

/// Request for analyzing a screen
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenAnalysisRequest {
    pub screenshot_base64: String,
    pub goal: String,
    pub previous_actions: Vec<String>,
}

/// Request for proposing next action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    pub observation: String,
    pub goal: String,
    pub step_description: String,
}

/// Response from LLM with cost info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub model: String,
    pub finish_reason: String,
}

/// Cost estimate for a request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub estimated_input_tokens: usize,
    pub estimated_output_tokens: usize,
    pub estimated_cost_usd: f64,
    pub currency: String,
}

/// Trait for LLM providers
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Get provider type
    fn provider_type(&self) -> ProviderType;

    /// Get provider name
    fn name(&self) -> &str;

    /// Check if provider is available (server running, key valid, etc.)
    async fn is_available(&self) -> bool;

    /// Get capabilities
    fn capabilities(&self) -> ProviderCapabilities;

    /// Plan a task
    async fn plan_task(&self, request: PlanRequest) -> Result<String, ProviderError>;

    /// Analyze a screen
    async fn analyze_screen(&self, request: ScreenAnalysisRequest) -> Result<String, ProviderError>;

    /// Propose next action
    async fn propose_next_step(&self, request: ActionRequest) -> Result<String, ProviderError>;

    /// Summarize result
    async fn summarize_result(&self, result_text: &str) -> Result<String, ProviderError>;

    /// Estimate cost for a request
    fn estimate_cost(&self, input_tokens: usize, output_tokens: usize) -> f64;
}

/// Error from provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderError {
    pub code: String,
    pub message: String,
    pub is_retryable: bool,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ProviderError {}

/// Provider router - manages multiple providers and routing logic
pub struct ProviderRouter {
    providers: RwLock<HashMap<ProviderType, Box<dyn LlmProvider>>>,
    default_provider: RwLock<ProviderType>,
    fallback_order: RwLock<Vec<ProviderType>>,
    user_preferences: RwLock<UserPreferences>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    pub default_provider: ProviderType,
    pub fallback_enabled: bool,
    pub ask_before_paid: bool,
    pub cost_limit_per_task: f64,
    pub provider_configs: HashMap<ProviderType, ProviderConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            default_provider: ProviderType::NativeQwenOllama,
            fallback_enabled: true,
            ask_before_paid: true,
            cost_limit_per_task: 1.0,
            provider_configs: HashMap::new(),
        }
    }
}

impl ProviderRouter {
    pub fn new() -> Self {
        Self {
            providers: RwLock::new(HashMap::new()),
            default_provider: RwLock::new(ProviderType::NativeQwenOllama),
            fallback_order: RwLock::new(vec![
                ProviderType::NativeQwenOllama,
                ProviderType::LocalOpenAiCompat,
                ProviderType::Claude,
                ProviderType::OpenAi,
            ]),
            user_preferences: RwLock::new(UserPreferences::default()),
        }
    }

    /// Register a provider
    pub async fn register_provider(&self, provider: Box<dyn LlmProvider>) {
        let mut providers = self.providers.write().await;
        providers.insert(provider.provider_type(), provider);
    }

    /// Get a specific provider
    pub async fn get_provider(&self, provider_type: ProviderType) -> Option<Box<dyn LlmProvider>> {
        let providers = self.providers.read().await;
        // In a real implementation, we'd need to handle this differently
        // since we can't clone Box<dyn Trait> easily
        None
    }

    /// Get the default provider
    pub async fn get_default_provider(&self) -> Option<Box<dyn LlmProvider>> {
        let default = self.default_provider.read().await;
        self.get_provider(*default).await
    }

    /// Get provider info (without consuming)
    pub async fn get_provider_info(&self, provider_type: ProviderType) -> Option<ProviderInfo> {
        let providers = self.providers.read().await;
        providers.get(&provider_type).map(|p| ProviderInfo {
            provider_type,
            name: p.name().to_string(),
            available: false, // Would need async call
            is_free: provider_type.is_free(),
            capabilities: p.capabilities(),
        })
    }

    /// List all registered providers
    pub async fn list_providers(&self) -> Vec<ProviderInfo> {
        let providers = self.providers.read().await;
        let mut infos = Vec::new();
        for (ptype, provider) in providers.iter() {
            infos.push(ProviderInfo {
                provider_type: *ptype,
                name: provider.name().to_string(),
                available: false, // Async in real impl
                is_free: ptype.is_free(),
                capabilities: provider.capabilities(),
            });
        }
        infos
    }

    /// Set default provider
    pub async fn set_default_provider(&self, provider_type: ProviderType) {
        let mut default = self.default_provider.write().await;
        *default = provider_type;
    }

    /// Route to best available provider
    pub async fn route(
        &self,
        preferred: Option<ProviderType>,
    ) -> Result<Box<dyn LlmProvider>, ProviderError> {
        let prefs = self.user_preferences.read().await;
        let providers = self.providers.read().await;

        // Try preferred or default
        let to_try = preferred.unwrap_or(prefs.default_provider);
        
        if let Some(provider) = providers.get(&to_try) {
            if provider.is_available().await {
                return Err(ProviderError {
                    code: "NOT_IMPLEMENTED".to_string(),
                    message: "Provider cloning not implemented in stub".to_string(),
                    is_retryable: false,
                });
            }
        }

        // Try fallback chain if enabled
        if prefs.fallback_enabled {
            let fallback_order = self.fallback_order.read().await;
            for ptype in fallback_order.iter() {
                if let Some(provider) = providers.get(ptype) {
                    if provider.is_available().await {
                        // Check if we need to ask before using paid provider
                        if ptype.is_cloud() && prefs.ask_before_paid {
                            // This should trigger UI confirmation
                            // For now, skip
                            continue;
                        }
                        return Err(ProviderError {
                            code: "NOT_IMPLEMENTED".to_string(),
                            message: "Provider cloning not implemented in stub".to_string(),
                            is_retryable: false,
                        });
                    }
                }
            }
        }

        Err(ProviderError {
            code: "NO_PROVIDER_AVAILABLE".to_string(),
            message: "No LLM provider is available".to_string(),
            is_retryable: false,
        })
    }

    /// Estimate cost for a request with the given provider
    pub async fn estimate_cost(
        &self,
        provider_type: ProviderType,
        input_tokens: usize,
        output_tokens: usize,
    ) -> Option<f64> {
        let providers = self.providers.read().await;
        providers
            .get(&provider_type)
            .map(|p| p.estimate_cost(input_tokens, output_tokens))
    }

    /// Update user preferences
    pub async fn update_preferences(&self, prefs: UserPreferences) {
        let mut guard = self.user_preferences.write().await;
        *guard = prefs;
    }

    /// Get user preferences
    pub async fn get_preferences(&self) -> UserPreferences {
        self.user_preferences.read().await.clone()
    }
}

/// Information about a provider for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub provider_type: ProviderType,
    pub name: String,
    pub available: bool,
    pub is_free: bool,
    pub capabilities: ProviderCapabilities,
}

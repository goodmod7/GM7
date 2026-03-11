//! Training data recorder for collecting demonstrations
//!
//! Records task demonstrations for later fine-tuning.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// A recorded demonstration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Demonstration {
    pub id: String,
    pub goal: String,
    pub description: String,
    pub recorded_at: u64,
    pub steps: Vec<DemonstrationStep>,
    pub metadata: DemonstrationMetadata,
}

/// A single step in a demonstration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemonstrationStep {
    pub timestamp_ms: u64,
    pub step_number: usize,
    pub action_type: String,
    pub action_summary: String, // Redacted/safe summary for logs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_ref: Option<String>, // Reference to stored image, not base64
}

/// Metadata about a demonstration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemonstrationMetadata {
    pub platform: String,
    pub app_version: String,
    pub screen_resolution: String,
    pub total_steps: usize,
    pub has_screenshots: bool,
}

/// Recorder for collecting demonstrations
pub struct DemonstrationRecorder {
    data_dir: PathBuf,
    current: Mutex<Option<Demonstration>>,
}

impl DemonstrationRecorder {
    pub fn new(data_dir: Option<PathBuf>) -> Self {
        let data_dir = data_dir.unwrap_or_else(|| {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".ai-operator").join("demonstrations")
        });

        // Ensure directory exists
        let _ = fs::create_dir_all(&data_dir);

        Self {
            data_dir,
            current: Mutex::new(None),
        }
    }

    /// Start recording a new demonstration
    pub fn start(&self, goal: &str, description: &str) -> Result<String, RecorderError> {
        let mut current = self.current.lock().map_err(|_| RecorderError::LockError)?;

        if current.is_some() {
            return Err(RecorderError::AlreadyRecording);
        }

        let id = format!(
            "demo_{}_{}",
            sanitize_filename(goal),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );

        let demo = Demonstration {
            id: id.clone(),
            goal: goal.to_string(),
            description: description.to_string(),
            recorded_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            steps: vec![],
            metadata: DemonstrationMetadata {
                platform: std::env::consts::OS.to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                screen_resolution: get_screen_resolution(),
                total_steps: 0,
                has_screenshots: false,
            },
        };

        *current = Some(demo);
        Ok(id)
    }

    /// Record a step
    pub fn record_step(
        &self,
        action_type: &str,
        action_summary: &str,
    ) -> Result<(), RecorderError> {
        let mut current = self.current.lock().map_err(|_| RecorderError::LockError)?;

        let demo = current.as_mut().ok_or(RecorderError::NotRecording)?;

        let step = DemonstrationStep {
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            step_number: demo.steps.len() + 1,
            action_type: action_type.to_string(),
            action_summary: action_summary.to_string(),
            screenshot_ref: None, // Screenshots stored separately
        };

        demo.steps.push(step);
        demo.metadata.total_steps = demo.steps.len();

        Ok(())
    }

    /// Stop recording and save
    pub fn stop(&self) -> Result<Demonstration, RecorderError> {
        let mut current = self.current.lock().map_err(|_| RecorderError::LockError)?;

        let demo = current.take().ok_or(RecorderError::NotRecording)?;

        // Save to file
        let filename = format!("{}.json", demo.id);
        let filepath = self.data_dir.join(&filename);

        let json = serde_json::to_string_pretty(&demo)
            .map_err(|e| RecorderError::SerializeError(e.to_string()))?;

        fs::write(&filepath, json).map_err(|e| RecorderError::IoError(e.to_string()))?;

        Ok(demo)
    }

    /// Cancel current recording without saving
    pub fn cancel(&self) -> Result<(), RecorderError> {
        let mut current = self.current.lock().map_err(|_| RecorderError::LockError)?;
        *current = None;
        Ok(())
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.current.lock().map(|c| c.is_some()).unwrap_or(false)
    }

    /// List recorded demonstrations
    pub fn list_demonstrations(&self) -> Result<Vec<DemonstrationSummary>, RecorderError> {
        let mut demos = vec![];

        let entries =
            fs::read_dir(&self.data_dir).map_err(|e| RecorderError::IoError(e.to_string()))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(demo) = serde_json::from_str::<Demonstration>(&content) {
                        demos.push(DemonstrationSummary {
                            id: demo.id,
                            goal: demo.goal,
                            description: demo.description,
                            recorded_at: demo.recorded_at,
                            total_steps: demo.metadata.total_steps,
                        });
                    }
                }
            }
        }

        // Sort by date descending
        demos.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));
        Ok(demos)
    }

    /// Get data directory path
    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }
}

/// Summary of a demonstration (for UI list)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemonstrationSummary {
    pub id: String,
    pub goal: String,
    pub description: String,
    pub recorded_at: u64,
    pub total_steps: usize,
}

/// Recorder error
#[derive(Debug, thiserror::Error)]
pub enum RecorderError {
    #[error("Lock error")]
    LockError,
    #[error("Already recording")]
    AlreadyRecording,
    #[error("Not recording")]
    NotRecording,
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Serialize error: {0}")]
    SerializeError(String),
}

fn sanitize_filename(input: &str) -> String {
    input
        .to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && c != ' ', "_")
        .replace(' ', "_")
        .trim_matches('_')
        .to_string()
}

fn get_screen_resolution() -> String {
    // Default fallback
    "unknown".to_string()
}

// Add dirs dependency for home directory
// This should be added to Cargo.toml: dirs = "5"

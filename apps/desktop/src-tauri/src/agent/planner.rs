//! Hierarchical task planner
//!
//! Creates multi-step plans and manages their execution.

use serde::{Deserialize, Serialize};

/// A task plan consisting of multiple steps
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPlan {
    pub goal: String,
    pub steps: Vec<PlanStep>,
    pub estimated_duration_secs: u64,
    pub required_apps: Vec<String>,
}

/// A single step in a task plan
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub title: String,
    pub description: String,
    pub step_type: StepType,
    pub status: StepStatus,
    pub retry_count: u32,
    pub max_retries: u32,
    pub is_critical: bool,
}

/// Type of step
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    /// UI automation action (click, type, etc.)
    UiAction,
    /// Tool call (file system, terminal)
    ToolCall,
    /// Ask user for input/clarification
    AskUser,
    /// Verify previous step succeeded
    Verification,
}

/// Status of a step
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    /// Not started yet
    Pending,
    /// Currently executing
    Running,
    /// Completed successfully
    Completed,
    /// Failed but can retry
    FailedRetryable,
    /// Failed permanently
    Failed,
    /// Blocked waiting for user
    AwaitingUser,
}

impl PlanStep {
    pub fn new(id: &str, title: &str, description: &str, step_type: StepType) -> Self {
        Self {
            id: id.to_string(),
            title: title.to_string(),
            description: description.to_string(),
            step_type,
            status: StepStatus::Pending,
            retry_count: 0,
            max_retries: 3,
            is_critical: false,
        }
    }

    pub fn with_critical(mut self, critical: bool) -> Self {
        self.is_critical = critical;
        self
    }

    pub fn with_max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }
}

/// Hierarchical planner that creates task plans using an LLM
pub struct HierarchicalPlanner<'a> {
    provider: &'a dyn super::providers::LlmProvider,
}

impl<'a> HierarchicalPlanner<'a> {
    pub fn new(provider: &'a dyn super::providers::LlmProvider) -> Self {
        Self { provider }
    }

    /// Create a plan for the given goal
    pub async fn create_plan(&self, goal: &str) -> Result<TaskPlan, String> {
        let request = super::providers::PlanRequest {
            goal: goal.to_string(),
            context: None,
        };

        let response = self.provider.plan_task(request).await.map_err(|e| e.message)?;

        // Parse the JSON response into a TaskPlan
        let steps = parse_plan_steps(&response)
            .map_err(|e| format!("Failed to parse plan: {}", e))?;

        // Ensure all steps have unique IDs
        let mut steps = steps;
        for (idx, step) in steps.iter_mut().enumerate() {
            if step.id.is_empty() {
                step.id = format!("step_{}", idx + 1);
            }
        }

        let estimated_duration_secs = estimate_duration(&steps);
        let required_apps = detect_required_apps(goal, &steps);

        Ok(TaskPlan {
            goal: goal.to_string(),
            steps,
            estimated_duration_secs,
            required_apps,
        })
    }

    /// Revise a plan when something goes wrong
    pub async fn revise_plan(
        &self,
        current_plan: &TaskPlan,
        failed_step_id: &str,
        failure_reason: &str,
    ) -> Result<TaskPlan, String> {
        let context = format!(
            "Previous plan failed at step '{}'. Reason: {}. Original goal: {}",
            failed_step_id, failure_reason, current_plan.goal
        );

        let request = super::providers::PlanRequest {
            goal: current_plan.goal.clone(),
            context: Some(context),
        };

        let response = self.provider.plan_task(request).await.map_err(|e| e.message)?;

        let steps = parse_plan_steps(&response)
            .map_err(|e| format!("Failed to parse revised plan: {}", e))?;

        let mut steps = steps;
        for (idx, step) in steps.iter_mut().enumerate() {
            if step.id.is_empty() {
                step.id = format!("step_{}", idx + 1);
            }
        }

        let estimated_duration_secs = estimate_duration(&steps);
        let required_apps = detect_required_apps(&current_plan.goal, &steps);

        Ok(TaskPlan {
            goal: current_plan.goal.clone(),
            steps,
            estimated_duration_secs,
            required_apps,
        })
    }
}

#[derive(Debug, Deserialize)]
struct RawPlanStep {
    #[serde(default)]
    id: String,
    title: String,
    description: String,
    #[serde(rename = "type", alias = "stepType", alias = "step_type")]
    step_type: RawStepType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RawStepType {
    UiAction,
    #[serde(alias = "tool")]
    ToolCall,
    AskUser,
    Verification,
}

fn parse_plan_steps(input: &str) -> Result<Vec<PlanStep>, String> {
    let raw_steps: Vec<RawPlanStep> = serde_json::from_str(input)
        .map_err(|e| e.to_string())?;

    Ok(raw_steps
        .into_iter()
        .map(|step| PlanStep {
            id: step.id,
            title: step.title,
            description: step.description,
            step_type: match step.step_type {
                RawStepType::UiAction => StepType::UiAction,
                RawStepType::ToolCall => StepType::ToolCall,
                RawStepType::AskUser => StepType::AskUser,
                RawStepType::Verification => StepType::Verification,
            },
            status: StepStatus::Pending,
            retry_count: 0,
            max_retries: 3,
            is_critical: false,
        })
        .collect())
}

/// Estimate duration based on step count and types
fn estimate_duration(steps: &[PlanStep]) -> u64 {
    let base_time_per_step = 5u64; // seconds
    let total_steps = steps.len() as u64;
    
    // Add extra time for UI actions (they take longer)
    let ui_action_count = steps.iter()
        .filter(|s| matches!(s.step_type, StepType::UiAction))
        .count() as u64;
    
    (total_steps * base_time_per_step) + (ui_action_count * 3)
}

/// Detect required applications from goal and steps
fn detect_required_apps(goal: &str, _steps: &[PlanStep]) -> Vec<String> {
    let goal_lower = goal.to_lowercase();
    let mut apps = Vec::new();
    
    // Common app keywords
    let app_keywords = [
        ("photoshop", "Adobe Photoshop"),
        ("blender", "Blender"),
        ("gimp", "GIMP"),
        ("chrome", "Google Chrome"),
        ("safari", "Safari"),
        ("firefox", "Firefox"),
        ("excel", "Microsoft Excel"),
        ("word", "Microsoft Word"),
        ("powerpoint", "Microsoft PowerPoint"),
        ("terminal", "Terminal"),
        ("finder", "Finder"),
        ("vscode", "Visual Studio Code"),
        ("slack", "Slack"),
        ("discord", "Discord"),
        ("spotify", "Spotify"),
    ];
    
    for (keyword, app_name) in app_keywords {
        if goal_lower.contains(keyword) {
            apps.push(app_name.to_string());
        }
    }
    
    apps.dedup();
    apps
}

/// Create a simple plan manually (for testing or fallback)
pub fn create_simple_plan(goal: &str) -> TaskPlan {
    TaskPlan {
        goal: goal.to_string(),
        steps: vec![
            PlanStep::new("1", "Analyze task", "Understand what needs to be done", StepType::AskUser)
                .with_critical(true),
        ],
        estimated_duration_secs: 10,
        required_apps: vec![],
    }
}

use std::{
    env, fs, io,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use flate2::read::GzDecoder;
use reqwest::{blocking::Client as BlockingClient, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tar::Archive;
use zip::ZipArchive;

#[path = "local_ai_manifest.rs"]
mod local_ai_manifest;

const LOCAL_AI_SERVICE_URL: &str = "http://127.0.0.1:11434";
const LOCAL_AI_HOST: &str = "127.0.0.1:11434";
const LOCAL_AI_METADATA_FILE: &str = "managed-install.json";
const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiTier {
    Light,
    Standard,
    Vision,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiInstallStage {
    NotStarted,
    Planned,
    Installing,
    Installed,
    Starting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiGpuClass {
    Unknown,
    Integrated,
    Discrete,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiRuntimeSource {
    #[serde(alias = "managed_or_adopted_ollama")]
    Managed,
    ExistingInstall,
    #[serde(alias = "existing_local_service")]
    ExistingService,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeStatus {
    pub managed_by_app: bool,
    pub managed_runtime_dir: String,
    pub runtime_binary_path: Option<String>,
    pub runtime_present: bool,
    pub runtime_running: bool,
    pub external_service_detected: bool,
    pub service_url: String,
    pub install_stage: LocalAiInstallStage,
    pub selected_tier: Option<LocalAiTier>,
    pub selected_model: Option<String>,
    pub installed_models: Vec<String>,
    pub runtime_source: Option<LocalAiRuntimeSource>,
    pub runtime_version: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallProgress {
    pub stage: LocalAiInstallStage,
    pub selected_tier: Option<LocalAiTier>,
    pub selected_model: Option<String>,
    pub progress_percent: Option<u8>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub message: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiHardwareProfile {
    pub os: String,
    pub architecture: String,
    pub logical_cpu_cores: u32,
    pub cpu_model: Option<String>,
    pub ram_bytes: Option<u64>,
    pub gpu_summary: Option<String>,
    pub gpu_class: LocalAiGpuClass,
    pub available_disk_bytes: Option<u64>,
    pub managed_runtime_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiTierRecommendation {
    pub tier: LocalAiTier,
    pub reason: String,
    pub vision_available: bool,
    pub standard_available: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallRequest {
    pub preferred_tier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAiInstallMetadata {
    runtime_version: String,
    runtime_source: LocalAiRuntimeSource,
    selected_tier: LocalAiTier,
    selected_model: String,
    installed_models: Vec<String>,
    optional_vision_model: Option<String>,
    updated_at_ms: u64,
}

#[derive(Debug, Clone)]
struct ResolvedRuntimeBinary {
    path: PathBuf,
    source: LocalAiRuntimeSource,
}

#[derive(Debug, Clone, Copy)]
struct LocalAiTierRuntimePlan {
    default_model: &'static str,
    optional_vision_model: &'static str,
}

#[derive(Clone)]
pub struct LocalAiRuntimeState {
    install_progress: Arc<Mutex<LocalAiInstallProgress>>,
    last_error: Arc<Mutex<Option<String>>>,
    managed_child: Arc<Mutex<Option<Child>>>,
    install_worker_active: Arc<Mutex<bool>>,
}

impl Default for LocalAiRuntimeState {
    fn default() -> Self {
        Self {
            install_progress: Arc::new(Mutex::new(default_install_progress())),
            last_error: Arc::new(Mutex::new(None)),
            managed_child: Arc::new(Mutex::new(None)),
            install_worker_active: Arc::new(Mutex::new(false)),
        }
    }
}

pub async fn runtime_status(state: &LocalAiRuntimeState) -> Result<LocalAiRuntimeStatus, String> {
    let managed_runtime_dir = managed_runtime_dir();
    let runtime_binary_path = expected_runtime_binary_path(&managed_runtime_dir);
    let runtime_present = runtime_binary_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let running = is_service_running(LOCAL_AI_SERVICE_URL).await;
    let managed_child_running = managed_child_running(state);
    let external_service_detected = running && !managed_child_running;
    let progress = install_progress(state);
    let metadata = read_metadata(&managed_runtime_dir);
    let last_error = state.last_error.lock().unwrap().clone();

    Ok(LocalAiRuntimeStatus {
        managed_by_app: runtime_present || managed_child_running || metadata.is_some(),
        managed_runtime_dir: managed_runtime_dir.display().to_string(),
        runtime_binary_path: runtime_binary_path.map(|path| path.display().to_string()),
        runtime_present,
        runtime_running: running,
        external_service_detected,
        service_url: LOCAL_AI_SERVICE_URL.to_string(),
        install_stage: derive_install_stage(
            progress.stage,
            runtime_present,
            running,
            metadata.as_ref(),
        ),
        selected_tier: progress
            .selected_tier
            .or_else(|| metadata.as_ref().map(|value| value.selected_tier)),
        selected_model: progress
            .selected_model
            .clone()
            .or_else(|| metadata.as_ref().map(|value| value.selected_model.clone())),
        installed_models: metadata
            .as_ref()
            .map(|value| value.installed_models.clone())
            .unwrap_or_default(),
        runtime_source: metadata.as_ref().map(|value| value.runtime_source),
        runtime_version: metadata.as_ref().map(|value| value.runtime_version.clone()),
        last_error,
    })
}

pub fn install_progress(state: &LocalAiRuntimeState) -> LocalAiInstallProgress {
    state.install_progress.lock().unwrap().clone()
}

pub async fn install_start(
    state: &LocalAiRuntimeState,
    request: Option<LocalAiInstallRequest>,
) -> Result<LocalAiInstallProgress, String> {
    let managed_dir = managed_runtime_dir();
    ensure_managed_dirs(&managed_dir)?;

    if *state.install_worker_active.lock().unwrap() {
        return Ok(install_progress(state));
    }

    let hardware = hardware_profile()?;
    let recommended = recommend_tier(&hardware);
    let selected_tier = request
        .and_then(|value| value.preferred_tier)
        .and_then(|value| parse_tier(&value))
        .unwrap_or(recommended.tier);
    let plan = tier_runtime_plan(selected_tier);
    let existing_metadata = read_metadata(&managed_dir);

    if let Some(metadata) = existing_metadata.as_ref() {
        if metadata.selected_tier == selected_tier
            && metadata
                .installed_models
                .iter()
                .any(|model| model == plan.default_model)
            && (expected_runtime_binary_path(&managed_dir)
                .as_ref()
                .is_some_and(|path| path.exists())
                || is_service_port_open())
        {
            let ready_progress = LocalAiInstallProgress {
                stage: if is_service_port_open() {
                    LocalAiInstallStage::Ready
                } else {
                    LocalAiInstallStage::Installed
                },
                selected_tier: Some(selected_tier),
                selected_model: Some(plan.default_model.to_string()),
                progress_percent: Some(if is_service_port_open() { 100 } else { 85 }),
                downloaded_bytes: None,
                total_bytes: None,
                message: Some(if is_service_port_open() {
                    format!("Free AI is ready with {}.", plan.default_model)
                } else {
                    format!("Free AI files are installed for {}. Start the local runtime to finish setup.", plan.default_model)
                }),
                updated_at_ms: unix_time_ms(),
            };
            set_install_progress(state, ready_progress.clone());
            clear_last_error(state);
            return Ok(ready_progress);
        }
    }

    let planned = LocalAiInstallProgress {
        stage: LocalAiInstallStage::Planned,
        selected_tier: Some(selected_tier),
        selected_model: Some(plan.default_model.to_string()),
        progress_percent: Some(0),
        downloaded_bytes: None,
        total_bytes: None,
        message: Some(format!(
            "Preparing managed Free AI install for {}.",
            plan.default_model
        )),
        updated_at_ms: unix_time_ms(),
    };
    set_install_progress(state, planned.clone());
    clear_last_error(state);
    *state.install_worker_active.lock().unwrap() = true;

    let worker_state = state.clone();
    thread::spawn(move || {
        let result = run_install_worker(worker_state.clone(), managed_dir, selected_tier);
        if let Err(error) = result {
            set_last_error(&worker_state, error.clone());
            set_install_progress(
                &worker_state,
                LocalAiInstallProgress {
                    stage: LocalAiInstallStage::Error,
                    selected_tier: Some(selected_tier),
                    selected_model: Some(
                        tier_runtime_plan(selected_tier).default_model.to_string(),
                    ),
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    message: Some(error),
                    updated_at_ms: unix_time_ms(),
                },
            );
        }
        *worker_state.install_worker_active.lock().unwrap() = false;
    });

    Ok(planned)
}

pub async fn enable_vision_boost(
    state: &LocalAiRuntimeState,
) -> Result<LocalAiInstallProgress, String> {
    let managed_dir = managed_runtime_dir();
    ensure_managed_dirs(&managed_dir)?;

    if *state.install_worker_active.lock().unwrap() {
        return Ok(install_progress(state));
    }

    let metadata = read_metadata(&managed_dir)
        .ok_or_else(|| "Set up Free AI first before enabling Vision Boost.".to_string())?;
    let plan = tier_runtime_plan(metadata.selected_tier);
    let vision_model = plan.optional_vision_model;

    if metadata
        .installed_models
        .iter()
        .any(|model| model == vision_model)
    {
        let ready_progress = LocalAiInstallProgress {
            stage: if is_service_port_open() {
                LocalAiInstallStage::Ready
            } else {
                LocalAiInstallStage::Installed
            },
            selected_tier: Some(metadata.selected_tier),
            selected_model: Some(vision_model.to_string()),
            progress_percent: Some(if is_service_port_open() { 100 } else { 85 }),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(format!(
                "Vision Boost is already available with {}.",
                vision_model
            )),
            updated_at_ms: unix_time_ms(),
        };
        set_install_progress(state, ready_progress.clone());
        clear_last_error(state);
        return Ok(ready_progress);
    }

    let planned = LocalAiInstallProgress {
        stage: LocalAiInstallStage::Planned,
        selected_tier: Some(metadata.selected_tier),
        selected_model: Some(vision_model.to_string()),
        progress_percent: Some(0),
        downloaded_bytes: None,
        total_bytes: None,
        message: Some(format!(
            "Preparing optional Vision Boost with {}.",
            vision_model
        )),
        updated_at_ms: unix_time_ms(),
    };
    set_install_progress(state, planned.clone());
    clear_last_error(state);
    *state.install_worker_active.lock().unwrap() = true;

    let worker_state = state.clone();
    thread::spawn(move || {
        let result = run_enable_vision_boost_worker(
            worker_state.clone(),
            managed_dir,
            metadata.selected_tier,
        );
        if let Err(error) = result {
            set_last_error(&worker_state, error.clone());
            set_install_progress(
                &worker_state,
                LocalAiInstallProgress {
                    stage: LocalAiInstallStage::Error,
                    selected_tier: Some(metadata.selected_tier),
                    selected_model: Some(vision_model.to_string()),
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    message: Some(error),
                    updated_at_ms: unix_time_ms(),
                },
            );
        }
        *worker_state.install_worker_active.lock().unwrap() = false;
    });

    Ok(planned)
}

pub async fn start_runtime(state: &LocalAiRuntimeState) -> Result<LocalAiRuntimeStatus, String> {
    let managed_dir = managed_runtime_dir();
    ensure_managed_dirs(&managed_dir)?;

    if is_service_port_open() {
        return runtime_status(state).await;
    }

    let runtime_binary = ensure_runtime_binary(&managed_dir)?;
    let metadata = read_metadata(&managed_dir);
    let selected_tier = metadata
        .as_ref()
        .map(|value| value.selected_tier)
        .unwrap_or(LocalAiTier::Light);
    let plan = tier_runtime_plan(selected_tier);

    set_install_progress(
        state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Starting,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(90),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some("Starting the local AI service...".to_string()),
            updated_at_ms: unix_time_ms(),
        },
    );
    clear_last_error(state);

    let _ = ensure_service_running(state, &managed_dir, &runtime_binary.path)?;

    set_install_progress(
        state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Ready,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(100),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(format!("Free AI is ready with {}.", plan.default_model)),
            updated_at_ms: unix_time_ms(),
        },
    );

    runtime_status(state).await
}

pub async fn stop_runtime(state: &LocalAiRuntimeState) -> Result<LocalAiRuntimeStatus, String> {
    let mut had_managed_child = false;

    {
        let mut guard = state.managed_child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            had_managed_child = true;
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    if had_managed_child {
        let managed_dir = managed_runtime_dir();
        let metadata = read_metadata(&managed_dir);
        set_install_progress(
            state,
            LocalAiInstallProgress {
                stage: if metadata.is_some() {
                    LocalAiInstallStage::Installed
                } else {
                    LocalAiInstallStage::NotStarted
                },
                selected_tier: metadata.as_ref().map(|value| value.selected_tier),
                selected_model: metadata.as_ref().map(|value| value.selected_model.clone()),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: None,
                message: Some("Managed local AI service stopped.".to_string()),
                updated_at_ms: unix_time_ms(),
            },
        );
        clear_last_error(state);
    } else if is_service_port_open() {
        set_last_error(
            state,
            "A local AI service is running, but this app did not start it. Stop it outside the app if needed."
                .to_string(),
        );
    } else {
        clear_last_error(state);
    }

    runtime_status(state).await
}

pub fn hardware_profile() -> Result<LocalAiHardwareProfile, String> {
    let managed_dir = managed_runtime_dir();

    Ok(LocalAiHardwareProfile {
        os: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        logical_cpu_cores: std::thread::available_parallelism()
            .map(|value| value.get() as u32)
            .unwrap_or(1),
        cpu_model: detect_cpu_model(),
        ram_bytes: detect_ram_bytes(),
        gpu_summary: detect_gpu_summary(),
        gpu_class: detect_gpu_class(),
        available_disk_bytes: detect_available_disk_bytes(&managed_dir),
        managed_runtime_dir: managed_dir.display().to_string(),
    })
}

pub fn recommended_tier() -> Result<LocalAiTierRecommendation, String> {
    let hardware = hardware_profile()?;
    Ok(recommend_tier(&hardware))
}

pub fn recommend_tier(profile: &LocalAiHardwareProfile) -> LocalAiTierRecommendation {
    let ram_gib = profile.ram_bytes.unwrap_or(0) / GIB;
    let disk_gib = profile.available_disk_bytes.unwrap_or(0) / GIB;
    let cpu_cores = profile.logical_cpu_cores;
    let discrete_gpu = matches!(profile.gpu_class, LocalAiGpuClass::Discrete);
    let apple_silicon = profile.os == "macos" && profile.architecture == "aarch64";
    let vision_capable =
        (discrete_gpu || apple_silicon) && ram_gib >= 24 && disk_gib >= 35 && cpu_cores >= 8;
    let standard_capable = ram_gib >= 14 && disk_gib >= 18 && cpu_cores >= 8;

    if vision_capable {
        return LocalAiTierRecommendation {
            tier: LocalAiTier::Standard,
            reason: "This machine looks capable of optional Vision Boost, but the app should keep the heavier screenshot model on-demand while Standard stays the default.".to_string(),
            vision_available: true,
            standard_available: true,
        };
    }

    if standard_capable {
        return LocalAiTierRecommendation {
            tier: LocalAiTier::Standard,
            reason: "This machine has enough RAM, disk, and CPU headroom for a stronger default local model without assuming a heavy always-on vision stack.".to_string(),
            vision_available: false,
            standard_available: true,
        };
    }

    LocalAiTierRecommendation {
        tier: LocalAiTier::Light,
        reason: "Recommend a lighter local model so the desktop stays usable while you work in heavier apps.".to_string(),
        vision_available: false,
        standard_available: false,
    }
}

fn run_install_worker(
    state: LocalAiRuntimeState,
    managed_dir: PathBuf,
    selected_tier: LocalAiTier,
) -> Result<(), String> {
    let plan = tier_runtime_plan(selected_tier);

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Installing,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(10),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some("Preparing the managed local runtime...".to_string()),
            updated_at_ms: unix_time_ms(),
        },
    );

    let runtime_binary = ensure_runtime_binary(&managed_dir)?;
    let runtime_version = detect_runtime_version(&runtime_binary.path)
        .unwrap_or_else(|| "ollama-unknown".to_string());

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Installed,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(35),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(
                "Managed local runtime installed. Starting the local AI service...".to_string(),
            ),
            updated_at_ms: unix_time_ms(),
        },
    );

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Starting,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(45),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some("Starting the local AI service...".to_string()),
            updated_at_ms: unix_time_ms(),
        },
    );

    let started_managed_service =
        ensure_service_running(&state, &managed_dir, &runtime_binary.path)?;

    let metadata_before = read_metadata(&managed_dir);
    let already_installed = metadata_before
        .as_ref()
        .map(|value| {
            value
                .installed_models
                .iter()
                .any(|model| model == plan.default_model)
        })
        .unwrap_or(false);

    if !already_installed {
        set_install_progress(
            &state,
            LocalAiInstallProgress {
                stage: LocalAiInstallStage::Installing,
                selected_tier: Some(selected_tier),
                selected_model: Some(plan.default_model.to_string()),
                progress_percent: Some(65),
                downloaded_bytes: None,
                total_bytes: None,
                message: Some(format!(
                    "Downloading the default free model {}...",
                    plan.default_model
                )),
                updated_at_ms: unix_time_ms(),
            },
        );
        pull_model(&runtime_binary.path, &managed_dir, plan.default_model)?;
    }

    let metadata = LocalAiInstallMetadata {
        runtime_version,
        runtime_source: if started_managed_service {
            runtime_binary.source
        } else {
            LocalAiRuntimeSource::ExistingService
        },
        selected_tier,
        selected_model: plan.default_model.to_string(),
        installed_models: vec![plan.default_model.to_string()],
        optional_vision_model: Some(plan.optional_vision_model.to_string()),
        updated_at_ms: unix_time_ms(),
    };
    write_metadata(&managed_dir, &metadata)?;

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Ready,
            selected_tier: Some(selected_tier),
            selected_model: Some(plan.default_model.to_string()),
            progress_percent: Some(100),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(format!("Free AI is ready with {}.", plan.default_model)),
            updated_at_ms: unix_time_ms(),
        },
    );
    clear_last_error(&state);
    Ok(())
}

fn run_enable_vision_boost_worker(
    state: LocalAiRuntimeState,
    managed_dir: PathBuf,
    selected_tier: LocalAiTier,
) -> Result<(), String> {
    let plan = tier_runtime_plan(selected_tier);
    let vision_model = plan.optional_vision_model;
    let existing_metadata = read_metadata(&managed_dir)
        .ok_or_else(|| "Set up Free AI first before enabling Vision Boost.".to_string())?;

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Installing,
            selected_tier: Some(selected_tier),
            selected_model: Some(vision_model.to_string()),
            progress_percent: Some(20),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some("Preparing Vision Boost download...".to_string()),
            updated_at_ms: unix_time_ms(),
        },
    );

    let runtime_binary = ensure_runtime_binary(&managed_dir)?;
    let _ = ensure_service_running(&state, &managed_dir, &runtime_binary.path)?;

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Installing,
            selected_tier: Some(selected_tier),
            selected_model: Some(vision_model.to_string()),
            progress_percent: Some(70),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(format!(
                "Downloading Vision Boost model {}...",
                vision_model
            )),
            updated_at_ms: unix_time_ms(),
        },
    );

    if !existing_metadata
        .installed_models
        .iter()
        .any(|model| model == vision_model)
    {
        pull_model(&runtime_binary.path, &managed_dir, vision_model)?;
    }

    let mut installed_models = existing_metadata.installed_models.clone();
    if !installed_models.iter().any(|model| model == vision_model) {
        installed_models.push(vision_model.to_string());
    }

    let metadata = LocalAiInstallMetadata {
        runtime_version: existing_metadata.runtime_version,
        runtime_source: existing_metadata.runtime_source,
        selected_tier,
        selected_model: existing_metadata.selected_model,
        installed_models,
        optional_vision_model: Some(vision_model.to_string()),
        updated_at_ms: unix_time_ms(),
    };
    write_metadata(&managed_dir, &metadata)?;

    set_install_progress(
        &state,
        LocalAiInstallProgress {
            stage: LocalAiInstallStage::Ready,
            selected_tier: Some(selected_tier),
            selected_model: Some(vision_model.to_string()),
            progress_percent: Some(100),
            downloaded_bytes: None,
            total_bytes: None,
            message: Some(format!("Vision Boost is ready with {}.", vision_model)),
            updated_at_ms: unix_time_ms(),
        },
    );
    clear_last_error(&state);
    Ok(())
}

fn tier_runtime_plan(tier: LocalAiTier) -> LocalAiTierRuntimePlan {
    match tier {
        LocalAiTier::Light => LocalAiTierRuntimePlan {
            default_model: "qwen2.5:1.5b",
            optional_vision_model: "qwen2.5-vl:3b",
        },
        LocalAiTier::Standard => LocalAiTierRuntimePlan {
            default_model: "qwen2.5:3b",
            optional_vision_model: "qwen2.5-vl:3b",
        },
        LocalAiTier::Vision => LocalAiTierRuntimePlan {
            default_model: "qwen2.5-vl:3b",
            optional_vision_model: "qwen2.5-vl:3b",
        },
    }
}

fn ensure_managed_dirs(managed_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(runtime_dir(managed_dir)).map_err(|error| {
        format!(
            "Failed to prepare managed local AI runtime directory {}: {}",
            runtime_dir(managed_dir).display(),
            error
        )
    })?;
    fs::create_dir_all(models_dir(managed_dir)).map_err(|error| {
        format!(
            "Failed to prepare managed local AI models directory {}: {}",
            models_dir(managed_dir).display(),
            error
        )
    })?;
    Ok(())
}

fn runtime_dir(managed_dir: &Path) -> PathBuf {
    managed_dir.join("runtime")
}

fn models_dir(managed_dir: &Path) -> PathBuf {
    managed_dir.join("models")
}

fn metadata_path(managed_dir: &Path) -> PathBuf {
    managed_dir.join(LOCAL_AI_METADATA_FILE)
}

fn read_metadata(managed_dir: &Path) -> Option<LocalAiInstallMetadata> {
    let path = metadata_path(managed_dir);
    let source = fs::read_to_string(path).ok()?;
    serde_json::from_str(&source).ok()
}

fn write_metadata(managed_dir: &Path, metadata: &LocalAiInstallMetadata) -> Result<(), String> {
    let path = metadata_path(managed_dir);
    let source = serde_json::to_string_pretty(metadata)
        .map_err(|error| format!("Failed to serialize local AI install metadata: {}", error))?;
    fs::write(&path, source).map_err(|error| {
        format!(
            "Failed to write local AI install metadata {}: {}",
            path.display(),
            error
        )
    })
}

fn ensure_runtime_binary(managed_dir: &Path) -> Result<ResolvedRuntimeBinary, String> {
    let path = expected_runtime_binary_path(managed_dir)
        .ok_or_else(|| "Managed local AI runtime path is unavailable.".to_string())?;
    if path.exists() {
        let source = read_metadata(managed_dir)
            .map(|metadata| metadata.runtime_source)
            .unwrap_or(LocalAiRuntimeSource::Managed);
        return Ok(ResolvedRuntimeBinary { path, source });
    }

    match provision_managed_runtime(managed_dir) {
        Ok(resolved) => Ok(resolved),
        Err(download_error) => {
            let source = find_system_ollama_binary().ok_or_else(|| {
                format!(
                    "Managed local runtime download failed: {} Existing Ollama binary was also not found locally, so Free AI cannot finish setup yet.",
                    download_error
                )
            })?;

            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "Failed to prepare managed runtime directory {}: {}",
                        parent.display(),
                        error
                    )
                })?;
            }

            fs::copy(&source, &path).map_err(|error| {
                format!(
                    "Failed to adopt local AI runtime from {} into {}: {}",
                    source.display(),
                    path.display(),
                    error
                )
            })?;

            set_runtime_executable(&path)?;

            Ok(ResolvedRuntimeBinary {
                path,
                source: LocalAiRuntimeSource::ExistingInstall,
            })
        }
    }
}

fn provision_managed_runtime(managed_dir: &Path) -> Result<ResolvedRuntimeBinary, String> {
    let asset = local_ai_manifest::resolve_current_runtime_asset().ok_or_else(|| {
        format!(
            "Managed local runtime download is not supported on {}-{} yet.",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;

    let archive_path = download_runtime_archive(&asset, managed_dir)?;
    verify_runtime_archive_checksum(&archive_path, &asset.checksum_sha256)?;
    let binary_path = extract_runtime_archive(&asset, &archive_path, managed_dir)?;
    set_runtime_executable(&binary_path)?;
    let _ = fs::remove_file(&archive_path);

    Ok(ResolvedRuntimeBinary {
        path: binary_path,
        source: LocalAiRuntimeSource::Managed,
    })
}

fn download_runtime_archive(
    asset: &local_ai_manifest::LocalAiRuntimeAssetManifest,
    managed_dir: &Path,
) -> Result<PathBuf, String> {
    let runtime_root = runtime_dir(managed_dir);
    fs::create_dir_all(&runtime_root).map_err(|error| {
        format!(
            "Failed to prepare managed runtime directory {}: {}",
            runtime_root.display(),
            error
        )
    })?;

    let archive_name = archive_file_name(asset);
    let archive_path = runtime_root.join(archive_name);
    let mut response = BlockingClient::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Failed to prepare managed runtime downloader: {}", error))?
        .get(&asset.download_url)
        .send()
        .map_err(|error| {
            format!(
                "Failed to download managed runtime asset {}: {}",
                asset.download_url, error
            )
        })?
        .error_for_status()
        .map_err(|error| {
            format!(
                "Managed runtime download request failed for {}: {}",
                asset.download_url, error
            )
        })?;

    let mut file = fs::File::create(&archive_path).map_err(|error| {
        format!(
            "Failed to create runtime archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    io::copy(&mut response, &mut file).map_err(|error| {
        format!(
            "Failed to write managed runtime archive {}: {}",
            archive_path.display(),
            error
        )
    })?;

    Ok(archive_path)
}

fn verify_runtime_archive_checksum(path: &Path, expected_checksum: &str) -> Result<(), String> {
    if expected_checksum.starts_with("dev-") {
        return Ok(());
    }

    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "Failed to open managed runtime archive {} for checksum verification: {}",
            path.display(),
            error
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let bytes_read = io::Read::read(&mut file, &mut buffer).map_err(|error| {
            format!(
                "Failed to hash managed runtime archive {}: {}",
                path.display(),
                error
            )
        })?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let actual_checksum = format!("{:x}", hasher.finalize());
    if actual_checksum != expected_checksum.to_ascii_lowercase() {
        return Err(format!(
            "Managed runtime checksum mismatch for {}.",
            path.display()
        ));
    }

    Ok(())
}

fn extract_runtime_archive(
    asset: &local_ai_manifest::LocalAiRuntimeAssetManifest,
    archive_path: &Path,
    managed_dir: &Path,
) -> Result<PathBuf, String> {
    let runtime_root = runtime_dir(managed_dir);
    let destination_path = runtime_root.join(&asset.binary_relative_path);

    if archive_path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.ends_with(".zip"))
    {
        extract_runtime_zip(archive_path, &asset.binary_relative_path, &destination_path)?;
    } else if archive_path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.ends_with(".tar.gz") || value.ends_with(".tgz"))
    {
        extract_runtime_tar_gz(archive_path, &asset.binary_relative_path, &destination_path)?;
    } else {
        return Err(format!(
            "Managed runtime archive format is unsupported for {}.",
            archive_path.display()
        ));
    }

    Ok(destination_path)
}

fn extract_runtime_zip(
    archive_path: &Path,
    binary_relative_path: &str,
    destination_path: &Path,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open managed runtime zip {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let mut archive = ZipArchive::new(archive_file).map_err(|error| {
        format!(
            "Failed to read managed runtime zip {}: {}",
            archive_path.display(),
            error
        )
    })?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            format!(
                "Failed to read managed runtime zip entry {}: {}",
                archive_path.display(),
                error
            )
        })?;
        if !entry.is_file() {
            continue;
        }
        let Some(entry_path) = entry.enclosed_name().map(|value| value.to_path_buf()) else {
            continue;
        };
        if !archive_entry_matches_binary(&entry_path, binary_relative_path) {
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to prepare runtime destination {}: {}",
                    parent.display(),
                    error
                )
            })?;
        }
        let mut output = fs::File::create(destination_path).map_err(|error| {
            format!(
                "Failed to create runtime binary {}: {}",
                destination_path.display(),
                error
            )
        })?;
        io::copy(&mut entry, &mut output).map_err(|error| {
            format!(
                "Failed to extract runtime binary {}: {}",
                destination_path.display(),
                error
            )
        })?;
        return Ok(());
    }

    Err(format!(
        "Managed runtime archive {} did not contain {}.",
        archive_path.display(),
        binary_relative_path
    ))
}

fn extract_runtime_tar_gz(
    archive_path: &Path,
    binary_relative_path: &str,
    destination_path: &Path,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open managed runtime archive {}: {}",
            archive_path.display(),
            error
        )
    })?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = Archive::new(decoder);
    let entries = archive.entries().map_err(|error| {
        format!(
            "Failed to read managed runtime archive {}: {}",
            archive_path.display(),
            error
        )
    })?;

    for entry_result in entries {
        let mut entry = entry_result.map_err(|error| {
            format!(
                "Failed to read managed runtime tar entry {}: {}",
                archive_path.display(),
                error
            )
        })?;
        let entry_path = entry.path().map_err(|error| {
            format!(
                "Failed to inspect managed runtime tar entry {}: {}",
                archive_path.display(),
                error
            )
        })?;
        if !archive_entry_matches_binary(entry_path.as_ref(), binary_relative_path) {
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to prepare runtime destination {}: {}",
                    parent.display(),
                    error
                )
            })?;
        }
        entry.unpack(destination_path).map_err(|error| {
            format!(
                "Failed to extract runtime binary {}: {}",
                destination_path.display(),
                error
            )
        })?;
        return Ok(());
    }

    Err(format!(
        "Managed runtime archive {} did not contain {}.",
        archive_path.display(),
        binary_relative_path
    ))
}

fn archive_entry_matches_binary(entry_path: &Path, binary_relative_path: &str) -> bool {
    if entry_path == Path::new(binary_relative_path) {
        return true;
    }
    if entry_path
        .to_string_lossy()
        .replace('\\', "/")
        .ends_with(binary_relative_path)
    {
        return true;
    }
    entry_path.file_name().is_some_and(|file_name| {
        Path::new(binary_relative_path)
            .file_name()
            .is_some_and(|binary_name| file_name == binary_name)
    })
}

fn archive_file_name(asset: &local_ai_manifest::LocalAiRuntimeAssetManifest) -> String {
    if asset.download_url.ends_with(".tar.gz") {
        "managed-runtime.tar.gz".to_string()
    } else if asset.download_url.ends_with(".tgz") {
        "managed-runtime.tgz".to_string()
    } else if asset.download_url.ends_with(".zip") {
        "managed-runtime.zip".to_string()
    } else {
        "managed-runtime.bin".to_string()
    }
}

fn set_runtime_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(path)
            .map_err(|error| {
                format!(
                    "Failed to read runtime metadata {}: {}",
                    path.display(),
                    error
                )
            })?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|error| {
            format!(
                "Failed to make managed runtime executable {}: {}",
                path.display(),
                error
            )
        })?;
    }

    #[cfg(not(unix))]
    {
        let _ = path;
    }

    Ok(())
}

fn find_system_ollama_binary() -> Option<PathBuf> {
    let binary_name = if cfg!(target_os = "windows") {
        "ollama.exe"
    } else {
        "ollama"
    };

    let mut candidates = Vec::new();

    if let Some(path_os) = env::var_os("PATH") {
        for segment in env::split_paths(&path_os) {
            candidates.push(segment.join(binary_name));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/ollama"));
        candidates.push(PathBuf::from("/usr/local/bin/ollama"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = env::var_os("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("Ollama")
                    .join("ollama.exe"),
            );
        }
        if let Some(local_app_data) = env::var_os("LocalAppData") {
            candidates.push(
                PathBuf::from(local_app_data)
                    .join("Programs")
                    .join("Ollama")
                    .join("ollama.exe"),
            );
        }
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn detect_runtime_version(runtime_binary: &Path) -> Option<String> {
    run_path_command_capture(runtime_binary, &["--version"])
        .or_else(|| run_path_command_capture(runtime_binary, &["version"]))
}

fn ensure_service_running(
    state: &LocalAiRuntimeState,
    managed_dir: &Path,
    runtime_binary: &Path,
) -> Result<bool, String> {
    if managed_child_running(state) || is_service_port_open() {
        return Ok(false);
    }

    let mut command = managed_ollama_command(runtime_binary, managed_dir);
    command
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command.spawn().map_err(|error| {
        format!(
            "Failed to start the managed local AI runtime {}: {}",
            runtime_binary.display(),
            error
        )
    })?;

    {
        let mut guard = state.managed_child.lock().unwrap();
        *guard = Some(child);
    }

    if !wait_for_service_port(Duration::from_secs(20)) {
        let mut guard = state.managed_child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err("Managed local AI runtime did not become ready in time.".to_string());
    }

    Ok(true)
}

fn pull_model(runtime_binary: &Path, managed_dir: &Path, model: &str) -> Result<(), String> {
    let status = managed_ollama_command(runtime_binary, managed_dir)
        .arg("pull")
        .arg(model)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Failed to start model download for {}: {}", model, error))?;

    if !status.success() {
        return Err(format!(
            "Managed local AI could not download model {}. Check disk space and network access, then try again.",
            model
        ));
    }

    Ok(())
}

fn managed_ollama_command(runtime_binary: &Path, managed_dir: &Path) -> Command {
    let mut command = Command::new(runtime_binary);
    command
        .env("OLLAMA_HOST", LOCAL_AI_HOST)
        .env("OLLAMA_MODELS", models_dir(managed_dir))
        .env("OLLAMA_KEEP_ALIVE", "10m")
        .env("NO_COLOR", "1");
    command
}

fn managed_child_running(state: &LocalAiRuntimeState) -> bool {
    let mut guard = state.managed_child.lock().unwrap();
    let Some(child) = guard.as_mut() else {
        return false;
    };

    match child.try_wait() {
        Ok(Some(_)) => {
            *guard = None;
            false
        }
        Ok(None) => true,
        Err(_) => {
            *guard = None;
            false
        }
    }
}

fn wait_for_service_port(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_service_port_open() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn is_service_port_open() -> bool {
    TcpStream::connect_timeout(
        &LOCAL_AI_HOST
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:11434".parse().expect("valid socket address")),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn derive_install_stage(
    progress_stage: LocalAiInstallStage,
    runtime_present: bool,
    running: bool,
    metadata: Option<&LocalAiInstallMetadata>,
) -> LocalAiInstallStage {
    if running {
        return LocalAiInstallStage::Ready;
    }
    if matches!(
        progress_stage,
        LocalAiInstallStage::Planned
            | LocalAiInstallStage::Installing
            | LocalAiInstallStage::Starting
            | LocalAiInstallStage::Error
    ) {
        return progress_stage;
    }
    if runtime_present || metadata.is_some() {
        return LocalAiInstallStage::Installed;
    }
    LocalAiInstallStage::NotStarted
}

fn default_install_progress() -> LocalAiInstallProgress {
    LocalAiInstallProgress {
        stage: LocalAiInstallStage::NotStarted,
        selected_tier: None,
        selected_model: None,
        progress_percent: None,
        downloaded_bytes: None,
        total_bytes: None,
        message: None,
        updated_at_ms: unix_time_ms(),
    }
}

fn set_install_progress(state: &LocalAiRuntimeState, progress: LocalAiInstallProgress) {
    *state.install_progress.lock().unwrap() = progress;
}

fn set_last_error(state: &LocalAiRuntimeState, error: String) {
    *state.last_error.lock().unwrap() = Some(error);
}

fn clear_last_error(state: &LocalAiRuntimeState) {
    *state.last_error.lock().unwrap() = None;
}

fn managed_runtime_dir() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI Operator")
        .join("local-ai")
}

fn expected_runtime_binary_path(managed_dir: &Path) -> Option<PathBuf> {
    if let Some(asset) = local_ai_manifest::resolve_current_runtime_asset() {
        return Some(runtime_dir(managed_dir).join(asset.binary_relative_path));
    }

    let binary_name = if cfg!(target_os = "windows") {
        "ollama.exe"
    } else {
        "ollama"
    };
    Some(runtime_dir(managed_dir).join(binary_name))
}

fn parse_tier(value: &str) -> Option<LocalAiTier> {
    match value {
        "light" => Some(LocalAiTier::Light),
        "standard" => Some(LocalAiTier::Standard),
        "vision" => Some(LocalAiTier::Vision),
        _ => None,
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

async fn is_service_running(base_url: &str) -> bool {
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client
        .get(format!("{}/api/tags", base_url.trim_end_matches('/')))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

fn detect_cpu_model() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(source) = fs::read_to_string("/proc/cpuinfo") {
            for line in source.lines() {
                if let Some(model) = line.strip_prefix("model name\t: ") {
                    return Some(model.trim().to_string());
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(value) = run_command_capture("sysctl", &["-n", "machdep.cpu.brand_string"]) {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(value) = run_command_capture(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)",
            ],
        ) {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

fn detect_ram_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(source) = fs::read_to_string("/proc/meminfo") {
            for line in source.lines() {
                if let Some(value) = line.strip_prefix("MemTotal:") {
                    let kb = value
                        .split_whitespace()
                        .next()
                        .and_then(|item| item.parse::<u64>().ok())?;
                    return Some(kb * 1024);
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(value) = run_command_capture("sysctl", &["-n", "hw.memsize"]) {
            if let Ok(bytes) = value.parse::<u64>() {
                return Some(bytes);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(value) = run_command_capture(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ],
        ) {
            if let Ok(bytes) = value.parse::<u64>() {
                return Some(bytes);
            }
        }
    }

    None
}

fn detect_available_disk_bytes(path: &Path) -> Option<u64> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let target = path.display().to_string();
        if let Some(output) = run_command_capture("df", &["-Pk", &target]) {
            let line = output.lines().nth(1)?;
            let blocks = line.split_whitespace().nth(3)?.parse::<u64>().ok()?;
            return Some(blocks * 1024);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let root = path
            .components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .unwrap_or_else(|| "C:".to_string());
        let query = format!(
            "(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='{}'\").FreeSpace",
            root.trim_end_matches('\\')
        );
        if let Some(value) = run_command_capture("powershell", &["-NoProfile", "-Command", &query])
        {
            if let Ok(bytes) = value.parse::<u64>() {
                return Some(bytes);
            }
        }
    }

    None
}

fn detect_gpu_summary() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        if let Some(value) = run_command_capture(
            "sh",
            &["-lc", "lspci | grep -Ei 'vga|3d|display' | head -n 1"],
        ) {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(value) = run_command_capture(
            "system_profiler",
            &["SPDisplaysDataType", "-detailLevel", "mini"],
        ) {
            let summary = value
                .lines()
                .find(|line| line.contains("Chipset Model:"))
                .map(|line| line.replace("Chipset Model:", "").trim().to_string());
            if summary.as_ref().is_some_and(|line| !line.is_empty()) {
                return summary;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(value) = run_command_capture(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
            ],
        ) {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

fn detect_gpu_class() -> LocalAiGpuClass {
    let summary = detect_gpu_summary()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if summary.is_empty() {
        return LocalAiGpuClass::Unknown;
    }

    if summary.contains("nvidia")
        || summary.contains("radeon")
        || summary.contains("geforce")
        || summary.contains("rtx")
        || summary.contains("quadro")
    {
        return LocalAiGpuClass::Discrete;
    }

    if summary.contains("intel")
        || summary.contains("apple")
        || summary.contains("integrated")
        || summary.contains("iris")
        || summary.contains("uhd")
    {
        return LocalAiGpuClass::Integrated;
    }

    LocalAiGpuClass::Unknown
}

fn run_command_capture(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn run_path_command_capture(program: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

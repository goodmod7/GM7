use serde::{Deserialize, Serialize};

const MANAGED_RUNTIME_VERSION: &str = "0.17.7";
const MANAGED_RUNTIME_TAG: &str = "v0.17.7";
const MANAGED_RUNTIME_BASE_URL: &str = "https://github.com/ollama/ollama/releases/download";
const MACOS_RUNTIME_CHECKSUM_SHA256: &str =
    "a87a5d78825f91aee334020c868fba6c470da4e2bf21578d2ae1e36bb184ef35";
const WINDOWS_X64_RUNTIME_CHECKSUM_SHA256: &str =
    "67710550b4b77d86dc307b52d84cb3b5780847d5468428325470e37e1a394a72";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalAiRuntimePlatformTarget {
    MacosArm64,
    MacosX64,
    WindowsX64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeAssetManifest {
    pub runtime_version: String,
    pub target_platform: LocalAiRuntimePlatformTarget,
    pub download_url: String,
    pub checksum_sha256: String,
    pub binary_relative_path: String,
}

pub fn resolve_platform_target(
    os: &str,
    architecture: &str,
) -> Option<LocalAiRuntimePlatformTarget> {
    match (os, architecture) {
        ("macos", "aarch64") => Some(LocalAiRuntimePlatformTarget::MacosArm64),
        ("macos", "x86_64") => Some(LocalAiRuntimePlatformTarget::MacosX64),
        ("windows", "x86_64") => Some(LocalAiRuntimePlatformTarget::WindowsX64),
        _ => None,
    }
}

pub fn runtime_asset_for_target(
    target_platform: LocalAiRuntimePlatformTarget,
) -> LocalAiRuntimeAssetManifest {
    match target_platform {
        LocalAiRuntimePlatformTarget::MacosArm64 => LocalAiRuntimeAssetManifest {
            runtime_version: MANAGED_RUNTIME_VERSION.to_string(),
            target_platform,
            download_url: format!(
                "{}/{}/ollama-darwin.tgz",
                MANAGED_RUNTIME_BASE_URL, MANAGED_RUNTIME_TAG
            ),
            checksum_sha256: MACOS_RUNTIME_CHECKSUM_SHA256.to_string(),
            binary_relative_path: "ollama".to_string(),
        },
        LocalAiRuntimePlatformTarget::MacosX64 => LocalAiRuntimeAssetManifest {
            runtime_version: MANAGED_RUNTIME_VERSION.to_string(),
            target_platform,
            download_url: format!(
                "{}/{}/ollama-darwin.tgz",
                MANAGED_RUNTIME_BASE_URL, MANAGED_RUNTIME_TAG
            ),
            checksum_sha256: MACOS_RUNTIME_CHECKSUM_SHA256.to_string(),
            binary_relative_path: "ollama".to_string(),
        },
        LocalAiRuntimePlatformTarget::WindowsX64 => LocalAiRuntimeAssetManifest {
            runtime_version: MANAGED_RUNTIME_VERSION.to_string(),
            target_platform,
            download_url: format!(
                "{}/{}/ollama-windows-amd64.zip",
                MANAGED_RUNTIME_BASE_URL, MANAGED_RUNTIME_TAG
            ),
            checksum_sha256: WINDOWS_X64_RUNTIME_CHECKSUM_SHA256.to_string(),
            binary_relative_path: "ollama.exe".to_string(),
        },
    }
}

pub fn resolve_current_runtime_asset() -> Option<LocalAiRuntimeAssetManifest> {
    let target_platform = resolve_platform_target(std::env::consts::OS, std::env::consts::ARCH)?;
    Some(runtime_asset_for_target(target_platform))
}

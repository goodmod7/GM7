# Adaptive Local AI Runtime

## Goal

Make the free local AI path feel native inside the desktop app by letting the app manage local AI setup itself, choose a lightweight default model tier based on machine capability, and keep heavier vision models optional and on-demand.

## Chosen Architecture

Use a managed adaptive bootstrap runtime:

- The desktop app owns the local AI lifecycle.
- On first use, the app detects hardware and recommends a local tier.
- The app downloads a platform-specific runtime bundle and the recommended default model into an app-managed directory.
- The default free path uses a light or standard text model for chat, planning, and tool choice.
- Vision-capable models are optional and installed only when the assistant actually needs screenshot understanding and the machine can handle it.

This is the best fit for the current codebase because the repo already:

- has a desktop-first Tauri app with a stable IPC pattern
- already talks to local HTTP-based providers
- already has desktop provider settings, keychain storage, and readiness state
- already has release/update infrastructure for signed desktop artifacts

It does not yet have:

- a managed local runtime lifecycle
- a model installer/downloader
- hardware profiling
- tier recommendation logic
- app-owned local AI onboarding

## Why This Approach

### Option 1: Bundle one heavy runtime/model inside the installer

- Complexity: medium in code, high in release/distribution
- UX quality: decent once installed, bad for install size and updates
- Installer size: worst
- Cross-platform pain: high, especially signed Windows/macOS artifacts
- Performance impact: bad on weaker machines if the bundled default is heavy
- Suitability for low-end devices: poor
- Maintainability: poor
- Fit for this repo: weak

This conflicts with the target product direction because the current free local default should not assume a heavy always-on 7B vision model, and the existing signed desktop release pipeline would get much heavier and slower.

### Option 2: Ship a managed local runtime that downloads models on first use

- Complexity: medium-high
- UX quality: good
- Installer size: good
- Cross-platform pain: moderate
- Performance impact: depends on model defaults
- Suitability for low-end devices: only acceptable if model choice is adaptive
- Maintainability: good
- Fit for this repo: good

This is close, but still incomplete if it assumes one fixed default model tier for every machine.

### Option 3: Adaptive bootstrap runtime

- Complexity: highest of the three, but still incremental
- UX quality: best
- Installer size: good
- Cross-platform pain: moderate
- Performance impact: best because the app can stay lightweight by default
- Suitability for low-end devices: best
- Maintainability: good if the runtime manager, tiering, and manifests are kept explicit
- Fit for this repo: best

This matches the repo and product goals best because it extends the existing local-provider path instead of replacing it, keeps the desktop-first flow intact, and allows the default free experience to stay light.

## What Already Exists In The Repo

### Desktop-first product shell

- Desktop sign-in and durable device auth already exist.
- The main desktop shell is already the primary operating surface.
- The web app is already demoted to auth, billing, account, downloads, and legacy/admin paths.

### Existing provider/runtime building blocks

- The main desktop flow already has provider config in `apps/desktop/src/lib/llmConfig.ts`.
- The desktop settings UI already has provider setup state in `apps/desktop/src/components/SettingsPanel.tsx`.
- The Tauri bridge already supports local and BYOK providers via `apps/desktop/src-tauri/src/llm/*`.
- The current local provider path already speaks to a local Ollama-style HTTP service through `apps/desktop/src-tauri/src/llm/native_ollama.rs`.

### Safety and approval plumbing

- Local approvals already gate privileged actions and tools.
- Screenshot capture is transient and currently passed through the runtime path rather than being persisted.
- API keys are already kept local in the OS keychain through Tauri commands in `apps/desktop/src-tauri/src/lib.rs`.
- The desktop IPC surface is already tightly allowlisted in `apps/desktop/src-tauri/permissions/desktop-ipc.toml` and enforced by `scripts/check-desktop-security.mjs`.

### Distribution and release primitives

- The desktop app already ships through a signed Windows/macOS release pipeline in `.github/workflows/desktop-release.yml`.
- The app already uses app-local directories and updater infrastructure that can be extended for managed runtime assets.

## What Is Missing

### 1. Runtime/process management

Missing:

- no app-owned runtime manager
- no runtime binary location abstraction
- no managed start/stop/status lifecycle
- no child-process ownership model

Current code truth:

- `native_qwen_ollama.rs` assumes something else is already running on `127.0.0.1:11434`
- the desktop app does not currently install or supervise a local runtime

### 2. Model/runtime download manager

Missing:

- no runtime download/install flow
- no model download/install flow
- no download progress persistence
- no retry/resume behavior

### 3. Local AI service lifecycle

Missing:

- no “installed / starting / ready / failed / updating” state machine
- no health check endpoint abstraction for the managed runtime
- no recovery logic after crash or reboot

### 4. Hardware capability detection

Missing:

- no hardware profile module for RAM, CPU, GPU, or available disk
- no OS-aware recommendation path

### 5. Model tier selection

Missing:

- no light / standard / vision tiering strategy in code
- current default is still a heavy single local model path

### 6. Health checks and readiness UI

Missing:

- no frontend surface for local runtime readiness
- no onboarding state machine for “Start Free AI”
- no friendly performance/download guidance

### 7. Disk space and model size handling

Missing:

- no install-size estimates
- no disk availability checks before installation
- no model cleanup/uninstall management

### 8. Update strategy for managed runtime

Missing:

- no runtime version manifest
- no runtime asset signature/checksum verification path
- no policy for when the app upgrades the managed runtime or models

### 9. Signed release and packaging implications

Missing:

- no release strategy for runtime assets separate from the desktop bundle
- no signed runtime artifact plan for Windows/macOS child binaries

### 10. Security implications

Missing:

- no allowlisted IPC for local runtime lifecycle yet
- no explicit download-integrity checks
- no sandbox boundary for runtime install directory management

### 11. macOS and Windows differences

Missing:

- no platform-specific process-start policy
- no platform-specific hardware probing
- no platform-specific runtime packaging plan
- no handling for Windows firewall prompts or macOS notarization expectations for managed binaries

### 12. Free vs Plus plan enforcement

Missing:

- no app-side local AI entitlement policy yet
- no desktop UI for free/plus local AI limits

## Hardware Tiering Strategy

The app should select a conservative default tier and allow manual upgrade later.

### Light

Default for weaker or average machines.

Targets:

- normal chat
- planning
- tool choice
- basic reasoning

Candidate models:

- Qwen2.5 0.5B
- Qwen2.5 1.5B
- Qwen2.5 3B

Use when:

- lower RAM
- limited disk
- no clearly capable GPU
- machine is likely to be used alongside heavy creative apps

### Standard

Default for better laptops/desktops.

Targets:

- richer reasoning
- code tasks
- better planning

Candidate models:

- Qwen2.5 3B
- Qwen2.5 7B
- Qwen2.5-Coder 3B
- Qwen2.5-Coder 7B

Use when:

- solid RAM headroom
- enough disk
- adequate CPU/GPU headroom

### Vision Boost

Optional and on-demand.

Targets:

- screenshot interpretation
- OCR-like understanding
- UI state localization
- result verification when tool-only reasoning is not enough

Candidate models:

- Qwen2.5-VL 3B
- Qwen2.5-VL 7B

Use only when:

- the current task genuinely needs screenshot understanding
- the machine can handle it
- the user explicitly enables or installs it, or the app prompts clearly for it

## When To Use Text-Only vs Vision

Stay text-only by default for:

- chat
- planning
- workspace/tool reasoning
- code tasks
- many file and terminal tasks
- follow-up reasoning when the assistant already has enough structured context

Escalate to vision only for:

- locating or verifying UI state in a third-party app
- checking whether a GUI action had the intended effect
- reading visual-only state that tools cannot inspect
- tasks where the assistant would otherwise guess about the current screen

The system should never require a heavy vision model to be always running before the user can get a free local experience.

## Packaging And Release Implications

Recommended release shape:

- keep the desktop installer small
- ship managed runtime assets as separate downloadable artifacts
- version runtime assets explicitly per platform
- verify integrity with signed metadata plus checksums before launch

Implications for this repo:

- `.github/workflows/desktop-release.yml` needs a companion path for local runtime assets
- runtime artifacts should be code-signed/notarized for macOS and signed for Windows when feasible
- the desktop app should store runtime assets under an app-managed directory, not inside the source tree or user workspace

Bundling a heavy local runtime and heavy models into the main installer is not recommended for this repo.

## Free vs Plus Product Implications

Free:

- managed local AI available
- light tier always available on supported machines
- conservative local usage limits if product needs them
- vision boost optional and possibly more restricted

Plus:

- higher or no app-side local usage limits
- easier access to standard tier defaults
- optional access to larger local models and vision boost without tighter caps

BYOK cloud providers remain separate:

- local AI entitlement should not weaken or replace BYOK provider handling
- no server-side cloud keys

## Safety And Security Considerations

- Preserve local approvals for privileged actions and tools.
- Keep screenshots transient only; do not persist them to disk as part of runtime setup.
- Keep provider keys local in the OS keychain.
- Do not log prompts, typed text, terminal args, file contents, screenshots, or tokens in runtime-manager logs.
- Restrict the managed runtime to an app-owned directory.
- Expose runtime lifecycle only through explicit allowlisted IPC commands.
- Treat runtime downloads as untrusted until checksum/signature verification passes.

## Phased Rollout Plan

### Phase 1: Manager skeleton and profiling

- add local runtime status model
- add hardware profile detection
- add tier recommendation logic
- add Tauri commands for status/start/stop/install skeleton
- add frontend helper surface

### Phase 2: Retail onboarding

- add “Start Free AI” flow
- show install state machine and recommended tier
- explain download size, disk needs, and performance expectations

### Phase 3: Managed install path

- download runtime assets
- install default model tier
- store install metadata
- start and health-check the local service

### Phase 4: Make adaptive local the real default

- wire the managed local runtime into the main assistant flow
- use recommended tier by default
- resolve remaining provider/readiness mismatch

### Phase 5: Vision Boost on demand

- define escalation rules
- prompt to enable/install vision only when needed

### Phase 6: Product gating

- add free vs plus local AI policy
- reflect entitlement cleanly in desktop UI

## Recommendation

For this codebase, use the managed adaptive bootstrap runtime approach.

It fits the current architecture because:

- the app is already desktop-first
- the current local provider path is already HTTP-runtime-based
- the repo already has tight Tauri IPC controls
- the release pipeline already handles signed desktop artifacts

It is the only option that keeps the installer reasonable, supports average machines, avoids a heavy always-on default, and preserves the target UX of “install one app, click Start Free AI, and use the assistant.”

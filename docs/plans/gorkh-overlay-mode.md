# GORKH Overlay Mode Design

## Goal

Turn the desktop app into a premium, retail-first assistant surface with:

- `GORKH` branding instead of `AI Operator` in the desktop product
- a premium black/silver visual identity
- a reversible active-work overlay mode
- a compact bottom-right controller during live execution
- existing approvals, auth, and task/run plumbing preserved underneath

## Current Reality

- The desktop app is currently a single-window Tauri app with one `main` window in [apps/desktop/src-tauri/tauri.conf.json](/workspaces/GM7/apps/desktop/src-tauri/tauri.conf.json).
- Active work is still rendered inside the normal app shell in [apps/desktop/src/App.tsx](/workspaces/GM7/apps/desktop/src/App.tsx).
- Branding is still user-visible as `AI Operator` or `AI Operator Desktop` in [apps/desktop/src/App.tsx](/workspaces/GM7/apps/desktop/src/App.tsx), [apps/desktop/src/components/ChatOverlay.tsx](/workspaces/GM7/apps/desktop/src/components/ChatOverlay.tsx), [apps/desktop/src/lib/permissions.ts](/workspaces/GM7/apps/desktop/src/lib/permissions.ts), and [apps/desktop/src-tauri/tauri.conf.json](/workspaces/GM7/apps/desktop/src-tauri/tauri.conf.json).
- There is no dedicated overlay-window control layer yet in [apps/desktop/src-tauri/src/lib.rs](/workspaces/GM7/apps/desktop/src-tauri/src/lib.rs).

## Windowing Options

### Option A: Single window morphs into overlay mode

The existing `main` window changes state when the assistant is actively executing:

- enter fullscreen
- remove normal framing/chrome where supported
- move to always-on-top
- apply a translucent black/glass visual treatment in the React shell
- collapse the normal desktop UI into a compact bottom-right controller

Pros:

- lowest architectural churn
- best fit for the current single-window app
- simplest state ownership for chat, approvals, stop/pause, and run state
- fewer focus/z-order bugs than coordinating multiple windows
- easier to make fully reversible

Cons:

- less flexible than a two-window model for future click-through observer mode
- the whole overlay remains a single interaction surface

### Option B: Two-window strategy

Use:

- one fullscreen translucent overlay window
- one smaller bottom-right controller window

Pros:

- best long-term fit for future click-through/controller separation
- natural separation between visual layer and controls

Cons:

- substantially more Tauri complexity now
- harder focus behavior on macOS and Windows
- more risk around always-on-top, fullscreen restoration, display targeting, and controller z-order
- approvals would need explicit routing across windows

### Option C: Hybrid in the current window without real window-mode changes

Keep the existing window mode and only restyle the React content to look more overlay-like.

Pros:

- fastest to ship

Cons:

- weakest product effect
- feels like “the app got darker,” not a real premium assistant overlay
- not credible for the stated product direction

## Chosen Architecture

Use **Option A: single window morphs into overlay mode**.

Why:

- The first version is intentionally **blocking**, not click-through.
- That removes the main reason to split overlay and controller into separate windows.
- The existing app already centralizes state in `App.tsx`; keeping one trusted window is safer and simpler for approvals and stop/pause handling.
- It gives a clean migration path to a future observer/click-through mode without forcing multi-window complexity now.

## Overlay Behavior

### Entering overlay mode

Overlay mode activates when the assistant is actively executing work. For the first shipping version:

- target the current/main display only
- block normal desktop interaction underneath
- keep only the bottom-right `GORKH` controller interactive inside the overlay

Entry should be triggered from assistant state, not from an unrelated manual window toggle.

### Exiting overlay mode

Overlay mode must be fully reversible and restore the prior window state:

- when the task ends successfully
- when the task fails
- when the user presses `Stop`
- when the user explicitly exits overlay mode through the controller/details affordance

The Tauri layer should snapshot the pre-overlay window state and restore it cleanly.

## Platform Behavior

### macOS

Preferred behavior:

- fullscreen borderless presentation
- transparent or near-transparent webview with a dark-tinted glass layer rendered in React
- always-on-top while active

Notes:

- true native blur/material effects vary by OS version and Tauri/WebView behavior
- the first pass should prefer stable fullscreen transparency over advanced native visual effects

### Windows

Preferred behavior:

- fullscreen borderless always-on-top window
- translucent/tinted overlay rendered in the app layer

Notes:

- acrylic/mica-like effects are less predictable across Windows versions and Tauri setups
- first pass should use a high-quality CSS/webview visual treatment rather than OS-specific composition dependencies

## Interaction Model

During active overlay mode:

- the user sees a black-tinted glass intelligence layer over the desktop
- the bottom-right `GORKH` controller remains the primary visible control surface
- the controller includes:
  - short assistant transcript
  - current status label such as `GORKH is working…`
  - `Stop`
  - `Pause` if supported by the active engine
  - `Details` or `Expand`
- the underlying desktop is intentionally blocked in this first version

Future extension:

- the state model should remain compatible with a future observe/click-through mode, but that is not part of this implementation.

## Branding Updates

Desktop-visible branding should move from `AI Operator` to `GORKH` in:

- main desktop header
- signed-out state
- main chat shell
- settings and intro/retail-facing branding points
- overlay controller branding
- Tauri window title and product name where visible

The new brand asset should be a hand-authored SVG wordmark:

- black background
- silver/white gradient or mixed lettering
- minimalist, sharp, premium
- text-based `GORKH`

## UI Demotion Strategy

During active overlay mode:

- hide or strongly demote:
  - large task/run panels
  - setup-heavy cards
  - device-management cards
  - debug/admin/details sections
- preserve, but behind `Details`:
  - diagnostic state
  - raw run/task internals
  - device/session management
  - advanced/debug surfaces

Outside overlay mode:

- keep the existing assistant-first retail shell
- apply the `GORKH` visual identity across signed-out and signed-in states

## Safety Model Preservation

This change must not weaken:

- local approvals
- auth/session model
- no screenshot persistence
- no server-side LLM keys
- log redaction expectations

Approvals must remain explicit and visible during overlay mode. If an action/tool requires approval, the overlay controller or approval panel must surface it clearly without silent execution.

## Fallback Behavior

If fullscreen overlay styling is not fully supported on a machine:

- keep the single-window architecture
- enter a fallback “focused active mode”:
  - maximized window
  - dark premium shell
  - same bottom-right controller layout
  - admin/debug panels still hidden/demoted

The app should never get stuck in an unrecoverable window state.

## Implementation Phases

1. `GORKH` branding and SVG wordmark
2. Tauri overlay-mode enter/exit state management
3. fullscreen translucent shell styling
4. bottom-right compact controller
5. retail UX cleanup during active work
6. approval presentation in overlay mode


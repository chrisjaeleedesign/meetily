# Meetily Silence Auto-Pause and Recording Overlay Handoff

Date: 2026-07-14

## Purpose

Implement two related Meetily features:

1. Pause the active Meetily recording after a configurable period with no detected speech.
2. Show a small always-on-top macOS overlay while Meetily is recording or paused.

"Pause the meeting" means pause Meetily's recording and transcription. It does not control Google Meet.

## Current Workspace

- Source repo: `/Volumes/Misc/Meetily/Source/meetily`
- Branch: `macos-spotify-audio-exclusion`
- Remote fork: `https://github.com/chrisjaeleedesign/meetily.git`
- Current branch is clean and tracks `origin/macos-spotify-audio-exclusion`.
- Installed app: `/Volumes/Misc/Applications/meetily.app`
- App data: `/Volumes/Misc/Meetily/AppData/com.meetily.ai`
- Recordings: `/Volumes/Misc/Meetily/Recordings`
- Latest relevant pushed commits:
  - `f1b483a Add macOS system audio app exclusions`
  - `57b8d4a Reduce recording start latency`

No code was changed during the feature exploration that produced this handoff.

## Existing Artifacts

Do not duplicate the completed Spotify/system-audio requirement. Read:

- `/Volumes/Misc/Meetily/Source/meetily/requirements/meetily-audio-control/project-requirements.md`
- `/Volumes/Misc/Meetily/Source/meetily/requirements/meetily-audio-control/features/001-REQ-native-app-system-audio-exclusion.md`

The new feature may be documented as `002-REQ-silence-auto-pause-recording-overlay.md` if a durable requirement is useful.

## Existing Behavior to Preserve

- Native macOS system-audio app exclusions work through Core Audio process objects. Spotify is the proof case, not a hard-coded special case.
- Spotify exclusion is applied before the mixed audio reaches VAD/transcription.
- Parakeet is warmed after startup and stays loaded after recording stops. Do not reintroduce frontend model preflight or unload the model after each session.
- Manual pause/resume already works in the backend, frontend state context, recording controls, and tray menu.
- Pausing keeps the recording session active but discards incoming audio before it reaches the pipeline.
- Active duration excludes pauses.
- The installed app and storage-heavy data must remain on `/Volumes/Misc`.

## Recommended V1 Contract

### Speech Inactivity

- Setting label: `Pause after no speech`
- Choices: `Off`, `3 minutes`, `5 minutes`, `10 minutes`
- Product-safe default: `Off`
- Configure the local installed copy to `5 minutes` after deployment.
- Use the existing Silero VAD result, not an RMS/volume threshold.
- Speech from either the microphone or non-excluded system audio resets the inactivity timer.
- Excluded Spotify audio must not reset the timer.
- At the threshold, pause through the existing recording pause semantics.
- Emit pause reason `silence` so the overlay and main UI can explain the state.
- Manual pause reason must remain distinct from silence-triggered pause.
- Manual resume resets the inactivity timer to the resume time.
- A manually paused recording must never be resumed automatically.
- Bind the monitor to the per-recording `Arc<RecordingState>`. A stale task from a prior recording must not affect a later recording.

### No Auto-Resume in V1

Resume is manual in V1.

Current pause behavior discards all input, so automatic resume cannot hear returning speech. A correct future auto-resume requires:

- A separate wake-only VAD that remains active while the main pipeline is paused
- About 500 ms of pre-roll to avoid clipping the first resumed words
- Active-timeline/timestamp rebasing so transcript timestamps remain aligned with the shortened recording
- Reason-aware pause behavior so manual pauses remain manual

Do not implement auto-resume as a quick change to the current VAD. It risks clipped words and transcript/audio misalignment.

### Recording Overlay

- Show whenever a recording session is active, including while paused.
- Hide after recording stops.
- Compact target size: approximately `210 x 44` logical pixels.
- Recording state: red indicator, `Recording`, active duration.
- Paused state: orange indicator, `Paused`, active duration.
- Include one pause/resume icon control.
- Do not add a stop control in V1. The tray and main app already provide stop, and their stop/post-processing flow is duplicated and should be centralized before another caller is added.
- Make the overlay draggable.
- Keep it always on top and visible on all macOS Spaces.
- Start it unfocused so it does not interrupt Google Meet controls.
- Use Tauri content protection so it is omitted from screen capture where macOS honors that setting. Verify this live; do not assume every screen-sharing mode respects it.
- Use an opaque, restrained surface first. Transparency is not required.
- Create it hidden during app setup so showing it does not add recording-start latency or steal focus.
- Keep it independent of the main window so closing/hiding the main window does not hide the recording indicator.

## Relevant Architecture

### Backend Recording State

- `frontend/src-tauri/src/audio/recording_state.rs`
  - `RecordingState` owns recording, pause, and duration state.
  - `pause_recording()` and `resume_recording()` already implement core semantics.
  - `send_audio_chunk()` currently discards every chunk while paused.
- Extend state with a small `PauseReason` enum and last-speech activity timestamp.
- Reset pause reason and speech activity at recording start/stop.

### VAD and Audio Pipeline

- `frontend/src-tauri/src/audio/vad.rs`
  - `ContinuousVadProcessor` wraps Silero VAD.
  - It currently keeps `in_speech` private.
- `frontend/src-tauri/src/audio/pipeline.rs`
  - Mixed microphone and remaining system audio is sent through VAD before transcription.
  - Saved audio receives the mixed stream.
- Expose a minimal speech-active/transition signal from `ContinuousVadProcessor` and call `RecordingState::mark_speech_activity()` directly from the pipeline.
- Do not use the existing frontend `speech-detected` event for inactivity timing. It is emitted only on first detected speech for UX feedback.

### Silence Monitor

- Prefer one small module, such as `frontend/src-tauri/src/audio/silence_monitor.rs`.
- Keep the decision logic as a pure, testable state machine using durations supplied by the caller.
- Runtime loop can check once per second.
- It should hold the per-session state reference and exit when that state is no longer recording.
- On auto-pause, update state, emit `recording-paused` with `reason: "silence"`, update the tray, and optionally send one system notification.
- Centralize pause event/tray emission so manual and automatic pause cannot drift.

### Commands and Frontend State

- `frontend/src-tauri/src/audio/recording_commands.rs`
  - Existing pause/resume commands emit events and update the tray.
  - `get_recording_state()` exposes recording and duration state.
- Add `pause_reason` to the state response and event payload without breaking existing listeners.
- `frontend/src/services/recordingService.ts` and `frontend/src/contexts/RecordingStateContext.tsx` should understand the optional pause reason.

### Preferences

- `frontend/src-tauri/src/audio/recording_preferences.rs`
- `frontend/src/components/RecordingSettings.tsx`
- Add backward-compatible serialized fields, for example:
  - `auto_pause_after_silence_seconds: Option<u64>`
  - `show_recording_overlay: bool`
- Use explicit Serde defaults so existing `recording_preferences.json` files continue to load.
- Add the controls to Recording Settings near notification/recording behavior, not inside system-audio exclusions.

### Overlay Window

- Locked Tauri version is `2.11.1` in `Cargo.lock`.
- This version provides `always_on_top`, `visible_on_all_workspaces`, `focusable`, `focused`, `decorations`, `content_protected`, and `shadow` on `WebviewWindowBuilder`.
- Current `frontend/src-tauri/tauri.conf.json` grants capabilities only to window label `main`. Add an overlay capability with only the event/window access it needs.
- Add a small Rust overlay module that creates, positions, shows, and hides window label `recording-overlay`.
- The current Next root layout mounts the full Meetily provider tree for every route. Do not mount that tree inside the overlay WebView.
- Add a minimal overlay route/shell and branch the root layout for it, or use an equivalently lightweight static entry.
- Overlay state should use an initial `get_recording_state`, recording lifecycle events, and low-frequency reconciliation. Avoid duplicating the main window's 500 ms polling plus all app providers.

## Suggested Implementation Order

1. Add backward-compatible preferences and Recording Settings controls.
2. Add pause reason and last-speech activity to `RecordingState`.
3. Expose current speech activity from VAD and mark it from the mixed pipeline.
4. Add the pure silence policy plus per-recording monitor and tests.
5. Reuse one pause transition helper for manual and silence-triggered pauses.
6. Add the hidden Tauri overlay window and limited capability.
7. Add the lightweight overlay UI and lifecycle synchronization.
8. Build, run the full Rust suite, reinstall the app bundle, and perform live Google Meet/Spotify tests.

## Verification

### Automated

- Unit-test the silence policy with controlled time. Do not wait real minutes in tests.
- Cover disabled behavior, threshold boundary, speech reset, resume reset, manual pause precedence, stop cancellation, and stale-session isolation.
- Add focused `RecordingState` tests for pause reasons and duration semantics.
- Run `cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib` with the external-drive toolchain environment.
- Run `pnpm build` from `frontend`.
- The prior baseline was `188 passed, 0 failed, 3 ignored`; the current count may be higher after new tests.

### Live macOS

- Temporarily use a short threshold only for testing; do not ship the short value.
- Start native Spotify, verify it is excluded, and leave the actual meeting sources silent.
- Confirm Spotify playback does not prevent auto-pause.
- Play or speak meeting speech before the threshold and confirm it resets the timer.
- Confirm the recording pauses once, reports `silence`, and remains paused until manually resumed.
- Confirm resume does not immediately pause again.
- Confirm saved audio and transcript remain aligned around a manual resume.
- Confirm the overlay shows on start, remains while the main window is hidden, changes color/state on pause/resume, and hides on stop.
- Check the overlay across Spaces and during full-screen use.
- Test Google Meet screen sharing to see whether content protection hides the overlay.
- Compare Google Meet lobby responsiveness and Meetily idle CPU before and after. The overlay must not reintroduce the prior lobby slowdown.
- Confirm all app data, models, recordings, build outputs, and installer artifacts remain on `/Volumes/Misc`.

## External-Drive Build Environment

Keep development storage off the internal drive:

```sh
export RUSTUP_HOME=/Volumes/Misc/Meetily/DevTools/rustup
export CARGO_HOME=/Volumes/Misc/Meetily/DevTools/cargo
export CARGO_TARGET_DIR=/Volumes/Misc/Meetily/Build/cargo-target
export XDG_CACHE_HOME=/Volumes/Misc/Meetily/DevTools/cache/xdg
export TMPDIR=/Volumes/Misc/Meetily/Build/tmp
export PNPM_HOME=/Volumes/Misc/Meetily/DevTools/pnpm/home
export PNPM_STORE_PATH=/Volumes/Misc/Meetily/DevTools/pnpm/store
export COREPACK_HOME=/Volumes/Misc/Meetily/DevTools/corepack
export npm_config_cache=/Volumes/Misc/Meetily/DevTools/cache/npm
export PATH=/Volumes/Misc/Meetily/DevTools/cmake/CMake.app/Contents/bin:/Volumes/Misc/Meetily/DevTools/cargo/bin:/Volumes/Misc/Meetily/DevTools/pnpm/home:$PATH
```

Release builds currently produce the `.app` and DMG but then fail updater signing when `TAURI_SIGNING_PRIVATE_KEY` is absent. Treat a successfully produced app bundle separately from that expected updater-signing failure.

## Guardrails

- Do not implement auto-resume in the first version.
- Do not use raw RMS as the definition of speech inactivity.
- Do not hard-code Spotify behavior into silence detection.
- Do not unload Parakeet on stop or add duplicate model validation before recording.
- Do not hold the global `RECORDING_MANAGER` mutex across an `await`.
- Do not add a second heavy frontend app tree for the overlay.
- Do not commit build output, installers, models, recordings, or app data.
- Preserve unrelated user changes if the worktree becomes dirty.
- Commit on the existing feature branch; push only if the implementing task explicitly authorizes it.

## Suggested Skills

- `$cjl-requirements`: create or synchronize a durable `002` feature contract before implementation if desired.
- `$tdd`: build the silence policy using red-green-refactor and controlled time.
- `$grug`: keep pause reasons, the monitor, and overlay lifecycle small and understandable.
- `$simplify-and-test-code`: final review of all touched code and proof of important paths.
- `$diagnose`: use only if live Google Meet performance, audio continuity, or macOS window behavior regresses.

## Completion Definition

The work is complete when the configured local app pauses after five minutes without non-excluded speech, never counts excluded Spotify audio as activity, requires manual resume, displays the recording overlay reliably, preserves transcript/audio continuity, does not degrade Google Meet responsiveness, passes builds/tests, and is reinstalled at `/Volumes/Misc/Applications/meetily.app`.

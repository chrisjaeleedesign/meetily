# REQ-001 Native App System-Audio Exclusion Requirements

Parent: `../project-requirements.md`
Project Version: V1
Status: Ready for goal
Last Updated: 2026-06-22

## Goal

Allow the user to exclude the native Spotify app from Meetily's system-audio capture while Spotify remains audible locally and other meeting/system audio remains recordable and transcribable.

## In Scope

- macOS only.
- Native app-level exclusion for system audio capture.
- Spotify as the first proven app, using its discovered root bundle identifier `com.spotify.client`.
- Preserve the user's Misc-backed install posture while implementing and testing the feature.
- A recording preference for excluded system-audio apps, persisted across app restarts.
- A settings UI that lets the user add or remove currently-audible native apps from the exclusion list.
- Backend discovery of currently-audible apps with enough stable metadata to save an exclusion:
  - display name;
  - root bundle identifier when available;
  - process bundle identifier when available;
  - current process ID for runtime tap construction;
  - Core Audio process object ID for runtime tap construction;
  - whether the app is currently producing output.
- Recording startup behavior that resolves saved app identities to currently-running Core Audio process object IDs and passes those object IDs to the Core Audio global tap exclusion list.
- Default empty exclusion list that preserves current all-system-audio capture behavior.
- Graceful no-op behavior when an excluded app is not running or not producing output.

## Out Of Scope

- Spotify web player inside Chrome, Safari, Arc, or another browser.
- Per-tab, per-window, per-track, per-device, or per-speaker separation.
- Post-processing removal of music from an already-recorded mixed audio file.
- Mobile behavior.
- Capturing only selected apps through an include-list.
- Changing exclusions during an active recording unless the implementation can do it safely without destabilizing capture. V1 may require stopping and starting a new recording.
- Notarized release packaging. A local development build is enough for implementation proof.
- Moving Apple-managed system tooling, such as Xcode or Command Line Tools, off the internal drive.

## Workflow

1. User opens recording settings.
2. Meetily lists currently-audible native apps, including Spotify when Spotify is playing.
3. User marks Spotify as excluded from recording.
4. Meetily saves Spotify's app identity.
5. User starts a Meetily recording while Spotify is playing and a meeting/audio source is also producing sound.
6. Meetily captures microphone and non-excluded system audio.
7. Spotify remains audible to the user but is absent from the Meetily recording and transcript input.
8. If the meeting/audio source contains speech, live transcription continues normally.

## Runtime / Data Posture

- Store excluded apps in the existing `recording_preferences.json` store unless implementation finds a materially safer local store.
- Add a backward-compatible `#[serde(default)]` field to `RecordingPreferences`; old preference files must still deserialize.
- Keep `recording_preferences.json` under `/Volumes/Misc/Meetily/AppData/com.meetily.ai` through the existing app-data symlink.
- Persist stable app identity, at minimum root bundle identifier and display name.
- Do not persist process IDs.
- At system-audio capture start, resolve saved root bundle identifiers to all matching running Core Audio output process object IDs.
- For V1 matching must at least support exact bundle ID matching. Bundle-family matching for helper IDs is allowed and preferred if implemented conservatively.
- If a matching app has helper processes, exclude every matching audio-output process object ID that maps to the same app identity.
- If an app has no bundle identifier, it may be displayed as unsupported for persistent exclusion.
- Do not rely on `CATapDescription.bundleIDs` or process restore for V1; those wrapper methods are macOS 26-only in the pinned `cidre` source. Use process object IDs at recording start.

## Install / Storage Posture

- Final app bundle target: `/Volumes/Misc/Applications/meetily.app`.
- Runtime app data target: `/Volumes/Misc/Meetily/AppData/com.meetily.ai`.
- Internal app data path: `~/Library/Application Support/com.meetily.ai` must be a symlink to the Misc app data target.
- Recording target: `/Volumes/Misc/Meetily/Recordings`.
- Installer/archive target: `/Volumes/Misc/Meetily/Installers`.
- Implementation source/build target: `/Volumes/Misc/Meetily/Source/meetily` or another clearly named directory under `/Volumes/Misc/Meetily/`.
- Rust/Cargo state, if installed for this goal:
  - `RUSTUP_HOME=/Volumes/Misc/Meetily/DevTools/rustup`;
  - `CARGO_HOME=/Volumes/Misc/Meetily/DevTools/cargo`;
  - Rust build output should use a target dir under `/Volumes/Misc/Meetily/Build/` or the Misc source checkout.
- Node/pnpm dependency state, if installed for this goal:
  - `node_modules` should be in the Misc source checkout;
  - pnpm store/cache should be under `/Volumes/Misc/Meetily/DevTools/pnpm`;
  - Next/Tauri build outputs should be under the Misc source checkout or `/Volumes/Misc/Meetily/Build/`.
- Do not create large Meetily-owned directories under `~/Library`, `~/Movies`, `~/Documents`, `~/.cargo`, `~/.rustup`, `~/Library/Caches`, or the internal-drive Codex workspace except as temporary small text docs/probes.

## Behavior That Must Survive

- Existing microphone capture still works.
- Existing system audio capture still works when no apps are excluded.
- Existing Parakeet transcription path is unchanged.
- Existing recording save preferences are not broken.
- The app still handles denied or missing macOS system-audio permission as it does today.
- Saved recordings and live transcription both consume the same mixed audio pipeline behavior as before, except excluded system-audio sources are absent before mixing.
- Existing Misc storage redirection remains intact: app data, models, database, and recordings stay on `/Volumes/Misc`.

## Edge Cases / Failure Behavior

- Excluded app not running: recording starts normally and logs that no matching process was excluded.
- Excluded app starts after recording begins: V1 may leave it uncaptured only after the next recording start, unless the implementation explicitly rebuilds the tap safely.
- Meeting and music come from the same app process: Meetily cannot separate them in V1; excluding that app would exclude both.
- Spotify helper process produces audio without a direct main-app PID match: implementation should match helper bundle IDs under `com.spotify.client.*` if they are reported by Core Audio as running output. Current live probe did not show this.
- Core Audio tap creation fails with exclusions: fall back to failing the recording start with a clear error rather than silently recording excluded apps.
- System audio backend is not Core Audio: V1 may show the exclusion UI disabled or state that source exclusion requires Core Audio; do not pretend exclusion works with another backend.

## Implementation Constraints

- Current Meetily code creates the system audio tap with `with_mono_global_tap_excluding_processes(&cidre::ns::Array::new())`; V1 must replace the empty list with the resolved excluded processes.
- Current system audio detection only returns display names; V1 needs structured app metadata.
- Do not hard-code Spotify-only behavior. Spotify is the proof case, not the architecture.
- Apply the same exclusion path anywhere Meetily constructs `CoreAudioCapture`.
- Prefer bundle identifier persistence because Apple exposes process restore semantics around bundle identity and PIDs are not stable.
- In the pinned `cidre` source, `TapDesc::with_mono_global_tap_excluding_processes` accepts `&ns::Array<ns::Number>`, where each number holds a Core Audio process object ID.
- In the pinned `cidre` source, `ca::Process` is transparent over `ca::Obj(pub u32)`, exposes `pid()`, `bundle_id()`, `is_running_output()`, and `Process::list()`.
- The implementation should build the excluded-process array by mapping matching `ca::Process` values to `ns::Number::with_u32(process.0.0)`, then `ns::Array::from_slice_retained(&numbers)`.
- Thread exclusion data through the active recording path:
  - `recording_commands.rs` loads full recording preferences;
  - `RecordingManager::start_recording` receives resolved or raw exclusion settings;
  - `AudioStreamManager::start_streams` passes exclusions only to system streams;
  - `AudioStream::create_core_audio_stream` passes exclusions to `CoreAudioCapture`;
  - `CoreAudioCapture::new` accepts excluded process object IDs and uses them in the tap description.
- Also update reconnect behavior for system audio in `RecordingManager::attempt_device_reconnect`; re-created system streams must retain the same exclusions.
- Permission-probe calls to `CoreAudioCapture::new()` may use an empty exclusion list.
- `capture/system.rs` and `system_audio_commands.rs` are not the main recording path but should either use the same constructor with empty exclusions or expose exclusions if still user-facing.

## Expected Data Shape

Backend preference shape:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExcludedSystemAudioApp {
    pub root_bundle_id: String,
    pub display_name: String,
}
```

Backend discovery payload shape:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct SystemAudioSourceApp {
    pub display_name: String,
    pub root_bundle_id: Option<String>,
    pub process_bundle_id: Option<String>,
    pub pid: i32,
    pub process_object_id: u32,
    pub is_running_output: bool,
    pub can_exclude: bool,
}
```

Frontend preference shape must mirror `excluded_system_audio_apps` and keep old fields unchanged.

## Required Commands / UI

- Add a Tauri command that returns structured currently-audible system audio apps, not just names.
- Reuse `get_recording_preferences` and `set_recording_preferences` for persisted exclusions unless that proves awkward.
- Add a compact settings control under recording/system audio settings:
  - shows currently audible apps;
  - lets Spotify be toggled into the exclusion list;
  - shows saved excluded apps even if currently closed;
  - disables unsupported apps without bundle identity.

## Ready Means

- A user can save Spotify as excluded from system audio recording.
- After app restart, Spotify still appears as excluded.
- With native Spotify playing before recording starts, Spotify audio is not present in the saved recording or the live transcript input.
- A separate meeting/audio app remains present in the saved recording.
- Live transcript is driven by the meeting/audio source and not by Spotify music.
- Starting a recording with Spotify excluded but closed does not fail.
- Clearing the exclusion restores current global system-audio capture.
- Core Audio process IDs are resolved at recording start, not persisted.
- Existing preference files without `excluded_system_audio_apps` continue to load.
- System-audio reconnect keeps exclusions applied.
- App bundle, app data, models, recordings, source checkout/build output, package caches, and optional Rust/Cargo toolchain state are under `/Volumes/Misc`.
- Internal-drive Meetily paths are symlinks or small source-control/docs/probe files only.
- Manual proof is recorded with the exact apps used, because fully automated validation of mixed app audio is likely fragile.

## Proof / Tests

- Unit or integration test preference serialization for excluded app identity.
- Unit test the resolver boundary with fake app/process records if the code can be structured without touching Core Audio.
- Compile/typecheck the Tauri Rust backend after changes.
- Build or run the app locally. If `cargo` is absent, install or locate a Rust toolchain before proof; if that is not possible, record proof as blocked.
- Before dependency install/build, ensure the active implementation checkout and heavy caches are under `/Volumes/Misc`.
- Manual macOS smoke test:
  - native Spotify playing;
  - separate meeting or controlled speech audio source playing;
  - Spotify excluded;
  - recording saved;
  - live transcript reviewed for absence of Spotify-derived words and presence of the speech source;
  - recording reviewed for absence of Spotify and presence of the meeting source.
- Storage smoke test:
  - verify `/Volumes/Misc/Applications/meetily.app` exists for the tested app bundle or clearly record that a dev runner was used;
  - verify `~/Library/Application Support/com.meetily.ai` points to `/Volumes/Misc/Meetily/AppData/com.meetily.ai`;
  - verify Meetily model/database files remain under `/Volumes/Misc/Meetily/AppData/com.meetily.ai`;
  - verify recordings land under `/Volumes/Misc/Meetily/Recordings`;
  - verify no new large Meetily-owned `target`, `node_modules`, Cargo, Rustup, model, database, or recording directories were created on the internal drive.

## Risks / Open Questions

- Spotify uses helper processes, but live Core Audio probing while Spotify was running showed only the main `com.spotify.client` process as running output. Implementation still must prove the excluded process object is the one Core Audio reports as running output.
- Some Core Audio tap behavior is sparsely documented and may vary by macOS version or output routing.
- If the meeting source and excluded source are inside the same browser process, this feature cannot solve it.
- This local machine did not have `cargo` on PATH during requirement exploration, so a later implementation goal may need to install or locate a Rust toolchain before proving the build.
- Installing Rust/Cargo or package dependencies without redirecting their homes/caches to `/Volumes/Misc` would violate the storage requirement.

## Evidence Notes

- `frontend/src-tauri/src/audio/capture/core_audio.rs` currently creates a mono global tap with `with_mono_global_tap_excluding_processes(&cidre::ns::Array::new())`, so no app processes are excluded today.
- `frontend/src-tauri/src/audio/system_detector.rs` already enumerates Core Audio processes that are running output, then maps PID to `RunningApp`, but currently returns only display names.
- `frontend/src-tauri/src/audio/stream.rs` creates `CoreAudioCapture::new()` without any recording preference input, so exclusions need to be threaded into capture creation.
- `frontend/src-tauri/src/audio/recording_commands.rs` already loads recording preferences before recording start, but only keeps `auto_save`, preferred microphone, and preferred system device in the default-device path.
- `frontend/src-tauri/src/audio/recording_manager.rs` starts streams through `AudioStreamManager::start_streams`; system-audio reconnect also starts streams there and must keep exclusions.
- Apple's `CATapDescription` docs describe process-based tap descriptions and the mono global tap initializer takes an array of process object IDs to exclude.
- Pinned `cidre` source at `a9587fa1d4ff6f0d5d082849ae7c62880fd739f7` exposes the needed V1 process-ID path. It also exposes bundle-ID restore methods, but marks them macOS 26-only, so V1 should not depend on them.
- Local verification found native Spotify's bundle identifier as `com.spotify.client`.
- Local process listing showed Spotify helper bundle IDs including `com.spotify.client.helper`, `com.spotify.client.helper.renderer`, and `com.spotify.client.helper.gpu`.
- Live Core Audio probe while Spotify was running reported one Spotify output process: object ID `159`, PID `96659`, `running_output=1`, process bundle ID `com.spotify.client`, running app bundle ID `com.spotify.client`, name `Spotify`.
- Prior Meetily setup put the app bundle at `/Volumes/Misc/Applications/meetily.app`, app data at `/Volumes/Misc/Meetily/AppData/com.meetily.ai`, recordings at `/Volumes/Misc/Meetily/Recordings`, and installers at `/Volumes/Misc/Meetily/Installers`.

## Notes / Decisions

- V1 is exclusion-list only, not a full audio source mixer.
- V1 should prefer "changes apply next recording" unless tap rebuild during active recording is proven safe.
- The V1 UI should show saved excluded apps plus currently-audible apps.
- The user case uses the native Spotify app, so app-level exclusion is a reasonable first version.
- For current Spotify, excluding the main Core Audio process object for `com.spotify.client` should be sufficient; helper matching remains a defensive implementation detail.
- This requirement is goal-ready for source implementation, but it does not require a notarized/released DMG.
- Everything Meetily-owned that is installed, downloaded, built, cached, or generated for this goal should live on `/Volumes/Misc`.

## Change Notes

- 2026-06-22: Created initial requirement from code exploration, pinned `cidre` source inspection, Apple Core Audio headers, and live Spotify/Core Audio probing.
- 2026-06-22: Added Misc-backed app/runtime/source/build/cache/toolchain storage constraints.

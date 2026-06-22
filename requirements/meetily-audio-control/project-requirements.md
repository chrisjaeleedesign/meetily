# Meetily Audio Control Requirements

Status: Ready for goal
Last Updated: 2026-06-22

## Version Map

- V0: Meetily records microphone plus all system audio through the existing macOS Core Audio global tap.
- V1: Add macOS native-app exclusion for system audio capture, starting with native Spotify, and prove transcription excludes Spotify audio.

## Active Version

### Goal

Let a user hear music from the native Spotify app while Meetily records a meeting, without Spotify audio entering Meetily's system-audio capture, saved recording, or transcript.

### Definitions

- System audio: audio emitted by macOS apps and captured by Meetily's Core Audio tap.
- Source exclusion: a saved setting that prevents selected native macOS apps from contributing audio to Meetily's system-audio capture.
- Native app: a macOS application with a stable bundle identifier, such as Spotify's `com.spotify.client`.
- Meeting app: the app producing the audio the user wants Meetily to capture, such as Zoom, Google Meet in a browser, or Teams.
- Misc install: Meetily-owned app bundles, app data, model files, recordings, installers, source/build outputs, package caches, and local toolchain state live under `/Volumes/Misc`, with only small compatibility symlinks on the internal drive.

### Current Assumptions

- The first target platform is macOS, because Meetily's process tap implementation is macOS-specific.
- The immediate user case is the native Spotify app, not Spotify in a browser tab.
- Spotify is installed as `com.spotify.client` on this machine, with helper bundle IDs under `com.spotify.client.helper*`; implementation should discover and persist app identity rather than hard-code Spotify-only behavior.
- Live Core Audio probing while Spotify was running reported Spotify's active output process as the main app process, not a helper: object ID `159`, PID `96659`, bundle `com.spotify.client`.
- Meetily currently creates a mono global Core Audio tap excluding an empty process list.
- Apple's Core Audio tap APIs include global tap descriptions that can exclude processes.
- The pinned `cidre` wrapper exposes the needed V1 primitives: Core Audio process listing, process object IDs, process bundle IDs, process output state, and mono global tap exclusion by process object ID.
- A local development proof requires a Rust/Cargo toolchain; `cargo` was not available on this machine during requirements exploration.
- The user's storage requirement is that Meetily-owned install and implementation artifacts should live on `/Volumes/Misc`, not the main Mac mini drive.
- Existing system-provided developer tools, such as Xcode or Command Line Tools, may remain in their normal system locations; do not duplicate or move Apple-managed tools just for this project.

### Current Postulates

- Persist app bundle identity, not process IDs. Process IDs change every launch.
- Resolve saved bundle identity to active Core Audio process object IDs when starting system audio capture.
- Treat a selected app as an app bundle family where practical, but the current live Spotify proof only required excluding the exact `com.spotify.client` Core Audio process object.
- Apply exclusions only to system audio. Microphone capture must not be affected.
- Default behavior must remain unchanged when no exclusions are configured.
- Store the installed app at `/Volumes/Misc/Applications/meetily.app`.
- Store Meetily runtime data at `/Volumes/Misc/Meetily/AppData/com.meetily.ai`, with `~/Library/Application Support/com.meetily.ai` as a symlink only.
- Store recordings at `/Volumes/Misc/Meetily/Recordings`.
- Store installers, local source checkout/build workspace, dependency caches, and optional Rust/Cargo toolchain state under `/Volumes/Misc/Meetily/`.

### Scope Summary

V1 is one feature: app-level exclusion for native macOS apps in the system audio stream. It is not per-tab, per-window, per-track, or mobile audio routing.

V1 implementation must also preserve the Misc-backed install posture: no large Meetily-owned model, recording, package-cache, build, or toolchain directories should be created on the internal drive.

### Feature Requirements

- REQ-001: Native app system-audio exclusion - ready for goal. See `features/001-REQ-native-app-system-audio-exclusion.md`.

### Ready Means

- `REQ-001` is specific enough for `/goal implement this`.
- Important non-scope is explicit, especially browser tabs and dynamic mid-recording changes.
- The implementation can be verified with native Spotify playing while a separate meeting/audio source remains captured and transcribed.
- The installed/tested app, app data, recordings, and implementation/build artifacts are on `/Volumes/Misc`, with internal-drive paths limited to symlinks or existing system tools.

### Open Questions

- None blocking. The V1 UI should show saved excluded apps plus currently-audible apps.
- If `cargo` is absent during implementation, the implementation goal should install or locate a Rust toolchain with `RUSTUP_HOME` and `CARGO_HOME` under `/Volumes/Misc/Meetily/DevTools`; if that is not possible, source changes may still be completed but build proof must be marked blocked.

## Backlog

- Include-list mode for users who want to capture only selected meeting apps.
- Browser-tab-level source separation, if a practical browser or OS API exists.
- Dynamic tap rebuild while recording when app exclusions change.

## Change Notes

- 2026-06-22: Created initial project requirements for native Spotify/system-audio exclusion.
- 2026-06-22: Added Misc-backed install and implementation storage requirement.

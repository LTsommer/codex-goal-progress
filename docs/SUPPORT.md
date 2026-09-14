# Support

This page lists the published platform and runtime surfaces.

## Platform

| Surface | Current value |
|---|---|
| Goal Progress release | v0.3.7 |
| Operating system | macOS |
| Architecture | Apple Silicon arm64 |
| Application | Codex Desktop |
| Helper runtime | Node SEA v24.19.0 |
| Goal Contract | schema v2 |
| IPC | protocol v4 |
| Renderer UI intent | protocol v2 |

## Linux source support

This checkout also supports Linux x86_64 with Node.js 22.12+, a systemd user manager,
and the verified packaged ChatGPT/Codex application layout. It does not provide a Linux
desktop application or a prebuilt Linux Helper release. See [Linux](LINUX.md) for
installation and separate core/UI acceptance. Linux native Goal versions remain unverified
until real-client acceptance; shared DOM probes do not establish compatibility by themselves.

## Interface adaptation

| Capability | Behavior |
|---|---|
| Theme | Reads live Codex light, dark, system, surface, foreground, and accent tokens |
| Font size | Reads the live Codex font token and derives layout continuously |
| Locale | Reads the live Codex document locale and selects a matching built-in catalog |
| Locale fallback | Uses English UI copy and locale-aware number formatting |
| Text direction | Reads live LTR or RTL direction |
| Placement | Native, managed fallback, fixed, and draggable floating views |
| Motion | Default motion, explicit pause, and `prefers-reduced-motion` |

Font regression tests cover 11, 14, 16, and 20 px.

## Installation results

A healthy installation returns:

```text
INSTALL_OK or INSTALL_ALREADY_CURRENT
DOCTOR_OK
VERIFY_OK
```

Use `nextStep` from the JSON result when a command requests another action.

## Product roadmap

The current roadmap includes:

- Developer ID signing and Apple notarization
- a native Goal-row activation shortcut
- an end-user checklist editor
- project checklist file watching
- expanded Token and context details
- additional platform packages

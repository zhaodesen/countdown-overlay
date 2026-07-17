# Bang — Countdown Overlay

A cross-platform desktop countdown overlay with animated themes, scheduled tasks, and offline synthesized sound effects.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Highlights

- Schedule one-time or weekly recurring countdowns
- Show a transparent, always-on-top, click-through overlay for the final five seconds
- Choose from 11 visual themes, including cyberpunk, ink, fire, ice, stars, arcade, and smoke
- Render animation with GSAP, Canvas 2D, and a WebGL2 fluid simulation fallback chain
- Generate theme-specific sounds with the Web Audio API—no bundled audio files required
- Store tasks and preferences locally
- Display a UTC+8 clock independently of the host time zone

## Tech Stack

Tauri 2 · Rust · TypeScript · Vite · GSAP · Canvas 2D · WebGL2 · Web Audio

## Getting Started

### Prerequisites

- Node.js and npm
- Rust stable
- Platform-specific Tauri prerequisites

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Architecture

```text
src/shared/    # Task types, time calculations, storage, theme metadata
src/settings/  # Scheduler and task-management window
src/overlay/   # Countdown engine, themes, particles, backgrounds, and sound
src-tauri/     # Native window creation and Tauri configuration
```

The settings window polls upcoming tasks. Five seconds before a target time, Rust creates a borderless transparent window sized to the primary display. The overlay timeline then coordinates each number, visual effects, particles, and sound before closing automatically.

## Platform Notes

- macOS 12+ on Intel and Apple Silicon
- Windows 10/11 x64
- Multi-display behavior and older operating systems are not currently guaranteed

## Contributing

Keep new themes isolated behind the existing theme interfaces and prefer transform/opacity animation to layout-changing properties.

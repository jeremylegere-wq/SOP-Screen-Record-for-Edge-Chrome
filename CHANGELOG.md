# Changelog

All notable changes to Step Recorder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

While preparing a release, add bullets under **Unreleased** (use the headings Added, Changed, Fixed,
Removed, Security as needed). `npm run version:set -- X.Y.Z` moves them into a dated section.

## Unreleased

### Added
- Record clicks, typed text, dropdown choices and Enter presses into a step-by-step guide with a screenshot per step and the clicked element highlighted.
- Floating on-page toolbar showing the step count, with Pause, Stop and a "move" button; hidden automatically while a screenshot is taken.
- Keyboard shortcuts: Alt+Shift+R to start/stop, Alt+Shift+P to pause/resume (changeable at `edge://extensions/shortcuts`).
- Guide library: every recording is saved and can be reopened, edited or deleted later.
- Guide editor: edit titles and notes, reorder, delete with Undo, remove a single screenshot, add text-only steps.
- Export a guide as one self-contained HTML file, print or save as PDF, or copy as Markdown.
- Privacy: password and card-like fields are never written into step text and are blurred in screenshots; optional setting to keep typed text out of steps.
- Welcome page on first install.

### Changed
- Extension now asks only for the `storage`, `unlimitedStorage` and `scripting` permissions plus access to http/https pages.

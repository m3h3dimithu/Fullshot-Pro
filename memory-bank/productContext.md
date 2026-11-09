# Product Context: Fullshot Pro

## 1. Why Fullshot Pro Exists
Standard browser screenshot tools often fail on modern web pages because:
1. **Unusual Scrolling Containers**: Modern web applications (e.g., Slack, Notion, Jira, Facebook, dashboards) often fix the `<body>` to `100vh` and scroll internal `<div>` or `<main>` containers. Standard tools take a screenshot of only the top viewport.
2. **Sticky & Fixed Headers Multiplying**: As standard full-page screenshot extensions scroll down, fixed navigation bars get captured repeatedly into every slice, ruining the stitched image.
3. **Heavy Virtualization & Slow Hydration**: Many feeds (Twitter/X, LinkedIn) dynamically load or unmount DOM nodes during scrolling. Fast scrolling causes blank or duplicated frames.
4. **Bloated or Clunky Editors**: Existing extensions either force users through complex cloud logins or provide rudimentary editors lacking smooth drawing, text font resizing, or blur options.
5. **No Clipboard Sharing**: Users frequently just want to paste a screenshot into WhatsApp, Slack, Discord, or an email without saving an intermediate PNG file to disk.

## 2. Problems Fullshot Pro Solves
- **Universal Scrolling Engine**: Intelligently identifies whether the window, an inner container, an open modal/dialog, or a user-specified CSS selector is the active scroll target.
- **Sticky Bar Suppression**: Automatically suppresses sticky/fixed elements after the first slice and restores them once capture completes.
- **Visual Deduplication**: Evaluates slice fingerprints and retry delays to avoid duplicate frames if lazy loading stutters.
- **Right-Click Capture Tool Panel**: Allows quick switching between presets (Article, App / SPA, Modal, Sticky bars, Lazy / slow) without cluttering the primary one-click capture workflow.
- **High-Fidelity Editor**:
  - Independent shape modification (e.g., modifying Circle #1 fill does not affect Circle #2).
  - Dynamic corner handles on text blocks to resize font smoothly on canvas.
  - Live stroke preview bubble hovering outside sidebar controls.
  - Censor tool with pixelation, gaussian-like smoothing, and blackout redaction.
  - Instant `Copy Image` button and `Ctrl+C` keyboard shortcut.
  - Day / Night theme toggle preserving user ergonomics.

## 3. User Experience & Workflow
```
[User on any Web Page]
       │
       ├── Left-Click Icon ──────────► Immediate Full-Page Scroll & Capture
       │                                     │
       └── Right-Click Icon ─────────► [Capture Settings Panel (popup.html)]
                                             │  - Change Layout Preset (SPA/Modal/Article)
                                             │  - Adjust Settle Delay / Overlap
                                             │  - Choose "Capture visible area"
                                             ▼
                                     [Progress Badge: 25%.. 50%.. 100%]
                                             │
                                             ▼
                                 [Editor Opens Beside Active Tab]
                                             │
             ┌───────────────────────────────┴───────────────────────────────┐
             ▼                               ▼                               ▼
    [Annotate / Markup]             [Crop / Blur / Censor]          [Instant Output]
    • Smooth Pen / Highlighter      • Corner-handle resize          • Copy Image (Ctrl+C)
    • Independent Circles/Rects     • Pixelate / Smooth / Redact    • Export PNG
    • Resizable Direct Text         • 100% Crop Undo/Redo           • Export PDF
```

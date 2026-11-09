# Fullshot Pro

Chrome/Edge Manifest V3 extension that captures a **full-page screenshot**, stitches the scroll slices, and opens a local editor for annotate, crop, copy, PNG, and PDF.

Left-click the toolbar icon to capture. Right-click it for the capture tool panel (pace, page setup, visible area). The badge shows progress, then a new tab opens the editor.

## Features

- Full-page capture with automatic scroll and stitch
- Left-click captures immediately; right-click opens the capture tool panel
- Tool panel for pace, scroll target, overlap, and overlay options
- Layout presets for articles, SPAs, modals, sticky headers, and lazy pages
- Custom CSS selector when a site uses an unusual scroll container
- Popup/modal and inner-container scroll when the page itself does not scroll
- Hides repeating sticky/fixed bars so they are not baked into every slice
- Editor tools: select, crop, draw, highlight, rectangle, circle, arrow, text, censor/blur
- Undo/redo, zoom, light/dark theme
- Copy image, export PNG, export PDF

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`fullshot-pro`)

The toolbar icon must show. If Chrome reports a missing icon, confirm `icons/icon-16.png`, `icons/icon-48.png`, and `icons/icon-128.png` exist.

## Use

1. Open a regular webpage (not `chrome://`, `edge://`, or the Chrome Web Store)
2. Left-click the Fullshot Pro icon to capture the full page
3. Right-click the icon for **Capture settings…** or **Capture visible area**
4. In settings, pick a **page setup** if Auto does not match the site (Article, App / SPA, Modal, Sticky bars, Lazy / slow)
5. Adjust **capture pace** if slices look cut off or duplicated
6. Wait for the percent badge to finish
7. Annotate in the editor, then **Copy Image**, **Export PNG**, or **Export PDF**

Pace and layout settings stay on this device until you reset them.

## Capture tool panel

| Control | When to use it |
| --- | --- |
| Auto / Article / App / SPA / Modal / Sticky / Lazy | Starting point for how the page scrolls |
| Scroll target | Force window, inner container, open modal, or a CSS selector |
| Wait after each scroll | Main pace control for lazy images and virtual lists |
| Slice overlap | Increase if content is missing at stitch seams |
| Hide sticky bars | Turn off if a site’s header is part of the content |
| Wait for infinite / lazy height | Keep on for feeds that grow as you scroll |
| Header / footer crop | Auto, none, or manual pixel insets |

Keyboard shortcuts in the editor:

- `Ctrl/Cmd + Z` undo
- `Ctrl/Cmd + Y` redo
- `Ctrl/Cmd + C` copy image (when no text is selected for copy)
- `Delete` remove the selected annotation
- `Enter` apply crop
- `Esc` cancel crop

Double-click or right-click a tool in the sidebar to open that tool’s settings.

## Project layout

```
fullshot-pro/
├── memory-bank/           AI context & project memory bank
├── manifest.json          Chrome MV3 manifest
├── popup.html             Right-click capture settings panel
├── popup.css              Tool panel styles
├── popup.js               Save settings and start capture
├── capture-settings.js    Defaults, presets, and storage helpers
├── background.js          Capture, storage, open editor
├── content.js             Scroll target, sticky-bar hiding, restore
├── editor.html            Annotation UI
├── editor.js              Stitch, tools, export
├── jspdf.umd.min.js       Local PDF helper (jsPDF 2.5.1)
├── icons/                 Toolbar and store icons
├── PRIVACY.md             Local-processing privacy notes
└── LICENSE                MIT
```

## Permissions

See [PRIVACY.md](PRIVACY.md). Capture stays on-device. Host access is required so the active tab can be captured after you click the icon.

## Limitations

- Chrome/Edge system pages and the Chrome Web Store cannot be captured
- Very long pages are capped (slice count and canvas height) so the browser stays stable
- Some sites with unusual virtualized scroll may still miss or duplicate a slice

## License

MIT. See [LICENSE](LICENSE).

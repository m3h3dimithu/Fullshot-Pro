# System Patterns & Architecture: Fullshot Pro

## 1. System Architecture Overview
Fullshot Pro follows a modular Chrome Manifest V3 architecture with strict separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Chrome Manifest V3                               │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                                  │
          ▼                                                  ▼
┌───────────────────────────┐                      ┌──────────────────────────┐
│  Background Service Worker│                      │ Injected Content Script  │
│      (background.js)      │◄──Message Protocol──►│       (content.js)       │
│                           │                      │                          │
│ • Toolbar click listener  │                      │ • DOM scroll-target scan │
│ • Context menu management │                      │ • Sticky bar suppressor  │
│ • Slice capture & retry   │                      │ • Animation freezer      │
│ • Chunk storage           │                      │ • Scroll executor & wait │
└─────────────┬─────────────┘                      └──────────────────────────┘
              │
              ├─────────────────────────────┐
              ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────────────────────────┐
│   Capture Settings Modal  │ │                 Editor Tab                    │
│(popup.html, css, js)      │ │            (editor.html, editor.js)           │
│                           │ │                                               │
│ • Layout & pace presets   │ │ • Canvas 2D image stitching from storage      │
│ • Settle / Overlap sliders│ │ • Annotation state engine & Bezier curves     │
│ • Stored in chrome.storage│ │ • Per-shape independent style managers        │
│                           │ │ • Direct inline text editor & font scaler     │
│                           │ │ • Censor renderer (pixelate, smooth, redact)  │
│                           │ │ • Full bitmap crop with 100% Undo/Redo        │
│                           │ │ • ClipboardItem writer & jsPDF exporter       │
└───────────────────────────┘ └───────────────────────────────────────────────┘
```

---

## 2. Key Modules and Responsibilities

### A. `manifest.json`
- Declares MV3 compliance, service worker `background.js`, permissions, host permissions `<all_urls>`, and icon definitions.
- Does **not** bind `default_popup` to action directly; instead, single left-click triggers immediate capture, while right-click context menu opens `popup.html` as a standalone settings modal.

### B. `capture-settings.js`
- Shared settings definition module (imported via `importScripts` in `background.js` and included via `<script>` in `popup.html`).
- Defines `FULLSHOT_DEFAULT_SETTINGS`, `FULLSHOT_PACE_PRESETS` (`fast`, `normal`, `slow`, `careful`), and `FULLSHOT_LAYOUT_PRESETS` (`auto`, `article`, `spa`, `modal`, `sticky`, `lazy`).
- Provides sanitized normalization via `clampNumber()`.

### C. `background.js` (Service Worker)
- Manages action clicks, context menus (`Capture settings…`, `Capture visible area`), and capture orchestration.
- **Capture Lifecycle**:
  1. Activates and inspects target tab (skips restricted URLs like `chrome://`, Web Store).
  2. Sets badge text (`0%`).
  3. Sends `init_capture` to `content.js` with active settings.
  4. Calculates slices needed (`viewportHeight`, `totalHeight`, `stepHeight`, `overlapPercent`).
  5. Iteratively requests `scroll_to`, waits for `settleDelayMs`, captures via `captureVisibleTabPng(winId)`, deduplicates visually against previous frame fingerprints, and updates badge (`25%`, `50%`...).
  6. Sends `restore_scroll` to restore page scroll and unhide sticky bars.
  7. Stores `captured_chunks` and `dimensions` into `chrome.storage.local`.
  8. Opens `editor.html` in a tab directly adjacent to the captured tab.

### D. `content.js` (Content Script)
- Inspects DOM for best scroll container (`window`, highest scrollable element with `overflowY: auto|scroll`, or open dialog/modal, or user CSS selector).
- Caches and hides sticky/fixed elements (`position: fixed` or `position: sticky`) on slices after slice 0 to prevent repeating banners.
- Disables transitions/animations temporarily to prevent motion blur during capture.
- Restores original scroll position, styles, and sticky visibility upon completion.

### E. `editor.html` & `editor.js` (Annotation & Export Studio)
- **Canvas Stitching**: Reads slices from `chrome.storage.local`, reconstructs the full-page canvas using recorded vertical slice offsets, and auto-fits zoom to viewport width.
- **Per-Shape Independent Styling**:
  - Each annotation object carries its own `shapeFill` (`none`, `semi`/Tint, `solid`), `color`, `width`, `fontSize`, etc.
  - Setting modal for shapes provides target selector buttons (e.g., `Circle #1`, `Circle #2`) so changing one circle does not modify other circles.
- **Direct Canvas Text Editing & Corner Scaling**:
  - Double-click or click with Text tool creates inline auto-resizing textarea.
  - Commits text as an annotation with calculated bounding box (`getTextBounds`).
  - When selected, text annotations display 4 corner handles (`tl`, `tr`, `br`, `bl`) that scale font size smoothly and symmetrically from the opposite corner.
  - Synchronizes with sidebar slider dynamically labeled "Text Size".
- **Live Stroke Preview Bubble**:
  - Positioned outside `#sidebar` in `#mainWorkspace` (`z-index: 1000`) to avoid being clipped by sidebar overflow.
  - Displays actual brush thickness, color, and highlighter translucency in real-time.
- **Silky Smooth Bezier Drawing**:
  - Freehand pencil and highlighter strokes connect coordinate points using midpoint quadratic Bezier curves (`ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)`).
- **Undo/Redo with Full Crop Restoration**:
  - `saveToHistory(isCrop = false)` records annotations array.
  - When `isCrop: true`, it saves an offscreen clone of `originalCanvas` along with width/height dimensions.
  - `undo()` and `redo()` swap back the full bitmap and adjust annotation coordinate offsets.
- **Copy & Export**:
  - `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])` for instant clipboard copy.
  - Canvas to PNG download.
  - `jspdf.umd.min.js` splits tall canvas into multi-page or single-page A4/Letter PDF.

---

## 3. Communication & Storage Patterns

| Key / Action | Scope | Description |
| --- | --- | --- |
| `capture_settings` | `chrome.storage.local` | User preferences for layout, pace, delays, overlap, and overlays |
| `captured_chunks` | `chrome.storage.local` | Array of slice dataURLs or objects `{ dataUrl, y, width, height }` |
| `dimensions` | `chrome.storage.local` | Total width, total height, devicePixelRatio, viewport metrics |
| `fullshot_theme` | `localStorage` | `'dark'` or `'light'` editor theme |
| `init_capture` | Message to tab | Informs `content.js` to inspect page and return dimensions |
| `scroll_to` | Message to tab | Directs `content.js` to scroll target container to `targetY` |
| `restore_scroll` | Message to tab | Reverts page scroll and restores hidden sticky headers |

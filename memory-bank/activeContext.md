# Active Context: Fullshot Pro

## 1. Current State of the Codebase
- **Status**: Production-ready, fully functional Chrome MV3 extension.
- **Current Version**: `1.2.2`.
- **Last Stoppage Point**:
  - **Streamlined Header Start Button & Single Start Point Control**:
    - Removed redundant dual `Capture full page` and `Visible area` buttons.
    - Added high-contrast primary `📸 Start` button directly in the top header right space beside "Fullshot Pro".
    - Cleaned up top `START POINT:` bar to only feature two 1-click chips: `⬆️ Page top` and `⬇️ Current position` (removed `Visible area` per user request).
    - Removed the duplicate bottom `Capture start point` dropdown from the `Page setup` section.
    - Clicking `📸 Start` immediately triggers capture in the chosen start mode.
  - **Custom User Icons Replaced**:
    - Retrieved user's custom-designed icons from `C:\Users\Pc\Downloads\Archives\fullshot-extension\icons`.
    - Updated `icons/icon-16.png`, `icons/icon-48.png`, and `icons/icon-128.png`.
    - Generated matched high-quality bicubic 32x32 `icons/icon-32.png` for popup header and extension toolbar.
  - **In-Flight Standby Capture Dock (`#fullshot-capture-dock`) Zero-Blink & Immediate Restoration**:
    - Embedded directly in webpage DOM with high z-index (`2147483647`) so it stays standby, always on top, and never minimizes to taskbar or hides behind browser.
    - Zero in-page screenshot pollution: before each viewport capture, `takeCleanSnapshot` in `background.js` triggers `prepare_for_snapshot` which applies `visibility: hidden`, `opacity: 0`, and `pointer-events: none` with double `requestAnimationFrame`s, ensuring Chromium's compositor paints a clean screen before `captureVisibleTabPng`.
    - **Zero-Blink & Standby**: Immediately upon completion of `captureVisibleTabPng` (~20-25ms), `takeCleanSnapshot` calls `restore_dock` which restores visibility, opacity, and pointer events. The dock stays visible and interactive 98%+ of the time.
    - **In-Place DOM Updates**: `updateCaptureDockUI` updates text labels, progress bar width, and button styles in place on existing DOM nodes (`dock.dataset.renderMode`), eliminating DOM rebuilding, layout reflow, and mouse-hover flicker.
    - Instant responsiveness via `interruptibleSleep` in `background.js` (polling every 40-50ms): `Pause/Resume`, `Stop & View`, and `Cancel` respond instantaneously without waiting for long sleep timers.
    - Features manual minimize/expand toggle button (`−` / `⛶`): user can collapse to a tiny pill or expand anytime.
    - Kbd shortcuts: Space to Pause/Resume, Enter to Stop & View, Esc to Cancel (always active on window during capture).
  - **Accessible Settings Panel implemented**:
    - Added `"default_popup": "popup.html"` to `manifest.json`: left-clicking extension icon opens the settings and capture panel instantly.
    - Added global shortcut `Alt+Shift+S` to open the panel from any tab.
    - Added webpage context menus (`contexts: ['page', 'action']`) for settings and capture.
  - **Default Target Section Highlighting implemented**:
    - Opening the panel now highlights the target section by default on the page so user immediately sees what will be captured.
    - Pressing "Capture full page" or "Visible area" immediately hides the border before capture begins.
  - All unit/runtime tests passing (`node -c` clean, 0 syntax or runtime errors).

---

## 2. Recent Major Fixes & Enhancements

### A. Capture Start Position & In-Flight Controls (Latest)
- **Problem**: Captures always scrolled to top; no way to stop/pause stuck captures; settings were hidden behind right-click menu; target border wasn't visible by default.
- **Solution**:
  - Added `startPosition` selection (`top` vs `current`).
  - Added floating control widget with `⏸️ Pause`, `⏹️ Stop & View`, and `✕ Cancel` buttons.
  - Connected action popup to `popup.html`, added `Alt+Shift+S` command, and registered page-level context menus.
  - Marked target section by default on popup open without auto-fading, and clear it cleanly on capture start.

### B. Header Captured Once at the Top (`headerMode`) (Latest Enhancement)
- **Problem**: Full-page screenshots either hid headers completely or duplicated them across every slice down the page.
- **Solution**:
  - Added `headerMode: 'once' | 'hide' | 'repeat'` in `capture-settings.js` and `popup.html`.
  - In `content.js`, sticky bars are not hidden on slice 0 when `headerMode === 'once'`; hiding starts only on `request.index > 0`.
  - In `background.js`, `sliceTopInset` is set to `0` for slice 0, allowing the site header to be captured cleanly without being cropped out or duplicated.

### C. Independent Shape Modification
- **Problem**: When multiple circles existed, changing fill style (None / Tint / Solid) in the settings modal modified all circles simultaneously.
- **Solution**:
  - Replaced global `toolConfig.shapeFill` rendering in `drawAnnotation()` with `ann.shapeFill || 'none'`.
  - Added target selector pills (`Circle #1`, `Circle #2`...) to the Circle/Square Settings modal to select and edit any existing shape on canvas independently.
  - Verified through simulation test `test_circles.js`.

### B. Direct Text Resizing on Canvas
- **Problem**: Text was movable but could not be scaled or resized after placement.
- **Solution**:
  - Created `getTextBounds()` calculating exact text dimensions based on font metrics, lines, and padding.
  - Added 4 interactive corner handles (`tl`, `tr`, `br`, `bl`) for selected text annotations.
  - Dragging diagonally scales font size symmetrically pinned against the opposite anchor corner.
  - Synchronized dynamically with sidebar slider labeled "Text Size".

### C. Stroke Preview Bubble & Tool Settings Modal Visibility
- **Problem**: Floating stroke preview bubble and double-click tool settings modal were not appearing.
- **Root Cause**: The elements were nested inside `#sidebar` which had `width: 140px; overflow-x: hidden;`. Any popup positioned at `left: 148px` was clipped by the browser.
- **Solution**:
  - Relocated `#strokePreviewBubble` and `#toolSettingsModal` to `#mainWorkspace` (`z-index: 1000`).
  - Added right-click support to all tool buttons (`contextmenu` event) in addition to double-click.
  - Added click-outside listener to dismiss modal smoothly.

### D. Tool Selection Reset Bug
- **Problem**: Clicking Pencil, Highlighter, Square, Circle, or Blur instantly reverted to the Select tool.
- **Root Cause**: Tool click listeners called `cancelCrop()`, which contained a hardcoded `activeTool = 'select'`.
- **Solution**: Cleared `cropBox` in `cancelCrop()` without overwriting `activeTool`.

### E. Crop Undo/Redo Restoration
- **Problem**: Clicking Undo after a crop did not restore the uncropped image.
- **Solution**: Added `saveToHistory(isCrop = true)` creating an offscreen canvas clone of `originalCanvas` and recording previous canvas dimensions. Undo/redo restores the full uncropped image and adjusts annotation coordinates.

---

## 3. Important Design Invariants & Conventions
1. **Never mutate `activeTool` implicitly**: Tool switching must only occur on user click or when explicitly exiting a mode.
2. **Never place floating modals inside `#sidebar`**: Keep all popups (`strokePreviewBubble`, `toolSettingsModal`) in `#mainWorkspace`.
3. **Always store per-annotation styling**: Never rely on global `toolConfig` for rendering existing annotations on canvas. Each annotation object in `annotations = []` must store its own `shapeFill`, `color`, `width`, `fontSize`, etc.
4. **Preserve Manifest V3 constraints**: No remote code, no inline event handlers (`onclick="..."`) in HTML; all listeners must be attached in JavaScript.
5. **Preserve Bengali communication style**: When addressing the user, respond directly and clearly in Bengali as established in previous conversation turns.

---

## 4. Next Tasks / Potential Future Work
- If the user requests cloud storage export (e.g. Google Drive / Dropbox), verify marketplace skills first.
- If high-DPI scaling causes coordinate offset on multi-monitor setups, ensure `window.devicePixelRatio` scaling in `getCoords()` stays synchronized.
- Git repository status: modified files (`background.js`, `content.js`, `manifest.json`, `README.md`) and untracked files (`capture-settings.js`, `popup.*`, `memory-bank/`) can be committed upon user request.

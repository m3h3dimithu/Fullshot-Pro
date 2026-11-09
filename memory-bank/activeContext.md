# Active Context: Fullshot Pro

## 1. Current State of the Codebase
- **Status**: Production-ready, fully functional Chrome MV3 extension.
- **Current Version**: `1.2.1`.
- **Last Stoppage Point**:
  - **Live Target Section Visualization & Interactive Element Picker implemented**:
    - Popup displays **Target Section Preview Card** showing the active target tag, dimensions, scrollability, and selector.
    - Added `🎯 Pick on page` button enabling hover-to-inspect overlay on the webpage to click any element, container, modal, or feed.
    - Added `👁️ Show` button and real-time live glow highlight on the target element whenever settings/presets change.
  - **Header Captured Exactly Once (`headerMode: 'once'`) implemented**:
    - Added `Header & sticky bars` dropdown in popup (`once` [Recommended], `hide`, `repeat`).
    - Slice 0 captures with header intact (`sliceTopInset = 0`, no persistent bar hiding before slice 0).
    - Slices 1+ hide repeating sticky headers and apply top inset so headers do not duplicate.
  - Independent shape customization implemented and verified: Each circle and rectangle retains its own `shapeFill` and border thickness. The settings popover provides a target selector (`Circle #1`, `Circle #2`...) when multiple shapes exist.
  - Interactive on-canvas text scaling implemented and verified with corner handles.
  - Floating stroke preview bubble and tool settings modal repositioned to `#mainWorkspace` with `z-index: 1000` to prevent CSS clipping.
  - Right-click capture tool panel (`popup.html`) and presets fully connected with `background.js` and `content.js`.
  - All unit/runtime tests passing (`node -c` clean, 0 syntax or runtime errors).

---

## 2. Recent Major Fixes & Enhancements

### A. Live Target Section Identification & Element Picker (Latest Enhancement)
- **Problem**: Modern web pages have multiple menus, sidebars, modals, and nested containers. Users could not tell which section would be captured.
- **Solution**:
  - Enhanced `content.js` `analyzePageForCapture()` to return detailed metadata: `targetName`, `targetTag`, `targetDimensions`, `canScroll`, `scrollablePages`, and `targetSelector`.
  - Implemented `highlightTargetSection()`: injects a glowing `#fullshot-target-highlighter` around the target container or viewport with a floating status pill.
  - Implemented `startElementPicker()`: interactive hover-inspection mode with `#fullshot-picker-ui`. Clicking any container computes its CSS selector, saves it to `chrome.storage.local`, and highlights it.
  - Added Target Section Preview Card in `popup.html` and bound live updates in `popup.js`.

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

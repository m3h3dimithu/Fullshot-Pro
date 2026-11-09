# Tech Context: Fullshot Pro

## 1. Technologies & Runtime
- **Platform**: Chromium Extension Manifest V3 (Chrome, Edge, Brave, Opera).
- **Languages**: Native Vanilla JavaScript (ES2022+), HTML5, CSS3.
- **Rendering Engine**: HTML5 Canvas 2D Context (`CanvasRenderingContext2D`, `OffscreenCanvas`).
- **Dependencies**:
  - `jspdf.umd.min.js` (Local standalone build of jsPDF v2.5.1 for client-side PDF compilation).
  - Zero external npm build or bundling required; extension runs directly as unpacked directory.

## 2. Chrome Extension APIs Used
- `chrome.action`: Toolbar icon, title, click handler, badge text/color updates for capture progress.
- `chrome.contextMenus`: Right-click context menus (`fullshot_open_settings`, `fullshot_capture_visible`).
- `chrome.tabs`: `sendMessage`, `captureVisibleTab`, `query`, `get`, `create`.
- `chrome.windows`: Managing focused browser windows and the standalone settings popup window.
- `chrome.scripting`: Injecting content scripts and styles dynamically into tabs.
- `chrome.storage.local` & `unlimitedStorage`: Storing capture chunks and user settings beyond standard quota limitations.
- `chrome.notifications`: Informing users when attempting to capture restricted system pages.

## 3. Browser & Security Constraints
- **Strict Content Security Policy (MV3)**:
  - No `eval()`, `new Function()`, or remotely hosted code allowed.
  - All scripts are bundled locally (`capture-settings.js`, `jspdf.umd.min.js`, `editor.js`).
- **Restricted Pages**:
  - Browser architecture prohibits content scripts on `chrome://*`, `chrome-extension://*`, `edge://*`, `about:*`, `view-source:*`, and the Chrome Web Store.
  - Handled cleanly via `isRestrictedTabUrl()` with visual notifications.
- **Service Worker Ephemeral Lifecycle**:
  - `background.js` can sleep when idle; persistent state is saved in `chrome.storage.local` rather than in-memory variables.

## 4. Development & Testing Workflow
- **Installation**:
  1. Open `chrome://extensions` or `edge://extensions`.
  2. Toggle **Developer mode** to ON.
  3. Click **Load unpacked** and select `d:\Web Development\Browser Extentions\Fullshot Pro`.
- **Validation**:
  - Syntax check on all scripts:
    ```powershell
    node -c background.js content.js capture-settings.js popup.js editor.js
    ```
  - Test suites: Local scratch test runners in `C:\Users\Pc\.gemini\antigravity\brain\...\scratch\` for bounding-box math, shape independence, and DOM placement.

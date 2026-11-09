# Project Brief: Fullshot Pro

## 1. Overview
**Fullshot Pro** is a high-performance, privacy-focused Chrome / Edge Browser Extension (Manifest V3) designed to capture full-page screenshots of any web page, automatically stitch scroll slices, and provide a rich on-canvas local editor for markup, annotation, cropping, copying, and exporting.

## 2. Core Objectives
- **Flawless Full-Page Captures**: Overcome common screenshot failures across single-page applications (SPAs), internal scrollable containers, sticky/fixed headers, and virtualized feeds.
- **On-the-Fly Tuning**: Provide quick right-click capture settings for pace (settle delays, bottom wait), scroll targets (window, container, modal, CSS selector), and overlay handling.
- **Standalone Local Editor**: Instantly open captured slices in an editor tab running entirely client-side with zero external servers.
- **Rich Annotation Suite**: Provide smooth freehand drawing, highlighting with opacity presets, shapes (rectangles, circles with independent styles), arrows, inline direct-canvas text editing with dynamic corner scaling, and customizable censor/blur blocks (pixelate, smooth blur, redaction).
- **Frictionless Exporting**: Instant clipboard copy (`Copy Image` / `Ctrl+C`), PNG download, and vector-aligned multi-page / single-page PDF generation.
- **Robust State Management**: True multi-level Undo/Redo (`Ctrl+Z`, `Ctrl+Y`) that restores both annotation states and full-resolution uncropped bitmaps.

## 3. Current Version & Metadata
- **Extension Version**: `1.2.1`
- **Manifest Version**: `3` (Chrome MV3 compliant)
- **Target Browsers**: Google Chrome, Microsoft Edge, Brave, Opera, and other Chromium-based browsers.
- **Primary Permissions**: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `notifications`, `clipboardWrite`, `contextMenus`.

## 4. Key Success Criteria
1. Zero capture failures on SPAs, nested containers, or infinite-scrolling pages.
2. Immediate user feedback: Live percentage badge during capture (`0%` -> `100%`) or `ERR`.
3. Editor tools are responsive, independent, and undoable.
4. 100% offline and secure: No user data or screenshots ever leave the browser.

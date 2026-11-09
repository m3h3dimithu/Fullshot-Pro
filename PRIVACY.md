# Privacy Policy — Fullshot Pro

Last updated: 23 October 2026

Fullshot Pro is a browser extension that captures full-page screenshots and lets you annotate them locally in your browser.

## What data is processed

When you click the toolbar icon or use the right-click capture menu, Fullshot Pro:

- Reads the visible contents of the **active tab** so it can capture and stitch a screenshot
- Temporarily injects a content script to measure page size, scroll, and hide repeating sticky bars during capture
- Stores the captured image slices and page dimensions in **`chrome.storage.local`** on your device so the editor can stitch them
- Uses **clipboard write** only when you click **Copy Image**
- May show a **notification** if capture cannot run on a Chrome/Edge system page

## What is not collected

Fullshot Pro does **not**:

- Create user accounts
- Send screenshots, page URLs, or annotations to a remote server
- Sell or share data with third parties
- Use analytics, advertising, or tracking scripts

All capture, stitching, annotation, PNG export, PDF export, and clipboard copy happen on your computer.

## Storage and retention

Captured slices stay in local extension storage until a new capture replaces them or you remove the extension. Capture pace and page-setup choices are stored in `chrome.storage.local` on your device. Theme preference for the editor is stored in `localStorage` on the editor page.

## Permissions (why they exist)

| Permission | Reason |
| --- | --- |
| `activeTab` | Capture the page you are viewing after you click the icon or a capture menu item |
| `contextMenus` | Show Capture settings and Visible area on right-click of the toolbar icon |
| `scripting` | Inject the scroll/capture helper into that tab |
| `storage` / `unlimitedStorage` | Keep large full-page captures for the editor |
| `notifications` | Warn you when a page cannot be captured |
| `clipboardWrite` | Copy the finished image when you choose to |
| Host access (`<all_urls>`) | Capture whichever regular website tab you open |

The extension cannot capture Chrome/Edge internal pages, `about:` pages, or the Chrome Web Store.

## Third-party libraries

PDF export uses the bundled **jsPDF** library (`jspdf.umd.min.js`) inside the extension package. It does not make network requests for that feature.

## Contact

Questions about this policy can be opened as an issue on the project repository: [https://github.com/m3h3dimithu/fullshot-pro](https://github.com/m3h3dimithu/fullshot-pro)

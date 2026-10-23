// background.js - Listens to action clicks and captures the tab
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const tabUrl = tab.url || "";

  // Prevent capturing Chrome internal pages where scripting is forbidden
  if (
    tabUrl.startsWith('chrome://') || 
    tabUrl.startsWith('chrome-extension://') || 
    tabUrl.startsWith('edge://') || 
    tabUrl.startsWith('about:') ||
    tabUrl.startsWith('view-source:') ||
    tabUrl.startsWith('https://chrome.google.com') || 
    tabUrl.startsWith('https://chromewebstore.google.com')
  ) {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Fullshot Pro',
        message: 'Cannot capture Chrome system pages or Chrome Web Store. Please try on a regular website.'
      });
    } catch (e) {
      console.warn("Could not create notification:", e);
    }
    return;
  }

  await captureFullPage(tab);
});

// Helper to send message with retry
async function sendMessageWithRetry(tabId, message, retries = 4, delay = 200) {
  for (let i = 0; i < retries; i++) {
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(res);
        }
      });
    });
    if (response) return response;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

async function cropCaptureDataUrl(dataUrl, rect, devicePixelRatio = 1) {
  if (!rect || !dataUrl) return dataUrl;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scaleX = bitmap.width / Math.max(1, rect.viewportWidth || bitmap.width);
    const scale = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : devicePixelRatio;
    const x = Math.max(0, Math.round(rect.x * scale));
    const y = Math.max(0, Math.round(rect.y * scale));
    const width = Math.min(bitmap.width - x, Math.max(1, Math.round(rect.width * scale)));
    const height = Math.min(bitmap.height - y, Math.max(1, Math.round(rect.height * scale)));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    bitmap.close();
    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await croppedBlob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch (error) {
    console.warn('Could not crop capture to scroll target; using full viewport:', error);
    return dataUrl;
  }
}

function getCaptureFingerprint(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return '';
  const sample = dataUrl.length <= 512
    ? dataUrl
    : `${dataUrl.slice(0, 256)}${dataUrl.slice(
      Math.max(256, dataUrl.length - 256)
    )}`;
  let hash = 2166136261;
  for (let i = 0; i < sample.length; i++) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${dataUrl.length}:${hash >>> 0}`;
}

async function captureFullPage(tab) {
  try {
    // Ensure tab is active and window focused for captureVisibleTab
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
    }

    // Set badge for loading state
    chrome.action.setBadgeText({ text: "0%" });
    chrome.action.setBadgeBackgroundColor({ color: "#4F46E5" });

    // 1. Inject content script to fetch dimensions and handle scrolling
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // 2. Initialize scrolling capture
    const response = await sendMessageWithRetry(tab.id, { action: "start_scroll_capture" });
    if (!response) {
      console.error("Failed to start scrolling capture after retries");
      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);

      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Fullshot Pro',
          message: 'Could not initialize screenshot engine on this page. Please refresh the page and try again.'
        });
      } catch (e) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => alert("Could not initialize screenshot engine on this page. Please refresh the page and try again.")
        });
      }
      return;
    }
    
    let { totalHeight, viewportHeight } = response;
    const topInset = Math.max(0, response.captureTopInset || 0);
    const bottomInset = Math.max(0, response.captureBottomInset || 0);
    const effectiveHeight = Math.max(80, response.effectiveViewportHeight || (viewportHeight - topInset - bottomInset));
    // Keep a deliberate overlap between slices so moving content is less
    // likely to be cut exactly at a stitch boundary.
    const stepHeight = Math.max(80, Math.round(effectiveHeight * 0.72));
    let totalPages = Math.min(
      40,
      totalHeight <= viewportHeight
        ? 1
        : Math.ceil((totalHeight - viewportHeight) / stepHeight) + 1
    );
    let capturedChunks = [];
    let lastCapturedScrollY = null;
    let lastCaptureFingerprint = null;

    const winId = tab.windowId || null;

    for (let i = 0; i < totalPages; i++) {
      const pct = Math.round(((i + 1) / totalPages) * 100);
      chrome.action.setBadgeText({ text: pct + "%" });

      const targetY = Math.min(i * stepHeight, Math.max(0, totalHeight - viewportHeight));

      // Scroll to specific page slice
      const scrollRes = await sendMessageWithRetry(tab.id, { 
        action: "scroll_to", 
        index: i,
        targetY: targetY 
      });
      if (!scrollRes || scrollRes.actualScrollY === undefined) {
        console.warn('Skipping capture because the page did not confirm the requested scroll position.', {
          index: i,
          targetY
        });
        break;
      }
      if (scrollRes.atBottom && Number.isFinite(scrollRes.totalHeight)) {
        totalHeight = Math.max(viewportHeight, scrollRes.totalHeight);
      } else if (Number.isFinite(scrollRes.totalHeight) && scrollRes.totalHeight > totalHeight) {
        totalHeight = scrollRes.totalHeight;
        totalPages = Math.min(
          40,
          Math.max(
            totalPages,
            totalHeight <= viewportHeight
              ? 1
              : Math.ceil((totalHeight - viewportHeight) / stepHeight) + 1
          )
        );
      }
      // Settle delay for scrolling and rendering
      await new Promise(r => setTimeout(r, 600));
      
      // Capture visual viewport chunk with backoff retry
      let dataUrl = null;
      const maxRetries = 4;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        dataUrl = await new Promise((resolve) => {
          chrome.tabs.captureVisibleTab(winId, { format: 'png' }, (data) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || "";
              if (errMsg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND") || errMsg.includes("quota") || errMsg.includes("exceeded")) {
                resolve({ error: "quota", message: errMsg });
              } else {
                resolve(null);
              }
            } else {
              resolve(data);
            }
          });
        });

        if (dataUrl && dataUrl.error === "quota") {
          const backoff = 800 + (attempt * 600);
          await new Promise(r => setTimeout(r, backoff));
          dataUrl = null;
        } else if (dataUrl) {
          break;
        } else {
          await new Promise(r => setTimeout(r, 400));
        }
      }
      
      if (dataUrl) {
        let actualScrollY = scrollRes.actualScrollY;
        const normalizedScrollY = Math.max(0, Math.round(Number(actualScrollY) || 0));
        const duplicateScroll = lastCapturedScrollY !== null &&
          Math.abs(normalizedScrollY - lastCapturedScrollY) <= 2;

        // Never add the same viewport twice. This is common on pages whose
        // scroll handler is still rendering when captureVisibleTab runs.
        if (duplicateScroll) {
          await new Promise(r => setTimeout(r, 350));
          const retryScroll = await sendMessageWithRetry(tab.id, {
            action: "scroll_to",
            index: i,
            targetY: Math.min(
              Math.max(targetY, lastCapturedScrollY + Math.max(80, Math.round(stepHeight / 2))),
              Math.max(0, totalHeight - viewportHeight)
            )
          });
          const retryY = retryScroll && retryScroll.actualScrollY !== undefined
            ? Math.max(0, Math.round(Number(retryScroll.actualScrollY) || 0))
            : normalizedScrollY;
          if (Math.abs(retryY - lastCapturedScrollY) <= 2) {
            break;
          }
          actualScrollY = retryY;
          await new Promise(r => setTimeout(r, 250));
          dataUrl = await new Promise((resolve) => {
            chrome.tabs.captureVisibleTab(winId, { format: 'png' }, (data) => {
              resolve(chrome.runtime.lastError ? null : data);
            });
          });
          if (!dataUrl) {
            break;
          }
        }

        // Some pages report a changed scroll position before their compositor
        // has painted the new viewport. Do not stitch an identical frame as a
        // new slice; give the page another scroll/render/capture opportunity.
        let captureFingerprint = getCaptureFingerprint(dataUrl);
        if (lastCaptureFingerprint && captureFingerprint === lastCaptureFingerprint) {
          await new Promise(r => setTimeout(r, 500));
          const repaintScroll = await sendMessageWithRetry(tab.id, {
            action: "scroll_to",
            index: i,
            targetY: Math.min(
              Math.max(targetY, normalizedScrollY + Math.max(40, Math.round(stepHeight / 3))),
              Math.max(0, totalHeight - viewportHeight)
            )
          });
          if (repaintScroll && repaintScroll.actualScrollY !== undefined) {
            actualScrollY = repaintScroll.actualScrollY;
            await new Promise(r => setTimeout(r, 700));
            dataUrl = await new Promise((resolve) => {
              chrome.tabs.captureVisibleTab(winId, { format: "png" }, (data) => {
                resolve(chrome.runtime.lastError ? null : data);
              });
            });
            captureFingerprint = getCaptureFingerprint(dataUrl);
          }
        }
        if (!dataUrl || (lastCaptureFingerprint && captureFingerprint === lastCaptureFingerprint)) {
          console.warn("Skipping visually duplicate capture slice", {
            index: i,
            scrollY: actualScrollY
          });
          break;
        }

        const cropRect = response.targetRect || (
          topInset || bottomInset
            ? {
              x: 0,
              y: topInset,
              width: response.targetWidth || 0,
              height: viewportHeight - topInset - bottomInset,
              viewportWidth: response.targetWidth || 0,
              viewportHeight: viewportHeight
            }
            : null
        );
        const croppedDataUrl = cropRect
          ? await cropCaptureDataUrl(dataUrl, cropRect, response.devicePixelRatio)
          : dataUrl;
        const chunk = {
          dataUrl: croppedDataUrl,
          scrollY: Math.max(0, Math.round(Number(actualScrollY) || 0))
        };
        if (!response.targetRect && (topInset || bottomInset)) {
          chunk.contentOffsetY = topInset;
        }
        capturedChunks.push(chunk);
        lastCapturedScrollY = chunk.scrollY;
        lastCaptureFingerprint = captureFingerprint;
      }

      // If we reached the end of the scrollable area, stop
      if (targetY >= totalHeight - viewportHeight && i > 0) {
        break;
      }
    }

    // Restore original scroll position and elements
    await sendMessageWithRetry(tab.id, { action: "restore_scroll" });

    // Clear badge
    chrome.action.setBadgeText({ text: "" });
    response.totalHeight = totalHeight;
    response.totalPages = capturedChunks.length;

    if (capturedChunks.length === 0) {
      console.error("No chunks captured");
      return;
    }

    // Clear previous chunks first to keep memory clean, then store and open editor
    chrome.storage.local.remove(['captured_chunks', 'dimensions'], () => {
      chrome.storage.local.set({ 
        captured_chunks: capturedChunks, 
        dimensions: response 
      }, () => {
        const editorUrl = chrome.runtime.getURL('editor.html');
        chrome.tabs.create({ url: editorUrl });
      });
    });
  } catch (err) {
    console.error("Capture failed:", err);
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);

    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Fullshot Pro Error',
        message: 'Capture failed: ' + (err.message || err)
      });
    } catch (e) {}
  }
}
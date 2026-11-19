// background.js - Toolbar click, right-click settings, scroll-stitch
importScripts('capture-settings.js');

const MENU_SETTINGS = 'fullshot_open_settings';
const MENU_FULLPAGE = 'fullshot_capture_fullpage';
const MENU_VISIBLE = 'fullshot_capture_visible';

let currentCaptureControl = {
  tabId: null,
  isPaused: false,
  isStopped: false,
  isCancelled: false,
  resumeResolve: null
};

function isRestrictedTabUrl(tabUrl) {
  return (
    tabUrl.startsWith('chrome://') ||
    tabUrl.startsWith('chrome-extension://') ||
    tabUrl.startsWith('edge://') ||
    tabUrl.startsWith('about:') ||
    tabUrl.startsWith('view-source:') ||
    tabUrl.startsWith('https://chrome.google.com') ||
    tabUrl.startsWith('https://chromewebstore.google.com')
  );
}

function notifyRestrictedPage() {
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
}

function createActionMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SETTINGS,
      title: 'Fullshot Pro: Capture settings & panel…',
      contexts: ['action', 'page']
    });
    chrome.contextMenus.create({
      id: MENU_FULLPAGE,
      title: 'Fullshot Pro: Capture full page',
      contexts: ['action', 'page']
    });
    chrome.contextMenus.create({
      id: MENU_VISIBLE,
      title: 'Fullshot Pro: Capture visible area',
      contexts: ['action', 'page']
    });
  });
}

createActionMenus();
chrome.runtime.onInstalled.addListener(createActionMenus);
chrome.runtime.onStartup.addListener(createActionMenus);

async function getActiveWebpageTab() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    return (win.tabs || []).find((tab) => tab.active) || null;
  } catch (e) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  }
}

async function openCaptureSettings() {
  const settingsUrl = chrome.runtime.getURL('popup.html');
  try {
    const popups = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    const existing = popups.find((win) =>
      (win.tabs || []).some((tab) => tab.url && tab.url.startsWith(settingsUrl))
    );
    if (existing) {
      await chrome.windows.update(existing.id, { focused: true });
      return;
    }
  } catch (e) {}

  await chrome.windows.create({
    url: settingsUrl,
    type: 'popup',
    width: 440,
    height: 700,
    focused: true
  });
}

async function beginCaptureForTab(tab, captureType) {
  if (!tab || !tab.id) {
    tab = await getActiveWebpageTab();
  }
  if (!tab || !tab.id) return;
  if (isRestrictedTabUrl(tab.url || '')) {
    notifyRestrictedPage();
    return;
  }
  await captureFullPage(tab, captureType);
}

chrome.action.onClicked.addListener((tab) => {
  openCaptureSettings();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SETTINGS) {
    openCaptureSettings();
    return;
  }
  if (info.menuItemId === MENU_FULLPAGE) {
    beginCaptureForTab(tab, 'fullpage');
    return;
  }
  if (info.menuItemId === MENU_VISIBLE) {
    beginCaptureForTab(tab, 'visible');
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'stop_capture') {
    currentCaptureControl.isStopped = true;
    if (currentCaptureControl.resumeResolve) {
      currentCaptureControl.resumeResolve();
      currentCaptureControl.resumeResolve = null;
    }
    chrome.runtime.sendMessage({ action: 'capture_progress', status: '⏹️ Finishing capture…' }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'cancel_capture') {
    currentCaptureControl.isCancelled = true;
    if (currentCaptureControl.resumeResolve) {
      currentCaptureControl.resumeResolve();
      currentCaptureControl.resumeResolve = null;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'pause_capture') {
    currentCaptureControl.isPaused = true;
    chrome.runtime.sendMessage({ action: 'capture_progress', isPaused: true }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'resume_capture') {
    currentCaptureControl.isPaused = false;
    if (currentCaptureControl.resumeResolve) {
      currentCaptureControl.resumeResolve();
      currentCaptureControl.resumeResolve = null;
    }
    chrome.runtime.sendMessage({ action: 'capture_progress', isPaused: false }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'capture_full_page') {
    (async () => {
      let tab = null;
      if (request.tabId) {
        tab = await getFreshTab(request.tabId);
      }
      if (!tab || isRestrictedTabUrl((tab.url || ''))) {
        tab = await getActiveWebpageTab();
      }
      await beginCaptureForTab(tab, request.captureType);
    })();

    sendResponse({ ok: true });
    return true;
  }
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

async function getFreshTab(tabId) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (e) {
    return null;
  }
}

async function openEditorBesideCaptureTab(sourceTab) {
  const editorUrl = chrome.runtime.getURL('editor.html');
  const windowId = sourceTab && sourceTab.windowId ? sourceTab.windowId : undefined;
  const created = await chrome.tabs.create({
    url: editorUrl,
    active: true,
    ...(windowId ? { windowId } : {})
  });

  if (!created || !created.id) return;

  const placeBesideSource = async () => {
    const latestSource = (await getFreshTab(sourceTab && sourceTab.id)) || sourceTab;
    if (!latestSource || !Number.isInteger(latestSource.index)) return;
    const targetIndex = latestSource.index + 1;
    const latestEditor = await getFreshTab(created.id);
    if (latestEditor && latestEditor.index === targetIndex && latestEditor.windowId === latestSource.windowId) {
      return;
    }
    await chrome.tabs.move(created.id, {
      index: targetIndex,
      ...(latestSource.windowId ? { windowId: latestSource.windowId } : {})
    });
  };

  try {
    await placeBesideSource();
  } catch (e) {
    console.warn('Could not move editor tab beside the captured page:', e);
  }

  const groupId = sourceTab && sourceTab.groupId;
  if (Number.isInteger(groupId) && groupId > -1) {
    try {
      await chrome.tabs.group({ tabIds: [created.id], groupId });
      await placeBesideSource();
    } catch (e) {
      console.warn('Could not add editor tab to the captured tab group:', e);
    }
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

async function captureVisibleTabPng(winId) {
  return new Promise((resolve) => {
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
}

async function captureFullPage(tab, captureTypeOverride) {
  const settings = await loadCaptureSettings();
  if (captureTypeOverride === 'visible' || captureTypeOverride === 'fullpage') {
    settings.captureType = captureTypeOverride;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  currentCaptureControl = {
    tabId: tab.id,
    isPaused: false,
    isStopped: false,
    isCancelled: false,
    resumeResolve: null
  };

  const interruptibleSleep = async (ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
        return;
      }
      while (currentCaptureControl.isPaused && !currentCaptureControl.isCancelled && !currentCaptureControl.isStopped) {
        await new Promise((r) => {
          currentCaptureControl.resumeResolve = r;
          setTimeout(r, 50);
        });
      }
      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(40, remaining)));
    }
  };

  const broadcastProgress = (info) => {
    chrome.runtime.sendMessage({
      action: 'capture_progress',
      ...info
    }).catch(() => {});
  };

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

    // Ensure any open highlight or picker overlay is removed
    await sendMessageWithRetry(tab.id, { action: "clear_highlight" });

    // 2. Initialize scrolling capture
    const response = await sendMessageWithRetry(tab.id, {
      action: "start_scroll_capture",
      settings
    });
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

    await interruptibleSleep(settings.startDelayMs);

    const cropCurrentView = async (dataUrl) => {
      const sliceTopInset = (settings.headerMode === 'once' || settings.headerMode === 'repeat')
        ? 0
        : (response.captureTopInset || 0);
      const cropRect = response.targetRect || (
        (sliceTopInset || response.captureBottomInset)
          ? {
            x: 0,
            y: sliceTopInset,
            width: response.targetWidth || 0,
            height: (response.viewportHeight || 0) - sliceTopInset - (response.captureBottomInset || 0),
            viewportWidth: response.targetWidth || 0,
            viewportHeight: response.viewportHeight
          }
          : null
      );
      return cropRect
        ? await cropCaptureDataUrl(dataUrl, cropRect, response.devicePixelRatio)
        : dataUrl;
    };

    if (settings.captureType === 'visible') {
      chrome.action.setBadgeText({ text: "100%" });
      let dataUrl = await captureVisibleTabPng(tab.windowId || null);
      if (dataUrl && dataUrl.error === 'quota') {
        await sleep(800);
        dataUrl = await captureVisibleTabPng(tab.windowId || null);
      }
      await sendMessageWithRetry(tab.id, { action: "restore_scroll", settings });
      chrome.action.setBadgeText({ text: "" });
      if (!dataUrl || dataUrl.error) {
        throw new Error('Could not capture the visible area.');
      }
      await chrome.storage.local.remove(['captured_chunks', 'dimensions']);
      await chrome.storage.local.set({
        captured_chunks: [{
          dataUrl: settings.cropToScrollTarget ? await cropCurrentView(dataUrl) : dataUrl,
          scrollY: Math.max(0, Math.round(Number(response.originalScrollTop) || 0))
        }],
        dimensions: { ...response, totalPages: 1, totalHeight: response.viewportHeight }
      });
      const sourceTab = (await getFreshTab(tab.id)) || tab;
      await openEditorBesideCaptureTab(sourceTab);
      return;
    }

    // Initialize in-page capture dock
    await sendMessageWithRetry(tab.id, {
      action: "init_capture_dock",
      currentSlice: 1,
      totalSlices: 1,
      pct: 0,
      isPaused: false
    });

    let { totalHeight, viewportHeight } = response;
    const topInset = Math.max(0, response.captureTopInset || 0);
    const bottomInset = Math.max(0, response.captureBottomInset || 0);
    const effectiveHeight = Math.max(80, response.effectiveViewportHeight || (viewportHeight - topInset - bottomInset));
    const overlapRatio = Math.min(0.6, Math.max(0, settings.overlapPercent / 100));
    const stepHeight = Math.max(80, Math.round(effectiveHeight * (1 - overlapRatio)));
    const maxSlices = settings.captureType === 'visible' ? 1 : settings.maxSlices;

    const startY = (settings.startPosition === 'current' && Number.isFinite(response.originalScrollTop))
      ? Math.max(0, Math.min(Math.round(Number(response.originalScrollTop)), Math.max(0, totalHeight - viewportHeight)))
      : 0;

    const captureRange = Math.max(viewportHeight, totalHeight - startY);
    let totalPages = Math.min(
      maxSlices,
      captureRange <= viewportHeight || settings.captureType === 'visible'
        ? 1
        : Math.ceil((captureRange - viewportHeight) / stepHeight) + 1
    );
    let capturedChunks = [];
    let lastCapturedScrollY = null;
    let lastCaptureFingerprint = null;

    const winId = tab.windowId || null;

    broadcastProgress({
      currentSlice: 1,
      totalSlices: totalPages,
      pct: 0,
      isPaused: false
    });

    for (let i = 0; i < totalPages; i++) {
      if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
        break;
      }
      while (currentCaptureControl.isPaused && !currentCaptureControl.isCancelled && !currentCaptureControl.isStopped) {
        await new Promise((r) => {
          currentCaptureControl.resumeResolve = r;
          setTimeout(r, 100);
        });
      }
      if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
        break;
      }

      const pct = Math.round(((i + 1) / totalPages) * 100);
      chrome.action.setBadgeText({ text: pct + "%" });
      broadcastProgress({
        currentSlice: i + 1,
        totalSlices: totalPages,
        pct,
        isPaused: currentCaptureControl.isPaused
      });
      await sendMessageWithRetry(tab.id, {
        action: "show_capture_dock",
        currentSlice: i + 1,
        totalSlices: totalPages,
        pct,
        isPaused: currentCaptureControl.isPaused
      });

      const targetY = Math.min(startY + i * stepHeight, Math.max(0, totalHeight - viewportHeight));

      // Scroll to specific page slice
      const scrollRes = await sendMessageWithRetry(tab.id, { 
        action: "scroll_to", 
        index: i,
        targetY: targetY,
        settings
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
        const newRange = Math.max(viewportHeight, totalHeight - startY);
        totalPages = Math.min(
          maxSlices,
          Math.max(
            totalPages,
            newRange <= viewportHeight
              ? 1
              : Math.ceil((newRange - viewportHeight) / stepHeight) + 1
          )
        );
      }
      const atLastSlice = i === totalPages - 1 || targetY >= totalHeight - viewportHeight;
      await interruptibleSleep(settings.settleDelayMs + (atLastSlice ? settings.bottomWaitMs : 0));

      if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
        break;
      }

      // Hide dock and wait for clean compositor repaint before capturing
      await sendMessageWithRetry(tab.id, { action: "prepare_for_snapshot" });

      // Capture visual viewport chunk with backoff retry
      let dataUrl = null;
      const maxRetries = 4;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
          break;
        }
        dataUrl = await captureVisibleTabPng(winId);

        if (dataUrl && dataUrl.error === "quota") {
          const backoff = 800 + (attempt * 600);
          await interruptibleSleep(backoff);
          dataUrl = null;
        } else if (dataUrl) {
          break;
        } else {
          await interruptibleSleep(400);
        }
      }

      if (currentCaptureControl.isCancelled) {
        break;
      }

      if (dataUrl) {
        let actualScrollY = scrollRes.actualScrollY;
        const normalizedScrollY = Math.max(0, Math.round(Number(actualScrollY) || 0));
        const duplicateScroll = settings.skipDuplicateFrames && lastCapturedScrollY !== null &&
          Math.abs(normalizedScrollY - lastCapturedScrollY) <= 2;

        if (duplicateScroll) {
          await interruptibleSleep(Math.max(200, Math.round(settings.settleDelayMs / 2)));
          if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
            break;
          }
          const retryScroll = await sendMessageWithRetry(tab.id, {
            action: "scroll_to",
            index: i,
            targetY: Math.min(
              Math.max(targetY, lastCapturedScrollY + Math.max(80, Math.round(stepHeight / 2))),
              Math.max(0, totalHeight - viewportHeight)
            ),
            settings
          });
          const retryY = retryScroll && retryScroll.actualScrollY !== undefined
            ? Math.max(0, Math.round(Number(retryScroll.actualScrollY) || 0))
            : normalizedScrollY;
          if (Math.abs(retryY - lastCapturedScrollY) <= 2) {
            break;
          }
          actualScrollY = retryY;
          await interruptibleSleep(Math.max(150, Math.round(settings.settleDelayMs / 3)));
          if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
            break;
          }
          dataUrl = await captureVisibleTabPng(winId);
          if (!dataUrl || dataUrl.error) {
            break;
          }
        }

        let captureFingerprint = getCaptureFingerprint(dataUrl);
        if (settings.skipDuplicateFrames && lastCaptureFingerprint && captureFingerprint === lastCaptureFingerprint) {
          await interruptibleSleep(Math.max(300, settings.settleDelayMs));
          if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
            break;
          }
          const repaintScroll = await sendMessageWithRetry(tab.id, {
            action: "scroll_to",
            index: i,
            targetY: Math.min(
              Math.max(targetY, normalizedScrollY + Math.max(40, Math.round(stepHeight / 3))),
              Math.max(0, totalHeight - viewportHeight)
            ),
            settings
          });
          if (repaintScroll && repaintScroll.actualScrollY !== undefined) {
            actualScrollY = repaintScroll.actualScrollY;
            await interruptibleSleep(Math.max(400, settings.settleDelayMs));
            if (currentCaptureControl.isCancelled || currentCaptureControl.isStopped) {
              break;
            }
            dataUrl = await captureVisibleTabPng(winId);
            captureFingerprint = getCaptureFingerprint(dataUrl);
          }
        }
        if (!dataUrl || (settings.skipDuplicateFrames && lastCaptureFingerprint && captureFingerprint === lastCaptureFingerprint)) {
          console.warn("Skipping visually duplicate capture slice", {
            index: i,
            scrollY: actualScrollY
          });
          break;
        }

        const sliceTopInset = (i === 0 && startY === 0 && (settings.headerMode === 'once' || settings.headerMode === 'repeat'))
          ? 0
          : topInset;
        const cropRect = response.targetRect || (
          (sliceTopInset || bottomInset)
            ? {
              x: 0,
              y: sliceTopInset,
              width: response.targetWidth || 0,
              height: viewportHeight - sliceTopInset - bottomInset,
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
        if (!response.targetRect && (sliceTopInset || bottomInset)) {
          chunk.contentOffsetY = sliceTopInset;
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
    await sendMessageWithRetry(tab.id, { action: "restore_scroll", settings });

    // Clear badge
    chrome.action.setBadgeText({ text: "" });

    if (currentCaptureControl.isCancelled) {
      console.log("Capture cancelled by user.");
      return;
    }

    response.totalHeight = totalHeight;
    response.totalPages = capturedChunks.length;

    if (capturedChunks.length === 0) {
      console.error("No chunks captured");
      return;
    }

    // Clear previous chunks first to keep memory clean, then store and open editor
    await chrome.storage.local.remove(['captured_chunks', 'dimensions']);
    await chrome.storage.local.set({
      captured_chunks: capturedChunks,
      dimensions: response
    });
    const sourceTab = (await getFreshTab(tab.id)) || tab;
    await openEditorBesideCaptureTab(sourceTab);
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
  } finally {
    await sendMessageWithRetry(tab.id, { action: "remove_capture_dock" });
  }
}
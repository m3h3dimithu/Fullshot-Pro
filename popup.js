let settings = { ...FULLSHOT_DEFAULT_SETTINGS };
let saveTimer = null;
let currentTabId = null;

const $ = (id) => document.getElementById(id);

function setChipActive(containerId, attr, value) {
  document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute(attr) === value);
  });
}

function updateTargetCard(info) {
  if (!info) return;
  const badgeEl = $('targetBadge');
  const titleEl = $('targetTitle');
  const dimsEl = $('targetDimensionsPill');
  const scrollEl = $('targetScrollPill');
  const selectorEl = $('targetSelectorText');

  if (badgeEl) {
    badgeEl.textContent = info.targetTag || (
      info.captureMode === 'popup' ? 'MODAL' : (info.captureMode === 'container' ? 'CONTAINER' : 'WINDOW')
    );
  }
  if (titleEl) {
    titleEl.textContent = info.targetName || 'Document / window';
  }
  if (dimsEl) {
    const dims = info.targetDimensions;
    dimsEl.textContent = dims
      ? `${Math.round(dims.width)} × ${Math.round(dims.height)} px`
      : `${info.totalHeight || 0} px high`;
  }
  if (scrollEl) {
    scrollEl.textContent = info.canScroll
      ? `Scrollable (${info.scrollablePages || 1} pages)`
      : 'Single view';
  }
  if (selectorEl) {
    if (info.targetSelector && info.targetSelector !== 'window') {
      selectorEl.hidden = false;
      selectorEl.textContent = info.targetSelector;
    } else {
      selectorEl.hidden = true;
    }
  }
}

function renderSettings() {
  $('scrollTarget').value = settings.scrollTarget;
  $('selector').value = settings.selector;
  $('selectorField').hidden = settings.scrollTarget !== 'selector';
  $('settleDelayMs').value = settings.settleDelayMs;
  $('startDelayMs').value = settings.startDelayMs;
  $('bottomWaitMs').value = settings.bottomWaitMs;
  $('overlapPercent').value = settings.overlapPercent;
  $('maxSlices').value = settings.maxSlices;
  if ($('headerMode')) {
    $('headerMode').value = settings.headerMode || 'once';
  }
  if ($('hideStickyBars')) {
    $('hideStickyBars').checked = settings.hideStickyBars;
  }
  $('disableAnimations').checked = settings.disableAnimations;
  $('waitForDynamicHeight').checked = settings.waitForDynamicHeight;
  $('skipDuplicateFrames').checked = settings.skipDuplicateFrames;
  $('cropToScrollTarget').checked = settings.cropToScrollTarget;
  $('insetMode').value = settings.insetMode;
  $('topInsetPx').value = settings.topInsetPx;
  $('bottomInsetPx').value = settings.bottomInsetPx;
  $('insetFields').hidden = settings.insetMode !== 'manual';
  $('scrollRetries').value = settings.scrollRetries;
  $('settleLabel').textContent = `${settings.settleDelayMs} ms`;
  $('startLabel').textContent = `${settings.startDelayMs} ms`;
  $('bottomLabel').textContent = `${settings.bottomWaitMs} ms`;
  $('overlapLabel').textContent = `${settings.overlapPercent}%`;
  $('slicesLabel').textContent = String(settings.maxSlices);
  $('retriesLabel').textContent = String(settings.scrollRetries);
  setChipActive('layoutPresets', 'data-layout', settings.layoutPreset);
  setChipActive('pacePresets', 'data-pace', settings.pacePreset);
}

function queueSave(flashHighlight = false) {
  settings = normalizeCaptureSettings(settings);
  renderSettings();
  $('savedNote').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = await saveCaptureSettings(settings);
    $('savedNote').textContent = 'Saved on this device';
  }, 180);

  requestTargetHighlight(flashHighlight);
}

async function getWebpageTab() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    return (win.tabs || []).find((tab) => tab.active) || null;
  } catch (e) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  }
}

async function requestTargetHighlight(flashHighlight = false) {
  try {
    const tab = await getWebpageTab();
    if (!tab || !tab.id) return;
    currentTabId = tab.id;
    const tabUrl = tab.url || '';
    if (
      tabUrl.startsWith('chrome://') ||
      tabUrl.startsWith('chrome-extension://') ||
      tabUrl.startsWith('edge://') ||
      tabUrl.startsWith('about:') ||
      tabUrl.startsWith('view-source:') ||
      tabUrl.startsWith('https://chrome.google.com') ||
      tabUrl.startsWith('https://chromewebstore.google.com')
    ) {
      return;
    }

    const action = flashHighlight ? 'highlight_target' : 'inspect_page';
    let res = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action, settings }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });

    if (!res) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      res = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action, settings }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
    }

    if (res) {
      updateTargetCard(res);
      const labels = {
        page: 'document / window scroll',
        container: 'an inner app container',
        popup: 'an open modal, drawer, or menu'
      };
      $('pageHint').textContent = `Targeting: ${labels[res.captureMode] || 'page scroll'}${res.hasOverlay ? ' · overlay open' : ''}.`;
    }
  } catch (e) {
    console.warn('Could not inspect tab target:', e);
  }
}

function bindControls() {
  $('scrollTarget').addEventListener('change', (e) => {
    settings.scrollTarget = e.target.value;
    settings.layoutPreset = 'auto';
    queueSave(true);
  });
  $('selector').addEventListener('input', (e) => {
    settings.selector = e.target.value;
    queueSave(true);
  });
  ['settleDelayMs', 'startDelayMs', 'bottomWaitMs', 'overlapPercent', 'maxSlices', 'scrollRetries'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      settings[id] = Number(e.target.value);
      if (['settleDelayMs', 'startDelayMs', 'bottomWaitMs'].includes(id)) {
        settings.pacePreset = 'custom';
      }
      queueSave(false);
    });
  });
  if ($('headerMode')) {
    $('headerMode').addEventListener('change', (e) => {
      settings.headerMode = e.target.value;
      settings.hideStickyBars = settings.headerMode !== 'repeat';
      queueSave(false);
    });
  }
  if ($('hideStickyBars')) {
    $('hideStickyBars').addEventListener('change', (e) => {
      settings.hideStickyBars = e.target.checked;
      queueSave(false);
    });
  }
  ['disableAnimations', 'waitForDynamicHeight', 'skipDuplicateFrames', 'cropToScrollTarget'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      settings[id] = e.target.checked;
      queueSave(id === 'cropToScrollTarget');
    });
  });
  $('insetMode').addEventListener('change', (e) => {
    settings.insetMode = e.target.value;
    queueSave(false);
  });
  $('topInsetPx').addEventListener('input', (e) => {
    settings.topInsetPx = Number(e.target.value);
    queueSave(false);
  });
  $('bottomInsetPx').addEventListener('input', (e) => {
    settings.bottomInsetPx = Number(e.target.value);
    queueSave(false);
  });

  document.querySelectorAll('#layoutPresets button').forEach((btn) => {
    btn.addEventListener('click', () => {
      settings = applyLayoutPreset(settings, btn.getAttribute('data-layout'));
      queueSave(true);
    });
  });
  document.querySelectorAll('#pacePresets button').forEach((btn) => {
    btn.addEventListener('click', () => {
      settings = applyPacePreset(settings, btn.getAttribute('data-pace'));
      queueSave(false);
    });
  });

  if ($('pickSectionBtn')) {
    $('pickSectionBtn').addEventListener('click', async () => {
      try {
        const tab = await getWebpageTab();
        if (!tab || !tab.id) {
          showStatus('No active webpage to pick from.');
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'start_element_picker' });
        showStatus('🎯 Click any section or container on the webpage to target it.');
      } catch (err) {
        showStatus('Could not activate element picker on this tab.');
      }
    });
  }

  if ($('highlightTargetBtn')) {
    $('highlightTargetBtn').addEventListener('click', () => {
      requestTargetHighlight(true);
    });
  }

  $('resetSettings').addEventListener('click', () => {
    settings = { ...FULLSHOT_DEFAULT_SETTINGS };
    queueSave(true);
  });

  $('captureFull').addEventListener('click', () => startCapture('fullpage'));
  $('captureVisible').addEventListener('click', () => startCapture('visible'));
}

function showStatus(message) {
  const el = $('statusMsg');
  el.hidden = !message;
  el.textContent = message || '';
}

async function startCapture(captureType) {
  settings.captureType = captureType;
  settings = await saveCaptureSettings(settings);
  showStatus('');
  try {
    const tab = await getWebpageTab();
    if (!tab || !tab.id) {
      showStatus('No active tab to capture.');
      return;
    }
    await chrome.runtime.sendMessage({
      action: 'capture_full_page',
      tabId: tab.id,
      captureType
    });
    window.close();
  } catch (error) {
    showStatus(error.message || 'Could not start capture.');
  }
}

async function inspectActiveTab() {
  const hint = $('pageHint');
  try {
    const tab = await getWebpageTab();
    if (!tab || !tab.id) {
      hint.textContent = 'Open a regular webpage to capture.';
      return;
    }
    const tabUrl = tab.url || '';
    if (
      tabUrl.startsWith('chrome://') ||
      tabUrl.startsWith('chrome-extension://') ||
      tabUrl.startsWith('edge://') ||
      tabUrl.startsWith('about:') ||
      tabUrl.startsWith('view-source:') ||
      tabUrl.startsWith('https://chrome.google.com') ||
      tabUrl.startsWith('https://chromewebstore.google.com')
    ) {
      hint.textContent = 'This tab cannot be captured. Open a regular website.';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await requestTargetHighlight(false);
  } catch (e) {
    hint.textContent = 'Could not inspect this tab. You can still capture after a refresh.';
  }
}

// Listen to storage changes so if the user picks an element on the page, the popup immediately reflects it!
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.capture_settings && changes.capture_settings.newValue) {
      settings = normalizeCaptureSettings(changes.capture_settings.newValue);
      renderSettings();
      requestTargetHighlight(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  settings = await loadCaptureSettings();
  renderSettings();
  bindControls();
  inspectActiveTab();
});
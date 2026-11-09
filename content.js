// content.js - Injected directly into the website tab
if (window.screenCaptureListener) {
  try {
    chrome.runtime.onMessage.removeListener(window.screenCaptureListener);
  } catch (e) {
    // Old extension context was invalidated, ignore
  }
}

function getFullshotSettings(request) {
  return (request && request.settings) || window.fullshotSettings || {};
}

function isVisibleOnScreen(el) {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' &&
    Number(style.opacity || 1) > 0 &&
    rect.width >= 40 && rect.height >= 40 &&
    rect.bottom > 0 && rect.right > 0 &&
    rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function getElementText(el) {
  return `${el.tagName} ${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ` +
    `${el.getAttribute('role') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
}

function isOverlayElement(el) {
  const style = window.getComputedStyle(el);
  const text = getElementText(el);
  const semanticOverlay = el.getAttribute('role') === 'dialog' ||
    el.getAttribute('aria-modal') === 'true' ||
    /modal|dialog|popover|popup|dropdown|menu|drawer|sheet|overlay|listbox/.test(text);
  if (semanticOverlay) return true;
  if (style.position === 'fixed') {
    const rect = el.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.45 &&
      rect.height >= window.innerHeight * 0.25;
  }
  return false;
}

function getOverlayScore(el) {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const text = getElementText(el);
  let score = 0;
  if (['fixed', 'absolute', 'sticky'].includes(style.position)) score += 80;
  if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' ||
      /modal|dialog|popover|popup|dropdown|menu|drawer|sheet|overlay|listbox/.test(text)) score += 100;
  if (Number.isFinite(Number(style.zIndex)) && Number(style.zIndex) > 10) score += 30;
  if (rect.width < window.innerWidth * 0.98 || rect.height < window.innerHeight * 0.98) score += 15;
  score += Math.min(20, el.scrollHeight / Math.max(1, el.clientHeight));
  return score;
}

function collectElements(root, result = []) {
  if (!root || !root.querySelectorAll) return result;
  root.querySelectorAll('*').forEach((el) => {
    result.push(el);
    if (el.shadowRoot) collectElements(el.shadowRoot, result);
  });
  return result;
}

function rectFromElement(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.min(window.innerWidth, Math.round(rect.width)),
    height: Math.min(window.innerHeight, Math.round(rect.height)),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}

function generateCssSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return '';
  if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) {
    return `#${el.id}`;
  }
  const role = el.getAttribute('role');
  if (role) {
    const sel = `${el.tagName.toLowerCase()}[role="${role}"]`;
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch (e) {}
  }
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
  if (testId) {
    const sel = `[data-testid="${testId}"]`;
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch (e) {}
  }
  if (el.classList && el.classList.length > 0) {
    const validClasses = Array.from(el.classList).filter((c) =>
      typeof c === 'string' && /^[a-zA-Z0-9_-]+$/.test(c) && !c.toLowerCase().includes('fullshot')
    );
    if (validClasses.length > 0) {
      const classSel = `${el.tagName.toLowerCase()}.${validClasses.slice(0, 2).join('.')}`;
      try {
        if (document.querySelectorAll(classSel).length === 1) return classSel;
      } catch (e) {}
    }
  }
  const path = [];
  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement && path.length < 4) {
    let tag = curr.tagName.toLowerCase();
    if (curr.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(curr.id)) {
      path.unshift(`#${curr.id}`);
      break;
    }
    let siblingIndex = 1;
    let sibling = curr.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === curr.tagName) siblingIndex++;
      sibling = sibling.previousElementSibling;
    }
    path.unshift(`${tag}:nth-of-type(${siblingIndex})`);
    curr = curr.parentElement;
  }
  return path.join(' > ');
}

function useElementTarget(el, captureMode) {
  return {
    scrollTarget: el,
    isWindowScroll: false,
    totalHeight: el.scrollHeight,
    targetRect: rectFromElement(el),
    captureMode
  };
}

function analyzePageForCapture(settings) {
  settings = settings || {};
  const doc = document.documentElement;
  const body = document.body;
  const docHeight = Math.max(
    doc ? doc.scrollHeight : 0,
    body ? body.scrollHeight : 0,
    doc ? doc.offsetHeight : 0,
    body ? body.offsetHeight : 0,
    doc ? doc.clientHeight : 0,
    window.innerHeight
  );

  const allVisibleElements = collectElements(document.body).filter(isVisibleOnScreen);
  const candidates = allVisibleElements.filter((el) => {
    if (el.clientHeight < 80 || el.clientWidth < 80) return false;
    return el.scrollHeight > el.clientHeight + 20;
  });

  const overlayRoots = allVisibleElements
    .filter(isOverlayElement)
    .sort((a, b) => getOverlayScore(b) - getOverlayScore(a));

  const isScrollableElement = (el) => {
    if (!isVisibleOnScreen(el) || el.clientHeight < 80 || el.clientWidth < 80) return false;
    const style = window.getComputedStyle(el);
    const overflowAllowsScroll = ['auto', 'scroll', 'overlay', 'hidden'].includes(style.overflowY);
    return overflowAllowsScroll && el.scrollHeight > el.clientHeight + 20;
  };

  const getBestScrollableDescendant = (root) => {
    const descendants = [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(isScrollableElement);
    if (!descendants.length) return null;
    return descendants.sort((a, b) => {
      const depth = (el) => {
        let value = 0;
        for (let node = el; node && node !== root; node = node.parentElement) value++;
        return value;
      };
      return depth(b) - depth(a) || (a.clientHeight - b.clientHeight);
    })[0];
  };

  const overlayTargets = overlayRoots
    .map((root) => ({ root, target: getBestScrollableDescendant(root) }))
    .filter((item) => item.target)
    .sort((a, b) => getOverlayScore(b.root) - getOverlayScore(a.root));

  const documentScrollRange = Math.max(0, docHeight - window.innerHeight);
  const scrollRoot = document.scrollingElement || document.documentElement || document.body;
  const originalWindowScrollY = window.scrollY || window.pageYOffset || 0;
  let windowScrollMoves = documentScrollRange > 0;
  if (windowScrollMoves && scrollRoot) {
    const probeY = Math.min(64, documentScrollRange);
    try {
      scrollRoot.scrollTop = probeY;
      const probeActualY = scrollRoot.scrollTop || window.scrollY || window.pageYOffset || 0;
      windowScrollMoves = Math.abs(probeActualY - originalWindowScrollY) >= 1;
      scrollRoot.scrollTop = originalWindowScrollY;
      if (document.documentElement) document.documentElement.scrollTop = originalWindowScrollY;
      if (document.body) document.body.scrollTop = originalWindowScrollY;
    } catch (e) {
      windowScrollMoves = false;
    }
  }

  const appScrollTargets = candidates
    .filter((el) => {
      const style = window.getComputedStyle(el);
      const range = el.scrollHeight - el.clientHeight;
      const rect = el.getBoundingClientRect();
      const intersectsViewport = rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;
      return ['auto', 'scroll', 'overlay', 'hidden'].includes(style.overflowY) &&
        el.clientHeight >= window.innerHeight * 0.45 &&
        el.clientWidth >= window.innerWidth * 0.35 &&
        intersectsViewport &&
        range > 20;
    })
    .sort((a, b) => {
      const rangeA = a.scrollHeight - a.clientHeight;
      const rangeB = b.scrollHeight - b.clientHeight;
      const areaA = a.clientWidth * a.clientHeight;
      const areaB = b.clientWidth * b.clientHeight;
      return (rangeB - rangeA) || (areaB - areaA);
    });
  const bestAppScrollTarget = appScrollTargets[0] || null;

  let chosen = {
    scrollTarget: null,
    isWindowScroll: true,
    totalHeight: docHeight,
    targetRect: null,
    captureMode: 'page'
  };

  const preference = settings.scrollTarget || 'auto';
  if (preference === 'selector' && settings.selector) {
    try {
      const el = document.querySelector(settings.selector);
      if (el) chosen = useElementTarget(el, isOverlayElement(el) ? 'popup' : 'container');
    } catch (e) {}
  } else if (preference === 'window') {
    chosen = {
      scrollTarget: null,
      isWindowScroll: true,
      totalHeight: docHeight,
      targetRect: null,
      captureMode: 'page'
    };
  } else if (preference === 'popup' && overlayTargets[0]) {
    chosen = useElementTarget(overlayTargets[0].target, 'popup');
  } else if (preference === 'container' && bestAppScrollTarget) {
    chosen = useElementTarget(bestAppScrollTarget, 'container');
  } else {
    const autoTarget = overlayTargets[0] ? overlayTargets[0].target : (
      bestAppScrollTarget && (
       !windowScrollMoves ||
       documentScrollRange <= 20
      ) ? bestAppScrollTarget : null
    );
    if (autoTarget) {
      chosen = useElementTarget(autoTarget, overlayTargets.length ? 'popup' : 'container');
    }
  }

  if (settings.cropToScrollTarget === false) {
    chosen.targetRect = null;
  }

  let targetName = 'Full Document / Window';
  let targetTag = 'WINDOW';
  let targetSelector = 'window';
  let canScroll = docHeight > window.innerHeight + 10;
  let targetDimensions = {
    width: window.innerWidth,
    height: docHeight,
    clientWidth: window.innerWidth,
    clientHeight: window.innerHeight
  };
  let scrollablePages = Math.max(1, Math.ceil(docHeight / Math.max(1, window.innerHeight)));

  if (!chosen.isWindowScroll && chosen.scrollTarget) {
    const el = chosen.scrollTarget;
    const tag = el.tagName.toLowerCase();
    const idStr = el.id ? `#${el.id}` : '';
    const classStr = (typeof el.className === 'string' && el.className.trim())
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const tagDesc = `${tag}${idStr}${classStr}`;
    targetTag = tagDesc.toUpperCase();
    targetSelector = generateCssSelector(el);
    let friendly = 'Inner Container';
    if (chosen.captureMode === 'popup') friendly = 'Modal / Dialog';
    else if (chosen.captureMode === 'container') friendly = 'App Container';
    targetName = `${friendly} (${tagDesc})`;
    canScroll = el.scrollHeight > el.clientHeight + 10;
    targetDimensions = {
      width: el.clientWidth,
      height: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight
    };
    scrollablePages = Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
  }

  return {
    ...chosen,
    docHeight,
    hasOverlay: overlayTargets.length > 0,
    viewportHeight: chosen.isWindowScroll ? window.innerHeight : chosen.scrollTarget.clientHeight,
    targetName,
    targetTag,
    targetSelector,
    canScroll,
    targetDimensions,
    scrollablePages
  };
}

function clearHighlightAndPicker() {
  const existingHighlight = document.getElementById('fullshot-target-highlighter');
  if (existingHighlight) existingHighlight.remove();
  const existingPicker = document.getElementById('fullshot-picker-ui');
  if (existingPicker) existingPicker.remove();
  if (window._fullshotPickerCleanup) {
    window._fullshotPickerCleanup();
    window._fullshotPickerCleanup = null;
  }
}

function highlightTargetSection(settings) {
  clearHighlightAndPicker();
  const analysis = analyzePageForCapture(settings);
  const highlighter = document.createElement('div');
  highlighter.id = 'fullshot-target-highlighter';

  let rect = null;
  const isWindow = analysis.isWindowScroll || !analysis.scrollTarget;
  if (!isWindow && analysis.scrollTarget) {
    rect = analysis.scrollTarget.getBoundingClientRect();
  }

  highlighter.style.position = 'fixed';
  highlighter.style.zIndex = '2147483646';
  highlighter.style.pointerEvents = 'none';
  highlighter.style.transition = 'opacity 0.4s ease';
  highlighter.style.opacity = '1';

  if (isWindow || !rect) {
    highlighter.style.top = '0';
    highlighter.style.left = '0';
    highlighter.style.width = '100vw';
    highlighter.style.height = '100vh';
    highlighter.style.boxShadow = 'inset 0 0 0 4px #6366f1, inset 0 0 24px rgba(99, 102, 241, 0.35)';
    highlighter.style.boxSizing = 'border-box';
  } else {
    highlighter.style.left = `${Math.max(0, rect.left)}px`;
    highlighter.style.top = `${Math.max(0, rect.top)}px`;
    highlighter.style.width = `${Math.min(window.innerWidth - Math.max(0, rect.left), rect.width)}px`;
    highlighter.style.height = `${Math.min(window.innerHeight - Math.max(0, rect.top), rect.height)}px`;
    highlighter.style.border = '3px solid #6366f1';
    highlighter.style.borderRadius = '6px';
    highlighter.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.9), 0 0 25px rgba(99, 102, 241, 0.55)';
    highlighter.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
    highlighter.style.boxSizing = 'border-box';
  }

  const pill = document.createElement('div');
  pill.style.position = 'absolute';
  pill.style.left = isWindow ? '50%' : '12px';
  pill.style.top = isWindow ? '16px' : (rect && rect.top > 40 ? '-38px' : '10px');
  if (isWindow) pill.style.transform = 'translateX(-50%)';
  pill.style.background = '#1e1b4b';
  pill.style.color = '#ffffff';
  pill.style.border = '1px solid #818cf8';
  pill.style.borderRadius = '999px';
  pill.style.padding = '6px 14px';
  pill.style.font = '600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  pill.style.boxShadow = '0 4px 14px rgba(0,0,0,0.45)';
  pill.style.display = 'flex';
  pill.style.alignItems = 'center';
  pill.style.gap = '8px';
  pill.style.pointerEvents = 'auto';
  pill.style.whiteSpace = 'nowrap';
  pill.style.userSelect = 'none';

  const badgeIcon = document.createElement('span');
  badgeIcon.textContent = '🎯';
  pill.appendChild(badgeIcon);

  const textSpan = document.createElement('span');
  const dims = analysis.targetDimensions;
  const dimText = dims ? `${Math.round(dims.width)} × ${Math.round(dims.height)}px` : '';
  const scrollText = analysis.canScroll ? `Scrollable (${analysis.scrollablePages} pages)` : 'Single view';
  textSpan.textContent = `Fullshot Target: ${analysis.targetName} [${dimText} · ${scrollText}]`;
  pill.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.background = 'transparent';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#c7d2fe';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '12px';
  closeBtn.style.padding = '0 2px';
  closeBtn.style.marginLeft = '4px';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    highlighter.remove();
  };
  pill.appendChild(closeBtn);

  highlighter.appendChild(pill);
  document.documentElement.appendChild(highlighter);

  clearTimeout(window._fullshotHighlightTimer);
  window._fullshotHighlightTimer = setTimeout(() => {
    if (highlighter.parentElement) {
      highlighter.style.opacity = '0';
      setTimeout(() => highlighter.remove(), 400);
    }
  }, 4000);

  return analysis;
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = '#065f46';
  toast.style.color = '#ffffff';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '999px';
  toast.style.font = '600 13px -apple-system, sans-serif';
  toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
  toast.style.zIndex = '2147483647';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '8px';
  toast.innerHTML = `<span>✓</span><span>${text}</span>`;
  document.documentElement.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function startElementPicker() {
  clearHighlightAndPicker();

  const pickerContainer = document.createElement('div');
  pickerContainer.id = 'fullshot-picker-ui';
  pickerContainer.style.position = 'fixed';
  pickerContainer.style.inset = '0';
  pickerContainer.style.zIndex = '2147483647';
  pickerContainer.style.pointerEvents = 'none';

  const banner = document.createElement('div');
  banner.style.position = 'fixed';
  banner.style.top = '14px';
  banner.style.left = '50%';
  banner.style.transform = 'translateX(-50%)';
  banner.style.background = '#0f172a';
  banner.style.color = '#f8fafc';
  banner.style.border = '2px solid #6366f1';
  banner.style.borderRadius = '12px';
  banner.style.padding = '10px 18px';
  banner.style.font = '500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  banner.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  banner.style.display = 'flex';
  banner.style.alignItems = 'center';
  banner.style.gap = '12px';
  banner.style.pointerEvents = 'auto';
  banner.style.userSelect = 'none';

  banner.innerHTML = `
    <span style="font-size: 16px;">🎯</span>
    <span><strong>Select section to capture:</strong> Hover and click any section/container. Press <strong>Esc</strong> to cancel.</span>
  `;

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.background = '#334155';
  cancelBtn.style.color = '#f8fafc';
  cancelBtn.style.border = 'none';
  cancelBtn.style.borderRadius = '6px';
  cancelBtn.style.padding = '5px 12px';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontWeight = '600';
  cancelBtn.style.fontSize = '12px';
  banner.appendChild(cancelBtn);

  const inspectBox = document.createElement('div');
  inspectBox.style.position = 'fixed';
  inspectBox.style.pointerEvents = 'none';
  inspectBox.style.border = '2px dashed #818cf8';
  inspectBox.style.backgroundColor = 'rgba(129, 140, 248, 0.15)';
  inspectBox.style.borderRadius = '4px';
  inspectBox.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.4)';
  inspectBox.style.display = 'none';
  inspectBox.style.transition = 'all 0.08s ease-out';

  const inspectPill = document.createElement('div');
  inspectPill.style.position = 'absolute';
  inspectPill.style.top = '-26px';
  inspectPill.style.left = '0';
  inspectPill.style.background = '#312e81';
  inspectPill.style.color = '#e0e7ff';
  inspectPill.style.font = '600 11px -apple-system, sans-serif';
  inspectPill.style.padding = '3px 8px';
  inspectPill.style.borderRadius = '4px';
  inspectPill.style.whiteSpace = 'nowrap';
  inspectBox.appendChild(inspectPill);

  pickerContainer.appendChild(banner);
  pickerContainer.appendChild(inspectBox);
  document.documentElement.appendChild(pickerContainer);

  let currentTargetEl = null;

  const onMouseMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.body || el === document.documentElement || el.closest('#fullshot-picker-ui')) {
      inspectBox.style.display = 'none';
      currentTargetEl = null;
      return;
    }

    let candidate = el;
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const style = window.getComputedStyle(curr);
      const isScroll = ['auto', 'scroll', 'overlay'].includes(style.overflowY) && curr.scrollHeight > curr.clientHeight + 20;
      if (isScroll && curr.clientHeight >= 80 && curr.clientWidth >= 80) {
        candidate = curr;
        break;
      }
      curr = curr.parentElement;
    }

    currentTargetEl = candidate;
    const rect = candidate.getBoundingClientRect();
    inspectBox.style.display = 'block';
    inspectBox.style.left = `${Math.max(0, rect.left)}px`;
    inspectBox.style.top = `${Math.max(0, rect.top)}px`;
    inspectBox.style.width = `${Math.min(window.innerWidth - Math.max(0, rect.left), rect.width)}px`;
    inspectBox.style.height = `${Math.min(window.innerHeight - Math.max(0, rect.top), rect.height)}px`;

    const tag = candidate.tagName.toLowerCase();
    const id = candidate.id ? `#${candidate.id}` : '';
    const isScrollable = candidate.scrollHeight > candidate.clientHeight + 10;
    inspectPill.textContent = `<${tag}${id}> ${Math.round(rect.width)}×${Math.round(rect.height)} ${isScrollable ? '· [Scrollable]' : ''}`;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };

  const onClick = (e) => {
    if (e.target && e.target.closest('#fullshot-picker-ui')) {
      if (e.target === cancelBtn || cancelBtn.contains(e.target)) {
        cleanup();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const selected = currentTargetEl || document.elementFromPoint(e.clientX, e.clientY);
    cleanup();

    if (selected && selected !== document.body && selected !== document.documentElement) {
      const selector = generateCssSelector(selected);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('capture_settings', (data) => {
          const s = data.capture_settings || {};
          s.scrollTarget = 'selector';
          s.selector = selector;
          chrome.storage.local.set({ capture_settings: s });
        });
      }

      highlightTargetSection({ scrollTarget: 'selector', selector });
      showToast(`Target selected: ${selector}`);
    }
  };

  function cleanup() {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    pickerContainer.remove();
    window._fullshotPickerCleanup = null;
  }

  cancelBtn.onclick = (e) => {
    e.stopPropagation();
    cleanup();
  };

  window._fullshotPickerCleanup = cleanup;
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
}

window.screenCaptureListener = (request, sender, sendResponse) => {
  if (request.action === "inspect_page") {
    const analysis = analyzePageForCapture(getFullshotSettings(request));
    sendResponse({
      captureMode: analysis.captureMode,
      hasOverlay: analysis.hasOverlay,
      totalHeight: analysis.totalHeight,
      viewportHeight: analysis.viewportHeight,
      targetName: analysis.targetName,
      targetTag: analysis.targetTag,
      targetSelector: analysis.targetSelector,
      canScroll: analysis.canScroll,
      targetDimensions: analysis.targetDimensions,
      scrollablePages: analysis.scrollablePages
    });
    return true;
  }

  if (request.action === "highlight_target") {
    const analysis = highlightTargetSection(getFullshotSettings(request));
    sendResponse({
      captureMode: analysis.captureMode,
      hasOverlay: analysis.hasOverlay,
      totalHeight: analysis.totalHeight,
      viewportHeight: analysis.viewportHeight,
      targetName: analysis.targetName,
      targetTag: analysis.targetTag,
      targetSelector: analysis.targetSelector,
      canScroll: analysis.canScroll,
      targetDimensions: analysis.targetDimensions,
      scrollablePages: analysis.scrollablePages
    });
    return true;
  }

  if (request.action === "start_element_picker") {
    startElementPicker();
    sendResponse({ started: true });
    return true;
  }

  if (request.action === "clear_highlight") {
    clearHighlightAndPicker();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "start_scroll_capture") {
    clearHighlightAndPicker();
    const settings = getFullshotSettings(request);
    window.fullshotSettings = settings;
    const analysis = analyzePageForCapture(settings);
    const scrollTarget = analysis.scrollTarget;
    const isWindowScroll = analysis.isWindowScroll;
    const totalHeight = analysis.totalHeight;
    const targetRect = analysis.targetRect;
    const captureMode = analysis.captureMode;
    const viewportHeight = analysis.viewportHeight;

    const getVisibleContentBottom = () => {
      if (!isWindowScroll) return scrollTarget ? scrollTarget.scrollHeight : window.innerHeight;
      return Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
        window.innerHeight
      );
    };
    window.captureGetVisibleContentBottom = getVisibleContentBottom;
    window.captureScrollTarget = scrollTarget;
    window.captureIsWindowScroll = isWindowScroll;
    window.captureMode = captureMode;

    const insets = getCaptureInsets(settings, captureMode);
    const captureTopInset = captureMode === 'popup' && settings.insetMode !== 'manual' ? 0 : insets.top;
    const captureBottomInset = captureMode === 'popup' && settings.insetMode !== 'manual' ? 0 : insets.bottom;
    const effectiveViewportHeight = Math.max(80, viewportHeight - captureTopInset - captureBottomInset);
    const totalPages = Math.max(
      1,
      Math.ceil(Math.max(1, totalHeight - viewportHeight) / effectiveViewportHeight) + 1
    );
    window.originalScrollTop = isWindowScroll
      ? (window.scrollY || window.pageYOffset || (document.documentElement ? document.documentElement.scrollTop : 0) || (document.body ? document.body.scrollTop : 0) || 0)
      : scrollTarget.scrollTop;

    if (settings.disableAnimations !== false) {
      let captureStyle = document.getElementById('fullshot-capture-styles');
      if (!captureStyle) {
        captureStyle = document.createElement('style');
        captureStyle.id = 'fullshot-capture-styles';
        captureStyle.textContent = '* { scroll-behavior: auto !important; transition: none !important; animation: none !important; }';
        (document.head || document.documentElement).appendChild(captureStyle);
      }
    }

    window.hiddenFixedElements = [];
    if (settings.hideStickyBars !== false && settings.headerMode !== 'once') {
      window.captureBarTimer = setInterval(hidePersistentBars, 50);
      window.captureBarObserver = new MutationObserver(() => hidePersistentBars());
      window.captureBarObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    sendResponse({
      totalHeight,
      viewportHeight,
      effectiveViewportHeight,
      captureTopInset,
      captureBottomInset,
      totalPages,
      targetWidth: scrollTarget ? scrollTarget.clientWidth : window.innerWidth,
      targetRect,
      captureMode,
      originalScrollTop: window.originalScrollTop || 0,
      devicePixelRatio: window.devicePixelRatio || 1
    });
    return true;
  }

  if (request.action === "scroll_to") {
    const settings = getFullshotSettings(request);
    const isWindow = window.captureIsWindowScroll !== false;
    const targetEl = window.captureScrollTarget;
    const viewportHeight = isWindow ? window.innerHeight : (targetEl ? targetEl.clientHeight : window.innerHeight);
    const targetY = request.targetY !== undefined ? request.targetY : (request.index * viewportHeight);
    const scrollRoot = document.scrollingElement || document.documentElement || document.body;
    const scrollRetries = Math.max(1, Number(settings.scrollRetries) || 8);
    const confirmDelay = Math.max(80, Math.min(400, Math.round((Number(settings.settleDelayMs) || 600) / 3)));

    const shouldHideSticky = settings.hideStickyBars !== false &&
      (settings.headerMode !== 'once' || (request.index && request.index > 0));

    if (shouldHideSticky) {
      if (!window.captureBarTimer && settings.headerMode === 'once') {
        window.captureBarTimer = setInterval(hidePersistentBars, 50);
        window.captureBarObserver = new MutationObserver(() => hidePersistentBars());
        window.captureBarObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      hidePersistentBars();
    }

    if (isWindow) {
      window.scrollTo(0, targetY);
      if (scrollRoot) scrollRoot.scrollTop = targetY;
      if (document.documentElement) document.documentElement.scrollTop = targetY;
      if (document.body) document.body.scrollTop = targetY;
    } else if (targetEl) {
      targetEl.scrollTop = targetY;
    }

    const waitForDynamicHeightToSettle = (initialHeight, maxWait = Math.max(400, Number(settings.bottomWaitMs) || 500)) =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        let lastHeight = initialHeight;
        let stableSince = Date.now();
        const check = () => {
          const currentHeight = isWindow
            ? Math.max(
              document.documentElement ? document.documentElement.scrollHeight : 0,
              document.body ? document.body.scrollHeight : 0,
              window.innerHeight
            )
            : (targetEl ? targetEl.scrollHeight : initialHeight);
          if (currentHeight !== lastHeight) {
            lastHeight = currentHeight;
            stableSince = Date.now();
          }
          if (Date.now() - stableSince >= 500 || Date.now() - startedAt >= maxWait) {
            resolve(currentHeight);
            return;
          }
          setTimeout(check, 150);
        };
        setTimeout(check, 150);
      });

    const replyAfterScrollSettles = (attempt = 0) => {
      if (shouldHideSticky) {
        hidePersistentBars();
      }
      const actualScrollY = isWindow
        ? (scrollRoot ? scrollRoot.scrollTop : 0) ||
          window.scrollY ||
          window.pageYOffset ||
          (document.documentElement ? document.documentElement.scrollTop : 0) ||
          0
        : (targetEl ? targetEl.scrollTop : targetY);

      const maxScrollY = Math.max(0, (isWindow ? (
        Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        ) - window.innerHeight
      ) : (targetEl ? targetEl.scrollHeight - targetEl.clientHeight : targetY)));
      const expectedScrollY = Math.min(Math.max(0, targetY), maxScrollY);
      if (attempt < scrollRetries && Math.abs(actualScrollY - expectedScrollY) > 2) {
        setTimeout(() => replyAfterScrollSettles(attempt + 1), 80);
        return;
      }
      const measuredHeight = isWindow
        ? Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0,
          window.innerHeight
        )
        : (targetEl ? targetEl.scrollHeight : targetY + viewportHeight);
      const currentTotalHeight = isWindow
        ? Math.max(
          typeof window.captureGetVisibleContentBottom === 'function'
            ? window.captureGetVisibleContentBottom()
            : (document.documentElement ? document.documentElement.scrollHeight : window.innerHeight),
          actualScrollY + viewportHeight
        )
        : (targetEl ? targetEl.scrollHeight : targetY + viewportHeight);
      const maxScroll = Math.max(
        0,
        currentTotalHeight - viewportHeight
      );
      const atBottom = actualScrollY >= maxScroll - 4;
      if (atBottom && attempt === 0 && settings.waitForDynamicHeight !== false) {
        waitForDynamicHeightToSettle(measuredHeight).then((settledHeight) => {
          const settledMaxScroll = Math.max(0, settledHeight - viewportHeight);
          sendResponse({
            success: true,
            actualScrollY,
            totalHeight: Math.max(currentTotalHeight, settledHeight),
            viewportHeight,
            atBottom: actualScrollY >= settledMaxScroll - 4
          });
        });
        return;
      }
      sendResponse({
        success: true,
        actualScrollY,
        totalHeight: currentTotalHeight,
        viewportHeight,
        atBottom
      });
    };
    setTimeout(() => replyAfterScrollSettles(), confirmDelay);
    return true;
  }

  if (request.action === "restore_scroll") {
    const isWindow = window.captureIsWindowScroll !== false;
    const targetEl = window.captureScrollTarget;
    const scrollRoot = document.scrollingElement || document.documentElement || document.body;

    if (window.originalScrollTop !== undefined) {
      if (isWindow) {
        window.scrollTo(0, window.originalScrollTop);
        if (scrollRoot) scrollRoot.scrollTop = window.originalScrollTop;
        if (document.documentElement) document.documentElement.scrollTop = window.originalScrollTop;
        if (document.body) document.body.scrollTop = window.originalScrollTop;
      } else if (targetEl) {
        targetEl.scrollTop = window.originalScrollTop;
      }
    }

    const captureStyle = document.getElementById('fullshot-capture-styles');
    if (captureStyle) {
      captureStyle.remove();
    }

    if (window.captureBarTimer) {
      clearInterval(window.captureBarTimer);
      window.captureBarTimer = null;
    }
    if (window.captureBarObserver) {
      window.captureBarObserver.disconnect();
      window.captureBarObserver = null;
    }
    window.captureGetVisibleContentBottom = null;

    if (window.hiddenFixedElements && window.hiddenFixedElements.length > 0) {
      window.hiddenFixedElements.forEach(item => {
        try {
          item.element.style.visibility = item.origVisibility;
          item.element.style.display = item.origDisplay;
        } catch (e) {}
      });
      window.hiddenFixedElements = [];
    }

    sendResponse({ success: true });
    return true;
  }
};

function hidePersistentBars() {
  if (!window.hiddenFixedElements) window.hiddenFixedElements = [];
  if (window.fullshotSettings && window.fullshotSettings.hideStickyBars === false) return;

  try {
    const targetNode = window.captureScrollTarget;
    const elements = [];
    const collect = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('*').forEach((node) => {
        elements.push(node);
        if (node.shadowRoot) collect(node.shadowRoot);
      });
    };
    collect(document.body);
    elements.forEach((el) => {
      try {
        if (el.tagName === 'BODY' || el.tagName === 'HTML') return;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none') return;

        if (window.captureMode === 'popup' && targetNode && (
          el === targetNode ||
          el.contains(targetNode) ||
          targetNode.contains(el)
        )) return;

        const rect = el.getBoundingClientRect();
        const visible = rect.width > 40 && rect.height > 8 &&
          rect.right > 0 && rect.left < window.innerWidth &&
          rect.bottom > 0 && rect.top < window.innerHeight;
        const positioned = style.position === 'fixed' || style.position === 'sticky';
        const absolutelyPositioned = style.position === 'absolute';
        const elevated = Number.isFinite(Number(style.zIndex)) && Number(style.zIndex) >= 10;
        const shortEnough = rect.height < window.innerHeight * 0.5;
        const anchored = rect.top <= 120 || rect.bottom >= window.innerHeight - 120;
        const wideOverlay = rect.width >= Math.min(320, window.innerWidth * 0.35);
        const promptText = (el.innerText || '').slice(0, 600).toLowerCase();
        const promptLike = /ask gemini|not finding|describe the image|ask anything|send money/.test(promptText);

        const shouldHide = window.captureMode !== 'popup'
          ? ((positioned || (absolutelyPositioned && anchored && wideOverlay && elevated)) && shortEnough) ||
            (promptLike && anchored && shortEnough && wideOverlay)
          : positioned && shortEnough && anchored;
        if (visible && shouldHide && (positioned || absolutelyPositioned || elevated || promptLike)) {
          if (!window.hiddenFixedElements.some((item) => item.element === el)) {
            window.hiddenFixedElements.push({
              element: el,
              origVisibility: el.style.visibility || '',
              origDisplay: el.style.display || ''
            });
          }

          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('display', 'none', 'important');
        }
      } catch (e) {}
    });
  } catch (e) {
    console.warn("Could not hide persistent bars:", e);
  }
}

function getCaptureInsets(settings, captureMode) {
  settings = settings || window.fullshotSettings || {};
  const mode = captureMode || window.captureMode;
  if (settings.insetMode === 'none') return { top: 0, bottom: 0 };
  if (settings.insetMode === 'manual') {
    return {
      top: Math.max(0, Number(settings.topInsetPx) || 0),
      bottom: Math.max(0, Number(settings.bottomInsetPx) || 0)
    };
  }
  if (mode === 'popup') return { top: 0, bottom: 0 };

  let top = 0;
  let bottom = 0;
  try {
    document.querySelectorAll('body *').forEach((el) => {
      if (el.tagName === 'BODY' || el.tagName === 'HTML') return;
      const style = window.getComputedStyle(el);
      if (!style || (style.position !== 'fixed' && style.position !== 'sticky')) return;
      if (window.captureScrollTarget && (
        el === window.captureScrollTarget ||
        el.contains(window.captureScrollTarget) ||
        window.captureScrollTarget.contains(el)
      )) return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 8 || rect.right <= 0 || rect.left >= window.innerWidth) return;
      if (rect.top <= 160 && rect.bottom > top && rect.bottom < window.innerHeight * 0.6) {
        top = Math.max(top, Math.round(rect.bottom));
      }
      if (rect.bottom >= window.innerHeight - 160 && rect.top > window.innerHeight * 0.4) {
        bottom = Math.max(bottom, Math.round(window.innerHeight - rect.top));
      }
    });
  } catch (e) {}
  return { top, bottom };
}

chrome.runtime.onMessage.addListener(window.screenCaptureListener);

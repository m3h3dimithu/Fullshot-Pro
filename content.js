// content.js - Injected directly into the website tab
if (window.screenCaptureListener) {
  try {
    chrome.runtime.onMessage.removeListener(window.screenCaptureListener);
  } catch (e) {
    // Old extension context was invalidated, ignore
  }
}

window.screenCaptureListener = (request, sender, sendResponse) => {
  if (request.action === "start_scroll_capture") {
    const doc = document.documentElement;
    const body = document.body;
    
    // Check document scrolling height
    const docHeight = Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      doc ? doc.offsetHeight : 0,
      body ? body.offsetHeight : 0,
      doc ? doc.clientHeight : 0,
      window.innerHeight
    );

    let scrollTarget = null;
    let isWindowScroll = true;
    let totalHeight = docHeight;
    let targetRect = null;
    let captureMode = 'page';

    const isVisibleOnScreen = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width >= 40 && rect.height >= 40 &&
        rect.bottom > 0 && rect.right > 0 &&
        rect.top < window.innerHeight && rect.left < window.innerWidth;
    };

    const getElementText = (el) =>
      `${el.tagName} ${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ` +
      `${el.getAttribute('role') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();

    const isOverlayElement = (el) => {
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
    };

    const getOverlayScore = (el) => {
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
    };

    const collectElements = (root, result = []) => {
      if (!root || !root.querySelectorAll) return result;
      root.querySelectorAll('*').forEach((el) => {
        result.push(el);
        if (el.shadowRoot) collectElements(el.shadowRoot, result);
      });
      return result;
    };
    const allVisibleElements = collectElements(document.body).filter(isVisibleOnScreen);
    const getVisibleContentBottom = () => {
      if (!isWindowScroll) return scrollTarget ? scrollTarget.scrollHeight : window.innerHeight;
      return Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
        window.innerHeight
      );
    };
    window.captureGetVisibleContentBottom = getVisibleContentBottom;
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
      // Prefer the deepest/smallest visible scroll area: this is usually the
      // content panel inside a fixed modal or dropdown wrapper.
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

    // Prefer an open modal/menu/popup even when the page itself is also scrollable.
    // Only fall back to an inner app container when the document itself is not scrolling.
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
    const appScrollRange = bestAppScrollTarget
      ? bestAppScrollTarget.scrollHeight - bestAppScrollTarget.clientHeight
      : 0;

    // If an app owns the viewport (Gemini/Pinterest-style layouts), its
    // internal scroll range is authoritative only when the document scroll
    // root cannot actually move. This avoids mistaking a large sidebar or
    // carousel for the page on ordinary websites.
    scrollTarget = overlayTargets[0] ? overlayTargets[0].target : (
      bestAppScrollTarget && (
       !windowScrollMoves ||
       documentScrollRange <= 20
      ) ? bestAppScrollTarget : null
    );
    if (scrollTarget) {
      isWindowScroll = false;
      totalHeight = scrollTarget.scrollHeight;
      const rect = scrollTarget.getBoundingClientRect();
      targetRect = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.min(window.innerWidth, Math.round(rect.width)),
        height: Math.min(window.innerHeight, Math.round(rect.height))
      };
      targetRect.viewportWidth = window.innerWidth;
      targetRect.viewportHeight = window.innerHeight;
      captureMode = overlayTargets.length ? 'popup' : 'container';
    }

    window.captureScrollTarget = scrollTarget;
    window.captureIsWindowScroll = isWindowScroll;
    window.captureMode = captureMode;

    const viewportHeight = isWindowScroll ? window.innerHeight : scrollTarget.clientHeight;
    const insets = getCaptureInsets();
    const captureTopInset = captureMode === 'popup' ? 0 : insets.top;
    const captureBottomInset = captureMode === 'popup' ? 0 : insets.bottom;
    const effectiveViewportHeight = Math.max(80, viewportHeight - captureTopInset - captureBottomInset);
    const totalPages = Math.max(
      1,
      Math.ceil(Math.max(1, totalHeight - viewportHeight) / effectiveViewportHeight) + 1
    );
    // Save original scroll state
    window.originalScrollTop = isWindowScroll 
      ? (window.scrollY || window.pageYOffset || (doc ? doc.scrollTop : 0) || (body ? body.scrollTop : 0) || 0)
      : scrollTarget.scrollTop;

    // Inject styles to disable smooth scrolling and transitions
    let captureStyle = document.getElementById('fullshot-capture-styles');
    if (!captureStyle) {
      captureStyle = document.createElement('style');
      captureStyle.id = 'fullshot-capture-styles';
      captureStyle.textContent = '* { scroll-behavior: auto !important; transition: none !important; animation: none !important; }';
      (document.head || document.documentElement).appendChild(captureStyle);
    }

    window.hiddenFixedElements = [];
    window.captureBarTimer = setInterval(hidePersistentBars, 50);
    window.captureBarObserver = new MutationObserver(() => hidePersistentBars());
    window.captureBarObserver.observe(document.documentElement, { childList: true, subtree: true });

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
      devicePixelRatio: window.devicePixelRatio || 1
    });
    return true;
  }

  if (request.action === "scroll_to") {
    const isWindow = window.captureIsWindowScroll !== false;
    const targetEl = window.captureScrollTarget;
    const viewportHeight = isWindow ? window.innerHeight : (targetEl ? targetEl.clientHeight : window.innerHeight);
    const targetY = request.targetY !== undefined ? request.targetY : (request.index * viewportHeight);
    const scrollRoot = document.scrollingElement || document.documentElement || document.body;

    // Pages can re-create sticky/fixed bars after every scroll. Re-scan before
    // every slice so newly-rendered bars cannot get baked into the stitch.
    hidePersistentBars();

    if (isWindow) {
      window.scrollTo(0, targetY);
      if (scrollRoot) scrollRoot.scrollTop = targetY;
      if (document.documentElement) document.documentElement.scrollTop = targetY;
      if (document.body) document.body.scrollTop = targetY;
    } else if (targetEl) {
      targetEl.scrollTop = targetY;
    }

    const waitForDynamicHeightToSettle = (initialHeight, maxWait = 2400) =>
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

    // Some sites recreate sticky UI after the scroll event. Wait for that
    // render pass, then hide the newly-created bars before captureVisibleTab.
    const replyAfterScrollSettles = (attempt = 0) => {
      hidePersistentBars();
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
      if (attempt < 8 && Math.abs(actualScrollY - expectedScrollY) > 2) {
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
      if (atBottom && attempt === 0) {
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
    setTimeout(() => replyAfterScrollSettles(), 250);
    return true;
  }

  if (request.action === "restore_scroll") {
    const isWindow = window.captureIsWindowScroll !== false;
    const targetEl = window.captureScrollTarget;
    const scrollRoot = document.scrollingElement || document.documentElement || document.body;

    // Restore original scroll
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

    // Remove capture styles
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

    // Restore hidden sticky/fixed elements
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

        // For a normal page capture, any visible fixed/sticky element can
        // repeat in every slice, even when it is not exactly flush with an edge.
        // For popup capture, preserve the selected popup and its descendants.
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

function getCaptureInsets() {
  if (window.captureMode === 'popup') return { top: 0, bottom: 0 };

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

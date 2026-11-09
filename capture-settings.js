const FULLSHOT_SETTINGS_KEY = 'capture_settings';

const FULLSHOT_DEFAULT_SETTINGS = {
  captureType: 'fullpage',
  layoutPreset: 'auto',
  scrollTarget: 'auto',
  selector: '',
  pacePreset: 'normal',
  settleDelayMs: 600,
  startDelayMs: 200,
  bottomWaitMs: 500,
  overlapPercent: 28,
  maxSlices: 40,
  headerMode: 'once',
  hideStickyBars: true,
  disableAnimations: true,
  waitForDynamicHeight: true,
  skipDuplicateFrames: true,
  cropToScrollTarget: true,
  insetMode: 'auto',
  topInsetPx: 0,
  bottomInsetPx: 0,
  scrollRetries: 8
};

const FULLSHOT_PACE_PRESETS = {
  fast: { settleDelayMs: 250, startDelayMs: 80, bottomWaitMs: 180, overlapPercent: 18 },
  normal: { settleDelayMs: 600, startDelayMs: 200, bottomWaitMs: 500, overlapPercent: 28 },
  slow: { settleDelayMs: 1100, startDelayMs: 400, bottomWaitMs: 1100, overlapPercent: 32 },
  careful: { settleDelayMs: 1800, startDelayMs: 650, bottomWaitMs: 2000, overlapPercent: 38 }
};

const FULLSHOT_LAYOUT_PRESETS = {
  auto: {
    scrollTarget: 'auto',
    headerMode: 'once',
    hideStickyBars: true,
    disableAnimations: true,
    waitForDynamicHeight: true,
    skipDuplicateFrames: true,
    cropToScrollTarget: true,
    insetMode: 'auto',
    pacePreset: 'normal'
  },
  article: {
    scrollTarget: 'window',
    headerMode: 'once',
    hideStickyBars: true,
    disableAnimations: true,
    waitForDynamicHeight: false,
    skipDuplicateFrames: true,
    cropToScrollTarget: false,
    insetMode: 'auto',
    pacePreset: 'normal'
  },
  spa: {
    scrollTarget: 'container',
    headerMode: 'once',
    hideStickyBars: true,
    disableAnimations: true,
    waitForDynamicHeight: true,
    skipDuplicateFrames: true,
    cropToScrollTarget: true,
    insetMode: 'auto',
    pacePreset: 'slow'
  },
  modal: {
    scrollTarget: 'popup',
    headerMode: 'repeat',
    hideStickyBars: false,
    disableAnimations: true,
    waitForDynamicHeight: true,
    skipDuplicateFrames: true,
    cropToScrollTarget: true,
    insetMode: 'none',
    pacePreset: 'normal'
  },
  sticky: {
    scrollTarget: 'auto',
    headerMode: 'once',
    hideStickyBars: true,
    disableAnimations: true,
    waitForDynamicHeight: true,
    skipDuplicateFrames: true,
    cropToScrollTarget: true,
    insetMode: 'auto',
    overlapPercent: 36,
    pacePreset: 'slow'
  },
  lazy: {
    scrollTarget: 'auto',
    headerMode: 'once',
    hideStickyBars: true,
    disableAnimations: true,
    waitForDynamicHeight: true,
    skipDuplicateFrames: true,
    cropToScrollTarget: true,
    insetMode: 'auto',
    pacePreset: 'careful'
  }
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function applyPacePreset(settings, pacePreset) {
  const pace = FULLSHOT_PACE_PRESETS[pacePreset];
  if (!pace) return settings;
  return {
    ...settings,
    pacePreset,
    settleDelayMs: pace.settleDelayMs,
    startDelayMs: pace.startDelayMs,
    bottomWaitMs: pace.bottomWaitMs,
    overlapPercent: settings.layoutPreset === 'sticky' ? Math.max(settings.overlapPercent, pace.overlapPercent) : pace.overlapPercent
  };
}

function applyLayoutPreset(settings, layoutPreset) {
  const layout = FULLSHOT_LAYOUT_PRESETS[layoutPreset];
  if (!layout) return { ...settings, layoutPreset };
  const next = {
    ...settings,
    ...layout,
    layoutPreset,
    selector: settings.selector
  };
  return applyPacePreset(next, layout.pacePreset || next.pacePreset);
}

function normalizeCaptureSettings(raw) {
  const merged = { ...FULLSHOT_DEFAULT_SETTINGS, ...(raw || {}) };
  merged.captureType = merged.captureType === 'visible' ? 'visible' : 'fullpage';
  merged.layoutPreset = FULLSHOT_LAYOUT_PRESETS[merged.layoutPreset] ? merged.layoutPreset : 'auto';
  merged.scrollTarget = ['auto', 'window', 'container', 'popup', 'selector'].includes(merged.scrollTarget)
    ? merged.scrollTarget
    : 'auto';
  merged.selector = typeof merged.selector === 'string' ? merged.selector.trim() : '';
  merged.pacePreset = FULLSHOT_PACE_PRESETS[merged.pacePreset] ? merged.pacePreset : 'custom';
  merged.settleDelayMs = clampNumber(merged.settleDelayMs, 80, 4000, 600);
  merged.startDelayMs = clampNumber(merged.startDelayMs, 0, 3000, 200);
  merged.bottomWaitMs = clampNumber(merged.bottomWaitMs, 0, 4000, 500);
  merged.overlapPercent = clampNumber(merged.overlapPercent, 0, 60, 28);
  merged.maxSlices = clampNumber(merged.maxSlices, 1, 80, 40);
  merged.headerMode = ['once', 'hide', 'repeat'].includes(merged.headerMode)
    ? merged.headerMode
    : (merged.hideStickyBars === false ? 'repeat' : 'once');
  merged.hideStickyBars = merged.headerMode !== 'repeat';
  merged.disableAnimations = merged.disableAnimations !== false;
  merged.waitForDynamicHeight = merged.waitForDynamicHeight !== false;
  merged.skipDuplicateFrames = merged.skipDuplicateFrames !== false;
  merged.cropToScrollTarget = merged.cropToScrollTarget !== false;
  merged.insetMode = ['auto', 'none', 'manual'].includes(merged.insetMode) ? merged.insetMode : 'auto';
  merged.topInsetPx = clampNumber(merged.topInsetPx, 0, 600, 0);
  merged.bottomInsetPx = clampNumber(merged.bottomInsetPx, 0, 600, 0);
  merged.scrollRetries = clampNumber(merged.scrollRetries, 1, 20, 8);
  return merged;
}

async function loadCaptureSettings() {
  try {
    const data = await chrome.storage.local.get(FULLSHOT_SETTINGS_KEY);
    return normalizeCaptureSettings(data[FULLSHOT_SETTINGS_KEY]);
  } catch (e) {
    return { ...FULLSHOT_DEFAULT_SETTINGS };
  }
}

async function saveCaptureSettings(settings) {
  const normalized = normalizeCaptureSettings(settings);
  await chrome.storage.local.set({ [FULLSHOT_SETTINGS_KEY]: normalized });
  return normalized;
}

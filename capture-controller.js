// capture-controller.js - Floating external controller window for screenshot capture
let isPaused = false;
let isStopping = false;

const headerStatus = document.getElementById('headerStatus');
const statusText = document.getElementById('statusText');
const sliceInfo = document.getElementById('sliceInfo');
const progressFill = document.getElementById('progressFill');
const pauseBtn = document.getElementById('pauseBtn');
const pauseIcon = document.getElementById('pauseIcon');
const pauseLabel = document.getElementById('pauseLabel');
const stopBtn = document.getElementById('stopBtn');
const cancelBtn = document.getElementById('cancelBtn');

function updatePauseUI(paused) {
  isPaused = paused;
  if (paused) {
    if (pauseIcon) pauseIcon.textContent = '▶️';
    if (pauseLabel) pauseLabel.textContent = 'Resume';
    if (pauseBtn) pauseBtn.style.background = '#4338ca';
    if (!isStopping) {
      if (headerStatus) {
        headerStatus.textContent = 'Paused';
        headerStatus.style.color = '#fbbf24';
      }
      if (statusText) statusText.textContent = '⏸️ Capture paused';
    }
  } else {
    if (pauseIcon) pauseIcon.textContent = '⏸️';
    if (pauseLabel) pauseLabel.textContent = 'Pause';
    if (pauseBtn) pauseBtn.style.background = '#312e81';
    if (!isStopping) {
      if (headerStatus) {
        headerStatus.textContent = 'Active';
        headerStatus.style.color = '#34d399';
      }
    }
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'capture_progress') {
    const { currentSlice, totalSlices, pct, isPaused: paused, status } = request;

    if (typeof paused === 'boolean' && paused !== isPaused) {
      updatePauseUI(paused);
    }

    if (Number.isFinite(pct)) {
      const clampedPct = Math.max(0, Math.min(100, pct));
      if (progressFill) progressFill.style.width = `${clampedPct}%`;
      if (sliceInfo) sliceInfo.textContent = `${clampedPct}%`;
    }

    if (!isStopping && !isPaused) {
      if (status && statusText) {
        statusText.textContent = status;
      } else if (totalSlices && currentSlice && statusText) {
        statusText.textContent = `📸 Slice ${currentSlice} of ${totalSlices} (${pct || 0}%)`;
      }
    }
  } else if (request.action === 'capture_controller_close') {
    window.close();
  }
});

if (pauseBtn) {
  pauseBtn.addEventListener('click', async () => {
    if (isStopping) return;
    const nextPaused = !isPaused;
    updatePauseUI(nextPaused);
    try {
      await chrome.runtime.sendMessage({
        action: nextPaused ? 'pause_capture' : 'resume_capture'
      });
    } catch (e) {
      console.warn('Could not send pause/resume message:', e);
    }
  });
}

if (stopBtn) {
  stopBtn.addEventListener('click', async () => {
    if (isStopping) return;
    isStopping = true;
    stopBtn.disabled = true;
    stopBtn.style.opacity = '0.6';
    stopBtn.style.cursor = 'not-allowed';
    if (headerStatus) {
      headerStatus.textContent = 'Stopping…';
      headerStatus.style.color = '#38bdf8';
    }
    if (statusText) {
      statusText.textContent = '⏹️ Finishing & opening editor…';
    }
    try {
      await chrome.runtime.sendMessage({ action: 'stop_capture' });
    } catch (e) {
      console.warn('Could not send stop message:', e);
    }
  });
}

if (cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.6';
    cancelBtn.style.cursor = 'not-allowed';
    if (headerStatus) {
      headerStatus.textContent = 'Cancelling…';
      headerStatus.style.color = '#f87171';
    }
    if (statusText) {
      statusText.textContent = '✕ Capture cancelled';
    }
    try {
      await chrome.runtime.sendMessage({ action: 'cancel_capture' });
    } catch (e) {
      console.warn('Could not send cancel message:', e);
    }
    setTimeout(() => window.close(), 150);
  });
}

// Global keyboard shortcuts while controller window has focus
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (pauseBtn) pauseBtn.click();
  } else if (e.code === 'Enter') {
    e.preventDefault();
    if (stopBtn) stopBtn.click();
  } else if (e.code === 'Escape') {
    e.preventDefault();
    if (cancelBtn) cancelBtn.click();
  }
});

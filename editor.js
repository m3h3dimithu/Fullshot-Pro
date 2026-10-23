// editor.js - Handles stitching, canvas scaling, annotations, clipboard copy, crop with undo/redo, live preview, and tool customization
let originalCanvas = null;
let canvas, ctx;
let zoom = 1.0;
let activeTool = 'select';
let strokeColor = '#ef4444';
let strokeWidth = 6;

let isDrawing = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

let annotations = [];
let undoStack = [];
let redoStack = [];

// Selection & drag & resize state
let selectedAnnotationId = null;
let isDraggingAnnotation = false;
let isResizingAnnotation = false;
let activeResizeHandle = null;
let dragStartCoords = { x: 0, y: 0 };
let dragAnnotationInitialPoints = [];
let dragAnnotationInitialFontSize = 22;
let dragAnnotationInitialBounds = null;
let dragAnnotationInitialRadius = 0;

// Crop tool state
let isCropping = false;
let cropBox = null; // { x, y, width, height }

// Live slider preview timer
let strokePreviewTimeout = null;

// Tool customization configuration
const toolConfig = {
  censorMode: 'pixelate',       // 'pixelate', 'smooth', 'redact'
  censorBlockSize: 14,          // 4 to 36
  highlighterOpacity: 0.35,     // 0.2 to 0.8
  fontFamily: 'sans-serif',     // 'sans-serif', 'serif', 'monospace'
  fontSizeMultiplier: 3.5,
  fontBold: true,
  shapeFill: 'none',            // 'none', 'semi', 'solid'
  cropAspect: 'free'            // 'free', '16:9', '4:3', '1:1'
};

let extensionDarkMode = true;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initEditor);
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initEditor();
}

function initEditor() {
  if (window.editorInitialized) return;
  window.editorInitialized = true;

  canvas = document.getElementById('editorCanvas');
  ctx = canvas.getContext('2d');

  initTheme();
  setupEvents();
  loadCapturedData();
  if (window.electronAPI && typeof window.electronAPI.onCaptureReady === 'function') {
    window.electronAPI.onCaptureReady(() => loadCapturedData());
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem('fullshot_theme') || 'dark';
  setTheme(savedTheme === 'dark');
}

function setTheme(isDark) {
  extensionDarkMode = isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');

  const sunIcon = document.getElementById('themeSunIcon');
  const moonIcon = document.getElementById('themeMoonIcon');
  if (sunIcon && moonIcon) {
    if (isDark) {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }

  localStorage.setItem('fullshot_theme', isDark ? 'dark' : 'light');
}

function loadCapturedData() {
  if (window.electronAPI && typeof window.electronAPI.getCapture === 'function') {
    window.electronAPI.getCapture().then((data) => {
      if (!data || !data.captured_chunks || data.captured_chunks.length === 0) {
        document.getElementById('resLabel').innerText = "No captured data found.";
        return;
      }
      document.getElementById('resLabel').innerText = `Loading ${data.captured_chunks.length} capture slice(s)...`;
      loadCaptureImages(data.captured_chunks, data.dimensions);
    }).catch((error) => {
      console.error('Could not load desktop capture:', error);
      document.getElementById('resLabel').innerText = "Could not load desktop capture.";
    });
    return;
  }

  chrome.storage.local.get(['captured_chunks', 'dimensions'], (data) => {
    loadCaptureImages(data.captured_chunks, data.dimensions);
  });
}

function loadCaptureImages(chunks, dims) {
    if (!chunks || chunks.length === 0) {
      document.getElementById('resLabel').innerText = "No captured data found.";
      return;
    }

    const uniqueChunks = [];
    let lastScrollY = null;
    chunks.forEach((chunk) => {
      const hasScrollY = chunk && typeof chunk === 'object' && chunk.scrollY !== undefined;
      const scrollY = hasScrollY ? Math.max(0, Math.round(Number(chunk.scrollY) || 0)) : null;
      if (scrollY !== null && lastScrollY !== null && Math.abs(scrollY - lastScrollY) <= 2) {
        return;
      }
      uniqueChunks.push(chunk);
      if (scrollY !== null) lastScrollY = scrollY;
    });

    chunks = uniqueChunks;
    document.getElementById('resLabel').innerText = `Stitching ${chunks.length} slices...`;

    let loaded = 0;
    const images = [];
    
    chunks.forEach((chunk, i) => {
      const img = new Image();
      const src = typeof chunk === 'string' ? chunk : chunk.dataUrl;
      img.onload = () => {
        loaded++;
        if (loaded === chunks.length) {
          stitch(images, dims, chunks);
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === chunks.length) {
          stitch(images, dims, chunks);
        }
      };
      img.src = src;
      images[i] = img;
    });
}

function stitch(images, dims, chunks) {
  const validImages = images.filter(img => img && img.width > 0 && img.height > 0);
  if (validImages.length === 0) {
    document.getElementById('resLabel').innerText = "Failed to load screenshot slices.";
    return;
  }

  const imgWidth = validImages[0].width;
  const imgHeight = validImages[0].height;
  
  const viewportHeight = (dims && (
    dims.targetRect?.height ||
    dims.effectiveViewportHeight ||
    dims.viewportHeight
  )) || (imgHeight / (window.devicePixelRatio || 1));
  const scale = imgHeight / viewportHeight;
  const totalHeight = (dims && dims.totalHeight) ? dims.totalHeight : (validImages.length * viewportHeight);

  let totalW = imgWidth;
  const firstChunk = chunks && chunks.find((chunk) => chunk && typeof chunk === 'object');
  const baseScrollY = firstChunk
    ? (Math.max(0, Number(firstChunk.scrollY) || 0) + (Number(firstChunk.contentOffsetY) || 0))
    : 0;
  const maxChunkEnd = images.reduce((maxEnd, img, idx) => {
    if (!img || img.width === 0) return maxEnd;
    const chunk = chunks && chunks[idx];
    const scrollY = chunk && typeof chunk === 'object' ? Math.max(0, Number(chunk.scrollY) || 0) : idx * viewportHeight;
    const offset = chunk && typeof chunk === 'object' ? (Number(chunk.contentOffsetY) || 0) : 0;
    return Math.max(maxEnd, (scrollY + offset - baseScrollY) + viewportHeight);
  }, 0);
  let totalH = Math.round(Math.max(0, Math.min(totalHeight - baseScrollY, maxChunkEnd)) * scale);

  const MAX_CANVAS_DIM = 32767;
  if (totalH > MAX_CANVAS_DIM) {
    totalH = MAX_CANVAS_DIM;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = totalW;
  tempCanvas.height = totalH;
  const tCtx = tempCanvas.getContext('2d');

  let previousScrollY = null;

  images.forEach((img, idx) => {
    if (!img || img.width === 0) return;

    const chunkObj = chunks && chunks[idx];
    const hasScrollY = chunkObj && typeof chunkObj === 'object' && chunkObj.scrollY !== undefined;

    const currentScrollY = chunkObj && typeof chunkObj === 'object'
      ? Math.max(0, Number(chunkObj.scrollY) || 0) + (Number(chunkObj.contentOffsetY) || 0)
      : idx * viewportHeight;

    if (idx === 0 || previousScrollY === null) {
      const firstHeight = idx === chunks.length - 1
        ? Math.min(imgHeight, Math.max(1, Math.round((totalHeight - baseScrollY) * scale)))
        : imgHeight;
      tCtx.drawImage(img, 0, 0, imgWidth, firstHeight, 0, 0, totalW, firstHeight);
      previousScrollY = currentScrollY;
    } else if (hasScrollY || chunkObj) {
      const overlapCss = Math.max(0, (previousScrollY + viewportHeight) - currentScrollY);
      const sourceY = Math.min(imgHeight, Math.round(overlapCss * scale));
      const remainingCss = Math.max(0, totalHeight - currentScrollY);
      const sourceH = Math.min(
        imgHeight - sourceY,
        Math.round(Math.min(viewportHeight - overlapCss, remainingCss) * scale)
      );
      const destY = Math.round((currentScrollY - baseScrollY + overlapCss) * scale);

      if (sourceH > 0 && destY < totalH) {
        const destH = Math.min(sourceH, totalH - destY);
        tCtx.drawImage(
          img,
          0, sourceY, imgWidth, sourceH,
          0, destY, totalW, destH
        );
      }
      previousScrollY = currentScrollY;
    } else {
      const prevActualScroll = Math.min((idx - 1) * viewportHeight, totalHeight - viewportHeight);
      const currActualScroll = Math.min(idx * viewportHeight, totalHeight - viewportHeight);
      const newHeight = currActualScroll - prevActualScroll;

      if (newHeight > 0) {
        const sourceY = Math.round((viewportHeight - newHeight) * scale);
        const sourceH = Math.round(newHeight * scale);
        const destY = Math.round((prevActualScroll + viewportHeight) * scale);
        const destH = Math.min(sourceH, totalH - destY);

        if (destH > 0 && destY < totalH) {
          tCtx.drawImage(
            img,
            0, sourceY, imgWidth, sourceH,
            0, destY, totalW, destH
          );
        }
      }
    }
  });

  originalCanvas = tempCanvas;

  canvas.width = totalW;
  canvas.height = totalH;

  document.getElementById('resLabel').innerText = `Resolution: ${totalW} × ${totalH}px`;

  fitToWidth();
  redraw();

  const viewport = document.getElementById('viewport');
  if (viewport) {
    viewport.scrollTop = 0;
  }
}

function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function applyZoom() {
  document.getElementById('zoomLabel').innerText = `${Math.round(zoom * 100)}%`;

  if (!canvas) return;

  const displayW = Math.round(canvas.width * zoom);
  const displayH = Math.round(canvas.height * zoom);

  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;

  const wrapper = document.getElementById('canvasWrapper');
  if (wrapper) {
    wrapper.style.width = `${displayW}px`;
    wrapper.style.height = `${displayH}px`;
  }

  updateCropActionBarPos();
}

function zoomScale(factor) {
  zoom = Math.max(0.1, Math.min(3.0, zoom + factor));
  applyZoom();
}

function fitToWidth() {
  if (!canvas || canvas.width === 0) return;
  const viewport = document.getElementById('viewport');
  const availW = Math.max(300, viewport.clientWidth - 56);
  zoom = Math.max(0.1, Math.min(1.0, availW / canvas.width));
  applyZoom();
}

// ROBUST UNDO / REDO HISTORY (SUPPORTS ANNOTATIONS & FULL CROP UNDO)
function saveToHistory(isCrop = false) {
  const state = {
    annotations: JSON.parse(JSON.stringify(annotations)),
    isCrop: isCrop
  };

  if (isCrop && originalCanvas) {
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = originalCanvas.width;
    backupCanvas.height = originalCanvas.height;
    backupCanvas.getContext('2d').drawImage(originalCanvas, 0, 0);

    state.canvasBackup = backupCanvas;
    state.width = canvas.width;
    state.height = canvas.height;
  }

  undoStack.push(state);
  redoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function undo() {
  if (undoStack.length === 0) return;

  const currentState = {
    annotations: JSON.parse(JSON.stringify(annotations)),
    isCrop: false
  };

  const prevState = undoStack.pop();

  if (prevState.isCrop && prevState.canvasBackup) {
    const currentBackup = document.createElement('canvas');
    currentBackup.width = originalCanvas.width;
    currentBackup.height = originalCanvas.height;
    currentBackup.getContext('2d').drawImage(originalCanvas, 0, 0);
    currentState.isCrop = true;
    currentState.canvasBackup = currentBackup;
    currentState.width = canvas.width;
    currentState.height = canvas.height;

    originalCanvas = prevState.canvasBackup;
    canvas.width = prevState.width;
    canvas.height = prevState.height;

    document.getElementById('resLabel').innerText = `Resolution: ${canvas.width} × ${canvas.height}px`;
    fitToWidth();
  }

  redoStack.push(currentState);
  annotations = prevState.annotations;
  selectedAnnotationId = null;
  updateHistoryButtons();
  redraw();
}

function redo() {
  if (redoStack.length === 0) return;

  const currentState = {
    annotations: JSON.parse(JSON.stringify(annotations)),
    isCrop: false
  };

  const nextState = redoStack.pop();

  if (nextState.isCrop && nextState.canvasBackup) {
    const currentBackup = document.createElement('canvas');
    currentBackup.width = originalCanvas.width;
    currentBackup.height = originalCanvas.height;
    currentBackup.getContext('2d').drawImage(originalCanvas, 0, 0);
    currentState.isCrop = true;
    currentState.canvasBackup = currentBackup;
    currentState.width = canvas.width;
    currentState.height = canvas.height;

    originalCanvas = nextState.canvasBackup;
    canvas.width = nextState.width;
    canvas.height = nextState.height;

    document.getElementById('resLabel').innerText = `Resolution: ${canvas.width} × ${canvas.height}px`;
    fitToWidth();
  }

  undoStack.push(currentState);
  annotations = nextState.annotations;
  selectedAnnotationId = null;
  updateHistoryButtons();
  redraw();
}

// Calculate accurate text bounding box based on font, lines and baseline
function getTextBounds(ann, targetCtx = ctx) {
  if (!ann || ann.type !== 'text' || !ann.points || !ann.points[0]) return null;
  const [p1] = ann.points;
  const fontSize = ann.fontSize || Math.max(18, (ann.width || 4) * 3.5);

  let maxLineW = 20;
  const lines = (ann.text || "").split('\n');
  if (targetCtx) {
    targetCtx.save();
    targetCtx.font = `${ann.fontBold ? 'bold ' : ''}${fontSize}px ${ann.fontFamily || 'sans-serif'}`;
    lines.forEach(l => {
      const w = targetCtx.measureText(l).width;
      if (w > maxLineW) maxLineW = w;
    });
    targetCtx.restore();
  } else {
    maxLineW = Math.max(30, (ann.text || "").length * fontSize * 0.6);
  }

  const lineHeight = fontSize * 1.3;
  const totalH = Math.max(fontSize, lines.length * lineHeight);
  const pad = 6;

  return {
    minX: p1.x - pad,
    maxX: p1.x + maxLineW + pad,
    minY: p1.y - fontSize - pad,
    maxY: p1.y + (lines.length - 1) * lineHeight + (fontSize * 0.25) + pad,
    width: maxLineW + (pad * 2),
    height: totalH + (pad * 2),
    fontSize: fontSize,
    maxLineW: maxLineW,
    totalH: totalH
  };
}

// Corner resize handle detection for blur, rectangle, circle, and text
function getResizeHandleAt(ann, x, y) {
  if (!ann) return null;

  let minX, maxX, minY, maxY;

  if (ann.type === 'rectangle' || ann.type === 'blur') {
    const [p1, p2] = ann.points;
    minX = Math.min(p1.x, p2.x);
    maxX = Math.max(p1.x, p2.x);
    minY = Math.min(p1.y, p2.y);
    maxY = Math.max(p1.y, p2.y);
  } else if (ann.type === 'circle') {
    const [p1, p2] = ann.points;
    const cx = p1.x;
    const cy = p1.y;
    const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    minX = cx - r;
    maxX = cx + r;
    minY = cy - r;
    maxY = cy + r;
  } else if (ann.type === 'text') {
    const bounds = getTextBounds(ann, ctx);
    if (!bounds) return null;
    minX = bounds.minX;
    maxX = bounds.maxX;
    minY = bounds.minY;
    maxY = bounds.maxY;
  } else {
    return null;
  }

  const radius = Math.max(16, 16 / zoom);

  const corners = {
    tl: { x: minX, y: minY },
    tr: { x: maxX, y: minY },
    br: { x: maxX, y: maxY },
    bl: { x: minX, y: maxY }
  };

  for (const [handle, pt] of Object.entries(corners)) {
    const dist = Math.hypot(x - pt.x, y - pt.y);
    if (dist <= radius) {
      return handle;
    }
  }
  return null;
}

function getAnnotationAtCoords(x, y) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.type === 'rectangle' || ann.type === 'blur') {
      const [p1, p2] = ann.points;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      if (x >= minX - 4 && x <= maxX + 4 && y >= minY - 4 && y <= maxY + 4) {
        return ann;
      }
    } else if (ann.type === 'circle') {
      const [p1, p2] = ann.points;
      const cx = p1.x;
      const cy = p1.y;
      const r = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
      if (dist <= r + 4) return ann;
    } else if (ann.type === 'text') {
      const bounds = getTextBounds(ann, ctx);
      if (bounds && x >= bounds.minX - 4 && x <= bounds.maxX + 4 && y >= bounds.minY - 4 && y <= bounds.maxY + 4) {
        return ann;
      }
    } else if (ann.type === 'pencil' || ann.type === 'highlighter' || ann.type === 'arrow') {
      for (const pt of ann.points) {
        const d = Math.sqrt(Math.pow(x - pt.x, 2) + Math.pow(y - pt.y, 2));
        if (d < Math.max(20, ann.width * 2)) {
          return ann;
        }
      }
    }
  }
  return null;
}

function redraw() {
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (originalCanvas) {
    ctx.drawImage(originalCanvas, 0, 0);
  }

  // Draw annotations
  annotations.forEach(ann => {
    drawAnnotation(ctx, ann);

    // Selected annotation boundary and corner handles
    if (ann.id === selectedAnnotationId && activeTool === 'select') {
      ctx.save();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);

      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      let hasBounds = false;

      if (ann.type === 'rectangle' || ann.type === 'blur') {
        const [p1, p2] = ann.points;
        minX = Math.min(p1.x, p2.x);
        maxX = Math.max(p1.x, p2.x);
        minY = Math.min(p1.y, p2.y);
        maxY = Math.max(p1.y, p2.y);
        hasBounds = true;
      } else if (ann.type === 'circle') {
        const [p1, p2] = ann.points;
        const cx = p1.x;
        const cy = p1.y;
        const r = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        minX = cx - r - 4;
        maxX = cx + r + 4;
        minY = cy - r - 4;
        maxY = cy + r + 4;
        hasBounds = true;
      } else if (ann.type === 'text') {
        const bounds = getTextBounds(ann, ctx);
        if (bounds) {
          minX = bounds.minX;
          maxX = bounds.maxX;
          minY = bounds.minY;
          maxY = bounds.maxY;
          hasBounds = true;
        }
      } else {
        const xs = ann.points.map(p => p.x);
        const ys = ann.points.map(p => p.y);
        minX = Math.min(...xs) - 6;
        maxX = Math.max(...xs) + 6;
        minY = Math.min(...ys) - 6;
        maxY = Math.max(...ys) + 6;
        hasBounds = true;
      }

      if (hasBounds) {
        ctx.strokeRect(minX - 2, minY - 2, (maxX - minX) + 4, (maxY - minY) + 4);

        // Draw 4 corner handles
        const handleSize = Math.max(8, Math.round(8 / zoom));
        const halfSize = handleSize / 2;

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        const cornerCoords = [
          { x: minX - 2, y: minY - 2 },
          { x: maxX + 2, y: minY - 2 },
          { x: maxX + 2, y: maxY + 2 },
          { x: minX - 2, y: maxY + 2 }
        ];

        cornerCoords.forEach(c => {
          ctx.fillRect(c.x - halfSize, c.y - halfSize, handleSize, handleSize);
          ctx.strokeRect(c.x - halfSize, c.y - halfSize, handleSize, handleSize);
        });
      }
      ctx.restore();
    }
  });

  // Draw active shape preview
  if (isDrawing && activeTool !== 'pencil' && activeTool !== 'highlighter' && activeTool !== 'select' && activeTool !== 'crop' && activeTool !== 'text') {
    const tempAnn = {
      type: activeTool,
      points: [{x: startX, y: startY}, {x: currentX, y: currentY}],
      color: strokeColor,
      width: strokeWidth,
      shapeFill: toolConfig.shapeFill || 'none'
    };
    drawAnnotation(ctx, tempAnn);
  }

  // Draw Crop Overlay
  if (activeTool === 'crop' && cropBox && cropBox.width > 5 && cropBox.height > 5) {
    drawCropOverlay(ctx, cropBox);
  }
}

// DRAW ANNOTATION WITH SILKY SMOOTH BEZIER CURVES
function drawAnnotation(targetCtx, ann) {
  targetCtx.save();
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';

  // 1. FREEHAND PENCIL & HIGHLIGHTER (SMOOTH QUADRATIC CURVES)
  if (ann.type === 'pencil' || ann.type === 'highlighter') {
    if (ann.type === 'highlighter') {
      targetCtx.globalAlpha = ann.opacity || toolConfig.highlighterOpacity || 0.35;
      targetCtx.strokeStyle = ann.color || strokeColor;
      targetCtx.lineWidth = Math.max(16, ann.width * 2.5);
    } else {
      targetCtx.globalAlpha = 1.0;
      targetCtx.strokeStyle = ann.color;
      targetCtx.lineWidth = ann.width;
    }

    const pts = ann.points;
    if (pts.length === 1) {
      targetCtx.beginPath();
      targetCtx.arc(pts[0].x, pts[0].y, targetCtx.lineWidth / 2, 0, Math.PI * 2);
      targetCtx.fillStyle = targetCtx.strokeStyle;
      targetCtx.fill();
    } else if (pts.length === 2) {
      targetCtx.beginPath();
      targetCtx.moveTo(pts[0].x, pts[0].y);
      targetCtx.lineTo(pts[1].x, pts[1].y);
      targetCtx.stroke();
    } else {
      targetCtx.beginPath();
      targetCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        targetCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      targetCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      targetCtx.stroke();
    }
  } 
  // 2. RECTANGLE
  else if (ann.type === 'rectangle') {
    targetCtx.strokeStyle = ann.color;
    targetCtx.lineWidth = ann.width;
    const [p1, p2] = ann.points;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);

    const fill = ann.shapeFill || 'none';
    if (fill === 'semi') {
      targetCtx.fillStyle = ann.color;
      targetCtx.globalAlpha = 0.25;
      targetCtx.fillRect(x, y, w, h);
      targetCtx.globalAlpha = 1.0;
    } else if (fill === 'solid') {
      targetCtx.fillStyle = ann.color;
      targetCtx.fillRect(x, y, w, h);
    }
    targetCtx.strokeRect(x, y, w, h);
  }
  // 3. CIRCLE
  else if (ann.type === 'circle') {
    targetCtx.strokeStyle = ann.color;
    targetCtx.lineWidth = ann.width;
    const [p1, p2] = ann.points;
    const cx = p1.x;
    const cy = p1.y;
    const r = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    targetCtx.beginPath();
    targetCtx.arc(cx, cy, r, 0, Math.PI * 2);

    const fill = ann.shapeFill || 'none';
    if (fill === 'semi') {
      targetCtx.fillStyle = ann.color;
      targetCtx.globalAlpha = 0.25;
      targetCtx.fill();
      targetCtx.globalAlpha = 1.0;
    } else if (fill === 'solid') {
      targetCtx.fillStyle = ann.color;
      targetCtx.fill();
    }
    targetCtx.stroke();
  }
  // 4. ARROW
  else if (ann.type === 'arrow') {
    targetCtx.strokeStyle = ann.color;
    targetCtx.fillStyle = ann.color;
    targetCtx.lineWidth = ann.width;

    const [p1, p2] = ann.points;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const headLength = Math.max(18, ann.width * 3.5);
    const spreadAngle = Math.PI / 7;

    const shaftEndX = p2.x - (headLength - 4) * Math.cos(angle);
    const shaftEndY = p2.y - (headLength - 4) * Math.sin(angle);

    targetCtx.beginPath();
    targetCtx.moveTo(p1.x, p1.y);
    targetCtx.lineTo(shaftEndX, shaftEndY);
    targetCtx.stroke();
    
    targetCtx.save();
    targetCtx.lineJoin = 'miter';
    targetCtx.beginPath();
    targetCtx.moveTo(p2.x, p2.y);
    targetCtx.lineTo(p2.x - headLength * Math.cos(angle - spreadAngle), p2.y - headLength * Math.sin(angle - spreadAngle));
    targetCtx.lineTo(p2.x - headLength * Math.cos(angle + spreadAngle), p2.y - headLength * Math.sin(angle + spreadAngle));
    targetCtx.closePath();
    targetCtx.fill();
    targetCtx.restore();
  }
  // 5. TEXT
  else if (ann.type === 'text') {
    const [p1] = ann.points;
    const fontSize = ann.fontSize || Math.max(18, ann.width * 3.5);
    targetCtx.font = `${ann.fontBold ? 'bold ' : ''}${fontSize}px ${ann.fontFamily || 'sans-serif'}`;
    targetCtx.fillStyle = ann.color;
    targetCtx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    targetCtx.shadowBlur = 4;

    const lines = (ann.text || "").split('\n');
    lines.forEach((line, idx) => {
      targetCtx.fillText(line, p1.x, p1.y + (idx * fontSize * 1.3));
    });
  }
  // 6. CENSOR / BLUR (CUSTOMIZABLE PIXELATE, SMOOTH, REDACT)
  else if (ann.type === 'blur') {
    const [p1, p2] = ann.points;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);
    const mode = ann.censorMode || toolConfig.censorMode || 'pixelate';
    const bSize = ann.censorBlockSize || toolConfig.censorBlockSize || 14;

    if (w > 2 && h > 2) {
      if (mode === 'redact') {
        targetCtx.fillStyle = '#0f172a';
        targetCtx.fillRect(x, y, w, h);
      } else {
        try {
          const imgData = ctx.getImageData(x, y, w, h);
          const offscreen = document.createElement('canvas');
          
          if (mode === 'smooth') {
            offscreen.width = Math.max(2, Math.round(w / (bSize * 1.5)));
            offscreen.height = Math.max(2, Math.round(h / (bSize * 1.5)));
            const offCtx = offscreen.getContext('2d');
            offCtx.imageSmoothingEnabled = true;
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
            
            offCtx.drawImage(tempCanvas, 0, 0, offscreen.width, offscreen.height);
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.drawImage(offscreen, x, y, w, h);
          } else {
            offscreen.width = Math.max(1, Math.round(w / bSize));
            offscreen.height = Math.max(1, Math.round(h / bSize));
            const offCtx = offscreen.getContext('2d');
            offCtx.imageSmoothingEnabled = false;
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
            
            offCtx.drawImage(tempCanvas, 0, 0, offscreen.width, offscreen.height);
            targetCtx.imageSmoothingEnabled = false;
            targetCtx.drawImage(offscreen, x, y, w, h);
          }
        } catch (e) {
          targetCtx.fillStyle = '#0f172a';
          targetCtx.fillRect(x, y, w, h);
        }
      }
    }
  }

  targetCtx.restore();
}

// CROP OVERLAY RENDERING
function drawCropOverlay(targetCtx, box) {
  targetCtx.save();
  targetCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';

  // Dim 4 sides outside crop box
  targetCtx.fillRect(0, 0, canvas.width, box.y);
  targetCtx.fillRect(0, box.y + box.height, canvas.width, canvas.height - (box.y + box.height));
  targetCtx.fillRect(0, box.y, box.x, box.height);
  targetCtx.fillRect(box.x + box.width, box.y, canvas.width - (box.x + box.width), box.height);

  // Dashed border around crop rect
  targetCtx.strokeStyle = '#ffffff';
  targetCtx.lineWidth = 2;
  targetCtx.setLineDash([6, 6]);
  targetCtx.strokeRect(box.x, box.y, box.width, box.height);

  // Corner brackets
  const bLen = Math.min(20, Math.min(box.width, box.height) / 3);
  targetCtx.strokeStyle = '#10b981';
  targetCtx.lineWidth = 4;
  targetCtx.setLineDash([]);

  // TL
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + bLen);
  targetCtx.lineTo(box.x, box.y);
  targetCtx.lineTo(box.x + bLen, box.y);
  targetCtx.stroke();

  // TR
  targetCtx.beginPath();
  targetCtx.moveTo(box.x + box.width - bLen, box.y);
  targetCtx.lineTo(box.x + box.width, box.y);
  targetCtx.lineTo(box.x + box.width, box.y + bLen);
  targetCtx.stroke();

  // BR
  targetCtx.beginPath();
  targetCtx.moveTo(box.x + box.width, box.y + box.height - bLen);
  targetCtx.lineTo(box.x + box.width, box.y + box.height);
  targetCtx.lineTo(box.x + box.width - bLen, box.y + box.height);
  targetCtx.stroke();

  // BL
  targetCtx.beginPath();
  targetCtx.moveTo(box.x + bLen, box.y + box.height);
  targetCtx.lineTo(box.x, box.y + box.height);
  targetCtx.lineTo(box.x, box.y + box.height - bLen);
  targetCtx.stroke();

  targetCtx.restore();
}

function updateCropActionBarPos() {
  const bar = document.getElementById('cropActionBar');
  if (!bar || !cropBox || activeTool !== 'crop') return;

  const boxDisplayX = cropBox.x * zoom;
  const boxDisplayY = (cropBox.y + cropBox.height) * zoom;

  bar.style.left = `${Math.max(10, boxDisplayX + 10)}px`;
  bar.style.top = `${boxDisplayY + 14}px`;
  bar.classList.remove('hidden');

  const dimBadge = document.getElementById('cropDimBadge');
  if (dimBadge) {
    dimBadge.innerText = `${Math.round(cropBox.width)} × ${Math.round(cropBox.height)}px`;
  }
}

function hideCropActionBar() {
  const bar = document.getElementById('cropActionBar');
  if (bar) bar.classList.add('hidden');
}

function applyCrop() {
  if (!cropBox || cropBox.width < 10 || cropBox.height < 10) return;
  
  // SAVE FULL IMAGE & DIMENSIONS TO UNDO STACK BEFORE CROPPING!
  saveToHistory(true);

  const cx = Math.max(0, Math.round(cropBox.x));
  const cy = Math.max(0, Math.round(cropBox.y));
  const cw = Math.min(canvas.width - cx, Math.round(cropBox.width));
  const ch = Math.min(canvas.height - cy, Math.round(cropBox.height));

  const newCanvas = document.createElement('canvas');
  newCanvas.width = cw;
  newCanvas.height = ch;
  const nCtx = newCanvas.getContext('2d');
  nCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

  if (originalCanvas) {
    const newOrig = document.createElement('canvas');
    newOrig.width = cw;
    newOrig.height = ch;
    const noCtx = newOrig.getContext('2d');
    noCtx.drawImage(originalCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
    originalCanvas = newOrig;
  }

  // Adjust annotation points
  annotations.forEach(ann => {
    ann.points.forEach(pt => {
      pt.x -= cx;
      pt.y -= cy;
    });
  });
  annotations = annotations.filter(ann => {
    return ann.points.some(pt => pt.x >= -50 && pt.x <= cw + 50 && pt.y >= -50 && pt.y <= ch + 50);
  });

  canvas.width = cw;
  canvas.height = ch;
  cropBox = null;
  activeTool = 'select';
  updateToolButtonStyles();
  hideCropActionBar();

  document.getElementById('resLabel').innerText = `Resolution: ${cw} × ${ch}px`;
  fitToWidth();
  redraw();
}

// CANCEL CROP (DOES NOT OVERWRITE ACTIVETOOL)
function cancelCrop() {
  cropBox = null;
  hideCropActionBar();
  redraw();
}

// INLINE DIRECT TEXT EDITING ON CANVAS
let textEditTarget = null;
function openInlineTextEditor(canvasX, canvasY, clientX, clientY, existingAnn = null) {
  textEditTarget = existingAnn;

  const wrapper = document.getElementById('inlineTextWrapper');
  const textarea = document.getElementById('activeInlineText');
  if (!wrapper || !textarea) return;

  const cRect = canvas.getBoundingClientRect();
  const posX = clientX - cRect.left;
  const posY = clientY - cRect.top;

  wrapper.style.left = `${Math.max(8, posX)}px`;
  wrapper.style.top = `${Math.max(8, posY - 20)}px`;

  textarea.value = existingAnn ? existingAnn.text : '';
  const fontSize = existingAnn ? (existingAnn.fontSize || 22) : Math.max(18, Math.round(strokeWidth * 3.5));
  textarea.style.fontSize = `${Math.max(14, Math.round(fontSize * zoom))}px`;
  textarea.style.color = (strokeColor === '#0f172a' || strokeColor === '#000000') ? '#38bdf8' : strokeColor;

  wrapper.classList.remove('hidden');
  setTimeout(() => {
    textarea.focus();
    if (existingAnn) textarea.select();
  }, 50);

  textarea.oninput = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(30, textarea.scrollHeight)}px`;
  };

  const commit = () => {
    const textVal = textarea.value.trim();
    wrapper.classList.add('hidden');

    if (textVal) {
      saveToHistory();
      if (textEditTarget) {
        textEditTarget.text = textVal;
        selectedAnnotationId = textEditTarget.id;
      } else {
        const newAnn = {
          id: 'ann_' + Date.now(),
          type: 'text',
          text: textVal,
          points: [{ x: canvasX, y: canvasY }],
          color: strokeColor,
          width: strokeWidth,
          fontSize: fontSize,
          fontBold: toolConfig.fontBold,
          fontFamily: toolConfig.fontFamily
        };
        annotations.push(newAnn);
        selectedAnnotationId = newAnn.id;
      }
      activeTool = 'select';
      updateToolButtonStyles();
      redraw();
    } else if (textEditTarget) {
      saveToHistory();
      annotations = annotations.filter(a => a.id !== textEditTarget.id);
      selectedAnnotationId = null;
      redraw();
    }
    textEditTarget = null;
  };

  const cancel = () => {
    wrapper.classList.add('hidden');
    textEditTarget = null;
  };

  document.getElementById('inlineTextDoneBtn').onclick = commit;
  document.getElementById('inlineTextCancelBtn').onclick = cancel;

  textarea.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };
}

function closeInlineTextIfOpen() {
  const wrapper = document.getElementById('inlineTextWrapper');
  if (wrapper && !wrapper.classList.contains('hidden')) {
    const doneBtn = document.getElementById('inlineTextDoneBtn');
    if (doneBtn) doneBtn.click();
  }
}

// LIVE STROKE SIZE PREVIEW BUBBLE
function showStrokePreviewBubble(val) {
  const bubble = document.getElementById('strokePreviewBubble');
  const circle = document.getElementById('previewCircle');
  const text = document.getElementById('previewText');
  const slider = document.getElementById('strokeWeightSlider');
  const mainWorkspace = document.getElementById('mainWorkspace');
  if (!bubble || !circle || !text || !slider || !mainWorkspace) return;

  const sliderRect = slider.getBoundingClientRect();
  const wsRect = mainWorkspace.getBoundingClientRect();
  const topOffset = sliderRect.top - wsRect.top - 18;

  bubble.style.top = `${Math.max(10, topOffset)}px`;
  bubble.style.left = '148px';
  text.innerText = `${val}px`;

  const size = Math.min(38, Math.max(4, val));
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
  circle.style.backgroundColor = strokeColor;
  circle.style.border = (strokeColor === '#ffffff' || strokeColor === '#fff') ? '1px solid #94a3b8' : 'none';
  circle.style.opacity = activeTool === 'highlighter' ? '0.35' : '1.0';

  bubble.classList.remove('hidden');

  if (strokePreviewTimeout) clearTimeout(strokePreviewTimeout);
  strokePreviewTimeout = setTimeout(() => {
    bubble.classList.add('hidden');
  }, 1200);
}

// TOOL SETTINGS MODAL / POPOVER (DOUBLE-CLICK / RIGHT-CLICK CUSTOMIZATION)
function openToolSettings(toolId, targetEl) {
  const modal = document.getElementById('toolSettingsModal');
  const title = document.getElementById('toolSettingsTitle');
  const body = document.getElementById('toolSettingsBody');
  const mainWorkspace = document.getElementById('mainWorkspace');
  if (!modal || !title || !body || !mainWorkspace) return;

  const btnRect = targetEl ? targetEl.getBoundingClientRect() : { top: 100 };
  const wsRect = mainWorkspace.getBoundingClientRect();
  const topOffset = Math.max(10, Math.min(wsRect.height - 320, btnRect.top - wsRect.top));

  modal.style.top = `${topOffset}px`;
  modal.style.left = '148px';

  title.innerText = `${toolId.toUpperCase()} SETTINGS`;
  body.innerHTML = '';

  // 1. CENSOR / BLUR CUSTOMIZATION
  if (toolId === 'blur') {
    body.innerHTML = `
      <div class="setting-row">
        <span class="setting-label">Censor Style</span>
        <div class="setting-btn-group">
          <button class="setting-opt-btn ${toolConfig.censorMode === 'pixelate' ? 'active' : ''}" data-val="pixelate">Pixelate</button>
          <button class="setting-opt-btn ${toolConfig.censorMode === 'smooth' ? 'active' : ''}" data-val="smooth">Smooth</button>
          <button class="setting-opt-btn ${toolConfig.censorMode === 'redact' ? 'active' : ''}" data-val="redact">Redact</button>
        </div>
      </div>
      <div class="setting-row">
        <div style="display:flex; justify-content:space-between;">
          <span class="setting-label">Intensity / Block Size</span>
          <span id="censorSizeVal" style="font-size:10px; font-weight:bold; color:var(--text-secondary);">${toolConfig.censorBlockSize}px</span>
        </div>
        <input type="range" id="censorBlockSlider" min="4" max="36" value="${toolConfig.censorBlockSize}" class="weight-slider">
      </div>
    `;

    body.querySelectorAll('.setting-opt-btn').forEach(b => {
      b.onclick = () => {
        body.querySelectorAll('.setting-opt-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        toolConfig.censorMode = b.dataset.val;
        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && ann.type === 'blur') { ann.censorMode = toolConfig.censorMode; redraw(); }
        }
      };
    });

    const sSlider = document.getElementById('censorBlockSlider');
    if (sSlider) {
      sSlider.oninput = (e) => {
        toolConfig.censorBlockSize = parseInt(e.target.value, 10);
        document.getElementById('censorSizeVal').innerText = `${toolConfig.censorBlockSize}px`;
        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && ann.type === 'blur') { ann.censorBlockSize = toolConfig.censorBlockSize; redraw(); }
        }
      };
    }
  }
  // 2. HIGHLIGHTER CUSTOMIZATION
  else if (toolId === 'highlighter') {
    body.innerHTML = `
      <div class="setting-row">
        <div style="display:flex; justify-content:space-between;">
          <span class="setting-label">Highlight Opacity</span>
          <span id="highOpacityVal" style="font-size:10px; font-weight:bold; color:var(--text-secondary);">${Math.round(toolConfig.highlighterOpacity * 100)}%</span>
        </div>
        <input type="range" id="highOpacitySlider" min="15" max="80" value="${Math.round(toolConfig.highlighterOpacity * 100)}" class="weight-slider">
      </div>
      <div class="setting-row">
        <span class="setting-label">Quick Opacity</span>
        <div class="setting-btn-group" style="grid-template-columns: repeat(3, 1fr);">
          <button class="setting-opt-btn" data-hop="25">Light 25%</button>
          <button class="setting-opt-btn" data-hop="40">Med 40%</button>
          <button class="setting-opt-btn" data-hop="65">Dark 65%</button>
        </div>
      </div>
    `;
    const hSlider = document.getElementById('highOpacitySlider');
    const updateHighOpacity = (val) => {
      toolConfig.highlighterOpacity = val;
      if (hSlider) hSlider.value = Math.round(val * 100);
      const valEl = document.getElementById('highOpacityVal');
      if (valEl) valEl.innerText = `${Math.round(val * 100)}%`;
      if (selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'highlighter') { ann.opacity = toolConfig.highlighterOpacity; redraw(); }
      }
    };
    if (hSlider) {
      hSlider.oninput = (e) => updateHighOpacity(parseInt(e.target.value, 10) / 100);
    }
    body.querySelectorAll('[data-hop]').forEach(btn => {
      btn.onclick = () => updateHighOpacity(parseInt(btn.dataset.hop, 10) / 100);
    });
  }
  // 3. TEXT CUSTOMIZATION (FONT FAMILY, STYLE, SIZE)
  else if (toolId === 'text') {
    const selTextAnn = selectedAnnotationId ? annotations.find(a => a.id === selectedAnnotationId && a.type === 'text') : null;
    const currentSize = selTextAnn ? (selTextAnn.fontSize || 22) : (toolConfig.fontSize || 22);

    body.innerHTML = `
      <div class="setting-row">
        <span class="setting-label">Font Family</span>
        <div class="setting-btn-group">
          <button class="setting-opt-btn ${toolConfig.fontFamily === 'sans-serif' ? 'active' : ''}" data-font="sans-serif">Sans</button>
          <button class="setting-opt-btn ${toolConfig.fontFamily === 'serif' ? 'active' : ''}" data-font="serif">Serif</button>
          <button class="setting-opt-btn ${toolConfig.fontFamily === 'monospace' ? 'active' : ''}" data-font="monospace">Mono</button>
        </div>
      </div>
      <div class="setting-row">
        <span class="setting-label">Style</span>
        <div class="setting-btn-group" style="grid-template-columns: 1fr 1fr;">
          <button class="setting-opt-btn ${toolConfig.fontBold ? 'active' : ''}" id="toggleBoldBtn">Bold</button>
          <button class="setting-opt-btn ${!toolConfig.fontBold ? 'active' : ''}" id="toggleNormalBtn">Normal</button>
        </div>
      </div>
      <div class="setting-row">
        <div style="display:flex; justify-content:space-between;">
          <span class="setting-label">Font Size</span>
          <span id="textSizeVal" style="font-size:10px; font-weight:bold; color:var(--text-secondary);">${currentSize}px</span>
        </div>
        <input type="range" id="textSizeSlider" min="12" max="80" value="${currentSize}" class="weight-slider">
      </div>
      <div class="setting-row">
        <span class="setting-label">Quick Preset Sizes</span>
        <div class="setting-btn-group" style="grid-template-columns: repeat(4, 1fr);">
          <button class="setting-opt-btn" data-tsize="16">16px</button>
          <button class="setting-opt-btn" data-tsize="24">24px</button>
          <button class="setting-opt-btn" data-tsize="36">36px</button>
          <button class="setting-opt-btn" data-tsize="48">48px</button>
        </div>
      </div>
    `;

    body.querySelectorAll('[data-font]').forEach(b => {
      b.onclick = () => {
        body.querySelectorAll('[data-font]').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        toolConfig.fontFamily = b.dataset.font;
        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && ann.type === 'text') { ann.fontFamily = toolConfig.fontFamily; redraw(); }
        }
      };
    });

    document.getElementById('toggleBoldBtn').onclick = () => {
      toolConfig.fontBold = true;
      document.getElementById('toggleBoldBtn').classList.add('active');
      document.getElementById('toggleNormalBtn').classList.remove('active');
      if (selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'text') { ann.fontBold = true; redraw(); }
      }
    };
    document.getElementById('toggleNormalBtn').onclick = () => {
      toolConfig.fontBold = false;
      document.getElementById('toggleNormalBtn').classList.add('active');
      document.getElementById('toggleBoldBtn').classList.remove('active');
      if (selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'text') { ann.fontBold = false; redraw(); }
      }
    };

    const updateTextSize = (newSize) => {
      toolConfig.fontSize = newSize;
      const sSlider = document.getElementById('textSizeSlider');
      if (sSlider) sSlider.value = newSize;
      const sVal = document.getElementById('textSizeVal');
      if (sVal) sVal.innerText = `${newSize}px`;

      if (selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'text') {
          ann.fontSize = newSize;
          redraw();
        }
      }

      // Also sync sidebar slider
      const sideSlider = document.getElementById('strokeWeightSlider');
      const sideVal = document.getElementById('strokeWeightVal');
      if (sideSlider) sideSlider.value = Math.min(40, Math.max(2, Math.round(newSize / 3.5)));
      if (sideVal) sideVal.innerText = `${newSize}px`;
    };

    const tSlider = document.getElementById('textSizeSlider');
    if (tSlider) {
      tSlider.oninput = (e) => updateTextSize(parseInt(e.target.value, 10));
    }
    body.querySelectorAll('[data-tsize]').forEach(btn => {
      btn.onclick = () => updateTextSize(parseInt(btn.dataset.tsize, 10));
    });
  }
  // 4. SHAPES (RECTANGLE / CIRCLE) CUSTOMIZATION
  else if (toolId === 'rectangle' || toolId === 'circle') {
    const shapeLabel = toolId === 'circle' ? 'Circle' : 'Rectangle';
    const shapes = annotations.filter(a => a.type === toolId);

    // If an annotation of this type is currently selected, use it.
    // If not, but shapes exist, select the latest shape so user can edit it immediately!
    let activeShape = null;
    if (selectedAnnotationId) {
      activeShape = shapes.find(a => a.id === selectedAnnotationId);
    }
    if (!activeShape && shapes.length > 0) {
      activeShape = shapes[shapes.length - 1];
      selectedAnnotationId = activeShape.id;
      redraw();
    }

    const currentFill = activeShape ? (activeShape.shapeFill || 'none') : (toolConfig.shapeFill || 'none');
    const currentWidth = activeShape ? (activeShape.width || strokeWidth) : strokeWidth;

    // Render target shape selector if shapes exist
    let targetSelectorHTML = '';
    if (shapes.length > 0) {
      targetSelectorHTML = `
        <div class="setting-row">
          <span class="setting-label">Select ${shapeLabel} to Edit</span>
          <div class="setting-btn-group" style="grid-template-columns: repeat(${Math.min(shapes.length, 3)}, 1fr);">
            ${shapes.map((s, idx) => `
              <button class="setting-opt-btn shape-target-btn ${activeShape && activeShape.id === s.id ? 'active' : ''}" data-annid="${s.id}">
                ${shapeLabel} #${idx + 1}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    body.innerHTML = `
      ${targetSelectorHTML}
      <div class="setting-row">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="setting-label">Fill Style</span>
          <span style="font-size:10px; font-weight:700; color:var(--text-muted);" id="shapeFillTargetLabel">
            ${activeShape ? `(${shapeLabel} #${shapes.findIndex(s => s.id === activeShape.id) + 1})` : '(New)'}
          </span>
        </div>
        <div class="setting-btn-group">
          <button class="setting-opt-btn fill-opt-btn ${currentFill === 'none' ? 'active' : ''}" data-fill="none">None</button>
          <button class="setting-opt-btn fill-opt-btn ${currentFill === 'semi' ? 'active' : ''}" data-fill="semi">Tint</button>
          <button class="setting-opt-btn fill-opt-btn ${currentFill === 'solid' ? 'active' : ''}" data-fill="solid">Solid</button>
        </div>
      </div>
      <div class="setting-row">
        <div style="display:flex; justify-content:space-between;">
          <span class="setting-label">Border Thickness</span>
          <span id="shapeWidthVal" style="font-size:10px; font-weight:bold; color:var(--text-secondary);">${currentWidth}px</span>
        </div>
        <input type="range" id="shapeWidthSlider" min="2" max="36" value="${currentWidth}" class="weight-slider">
      </div>
    `;

    // Shape selection buttons (Circle #1, Circle #2...)
    body.querySelectorAll('.shape-target-btn').forEach(btn => {
      btn.onclick = () => {
        body.querySelectorAll('.shape-target-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const annId = btn.dataset.annid;
        selectedAnnotationId = annId;
        const targetAnn = annotations.find(a => a.id === annId);
        if (targetAnn) {
          const f = targetAnn.shapeFill || 'none';
          body.querySelectorAll('.fill-opt-btn').forEach(fb => {
            fb.classList.toggle('active', fb.dataset.fill === f);
          });
          const wSlider = document.getElementById('shapeWidthSlider');
          const wVal = document.getElementById('shapeWidthVal');
          if (wSlider) wSlider.value = targetAnn.width || 4;
          if (wVal) wVal.innerText = `${targetAnn.width || 4}px`;

          const lbl = document.getElementById('shapeFillTargetLabel');
          if (lbl) {
            const idx = shapes.findIndex(s => s.id === annId);
            lbl.innerText = `(${shapeLabel} #${idx + 1})`;
          }
          redraw();
        }
      };
    });

    // Fill style buttons
    body.querySelectorAll('.fill-opt-btn').forEach(b => {
      b.onclick = () => {
        body.querySelectorAll('.fill-opt-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        const chosenFill = b.dataset.fill;

        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && (ann.type === 'circle' || ann.type === 'rectangle')) {
            saveToHistory();
            ann.shapeFill = chosenFill;
            redraw();
            return;
          }
        }

        toolConfig.shapeFill = chosenFill;
      };
    });

    // Shape border thickness slider
    const wSlider = document.getElementById('shapeWidthSlider');
    if (wSlider) {
      wSlider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        document.getElementById('shapeWidthVal').innerText = `${val}px`;
        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && (ann.type === 'circle' || ann.type === 'rectangle')) {
            ann.width = val;
            redraw();
          }
        }
      };
    }
  }
  // 5. DRAW / PENCIL CUSTOMIZATION
  else if (toolId === 'pencil') {
    body.innerHTML = `
      <div class="setting-row">
        <span class="setting-label">Pen Thickness Presets</span>
        <div class="setting-btn-group" style="grid-template-columns: repeat(4, 1fr);">
          <button class="setting-opt-btn" data-psize="3">3px</button>
          <button class="setting-opt-btn" data-psize="6">6px</button>
          <button class="setting-opt-btn" data-psize="12">12px</button>
          <button class="setting-opt-btn" data-psize="24">24px</button>
        </div>
      </div>
    `;
    body.querySelectorAll('[data-psize]').forEach(btn => {
      btn.onclick = () => {
        const val = parseInt(btn.dataset.psize, 10);
        strokeWidth = val;
        const sideSlider = document.getElementById('strokeWeightSlider');
        const sideVal = document.getElementById('strokeWeightVal');
        if (sideSlider) sideSlider.value = val;
        if (sideVal) sideVal.innerText = `${val}px`;
        showStrokePreviewBubble(val);
      };
    });
  }
  // 6. CROP CUSTOMIZATION
  else if (toolId === 'crop') {
    body.innerHTML = `
      <div class="setting-row">
        <span class="setting-label">Aspect Ratio</span>
        <div class="setting-btn-group" style="grid-template-columns: repeat(4, 1fr);">
          <button class="setting-opt-btn ${toolConfig.cropAspect === 'free' ? 'active' : ''}" data-ratio="free">Free</button>
          <button class="setting-opt-btn ${toolConfig.cropAspect === '16:9' ? 'active' : ''}" data-ratio="16:9">16:9</button>
          <button class="setting-opt-btn ${toolConfig.cropAspect === '4:3' ? 'active' : ''}" data-ratio="4:3">4:3</button>
          <button class="setting-opt-btn ${toolConfig.cropAspect === '1:1' ? 'active' : ''}" data-ratio="1:1">1:1</button>
        </div>
      </div>
    `;
    body.querySelectorAll('[data-ratio]').forEach(b => {
      b.onclick = () => {
        body.querySelectorAll('[data-ratio]').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        toolConfig.cropAspect = b.dataset.ratio;
      };
    });
  }
  else {
    body.innerHTML = `
      <div class="setting-row">
        <span class="setting-label">Tool Options</span>
        <p style="font-size:10px; color:var(--text-muted); line-height: 1.4;">Use the sidebar stroke slider and color swatches to customize your drawings.</p>
      </div>
    `;
  }

  modal.classList.remove('hidden');
}

function updateToolButtonStyles() {
  document.querySelectorAll('#toolsContainer .tool-btn').forEach(btn => {
    const toolId = btn.id.replace('tool-', '');
    if (toolId === activeTool) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  updateCanvasCursor();
}

function updateCanvasCursor() {
  if (!canvas) return;
  if (activeTool === 'select') {
    canvas.style.cursor = 'default';
  } else if (activeTool === 'text') {
    canvas.style.cursor = 'text';
  } else if (activeTool === 'crop') {
    canvas.style.cursor = 'crosshair';
  } else {
    canvas.style.cursor = 'crosshair';
  }
}

async function copyImageToClipboard() {
  if (!canvas) return;
  const copyBtn = document.getElementById('copyBtn');
  const originalHTML = copyBtn.innerHTML;

  try {
    copyBtn.disabled = true;
    copyBtn.innerHTML = `
      <svg style="width: 15px; height: 15px;" fill="none" viewBox="0 0 24 24">
        <circle style="opacity: 0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path style="opacity: 0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Copying...</span>
    `;

    canvas.toBlob(async (blob) => {
      if (!blob) {
        copyBtn.innerHTML = originalHTML;
        copyBtn.disabled = false;
        alert("Could not generate image blob.");
        return;
      }

      try {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);

        copyBtn.innerHTML = `
          <svg style="width: 15px; height: 15px; color: #a7f3d0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
          </svg>
          <span style="color: #a7f3d0;">Copied!</span>
        `;
        copyBtn.style.backgroundColor = '#047857';

        setTimeout(() => {
          copyBtn.innerHTML = originalHTML;
          copyBtn.style.backgroundColor = '';
          copyBtn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error("Clipboard write failed:", err);
        copyBtn.innerHTML = originalHTML;
        copyBtn.style.backgroundColor = '';
        copyBtn.disabled = false;
        alert("Clipboard copy failed. Please grant clipboard permissions or export as PNG.");
      }
    }, 'image/png');
  } catch (err) {
    console.error("Copy failed:", err);
    copyBtn.innerHTML = originalHTML;
    copyBtn.disabled = false;
  }
}

function setupEvents() {
  // Stroke Weight Slider with LIVE POPUP PREVIEW & TEXT SIZE SCALING
  const strokeWeightSlider = document.getElementById('strokeWeightSlider');
  const strokeWeightVal = document.getElementById('strokeWeightVal');
  if (strokeWeightSlider) {
    const triggerSliderUpdate = () => {
      const val = parseInt(strokeWeightSlider.value, 10);

      // If text annotation is selected, scale its font size
      if (activeTool === 'select' && selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'text') {
          ann.fontSize = Math.max(12, Math.round(val * 3.5));
          if (strokeWeightVal) strokeWeightVal.innerText = `${ann.fontSize}px`;
          showStrokePreviewBubble(ann.fontSize);
          redraw();
          return;
        } else if (ann) {
          strokeWidth = val;
          ann.width = strokeWidth;
          if (strokeWeightVal) strokeWeightVal.innerText = `${strokeWidth}px`;
          showStrokePreviewBubble(strokeWidth);
          redraw();
          return;
        }
      }

      strokeWidth = val;
      if (strokeWeightVal) strokeWeightVal.innerText = `${strokeWidth}px`;
      showStrokePreviewBubble(strokeWidth);
    };

    strokeWeightSlider.addEventListener('input', triggerSliderUpdate);
    strokeWeightSlider.addEventListener('mousedown', () => {
      const val = parseInt(strokeWeightSlider.value, 10);
      if (activeTool === 'select' && selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann && ann.type === 'text') {
          showStrokePreviewBubble(ann.fontSize || Math.round(val * 3.5));
          return;
        }
      }
      showStrokePreviewBubble(strokeWidth);
    });
  }

  // Color Swatches & Picker
  const colorDots = document.querySelectorAll('.color-dot');
  const brushColorInput = document.getElementById('brushColor');

  const updateSelectedColor = (newColor) => {
    strokeColor = newColor;
    if (brushColorInput) brushColorInput.value = strokeColor;

    if (activeTool === 'select' && selectedAnnotationId) {
      const ann = annotations.find(a => a.id === selectedAnnotationId);
      if (ann) {
        saveToHistory();
        ann.color = strokeColor;
        redraw();
      }
    }
  };

  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      colorDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      updateSelectedColor(dot.dataset.color);
    });
  });

  if (brushColorInput) {
    brushColorInput.addEventListener('input', (e) => {
      colorDots.forEach(d => d.classList.remove('active'));
      updateSelectedColor(e.target.value);
    });
  }

  // Tool buttons: Single click selects tool, DOUBLE CLICK or RIGHT-CLICK opens tool customization!
  const toolButtons = document.querySelectorAll('#toolsContainer .tool-btn');
  toolButtons.forEach(btn => {
    const toolId = btn.id.replace('tool-', '');

    btn.addEventListener('click', () => {
      closeInlineTextIfOpen();
      // If was in crop and switching to other tool, clear crop selection
      if (activeTool === 'crop' && toolId !== 'crop') {
        cancelCrop();
      }
      activeTool = toolId;
      selectedAnnotationId = null;
      updateToolButtonStyles();
      redraw();
    });

    // DOUBLE CLICK to open customization popover!
    btn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openToolSettings(toolId, btn);
    });

    // RIGHT CLICK (Context menu) ALSO opens customization popover!
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openToolSettings(toolId, btn);
    });
  });
  updateToolButtonStyles();

  // Close tool settings modal on close button OR click outside
  document.getElementById('closeToolSettingsBtn').onclick = () => {
    document.getElementById('toolSettingsModal').classList.add('hidden');
  };

  document.addEventListener('mousedown', (e) => {
    const modal = document.getElementById('toolSettingsModal');
    if (modal && !modal.classList.contains('hidden')) {
      if (!modal.contains(e.target) && !e.target.closest('.tool-btn')) {
        modal.classList.add('hidden');
      }
    }
  });

  // Zoom buttons
  document.getElementById('zoomInBtn').addEventListener('click', () => zoomScale(0.15));
  document.getElementById('zoomOutBtn').addEventListener('click', () => zoomScale(-0.15));
  document.getElementById('zoomFitBtn').addEventListener('click', () => fitToWidth());
  document.getElementById('zoomLabel').addEventListener('click', () => {
    zoom = 1.0;
    applyZoom();
  });

  // Ctrl + Wheel Zoom, Normal Wheel Scroll
  const viewport = document.getElementById('viewport');
  viewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      zoomScale(delta);
    }
  }, { passive: false });

  // Day / Night Theme Switcher
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  themeToggleBtn.addEventListener('click', () => {
    setTheme(!extensionDarkMode);
  });

  // Copy Image Button
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', copyImageToClipboard);
  }

  // Crop Action Bar Buttons
  document.getElementById('applyCropBtn').onclick = applyCrop;
  document.getElementById('cancelCropBtn').onclick = () => {
    cancelCrop();
    activeTool = 'select';
    updateToolButtonStyles();
  };

  // Undo / Redo
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  // Clear Canvas
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (annotations.length === 0) return;
    if (confirm('সব আঁকা এবং এডিট মুছে ফেলতে চান? (Clear all annotations?)')) {
      saveToHistory();
      annotations = [];
      selectedAnnotationId = null;
      redraw();
    }
  });

  // Export PNG
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!canvas) return;
    closeInlineTextIfOpen();
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `fullshot-capture-${Date.now()}.png`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  });

  // Export PDF
  document.getElementById('exportPdfBtn').addEventListener('click', () => {
    if (!canvas) return;
    closeInlineTextIfOpen();
    try {
      const { jsPDF } = window.jspdf;
      const w = canvas.width;
      const h = canvas.height;
      const pdf = new jsPDF({
        orientation: w > h ? 'l' : 'p',
        unit: 'px',
        format: [w, h],
        hotfixes: ['px_scaling']
      });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
      pdf.save(`fullshot-capture-${Date.now()}.pdf`);
    } catch (err) {
      console.error(err);
      alert('PDF generation failed. Try copying or exporting as PNG.');
    }
  });

  // Global Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (!selectedAnnotationId) {
        e.preventDefault();
        copyImageToClipboard();
        return;
      }
    }

    if (e.key === 'Enter' && activeTool === 'crop' && cropBox) {
      e.preventDefault();
      applyCrop();
      return;
    }

    if (e.key === 'Escape' && activeTool === 'crop') {
      e.preventDefault();
      cancelCrop();
      activeTool = 'select';
      updateToolButtonStyles();
      return;
    }

    if (activeTool === 'select' && selectedAnnotationId && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        saveToHistory();
        annotations = annotations.filter(ann => ann.id !== selectedAnnotationId);
        selectedAnnotationId = null;
        redraw();
      }
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    }
  });

  // DOUBLE CLICK ON CANVAS (Edit text OR customize selected block)
  canvas.addEventListener('dblclick', (e) => {
    const { x, y } = getCoords(e);

    if (activeTool === 'crop' && cropBox) {
      applyCrop();
      return;
    }

    const ann = getAnnotationAtCoords(x, y);
    if (ann) {
      if (ann.type === 'text') {
        openInlineTextEditor(ann.points[0].x, ann.points[0].y, e.clientX, e.clientY, ann);
      } else {
        selectedAnnotationId = ann.id;
        redraw();
        const toolBtn = document.getElementById(`tool-${ann.type}`);
        if (toolBtn) {
          openToolSettings(ann.type, toolBtn);
        }
      }
    }
  });

  // Canvas Mouse events
  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = getCoords(e);

    // If inline text editor is open and clicked on canvas, commit it
    const inlineWrapper = document.getElementById('inlineTextWrapper');
    if (inlineWrapper && !inlineWrapper.classList.contains('hidden')) {
      const textarea = document.getElementById('activeInlineText');
      if (textarea && textarea.value.trim()) {
        document.getElementById('inlineTextDoneBtn').click();
      } else {
        document.getElementById('inlineTextCancelBtn').click();
      }
      if (activeTool !== 'text') return;
    }

    // 1. CROP TOOL
    if (activeTool === 'crop') {
      isCropping = true;
      startX = x;
      startY = y;
      currentX = x;
      currentY = y;
      cropBox = { x, y, width: 0, height: 0 };
      hideCropActionBar();
      redraw();
      return;
    }

    // 2. TEXT TOOL
    if (activeTool === 'text') {
      openInlineTextEditor(x, y, e.clientX, e.clientY);
      return;
    }

    // 3. SELECT TOOL
    if (activeTool === 'select') {
      // Check corner resize handles
      if (selectedAnnotationId) {
        const selAnn = annotations.find(a => a.id === selectedAnnotationId);
        const handle = getResizeHandleAt(selAnn, x, y);
        if (handle) {
          isResizingAnnotation = true;
          activeResizeHandle = handle;
          dragStartCoords = { x, y };
          dragAnnotationInitialPoints = selAnn.points.map(p => ({ ...p }));
          if (selAnn.type === 'text') {
            dragAnnotationInitialFontSize = selAnn.fontSize || Math.max(18, (selAnn.width || 4) * 3.5);
            dragAnnotationInitialBounds = getTextBounds(selAnn, ctx);
          } else if (selAnn.type === 'circle') {
            const [p1, p2] = selAnn.points;
            dragAnnotationInitialRadius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          }
          saveToHistory();
          return;
        }
      }

      // Check annotation body
      const clickedAnn = getAnnotationAtCoords(x, y);
      if (clickedAnn) {
        selectedAnnotationId = clickedAnn.id;
        isDraggingAnnotation = true;
        dragStartCoords = { x, y };
        dragAnnotationInitialPoints = clickedAnn.points.map(p => ({ ...p }));
        saveToHistory();

        const sliderTitle = document.getElementById('sliderSectionTitle');
        if (clickedAnn.type === 'text') {
          const fontSize = clickedAnn.fontSize || Math.max(18, (clickedAnn.width || 4) * 3.5);
          if (sliderTitle) sliderTitle.innerText = 'Text Size';
          if (strokeWeightSlider) strokeWeightSlider.value = Math.min(40, Math.max(2, Math.round(fontSize / 3.5)));
          if (strokeWeightVal) strokeWeightVal.innerText = `${fontSize}px`;
        } else if (clickedAnn.width && strokeWeightSlider) {
          if (sliderTitle) sliderTitle.innerText = 'Stroke Size';
          strokeWeightSlider.value = clickedAnn.width;
          if (strokeWeightVal) strokeWeightVal.innerText = `${clickedAnn.width}px`;
          strokeWidth = clickedAnn.width;
        }

        // If toolSettingsModal is currently open, dynamically refresh it for this clicked shape
        const modal = document.getElementById('toolSettingsModal');
        if (modal && !modal.classList.contains('hidden')) {
          const toolBtn = document.getElementById(`tool-${clickedAnn.type}`);
          if (toolBtn) openToolSettings(clickedAnn.type, toolBtn);
        }
      } else {
        selectedAnnotationId = null;
        const sliderTitle = document.getElementById('sliderSectionTitle');
        if (sliderTitle) sliderTitle.innerText = 'Stroke Size';
      }
      redraw();
      return;
    }

    // 4. DRAWING TOOLS (pencil, highlighter, rectangle, circle, arrow, blur)
    isDrawing = true;
    startX = x;
    startY = y;
    currentX = x;
    currentY = y;

    if (activeTool === 'pencil' || activeTool === 'highlighter') {
      saveToHistory();
      annotations.push({
        id: 'ann_' + Date.now(),
        type: activeTool,
        points: [{ x: startX, y: startY }],
        color: strokeColor,
        width: strokeWidth
      });
    }

    redraw();
  });

  window.addEventListener('mousemove', (e) => {
    if (!canvas) return;
    const { x, y } = getCoords(e);

    // CROP DRAGGING
    if (activeTool === 'crop' && isCropping) {
      currentX = x;
      currentY = y;
      const cx = Math.min(startX, currentX);
      const cy = Math.min(startY, currentY);
      let cw = Math.abs(currentX - startX);
      let ch = Math.abs(currentY - startY);

      if (toolConfig.cropAspect === '16:9') ch = cw * (9 / 16);
      else if (toolConfig.cropAspect === '4:3') ch = cw * (3 / 4);
      else if (toolConfig.cropAspect === '1:1') ch = cw;

      cropBox = { x: cx, y: cy, width: cw, height: ch };
      redraw();
      return;
    }

    // SELECT RESIZING & DRAGGING
    if (activeTool === 'select') {
      if (isResizingAnnotation && selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (!ann) return;

        // 1. TEXT RESIZING (DRAG ANY CORNER TO SCALE FONT SIZE)
        if (ann.type === 'text') {
          const initBounds = dragAnnotationInitialBounds;
          const initFontSize = dragAnnotationInitialFontSize;
          if (initBounds && initFontSize) {
            let anchorX, anchorY;
            if (activeResizeHandle === 'br') {
              anchorX = initBounds.minX;
              anchorY = initBounds.minY;
            } else if (activeResizeHandle === 'bl') {
              anchorX = initBounds.maxX;
              anchorY = initBounds.minY;
            } else if (activeResizeHandle === 'tr') {
              anchorX = initBounds.minX;
              anchorY = initBounds.maxY;
            } else { // 'tl'
              anchorX = initBounds.maxX;
              anchorY = initBounds.maxY;
            }

            const startDiag = Math.hypot(dragStartCoords.x - anchorX, dragStartCoords.y - anchorY);
            const currDiag = Math.hypot(x - anchorX, y - anchorY);
            const scale = currDiag / Math.max(10, startDiag);
            const newFontSize = Math.max(10, Math.min(180, Math.round(initFontSize * scale)));
            ann.fontSize = newFontSize;

            // Anchor adjustment so text stays pinned to opposite corner
            const newBounds = getTextBounds(ann, ctx);
            if (newBounds) {
              if (activeResizeHandle === 'tl' || activeResizeHandle === 'bl') {
                ann.points[0].x = initBounds.maxX - newBounds.width + 6;
              }
              if (activeResizeHandle === 'tl' || activeResizeHandle === 'tr') {
                ann.points[0].y = initBounds.maxY - (newBounds.totalH - newFontSize) - 4;
              }
            }

            // Sync sidebar slider and val
            const slider = document.getElementById('strokeWeightSlider');
            const sliderVal = document.getElementById('strokeWeightVal');
            if (slider && sliderVal) {
              slider.value = Math.min(40, Math.max(2, Math.round(newFontSize / 3.5)));
              sliderVal.innerText = `${newFontSize}px`;
            }
          }
          redraw();
          return;
        }

        // 2. RECTANGLE & BLUR RESIZING
        if (ann.type === 'rectangle' || ann.type === 'blur') {
          const [p1, p2] = ann.points;
          const initialP1 = dragAnnotationInitialPoints[0];
          const initialP2 = dragAnnotationInitialPoints[1];
          const minX = Math.min(initialP1.x, initialP2.x);
          const maxX = Math.max(initialP1.x, initialP2.x);
          const minY = Math.min(initialP1.y, initialP2.y);
          const maxY = Math.max(initialP1.y, initialP2.y);

          if (activeResizeHandle === 'br') {
            p1.x = minX; p1.y = minY;
            p2.x = x; p2.y = y;
          } else if (activeResizeHandle === 'tl') {
            p1.x = x; p1.y = y;
            p2.x = maxX; p2.y = maxY;
          } else if (activeResizeHandle === 'tr') {
            p1.x = minX; p1.y = y;
            p2.x = x; p2.y = maxY;
          } else if (activeResizeHandle === 'bl') {
            p1.x = x; p1.y = minY;
            p2.x = maxX; p2.y = y;
          }
          redraw();
          return;
        }

        // 3. CIRCLE RESIZING
        if (ann.type === 'circle') {
          const [p1, p2] = ann.points;
          const initialP1 = dragAnnotationInitialPoints[0];
          const cx = initialP1.x;
          const cy = initialP1.y;
          const newRadius = Math.hypot(x - cx, y - cy);
          p2.x = cx + newRadius;
          p2.y = cy;
          redraw();
          return;
        }
      }

      if (isDraggingAnnotation && selectedAnnotationId) {
        const ann = annotations.find(a => a.id === selectedAnnotationId);
        if (ann) {
          const dx = x - dragStartCoords.x;
          const dy = y - dragStartCoords.y;
          ann.points = dragAnnotationInitialPoints.map(p => ({
            x: p.x + dx,
            y: p.y + dy
          }));
          redraw();
        }
        return;
      }

      // Cursor hover feedback
      if (selectedAnnotationId) {
        const selAnn = annotations.find(a => a.id === selectedAnnotationId);
        const handle = getResizeHandleAt(selAnn, x, y);
        if (handle === 'tl' || handle === 'br') {
          canvas.style.cursor = 'nwse-resize';
          return;
        } else if (handle === 'tr' || handle === 'bl') {
          canvas.style.cursor = 'nesw-resize';
          return;
        }
      }

      const hoveredAnn = getAnnotationAtCoords(x, y);
      canvas.style.cursor = hoveredAnn ? 'move' : 'default';
      return;
    }

    if (!isDrawing) return;
    currentX = x;
    currentY = y;

    if (activeTool === 'pencil' || activeTool === 'highlighter') {
      const activeAnn = annotations[annotations.length - 1];
      if (activeAnn && activeAnn.points.length > 0) {
        const lastPt = activeAnn.points[activeAnn.points.length - 1];
        if (Math.hypot(currentX - lastPt.x, currentY - lastPt.y) >= 2) {
          activeAnn.points.push({ x: currentX, y: currentY });
        }
      }
    }

    redraw();
  });

  window.addEventListener('mouseup', () => {
    // FINISH CROP DRAGGING
    if (activeTool === 'crop' && isCropping) {
      isCropping = false;
      if (cropBox && cropBox.width > 20 && cropBox.height > 20) {
        updateCropActionBarPos();
      } else {
        cropBox = null;
        hideCropActionBar();
      }
      redraw();
      return;
    }

    if (activeTool === 'select') {
      if (isResizingAnnotation) {
        isResizingAnnotation = false;
        activeResizeHandle = null;
        dragAnnotationInitialBounds = null;
        if (selectedAnnotationId) {
          const ann = annotations.find(a => a.id === selectedAnnotationId);
          if (ann && (ann.type === 'rectangle' || ann.type === 'blur')) {
            const [p1, p2] = ann.points;
            const x1 = Math.min(p1.x, p2.x);
            const y1 = Math.min(p1.y, p2.y);
            const x2 = Math.max(p1.x, p2.x);
            const y2 = Math.max(p1.y, p2.y);
            p1.x = x1; p1.y = y1;
            p2.x = x2; p2.y = y2;
            redraw();
          }
        }
      }
      isDraggingAnnotation = false;
    }

    if (isDrawing) {
      isDrawing = false;
      if (activeTool !== 'pencil' && activeTool !== 'highlighter' && activeTool !== 'text' && activeTool !== 'crop') {
        if (Math.hypot(currentX - startX, currentY - startY) > 3) {
          saveToHistory();
          const newAnn = {
            id: 'ann_' + Date.now(),
            type: activeTool,
            points: [{ x: startX, y: startY }, { x: currentX, y: currentY }],
            color: strokeColor,
            width: strokeWidth
          };
          if (activeTool === 'rectangle' || activeTool === 'circle') {
            newAnn.shapeFill = toolConfig.shapeFill || 'none';
          }
          if (activeTool === 'blur') {
            newAnn.censorMode = toolConfig.censorMode || 'pixelate';
            newAnn.censorBlockSize = toolConfig.censorBlockSize || 14;
          }
          annotations.push(newAnn);
          selectedAnnotationId = newAnn.id;
        }
      }
      redraw();
    }
  });
}

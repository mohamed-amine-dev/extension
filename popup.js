/**
 * VariantSnap Popup v3
 * All page images → click download icon → saves as WebP
 * No ZIP, no bulk selection. One click = one WebP file.
 */

const OUTPUT_FORMAT = 'webp'; // Always WebP

// ─── State ────────────────────────────────────────────────────────────────────
let allImages    = [];   // Full list from scanAllImages()
let displayImages = [];  // After type filter applied
let activeFilter = 'all';
let productName  = 'image';
let isScanning   = false;
let selectMode   = false;         // Multi-select mode on/off
let selectedUrls = new Set();     // URLs currently selected

// ─── DOM ──────────────────────────────────────────────────────────────────────
const scanBtn         = document.getElementById('scanBtn');
const scanBtnText     = document.getElementById('scanBtnText');
const progressWrap    = document.getElementById('progressWrap');
const progressFill    = document.getElementById('progressFill');
const progressMsg     = document.getElementById('progressMsg');
const statsRow        = document.getElementById('statsRow');
const imgCountLabel   = document.getElementById('imgCountLabel');
const imageGrid       = document.getElementById('imageGrid');
const emptyState      = document.getElementById('emptyState');
const toast           = document.getElementById('toast');
const previewOverlay  = document.getElementById('previewOverlay');
const previewImg      = document.getElementById('previewImg');
const previewMeta     = document.getElementById('previewMeta');
const previewClose    = document.getElementById('previewClose');
const previewDlBtn    = document.getElementById('previewDlBtn');

const selectionBar     = document.getElementById('selectionBar');
const selCountLabel    = document.getElementById('selCountLabel');
const selDownloadCount = document.getElementById('selDownloadCount');
const selDownloadBtn   = document.getElementById('selDownloadBtn');
const selAllBtn        = document.getElementById('selAllBtn');
const selNoneBtn       = document.getElementById('selNoneBtn');
const selectModeBtn    = document.getElementById('selectModeBtn');

// ─── Select Mode Toggle ───────────────────────────────────────────────────────
selectModeBtn.addEventListener('click', () => {
  selectMode = !selectMode;
  selectModeBtn.classList.toggle('active', selectMode);
  imageGrid.classList.toggle('select-mode', selectMode);
  if (!selectMode) {
    // Clear selection when exiting
    selectedUrls.clear();
    document.querySelectorAll('.img-card.selected').forEach(c => c.classList.remove('selected'));
    selectionBar.classList.add('hidden');
  }
  updateSelectionBar();
});

selAllBtn.addEventListener('click', () => {
  displayImages.forEach(img => selectedUrls.add(img.url));
  document.querySelectorAll('.img-card').forEach(c => c.classList.add('selected'));
  updateSelectionBar();
});

selNoneBtn.addEventListener('click', () => {
  selectedUrls.clear();
  document.querySelectorAll('.img-card').forEach(c => c.classList.remove('selected'));
  updateSelectionBar();
});

selDownloadBtn.addEventListener('click', () => downloadSelected());

function updateSelectionBar() {
  const count = selectedUrls.size;
  if (selectMode) {
    selCountLabel.textContent = count === 0 ? 'None selected' : `${count} selected`;
    selDownloadCount.textContent = count;
    selectionBar.classList.toggle('hidden', false);
    selDownloadBtn.disabled = count === 0;
  } else {
    selectionBar.classList.add('hidden');
  }
}
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.type;
    applyFilter();
    renderGrid();
  });
});

// ─── Scan ─────────────────────────────────────────────────────────────────────
scanBtn.addEventListener('click', startScan);

async function startScan() {
  if (isScanning) return;
  isScanning = true;

  allImages = [];
  displayImages = [];
  imageGrid.innerHTML = '';
  statsRow.classList.add('hidden');
  emptyState.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  scanBtn.disabled = true;
  scanBtn.classList.add('scanning');
  scanBtnText.textContent = 'Scanning...';
  setProgress(0, '🔍 Starting...');

  const listener = (msg) => {
    if (msg.action === 'SCAN_PROGRESS') setProgress(msg.pct, msg.msg);
  };
  chrome.runtime.onMessage.addListener(listener);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Re-inject content script (safe to call if already there)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['libs/html2canvas.min.js', 'content.js'],
    }).catch(() => {});

    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_ALL_IMAGES' });

    if (resp?.success) {
      allImages   = resp.images   || [];
      productName = resp.productName || 'image';
    } else {
      showToast('Scan failed: ' + (resp?.error || 'unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    chrome.runtime.onMessage.removeListener(listener);
    isScanning = false;
    scanBtn.disabled = false;
    scanBtn.classList.remove('scanning');
    scanBtnText.textContent = 'Rescan';
    progressWrap.classList.add('hidden');
    applyFilter();
    renderGrid();
  }
}

function setProgress(pct, msg) {
  progressFill.style.width = Math.min(100, pct) + '%';
  progressMsg.textContent = msg;
}

// ─── Filter ───────────────────────────────────────────────────────────────────
function applyFilter() {
  if (activeFilter === 'all') {
    displayImages = [...allImages];
  } else {
    displayImages = allImages.filter((img) => {
      if (activeFilter === 'jpg') return img.type === 'jpg';
      return img.type === activeFilter;
    });
  }
}

// ─── Grid Rendering ───────────────────────────────────────────────────────────
function renderGrid() {
  imageGrid.innerHTML = '';

  if (!displayImages.length) {
    statsRow.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.querySelector('.empty-sub').innerHTML = allImages.length
      ? `No <strong>${activeFilter.toUpperCase()}</strong> images on this page`
      : 'Go to any page and click <strong>Scan Page</strong>';
    return;
  }

  emptyState.classList.add('hidden');
  statsRow.classList.remove('hidden');
  imgCountLabel.textContent = `${displayImages.length} image${displayImages.length !== 1 ? 's' : ''} found`;

  displayImages.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'img-card' + (selectedUrls.has(img.url) ? ' selected' : '');
    card.dataset.url = img.url;

    // Selection check circle (visible in select mode)
    const check = document.createElement('div');
    check.className = 'sel-check';
    card.appendChild(check);

    // Image element
    const el = document.createElement('img');
    el.loading = 'lazy';
    el.alt = img.alt || '';
    el.src = img.url;
    el.onerror = () => {
      el.style.display = 'none';
      const ph = document.createElement('div');
      ph.className = 'no-preview';
      ph.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg><span>No preview</span>`;
      card.appendChild(ph);
    };
    card.appendChild(el);

    // Type badge
    const badge = document.createElement('div');
    badge.className = `type-badge ${img.type}`;
    badge.textContent = img.type.toUpperCase();
    card.appendChild(badge);

    // Spinner (shown during single download)
    const spinner = document.createElement('div');
    spinner.className = 'card-spinner';
    card.appendChild(spinner);

    // Download button (bottom-right, appears on hover, hidden in select mode)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'dl-btn-overlay';
    dlBtn.title = 'Download as WebP';
    dlBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`;
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectMode) downloadAsWebp(img, card, i);
    });
    card.appendChild(dlBtn);

    // Card click: select/deselect in select mode, open preview otherwise
    card.addEventListener('click', () => {
      if (selectMode) {
        if (selectedUrls.has(img.url)) {
          selectedUrls.delete(img.url);
          card.classList.remove('selected');
        } else {
          selectedUrls.add(img.url);
          card.classList.add('selected');
        }
        updateSelectionBar();
      } else {
        openPreview(img, i);
      }
    });

    imageGrid.appendChild(card);
  });
  // Keep select-mode class on grid if active
  imageGrid.classList.toggle('select-mode', selectMode);
}

// ─── Multi-select Download (all simultaneous) ────────────────────────────────
async function downloadSelected() {
  const toDownload = displayImages.filter(img => selectedUrls.has(img.url));
  if (!toDownload.length) return;

  selDownloadBtn.disabled = true;
  showToast(`⬇ Downloading ${toDownload.length} images...`, '');

  // Launch ALL downloads simultaneously (parallel)
  const promises = toDownload.map((img, localIndex) => {
    const globalIndex = displayImages.indexOf(img);
    return singleDownloadQuiet(img, globalIndex);
  });

  const results = await Promise.allSettled(promises);
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const failed    = results.length - succeeded;

  selDownloadBtn.disabled = selectedUrls.size === 0;
  showToast(
    failed === 0
      ? `✓ ${succeeded} image${succeeded !== 1 ? 's' : ''} downloaded!`
      : `✓ ${succeeded} downloaded, ${failed} failed`,
    failed === 0 ? 'success' : ''
  );
}

// Silent single download used for bulk — no loading spinner on card
async function singleDownloadQuiet(img, index) {
  try {
    if (img.type === 'gif') {
      const ext = 'gif';
      const filename = buildFilename(img, index, ext);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'FETCH_IMAGE', url: img.url }).catch(() => null);
      if (resp?.success && resp.dataUrl) {
        await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: resp.dataUrl, filename });
      } else {
        await chrome.runtime.sendMessage({ action: 'DOWNLOAD_URL', url: img.url, filename });
      }
    } else {
      const dataUrl = await fetchImageAsDataUrl(img.url);
      if (!dataUrl) return false;
      const webpDataUrl = await convertToWebp(dataUrl);
      const filename = buildFilename(img, index, 'webp');
      await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: webpDataUrl, filename });
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Download a single image as WebP ─────────────────────────────────────────
async function downloadAsWebp(img, card, i) {
  if (card.classList.contains('loading')) return;
  card.classList.add('loading');

  try {
    if (img.type === 'gif') {
      // GIFs stay as GIF — download original bytes to preserve animation
      await downloadOriginal(img, i);
    } else {
      // Everything else → convert to WebP
      const dataUrl = await fetchImageAsDataUrl(img.url);
      if (!dataUrl) { showToast('Could not fetch image', 'error'); card.classList.remove('loading'); return; }
      const webpDataUrl = await convertToWebp(dataUrl);
      const filename = buildFilename(img, i, 'webp');
      await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: webpDataUrl, filename });
      showToast(`✓ Saved: ${filename}`, 'success');
    }
    card.classList.remove('loading');
    card.classList.add('done-flash');
    setTimeout(() => card.classList.remove('done-flash'), 1200);
  } catch (err) {
    card.classList.remove('loading');
    showToast('Download failed: ' + err.message, 'error');
  }
}

// Download original bytes (used for GIFs to preserve animation)
async function downloadOriginal(img, index) {
  const ext = img.type === 'gif' ? 'gif' : (img.type !== 'img' && img.type !== 'unknown' ? img.type : 'png');
  const filename = buildFilename(img, index, ext);

  if (img.url.startsWith('data:')) {
    await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: img.url, filename });
    showToast(`✓ Saved as GIF: ${filename}`, 'success');
    return;
  }

  // Fetch via content script first (better for same-origin)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'FETCH_IMAGE', url: img.url });
    if (resp?.success && resp.dataUrl) {
      await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: resp.dataUrl, filename });
      showToast(`✓ Saved as GIF: ${filename}`, 'success');
      return;
    }
  } catch {}

  // Fallback: direct URL download (works for publicly accessible GIFs)
  await chrome.runtime.sendMessage({ action: 'DOWNLOAD_URL', url: img.url, filename });
  showToast(`✓ Saved as GIF: ${filename}`, 'success');
}

// ─── Preview Overlay ──────────────────────────────────────────────────────────
let previewImg_data = null;
let previewIndex = 0;

function openPreview(img, index) {
  previewImg_data = img;
  previewIndex    = index;
  previewImg.src  = img.url;
  previewMeta.textContent = [
    img.type?.toUpperCase(),
    img.width && img.height ? `${img.width}×${img.height}px` : '',
    img.alt || '',
  ].filter(Boolean).join(' · ');
  previewOverlay.classList.remove('hidden');
}

previewClose.addEventListener('click', () => previewOverlay.classList.add('hidden'));
previewOverlay.addEventListener('click', (e) => {
  if (e.target === previewOverlay) previewOverlay.classList.add('hidden');
});

previewDlBtn.addEventListener('click', async () => {
  if (!previewImg_data) return;
  previewDlBtn.disabled = true;
  previewDlBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Converting...`;

  try {
    if (previewImg_data.type === 'gif') {
      await downloadOriginal(previewImg_data, previewIndex);
    } else {
      const dataUrl = await fetchImageAsDataUrl(previewImg_data.url);
      if (!dataUrl) throw new Error('fetch failed');
      const webpDataUrl = await convertToWebp(dataUrl);
      const filename = buildFilename(previewImg_data, previewIndex, 'webp');
      await chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', dataUrl: webpDataUrl, filename });
      showToast(`✓ Saved: ${filename}`, 'success');
    }
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  } finally {
    previewDlBtn.disabled = false;
    previewDlBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download as WebP`;
  }
});

// ─── Image Fetching ───────────────────────────────────────────────────────────
async function fetchImageAsDataUrl(url) {
  // Already data URL
  if (url.startsWith('data:')) return url;

  // Try via content script (avoids CORS for same-origin images)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'FETCH_IMAGE', url });
    if (resp?.success && resp.dataUrl) return resp.dataUrl;
  } catch {}

  // Direct fetch (CORS-friendly images)
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) {
      const blob = await r.blob();
      return blobToDataUrl(blob);
    }
  } catch {}

  // Fallback fetch without CORS mode (may still work for some)
  try {
    const r = await fetch(url);
    if (r.ok) return blobToDataUrl(await r.blob());
  } catch {}

  return null;
}

// ─── WebP Conversion (min 600×600 upscale) ───────────────────────────────────
const MIN_SIZE = 600; // Minimum output dimension in pixels

function convertToWebp(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.naturalWidth  || img.width  || 800;
      let h = img.naturalHeight || img.height || 600;

      // If the image is smaller than MIN_SIZE in any dimension, scale it up
      // Preserves aspect ratio — only the smaller axis drives the scale
      if (w < MIN_SIZE || h < MIN_SIZE) {
        const scale = Math.max(MIN_SIZE / w, MIN_SIZE / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // High-quality bicubic-like interpolation for clean upscaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      const webp = canvas.toDataURL('image/webp', 0.92);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not load image for conversion'));
    img.src = dataUrl;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildFilename(img, index, ext) {
  const base = clean(productName).substring(0, 35) || 'image';
  const label = img.alt ? '_' + clean(img.alt).substring(0, 20) : '';
  const num = String(index + 1).padStart(3, '0');
  return `${base}${label}_${num}.${ext}`;
}

function clean(s) {
  return (s || '').replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, '_').trim();
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

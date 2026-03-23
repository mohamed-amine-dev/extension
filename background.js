// VariantSnap Background Service Worker
// Handles downloads, blob transfers, and messaging

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DOWNLOAD_URL') {
    handleUrlDownload(message.url, message.filename)
      .then(id => sendResponse({ success: true, downloadId: id }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep async channel open
  }

  if (message.action === 'DOWNLOAD_BLOB') {
    handleBlobDownload(message.dataUrl, message.filename)
      .then(id => sendResponse({ success: true, downloadId: id }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'DOWNLOAD_ZIP') {
    handleBlobDownload(message.dataUrl, message.filename)
      .then(id => sendResponse({ success: true, downloadId: id }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'OPEN_TAB') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return false;
  }
});

async function handleUrlDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename: sanitizeFilename(filename), saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

async function handleBlobDownload(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename: sanitizeFilename(filename), saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').substring(0, 200);
}

// Track download progress
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    // Notify any open popup about completion
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_COMPLETE', downloadId: delta.id }).catch(() => {});
  }
  if (delta.state && delta.state.current === 'interrupted') {
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_ERROR', downloadId: delta.id }).catch(() => {});
  }
});

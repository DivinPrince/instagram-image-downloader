'use strict';

importScripts('lib/urls.js');

const { isAllowedImageUrl, safeFilename } = globalThis.IGUrls;

let busy = false;
let popupPort = null;
const saveResults = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup-saver') return;
  popupPort = port;
  port.onDisconnect.addListener(() => {
    if (popupPort === port) popupPort = null;
  });
  port.onMessage.addListener((message) => {
    if (message?.type !== 'SAVE_RESULT') return;
    const waiter = saveResults.get(message.id);
    if (!waiter) return;
    saveResults.delete(message.id);
    if (message.ok) waiter.resolve();
    else waiter.reject(new Error(message.error || 'Could not save the file'));
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'DOWNLOAD_IMAGES') return;
  if (busy) {
    sendResponse({ ok: false, error: 'A download is already running.' });
    return;
  }

  busy = true;
  downloadImages(Array.isArray(message.images) ? message.images : [])
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Download failed' });
    })
    .finally(() => {
      busy = false;
    });
  return true;
});

async function downloadImages(images) {
  const queue = images
    .filter((image) => image && (isAllowedImageUrl(image.fallbackUrl) || isAllowedImageUrl(image.downloadUrl)))
    .slice(0, 150);

  let saved = 0;
  let failed = 0;
  let lastError = queue.length ? '' : 'No downloadable image links were found on this page.';

  for (let index = 0; index < queue.length; index += 1) {
    const image = queue[index];
    const filename = safeFilename(image.filename);
    if (!filename) {
      failed += 1;
      lastError = 'Could not name that file.';
    } else {
      try {
        await downloadOne(image, filename);
        saved += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : 'Download failed';
      }
    }
    notify({
      type: 'DOWNLOAD_PROGRESS',
      completed: index + 1,
      saved,
      failed,
      total: queue.length,
    });
  }

  return { saved, failed, total: queue.length, error: saved ? '' : friendlyError(lastError) };
}

async function downloadOne(image, filename) {
  const urls = uniqueUrls(image.fallbackUrl, image.downloadUrl);
  let lastError = new Error('Download failed');

  for (const url of urls) {
    try {
      const blob = await fetchImage(url);
      await saveBlob(blob, filename);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Download failed');
    }
  }

  for (const url of urls) {
    try {
      const id = await startDownload(url, filename);
      await waitUntilDone(id);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  throw lastError;
}

function uniqueUrls(first, second) {
  const urls = [];
  if (isAllowedImageUrl(first)) urls.push(first);
  if (isAllowedImageUrl(second) && second !== first) urls.push(second);
  return urls;
}

async function fetchImage(url) {
  const attempts = [
    { credentials: 'omit', referrer: 'https://www.instagram.com/' },
    { credentials: 'include', referrer: 'https://www.instagram.com/' },
  ];
  let lastError = new Error('Could not fetch image');

  for (const options of attempts) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error('Instagram returned ' + response.status);
      const blob = await response.blob();
      if (!blob || blob.size < 100) throw new Error('Empty image');
      if (!(await looksLikeImage(blob))) throw new Error('Instagram did not return an image');
      return blob;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  throw lastError;
}

async function looksLikeImage(blob) {
  if (blob.type && blob.type.startsWith('image/')) return true;
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (header[0] === 0xff && header[1] === 0xd8) return true;
  if (header[0] === 0x89 && header[1] === 0x50) return true;
  if (header[0] === 0x47 && header[1] === 0x49) return true;
  if (header[0] === 0x52 && header[1] === 0x49 && header[8] === 0x57) return true;
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return true;
  return false;
}

async function saveBlob(blob, filename) {
  if (getDownloads()) {
    try {
      const dataUrl = await blobToDataUrl(blob);
      const id = await startDownload(dataUrl, filename);
      await waitUntilDone(id);
      return;
    } catch (error) {
      if (!popupPort) throw error;
    }
  }
  await saveFromPopup(blob, filename);
}

function getDownloads() {
  const scopes = [globalThis.chrome, globalThis.browser];
  for (const scope of scopes) {
    if (typeof scope?.downloads?.download === 'function') return scope.downloads;
  }
  return null;
}

function saveFromPopup(blob, filename) {
  if (!popupPort) return Promise.reject(new Error('Keep this popup open until the save finishes.'));
  return blob.arrayBuffer().then(
    (buffer) =>
      new Promise((resolve, reject) => {
        const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
        const timeout = setTimeout(() => {
          saveResults.delete(id);
          reject(new Error('Save timed out'));
        }, 20000);
        saveResults.set(id, {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        popupPort.postMessage({
          type: 'SAVE_WITH_ANCHOR',
          id,
          filename,
          mime: blob.type || 'image/jpeg',
          buffer,
        });
      })
  );
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });
}

function startDownload(url, filename) {
  const downloads = getDownloads();
  if (!downloads) return Promise.reject(new Error('Keep this popup open until the save finishes.'));
  return new Promise((resolve, reject) => {
    downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, (id) => {
      const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
      const err = runtime && runtime.lastError;
      if (err || typeof id !== 'number') reject(new Error((err && err.message) || 'Download failed'));
      else resolve(id);
    });
  });
}

function waitUntilDone(id) {
  const downloads = getDownloads();
  if (!downloads?.onChanged || !downloads.search) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Download timed out')), 60000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    }

    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish();
      else if (delta.state.current === 'interrupted') finish(new Error(delta.error?.current || 'Download interrupted'));
    }

    downloads.onChanged.addListener(onChanged);
    downloads.search({ id }, (items) => {
      const item = items && items[0];
      if (!item) return;
      if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(new Error(item.error || 'Download interrupted'));
    });
  });
}

function friendlyError(message) {
  const text = String(message || '');
  if (/403|FORBIDDEN/i.test(text)) return 'Instagram blocked the save. Refresh the page so the photos reload, then try again.';
  if (/404|NOT_FOUND/i.test(text)) return 'That photo link expired. Refresh Instagram and try again.';
  if (/timed out/i.test(text)) return 'The save took too long. Try fewer photos at once.';
  if (/is not an object|downloads/i.test(text)) return 'Keep this popup open, then try the download again.';
  return text || 'Couldn’t save those images. Reload the extension, refresh Instagram, and try again.';
}

function notify(payload) {
  try {
    const result = chrome.runtime.sendMessage(payload);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // The popup can close while saving continues.
  }
}

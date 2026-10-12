'use strict';

const subtitle = document.querySelector('#subtitle');
const rescan = document.querySelector('#rescan');
const toolbar = document.querySelector('#toolbar');
const selectAll = document.querySelector('#select-all');
const count = document.querySelector('#count');
const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const downloadSelected = document.querySelector('#download-selected');
const downloadAll = document.querySelector('#download-all');

const state = {
  images: [],
  pageFolder: 'page',
  selected: new Set(),
  downloading: false,
  scanning: false,
};

rescan.addEventListener('click', () => {
  scan();
});

selectAll.addEventListener('change', () => {
  state.selected = selectAll.checked ? new Set(state.images.map((image) => image.id)) : new Set();
  syncCards();
});

downloadSelected.addEventListener('click', () => {
  download(state.images.filter((image) => state.selected.has(image.id)));
});

downloadAll.addEventListener('click', () => {
  download(state.images);
});

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'DOWNLOAD_PROGRESS') return;
    setStatus('Saving ' + message.completed + ' of ' + message.total + '…');
  });
}

if (globalThis.chrome?.runtime?.connect) connectSaver();

function connectSaver() {
  const saverPort = chrome.runtime.connect({ name: 'popup-saver' });
  saverPort.onDisconnect.addListener(() => {
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.lastError && document.visibilityState !== 'hidden') setTimeout(connectSaver, 150);
  });
  saverPort.onMessage.addListener((message) => {
    if (message?.type !== 'SAVE_WITH_ANCHOR') return;
    try {
      saveWithAnchor(message.buffer, message.mime, message.filename);
      saverPort.postMessage({ type: 'SAVE_RESULT', id: message.id, ok: true });
    } catch (error) {
      saverPort.postMessage({
        type: 'SAVE_RESULT',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Could not save the file',
      });
    }
  });
}

scan();

async function scan() {
  if (state.downloading || state.scanning) return;
  state.scanning = true;
  rescan.disabled = true;
  setStatus('');

  try {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.runtime) {
      state.images = [];
      renderMessage('Open this from Chrome', 'Load the extension, then click its toolbar icon on Instagram.');
      return;
    }

    let tab;
    try {
      tab = await activeTab();
    } catch {
      renderMessage('Couldn’t read the tab', 'Click the extension again from an Instagram page.');
      return;
    }

    if (!tab?.id || !isInstagram(tab.url)) {
      state.images = [];
      renderMessage('Not an Instagram tab', 'Open instagram.com, then click the extension.');
      return;
    }

    subtitle.textContent = pageLabel(tab.url);
    renderMessage('Scanning this page', 'Looking for photos already loaded.');

    try {
      const result = await collect(tab.id);
      state.images = result.images || [];
      state.pageFolder = result.pageFolder || 'page';
      state.selected = new Set();
      if (!state.images.length) {
        renderMessage('Nothing to save yet', 'Scroll the feed or open a post so photos load, then rescan.');
      } else {
        renderGrid(Boolean(result.truncated));
      }
    } catch {
      state.images = [];
      renderMessage('Couldn’t scan this tab', 'Refresh the Instagram page, then open the popup again.');
    }
  } finally {
    state.scanning = false;
    setActions();
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isInstagram(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

function pageLabel(url) {
  try {
    const path = new URL(url).pathname;
    if (!path || path === '/') return 'Home feed';
    return path;
  } catch {
    return 'Instagram';
  }
}

async function collect(tabId) {
  try {
    return await sendCollect(tabId);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/urls.js', 'content.js'],
    });
    return sendCollect(tabId);
  }
}

function sendCollect(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'COLLECT_IMAGES' }).then((response) => {
    if (!response?.ok) throw new Error(response?.error || 'Scan failed');
    return response;
  });
}

function renderMessage(title, body) {
  toolbar.hidden = true;
  panel.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const copy = document.createElement('p');
  copy.textContent = body;
  wrap.append(heading, copy);
  panel.append(wrap);
}

function renderGrid(truncated) {
  toolbar.hidden = false;
  panel.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'grid';

  state.images.forEach((image, index) => {
    const card = document.createElement('label');
    card.className = 'card';
    const details = [];
    if (image.alt) details.push(image.alt);
    if (image.width && image.height) details.push(image.width + '×' + image.height);
    card.title = details.join(' · ') || 'Image ' + (index + 1);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', card.title);
    input.addEventListener('change', () => {
      if (input.checked) state.selected.add(image.id);
      else state.selected.delete(image.id);
      card.classList.toggle('is-selected', input.checked);
      syncSelectAll();
    });

    const img = document.createElement('img');
    img.alt = image.alt || '';
    img.referrerPolicy = 'no-referrer';
    img.src = image.previewUrl;
    img.addEventListener('error', () => {
      card.classList.add('is-broken');
    });

    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.setAttribute('aria-hidden', 'true');

    card.append(input, img, tick);
    grid.append(card);
  });

  panel.append(grid);
  if (truncated) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Showing the first 150 photos. Scroll, then rescan, for more.';
    panel.append(note);
  }
  count.textContent = state.images.length + ' found';
  syncSelectAll();
}

function syncCards() {
  const cards = panel.querySelectorAll('.card');
  cards.forEach((card, index) => {
    const image = state.images[index];
    if (!image) return;
    const input = card.querySelector('input');
    const on = state.selected.has(image.id);
    input.checked = on;
    card.classList.toggle('is-selected', on);
  });
  syncSelectAll();
}

function syncSelectAll() {
  const total = state.images.length;
  const selected = state.selected.size;
  selectAll.indeterminate = selected > 0 && selected < total;
  selectAll.checked = total > 0 && selected === total;
  setActions();
}

function setActions() {
  const total = state.images.length;
  const selected = state.selected.size;
  document.querySelector('.actions').hidden = total === 0;
  downloadAll.disabled = state.downloading || total === 0;
  downloadSelected.disabled = state.downloading || selected === 0;
  downloadAll.textContent = total ? 'Download all ' + total : 'Download all';
  downloadSelected.textContent = selected ? 'Download ' + selected : 'Download selected';
  rescan.disabled = state.downloading || state.scanning;
}

async function download(images) {
  if (!images.length || state.downloading) return;
  state.downloading = true;
  setActions();
  setStatus('Saving 0 of ' + images.length + '…');

  const payload = images.map((image) => {
    const index = state.images.findIndex((item) => item.id === image.id);
    return {
      downloadUrl: image.downloadUrl,
      fallbackUrl: image.fallbackUrl,
      filename: globalThis.IGUrls.buildFilename(
        state.pageFolder,
        index < 0 ? 0 : index,
        image.fallbackUrl || image.downloadUrl
      ),
    };
  });

  try {
    const result = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_IMAGES', images: payload });
    if (!result?.ok) throw new Error(result?.error || 'Download failed');
    if (!result.saved) {
      setStatus(result.error || 'Couldn’t save those images. Reload the extension, refresh Instagram, and try again.', 'error');
    } else if (result.failed) {
      setStatus('Saved ' + result.saved + '. ' + result.failed + ' failed. Rescan and try again.', 'error');
    } else {
      const noun = result.saved === 1 ? 'image' : 'images';
      setStatus('Saved ' + result.saved + ' ' + noun + ' to Downloads.', 'ok');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Download failed.', 'error');
  } finally {
    state.downloading = false;
    setActions();
  }
}

function saveWithAnchor(buffer, mime, filename) {
  const blob = new Blob([buffer], { type: mime || 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const base = String(filename || 'image.jpg').split('/').pop() || 'image.jpg';
  link.href = url;
  link.download = base;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

function setStatus(text, kind) {
  status.textContent = text || '';
  status.classList.toggle('is-ok', kind === 'ok');
  status.classList.toggle('is-error', kind === 'error');
}

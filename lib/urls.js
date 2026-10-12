(function (root) {
  'use strict';

  function isAllowedImageUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname;
    const cdn =
      host === 'cdninstagram.com' ||
      host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net');
    if (cdn) return true;
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      return /\.(jpe?g|png|webp|gif)$/i.test(parsed.pathname) || parsed.pathname.includes('/media');
    }
    return false;
  }

  function looksLikeUiAsset(url) {
    return /emoji|rsrc\.php|static\.cdninstagram\.com|\/sprites?\//i.test(url) || /\.svg(\?|$)/i.test(url);
  }

  function canonicalKey(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  function sizeScore(url) {
    if (!url) return 0;
    let best = 0;
    const pattern = /(?:^|[^a-z0-9])([sp])(\d{2,4})x(\d{2,4})/gi;
    let match;
    while ((match = pattern.exec(url))) {
      const width = Number(match[2]);
      const height = Number(match[3]);
      if (width >= 40 && height >= 40) best = Math.max(best, width * height);
    }
    return best;
  }

  function qualityRank(url) {
    const score = sizeScore(url);
    if (score > 0) return score;
    try {
      const stp = new URL(url).searchParams.get('stp') || '';
      if (!/[sp]\d{2,4}x\d{2,4}/i.test(stp)) return Number.MAX_SAFE_INTEGER;
    } catch {
      return 0;
    }
    return 0;
  }

  function largerUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const stp = parsed.searchParams.get('stp');
    if (!stp) return url;
    let changed = false;
    const next = stp.replace(/([sp])(\d{2,4})x(\d{2,4})/gi, (full, prefix, w, h) => {
      const width = Number(w);
      const height = Number(h);
      if (width >= 1080 && height >= 1080) return full;
      if (width < 80 || height < 80) return full;
      changed = true;
      if (width === height) return prefix + '1080x1080';
      const scale = 1080 / Math.max(width, height);
      const nextW = Math.max(1, Math.round(width * scale));
      const nextH = Math.max(1, Math.round(height * scale));
      return prefix + nextW + 'x' + nextH;
    });
    if (!changed) return url;
    parsed.searchParams.set('stp', next);
    return parsed.href;
  }

  function extensionFromUrl(url) {
    try {
      const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
      if (!match) return 'jpg';
      return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    } catch {
      return 'jpg';
    }
  }

  function fileStem(url) {
    try {
      const base = new URL(url).pathname.split('/').pop() || 'image';
      const stem = base.replace(/\.[a-z0-9]+$/i, '');
      const safe = stem.replace(/[^a-z0-9._-]/gi, '').replace(/^\.+/, '').slice(0, 48);
      return safe || 'image';
    } catch {
      return 'image';
    }
  }

  function pageFolder(pathname) {
    const parts = String(pathname || '/')
      .split('/')
      .filter(Boolean)
      .map((part) => part.replace(/[^a-z0-9._-]/gi, '').replace(/^\.+/, '').slice(0, 40))
      .filter((part) => part && part !== '.' && part !== '..')
      .slice(0, 3);
    return parts.join('_') || 'page';
  }

  function localDay(date) {
    const now = date || new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function buildFilename(page, index, url, date) {
    const folder = String(page || 'page').replace(/[^a-z0-9._-]/gi, '').slice(0, 80) || 'page';
    const n = String(index + 1).padStart(2, '0');
    const ext = extensionFromUrl(url);
    const stem = fileStem(url);
    return 'instagram-images/' + localDay(date) + '_' + folder + '/' + n + '-' + stem + '.' + ext;
  }

  function safeFilename(name) {
    const parts = String(name || '').replace(/\\/g, '/').split('/');
    if (parts.some((part) => part === '..' || part === '.' || part.includes('\0'))) return '';
    const cleaned = parts
      .map((part) => part.replace(/[^a-z0-9._-]/gi, '').replace(/^\.+/, '').slice(0, 80))
      .filter(Boolean);
    if (cleaned.length < 2 || cleaned.length > 4) return '';
    if (cleaned[0] !== 'instagram-images') return '';
    if (!/\.(jpe?g|png|webp|gif)$/i.test(cleaned[cleaned.length - 1])) return '';
    return cleaned.join('/');
  }

  const api = {
    isAllowedImageUrl,
    looksLikeUiAsset,
    canonicalKey,
    sizeScore,
    qualityRank,
    largerUrl,
    extensionFromUrl,
    fileStem,
    pageFolder,
    buildFilename,
    safeFilename,
  };

  root.IGUrls = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

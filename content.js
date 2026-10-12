(() => {
  'use strict';

  if (globalThis.__igImageDownloaderLoaded) return;
  if (!globalThis.IGUrls) return;
  globalThis.__igImageDownloaderLoaded = true;

  const {
    isAllowedImageUrl,
    looksLikeUiAsset,
    canonicalKey,
    qualityRank,
    largerUrl,
    pageFolder,
  } = globalThis.IGUrls;

  const MAX_IMAGES = 150;
  const LARGE_RANK = 480 * 480;

  function absUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, location.href).href;
    } catch {
      return '';
    }
  }

  function consider(map, order, rawUrl, meta) {
    const href = absUrl(rawUrl);
    if (!href || href.startsWith('data:') || href.startsWith('blob:')) return;
    if (!isAllowedImageUrl(href) || looksLikeUiAsset(href)) return;

    const key = canonicalKey(href);
    const alt = (meta.alt || '').slice(0, 180);
    const previewCandidate = absUrl(meta.preview);
    const preview =
      previewCandidate &&
      !previewCandidate.startsWith('blob:') &&
      !previewCandidate.startsWith('data:') &&
      isAllowedImageUrl(previewCandidate)
        ? previewCandidate
        : href;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        href,
        preview,
        alt,
        width: meta.naturalW || 0,
        height: meta.naturalH || 0,
      });
      order.push(key);
      return;
    }

    if (qualityRank(href) > qualityRank(existing.href)) existing.href = href;
    if (!existing.alt && alt) existing.alt = alt;
    if ((meta.naturalW || 0) > existing.width) {
      existing.width = meta.naturalW || 0;
      existing.height = meta.naturalH || existing.height;
    }
  }

  function shouldKeep(meta, href) {
    if (meta.force) return true;
    const display = meta.display || 0;
    const natural = meta.natural || 0;
    if (display >= 80) return true;
    if (natural >= 240) return true;
    if (qualityRank(href) >= LARGE_RANK) return true;
    if (meta.inPost && display >= 48) return true;
    return false;
  }

  function addSrcset(candidates, srcset) {
    if (!srcset) return;
    srcset.split(',').forEach((part) => {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      if (!url) return;
      const desc = bits[1] || '';
      let extra = 0;
      if (desc.endsWith('w')) extra = Number.parseInt(desc, 10) ** 2;
      else if (desc.endsWith('x')) extra = Math.round(Number.parseFloat(desc) * 800) ** 2;
      candidates.push({ href: absUrl(url), extra });
    });
  }

  function bestFromImg(img) {
    const candidates = [];
    const push = (url, extra) => {
      const href = absUrl(url);
      if (!href) return;
      candidates.push({ href, extra: extra || 0 });
    };

    push(img.currentSrc, (img.naturalWidth || 0) * (img.naturalHeight || 0));
    push(img.src, (img.naturalWidth || 0) * (img.naturalHeight || 0));
    addSrcset(candidates, img.getAttribute('srcset'));

    const picture = img.closest('picture');
    if (picture) {
      picture.querySelectorAll('source[srcset]').forEach((source) => {
        addSrcset(candidates, source.getAttribute('srcset'));
      });
    }

    let best = '';
    let bestRank = -1;
    candidates.forEach((candidate) => {
      if (!candidate.href || candidate.href.startsWith('blob:') || candidate.href.startsWith('data:')) return;
      const rank = Math.max(qualityRank(candidate.href), candidate.extra || 0);
      if (rank >= bestRank) {
        bestRank = rank;
        best = candidate.href;
      }
    });
    return best;
  }

  function collectImages() {
    const map = new Map();
    const order = [];
    const path = location.pathname;
    const isSingleMedia = /^\/(p|reel|tv)\//.test(path);

    if (isSingleMedia) {
      const og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) {
        consider(map, order, og, {
          force: true,
          alt: document.querySelector('meta[property="og:image:alt"]')?.content || '',
          preview: og,
          naturalW: 1080,
          naturalH: 1080,
        });
      }
    }

    document.querySelectorAll('img').forEach((img) => {
      const href = bestFromImg(img);
      if (!href) return;
      const rect = img.getBoundingClientRect();
      const display = Math.round(Math.max(rect.width, rect.height));
      const natural = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
      const meta = {
        display,
        natural,
        naturalW: img.naturalWidth || 0,
        naturalH: img.naturalHeight || 0,
        alt: img.alt || '',
        preview: img.currentSrc || img.src,
        inPost: Boolean(img.closest('a[href*="/p/"], a[href*="/reel/"]')),
      };
      if (!shouldKeep(meta, href)) return;
      consider(map, order, href, meta);
    });

    document.querySelectorAll('video[poster]').forEach((video) => {
      const rect = video.getBoundingClientRect();
      const display = Math.round(Math.max(rect.width, rect.height));
      const meta = {
        display,
        natural: display,
        alt: 'Video cover',
        preview: video.poster,
        inPost: true,
      };
      if (!shouldKeep(meta, video.poster)) return;
      consider(map, order, video.poster, meta);
    });

    // Large files already requested by the page, including carousel frames
    // that have scrolled out of the DOM.
    performance.getEntriesByType('resource').forEach((entry) => {
      if (entry.initiatorType !== 'img') return;
      if (!isAllowedImageUrl(entry.name) || looksLikeUiAsset(entry.name)) return;
      if (qualityRank(entry.name) < LARGE_RANK) return;
      consider(map, order, entry.name, { preview: entry.name, alt: '' });
    });

    const images = [];
    order.forEach((key) => {
      if (images.length >= MAX_IMAGES) return;
      const item = map.get(key);
      const fallbackUrl = item.href;
      const upgraded = largerUrl(fallbackUrl);
      images.push({
        id: key,
        previewUrl: item.preview || fallbackUrl,
        downloadUrl: isAllowedImageUrl(upgraded) ? upgraded : fallbackUrl,
        fallbackUrl,
        width: item.width || 0,
        height: item.height || 0,
        alt: item.alt || '',
      });
    });

    return {
      images,
      pageFolder: pageFolder(path),
      truncated: order.length > images.length,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'COLLECT_IMAGES') return;
    try {
      sendResponse({ ok: true, ...collectImages() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Scan failed' });
    }
  });
})();

/**
 * VariantSnap Content Script
 * Smart product image variant detector & extractor
 * Injected into all pages by the extension
 */

(function () {
  'use strict';

  // ─── Utility helpers ────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function absUrl(src) {
    if (!src) return null;
    try {
      return new URL(src, location.href).href;
    } catch {
      return null;
    }
  }

  function cleanFilename(name) {
    return name.replace(/[^a-zA-Z0-9\-_. ]/g, '_').replace(/\s+/g, '_').substring(0, 80).trim();
  }

  function getBestSrc(img) {
    // Prefer highest resolution from srcset
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    if (srcset) {
      const entries = srcset.split(',').map((s) => {
        const parts = s.trim().split(/\s+/);
        const w = parts[1] ? parseFloat(parts[1]) : 0;
        return { url: parts[0], w };
      });
      entries.sort((a, b) => b.w - a.w);
      if (entries[0]?.url) return absUrl(entries[0].url);
    }
    // Data lazy-load attributes
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-full-size-image', 'data-zoom-image'];
    for (const attr of lazyAttrs) {
      const val = img.getAttribute(attr);
      if (val) return absUrl(val);
    }
    return absUrl(img.src);
  }

  function upscaleShopifyUrl(url) {
    if (!url) return url;
    // Remove size modifiers like _100x, _200x200, etc. to get master image
    return url.replace(/(_\d+x\d*|_\d*x\d+)(\.[a-z]+)(\?.*)?$/i, '$2$3');
  }

  function dedupeUrls(arr) {
    const seen = new Set();
    return arr.filter((u) => {
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }

  /**
   * Normalize a URL for deduplication:
   * Strips well-known size/quality query params and Shopify/CDN size suffixes
   * so that img.jpg?width=300 and img.jpg?width=800 resolve to the same key.
   */
  function normalizeUrl(url) {
    if (!url || url.startsWith('data:')) return url;
    try {
      const u = new URL(url);
      // Strip common size-related query params
      const sizeParams = ['w','h','width','height','size','quality','q','resize','fit','auto','format','fm','dpr','scale'];
      sizeParams.forEach((p) => u.searchParams.delete(p));
      // Remove Shopify-style size in filename: _100x, _200x300, etc.
      u.pathname = u.pathname.replace(/(_\d+x\d*|_\d*x\d+)(?=\.[^.]+$)/i, '');
      // Remove common CDN size prefixes like /300x300/ or /w_300,h_400/ (Cloudinary)
      u.pathname = u.pathname.replace(/\/\d+x\d+\//g, '/');
      return u.origin + u.pathname + (u.search || '');
    } catch {
      return url;
    }
  }

  // ─── Site-specific JSON extractors ──────────────────────────────────────────

  function extractShopify() {
    const variants = [];
    try {
      // Method 1: ShopifyAnalytics object
      const sa = window.ShopifyAnalytics?.meta?.product;
      if (sa?.variants) {
        sa.variants.forEach((v) => {
          if (v.featured_image) {
            variants.push({
              name: [v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || v.title || 'Variant',
              urls: [absUrl(v.featured_image.src || v.featured_image)].filter(Boolean).map(upscaleShopifyUrl),
            });
          }
        });
      }
      // Method 2: __st (ShopifyTracking)
      if (!variants.length && window.__st?.cid) {
        const productData = window.meta?.product;
        if (productData?.variants) {
          productData.variants.forEach((v) => {
            if (v.featured_image) {
              variants.push({
                name: v.title || 'Variant',
                urls: [upscaleShopifyUrl(v.featured_image.src || v.featured_image)],
              });
            }
          });
        }
      }
      // Method 3: JSON-LD
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try {
          const data = JSON.parse(s.textContent);
          const items = Array.isArray(data) ? data : [data];
          items.forEach((item) => {
            if (item['@type'] === 'Product' && item.offers) {
              const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
              offers.forEach((offer, i) => {
                if (offer.image) {
                  variants.push({
                    name: offer.name || offer.color || `Variant ${i + 1}`,
                    urls: [absUrl(Array.isArray(offer.image) ? offer.image[0] : offer.image)].filter(Boolean),
                  });
                }
              });
            }
          });
        } catch {}
      });
    } catch {}
    return variants;
  }

  function extractWooCommerce() {
    const variants = [];
    try {
      // WooCommerce stores variation data in a script tag as JSON
      document.querySelectorAll('script:not([src])').forEach((s) => {
        const text = s.textContent;
        if (!text.includes('wc_product_variations') && !text.includes('variations_params') && !text.includes('"variations"')) return;
        
        // Try to find variations array in script
        const matches = text.match(/"variations"\s*:\s*(\[[\s\S]*?\])/);
        if (matches) {
          try {
            const vars = JSON.parse(matches[1]);
            vars.forEach((v, i) => {
              const img = v.image?.url || v.image_src || v.image?.full_src;
              if (img) {
                const attrStr = Object.values(v.attributes || {}).filter(Boolean).join(' / ') || `Variant ${i + 1}`;
                variants.push({ name: attrStr, urls: [absUrl(img)] });
              }
            });
          } catch {}
        }
      });
    } catch {}
    return variants;
  }

  function extractJsonLd() {
    const variants = [];
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try {
          const parse = (data) => {
            if (!data) return;
            if (Array.isArray(data)) { data.forEach(parse); return; }
            if (data['@type'] === 'Product') {
              const imgs = data.image ? (Array.isArray(data.image) ? data.image : [data.image]) : [];
              if (imgs.length) {
                variants.push({ name: data.name || 'Product', urls: imgs.map(absUrl).filter(Boolean) });
              }
              if (data.hasVariant) {
                data.hasVariant.forEach((v, i) => {
                  const vi = v.image ? [absUrl(Array.isArray(v.image) ? v.image[0] : v.image)] : [];
                  if (vi.length) {
                    variants.push({ name: v.name || `Variant ${i + 1}`, urls: vi.filter(Boolean) });
                  }
                });
              }
            }
            if (data['@graph']) parse(data['@graph']);
          };
          parse(JSON.parse(s.textContent));
        } catch {}
      });
    } catch {}
    return variants;
  }

  // ─── DOM-based swatch/variant detector ──────────────────────────────────────

  const SWATCH_SELECTORS = [
    '[data-color]', '[data-variant]', '[data-option]',
    '.swatch', '.color-swatch', '.variant-swatch', '.color-option',
    '[class*="swatch"]', '[class*="color-btn"]', '[class*="variant-btn"]',
    '[aria-label][role="radio"]', '[aria-label][role="button"]',
    '.product-color', '.product-option',
    'li[data-value]', 'button[data-value]',
    '.colorchip', '.colorOption', '.Color_option',
    'label[for*="color"]', 'label[for*="Color"]',
  ];

  function findSwatchElements() {
    const found = new Set();
    SWATCH_SELECTORS.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => found.add(el));
      } catch {}
    });
    return [...found].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0; // Only visible elements
    });
  }

  function getProductImageContainer() {
    const selectors = [
      '[class*="product__image"]', '[class*="product-image"]',
      '[class*="product__media"]', '[class*="product-media"]',
      '[class*="product__gallery"]', '[class*="product-gallery"]',
      '[class*="ProductImages"]', '[class*="product_images"]',
      '.woocommerce-product-gallery__image',
      '[data-product-image]', '.main-image', '.primary-image',
      '#product-image', '.productImage',
      'figure.product', '.product__photo',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallback: find largest visible image near top of page
    let largest = null, maxArea = 0;
    document.querySelectorAll('img').forEach((img) => {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > maxArea && r.top < window.innerHeight * 1.5) {
        maxArea = area;
        largest = img;
      }
    });
    return largest || document.body;
  }

  function getMainProductImage() {
    const container = getProductImageContainer();
    const img = container.tagName === 'IMG' ? container : container.querySelector('img');
    return img ? getBestSrc(img) : null;
  }

  // ─── Canvas screenshot capture (bypass protetion) ───────────────────────────

  async function captureElementScreenshot(element) {
    try {
      if (typeof html2canvas !== 'undefined') {
        const canvas = await html2canvas(element, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          logging: false,
          backgroundColor: null,
        });
        return canvas.toDataURL('image/png');
      }
    } catch (e) {
      console.warn('[VariantSnap] html2canvas failed:', e);
    }
    return null;
  }

  // ─── Fetch image as data URL (bypass CORS when possible) ────────────────────

  async function fetchAsDataUrl(url) {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // ─── Main Scanner ────────────────────────────────────────────────────────────

  async function scanPage(onProgress) {
    const report = (msg, pct) => { try { onProgress?.(msg, pct); } catch {} };
    let variants = [];

    report('🔍 Detecting store platform...', 5);
    await sleep(200);

    // 1. Try structured data first (fastest, highest quality)
    report('📦 Reading product JSON data...', 15);
    const shopifyVariants = extractShopify();
    const wooVariants = extractWooCommerce();
    const jsonLdVariants = extractJsonLd();

    const structured = [...shopifyVariants, ...wooVariants, ...jsonLdVariants];
    if (structured.length > 0) {
      report(`✅ Found ${structured.length} variants from product data`, 40);
      variants = structured;
    }

    // 2. DOM swatch clicking (capture images per-variant)
    report('🖱️ Scanning color swatches...', 50);
    const swatches = findSwatchElements();
    
    if (swatches.length > 1) {
      report(`Found ${swatches.length} swatches, auto-clicking...`, 55);
      const clickedVariants = [];
      const container = getProductImageContainer();
      const seenUrls = new Set(variants.flatMap(v => v.urls));

      for (let i = 0; i < swatches.length; i++) {
        const swatch = swatches[i];
        const label = swatch.getAttribute('data-color')
          || swatch.getAttribute('data-value')
          || swatch.getAttribute('aria-label')
          || swatch.getAttribute('title')
          || swatch.textContent.trim()
          || `Color ${i + 1}`;
        
        report(`Clicking: ${label} (${i + 1}/${swatches.length})`, 55 + Math.floor((i / swatches.length) * 30));

        try {
          swatch.click();
          await sleep(600); // Wait for image to update

          const newUrl = getMainProductImage();
          if (newUrl && !seenUrls.has(newUrl)) {
            seenUrls.add(newUrl);
            clickedVariants.push({ name: label, urls: [newUrl], fromClick: true });
          }
        } catch {}
      }

      if (clickedVariants.length > 0) {
        // Merge with structured or replace if better
        if (variants.length === 0) {
          variants = clickedVariants;
        } else {
          // Add unique click-found variants
          clickedVariants.forEach(cv => {
            if (!variants.some(v => v.urls.some(u => cv.urls.includes(u)))) {
              variants.push(cv);
            }
          });
        }
      }
    }

    // 3. Fallback: scan all large images on the page
    if (variants.length === 0) {
      report('🖼️ Scanning page images as fallback...', 80);
      const imgs = [...document.querySelectorAll('img')].filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width >= 200 && r.height >= 200;
      });
      if (imgs.length) {
        const urls = dedupeUrls(imgs.map(getBestSrc).filter(Boolean));
        if (urls.length) {
          variants = [{ name: 'Product Images', urls }];
        }
      }
    }

    // 4. Canvas screenshot fallback if still no results
    if (variants.length === 0) {
      report('📸 Taking screenshot as fallback...', 85);
      const container = getProductImageContainer();
      const dataUrl = await captureElementScreenshot(container);
      if (dataUrl) {
        variants = [{ name: 'Screenshot', urls: [dataUrl], isScreenshot: true }];
      }
    }

    // Dedupe URLs within each variant
    variants = variants.map((v) => ({ ...v, urls: dedupeUrls(v.urls) }));

    // Get page title for ZIP naming
    const productName = document.querySelector('h1')?.textContent?.trim()
      || document.title.replace(/\s*[-|].*$/, '').trim()
      || 'product';

    report(`✅ Done! ${variants.length} variant(s) detected`, 100);
    return { variants, productName };
  }

  // ─── Scan ALL images on the page ─────────────────────────────────────────────

  async function scanAllImages(onProgress) {
    const report = (msg, pct) => { try { onProgress?.(msg, pct); } catch {} };
    // Key = normalizedUrl, Value = { entry, bestWidth }
    const collected = new Map();

    function addImage(url, entry) {
      if (!url) return;
      const key = normalizeUrl(url);
      const existing = collected.get(key);
      const w = entry.width || 0;
      // Keep the entry with the largest known dimension (= highest res)
      if (!existing || w > (existing.bestWidth || 0)) {
        collected.set(key, { ...entry, url, bestWidth: w });
      }
    }

    report('🔍 Scanning all page images...', 10);

    // 1. <img> elements — only take the BEST (highest-res) src, not all srcset candidates
    document.querySelectorAll('img').forEach((img) => {
      const rect = img.getBoundingClientRect();
      const w = img.naturalWidth || Math.round(rect.width);
      const h = img.naturalHeight || Math.round(rect.height);
      const base = { type: '', width: w, height: h, alt: img.alt || '', element: 'img' };

      // Best srcset URL (highest descriptor)
      const bestUrl = getBestSrc(img);
      if (bestUrl) addImage(bestUrl, { ...base, type: guessType(bestUrl) });

      // Also check lazy-load attrs (may point to higher-res src not yet loaded)
      const lazyAttrs = ['data-src','data-original','data-lazy','data-lazy-src','data-full-size-image','data-zoom-image'];
      for (const a of lazyAttrs) {
        const v = absUrl(img.getAttribute(a));
        if (v) addImage(v, { ...base, type: guessType(v), width: Math.max(w, 800) }); // assume lazy = full-res
      }
    });

    report('🔍 Scanning background images...', 30);

    // 2. CSS background-image on visible elements
    document.querySelectorAll('*').forEach((el) => {
      try {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        if (!bg || bg === 'none') return;
        const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g) || [];
        matches.forEach((m) => {
          const raw = m.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
          const url = absUrl(raw);
          if (!url) return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) return;
          addImage(url, {
            type: guessType(url),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            alt: el.getAttribute('aria-label') || el.getAttribute('title') || '',
            element: 'bg',
          });
        });
      } catch {}
    });

    report('🔍 Scanning <picture> & <source> elements...', 50);

    // 3. <picture> / <source> — only take first/best URL from each source
    document.querySelectorAll('source').forEach((src) => {
      const bestEntry = (src.srcset || '').split(',').map((s) => {
        const parts = s.trim().split(/\s+/);
        return { url: absUrl(parts[0]), w: parseFloat(parts[1]) || 0 };
      }).sort((a, b) => b.w - a.w)[0];
      if (bestEntry?.url) {
        addImage(bestEntry.url, { type: guessType(bestEntry.url), width: 0, height: 0, alt: '', element: 'source' });
      }
    });

    report('🔍 Scanning data-* image attributes...', 65);

    // 4. Elements with data-image / data-img / data-src etc.
    const dataSelectors = ['[data-image]','[data-img]','[data-thumb]','[data-thumbnail]','[data-photo]','[data-background]'];
    dataSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const attrName = sel.replace('[','').replace(']','');
        const url = absUrl(el.getAttribute(attrName));
        if (url) addImage(url, { type: guessType(url), width: 0, height: 0, alt: '', element: 'data' });
      });
    });

    report('🔍 Scanning JSON-LD & meta tags...', 78);

    // 5. JSON-LD images
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const text = s.textContent;
        const imgMatches = text.match(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp|svg|avif)[^"]*)"/gi) || [];
        imgMatches.forEach((m) => {
          const url = m.replace(/^"|"$/g, '');
          if (url) addImage(url, { type: guessType(url), width: 0, height: 0, alt: 'Schema', element: 'json-ld' });
        });
      } catch {}
    });

    // 6. Meta og:image / twitter:image
    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((m) => {
      const url = absUrl(m.getAttribute('content'));
      if (url) addImage(url, { type: guessType(url), width: 0, height: 0, alt: 'OG Image', element: 'meta' });
    });

    report('✅ Building image list...', 90);

    // Filter out tiny tracker images and data URIs that are empty
    const results = [...collected.values()].filter((img) => {
      if (!img.url) return false;
      if (img.url.startsWith('data:') && img.url.length < 100) return false; // Empty data URI
      if (img.width > 0 && img.width < 20) return false;
      if (img.height > 0 && img.height < 20) return false;
      // Skip SVG icons that are tiny
      if (img.type === 'svg' && img.width < 32 && img.height < 32) return false;
      return true;
    });

    const productName = document.querySelector('h1')?.textContent?.trim()
      || document.title.replace(/\s*[-|].*$/, '').trim()
      || 'images';

    report(`✅ Found ${results.length} images`, 100);
    return { images: results, productName };
  }

  function guessType(url) {
    if (!url) return 'unknown';
    const lower = url.toLowerCase().split('?')[0];
    if (lower.includes('.gif')) return 'gif';
    if (lower.includes('.svg')) return 'svg';
    if (lower.includes('.webp')) return 'webp';
    if (lower.includes('.png')) return 'png';
    if (lower.includes('.avif')) return 'avif';
    if (lower.match(/\.jpe?g/)) return 'jpg';
    if (lower.startsWith('data:image/gif')) return 'gif';
    if (lower.startsWith('data:image/svg')) return 'svg';
    if (lower.startsWith('data:image/png')) return 'png';
    if (lower.startsWith('data:image/')) return 'img';
    return 'img';
  }

  // ─── Message Listener ────────────────────────────────────────────────────────

  window.__variantSnap = { scanPage, scanAllImages };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCAN_PAGE') {
      scanPage((msg, pct) => {
        chrome.runtime.sendMessage({ action: 'SCAN_PROGRESS', msg, pct }).catch(() => {});
      }).then((result) => {
        sendResponse({ success: true, ...result });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    if (message.action === 'SCAN_ALL_IMAGES') {
      scanAllImages((msg, pct) => {
        chrome.runtime.sendMessage({ action: 'SCAN_PROGRESS', msg, pct }).catch(() => {});
      }).then((result) => {
        sendResponse({ success: true, ...result });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    if (message.action === 'FETCH_IMAGE') {
      fetchAsDataUrl(message.url)
        .then((dataUrl) => sendResponse({ success: true, dataUrl }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === 'SCREENSHOT_ELEMENT') {
      const container = getProductImageContainer();
      captureElementScreenshot(container)
        .then((dataUrl) => sendResponse({ success: true, dataUrl }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  console.log('[VariantSnap] Content script loaded on', location.href);
})();

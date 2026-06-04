'use strict';

/* ─── Analytics ─────────────────────────────────────────── */
// Thin wrapper around GA4's gtag. Safe no-op if GA is blocked/offline.
function track(event, params) {
  try {
    if (typeof gtag === 'function') gtag('event', event, params || {});
  } catch (_) { /* never let analytics break the app */ }
}

/* ─── State ─────────────────────────────────────────────── */
const state = {
  allItems:        [],
  filtered:        [],
  currentIndex:    0,
  cart:            [],   // [{id, name, price, image, quantity}]
  addOns:          [],   // [{id, name, quantity, price}]
  showLoveCount:    false,
  showMoodDeck:     false,
  showPersonality:  false,
  sessionSeen:      0,
  sessionYes:       0,
  category:        'All',
  tableNumber:     '',
  history:         [],   // [{item, direction}] for undo
  config:          {},
  vegOnly:         false,
  activeAllergens: new Set(),
};

function loadFilterPrefs() {
  try {
    state.vegOnly = localStorage.getItem('gn_vegOnly') === '1';
    const saved = JSON.parse(localStorage.getItem('gn_allergens') || '[]');
    state.activeAllergens = new Set(saved);
  } catch { /* ignore */ }
}

function saveFilterPrefs() {
  localStorage.setItem('gn_vegOnly', state.vegOnly ? '1' : '0');
  localStorage.setItem('gn_allergens', JSON.stringify([...state.activeAllergens]));
}

function applyFilters() {
  let items = state.category === 'All'
    ? [...state.allItems]
    : state.allItems.filter(i => i.category === state.category);

  if (state.vegOnly) {
    items = items.filter(i => i.vegetarian);
  }

  if (state.activeAllergens.size > 0) {
    items = items.filter(item => {
      const text = ((item.allergens || '') + ' ' + (item.contains || '')).toLowerCase();
      return ![...state.activeAllergens].some(a => text.includes(a));
    });
  }

  state.filtered     = items;
  state.currentIndex = 0;
}

/* ─── Constants ─────────────────────────────────────────── */
const MOOD_TAGS = {
  comfort: ['ramen', 'donburi', 'rice', 'chicken', 'noodles'],
  energy:  ['coffee', 'espresso', 'matcha', 'acai', 'healthy'],
  clean:   ['vegetarian', 'vegan', 'healthy', 'salad', 'bowl'],
  spicy:   ['spicy', 'tantanmen'],
  treat:   ['boba tea', 'dessert', 'chocolate', 'sweet', 'waffle'],
  light:   ['poke', 'bowl', 'fruity', 'sparkling', 'green tea'],
};

const STACK_DEPTH  = 3;
const SWIPE_THRESH = 110;
const SCALE_STEPS  = [1, 0.95, 0.90];
const TY_STEPS     = [0, 18, 36];
const STACK_STEPS  = SCALE_STEPS; // alias used in applyStackTransform

/* ─── Supabase Like Counter ─────────────────────────────── */
const SB_URL = 'https://twdrocixrvplgrdwncdu.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3ZHJvY2l4cnZwbGdyZHduY2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTAzNjYsImV4cCI6MjA5NTI4NjM2Nn0.9xlrD-0m_Iqi3pRs5xlM1kim75tqconC-aSvhrV2Oj8';
const SB_HDR = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

function getLikedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('gn_likes') || '[]')); }
  catch { return new Set(); }
}
function saveLikedSet(s) { localStorage.setItem('gn_likes', JSON.stringify([...s])); }

async function fetchLikeCount(itemId) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/likes?item_id=eq.${encodeURIComponent(itemId)}&select=count`, { headers: SB_HDR });
    const d = await r.json();
    return parseInt(d[0]?.count) || 0;
  } catch { return 0; }
}

function burstHearts(btn) {
  const rect   = btn.getBoundingClientRect();
  const emojis = ['❤️', '🩷', '💕', '💗', '💖', '💝', '💓', '💞'];
  const count  = 22 + Math.floor(Math.random() * 8); // 22–30 hearts
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className   = 'heart-burst';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const startX = rect.left + rect.width / 2 + (Math.random() - 0.5) * 80;
    const startY = rect.top  + rect.height / 2 + (Math.random() - 0.5) * 20;
    el.style.cssText = [
      `left:${startX}px`,
      `top:${startY}px`,
      `font-size:${12 + Math.random() * 22}px`,
      `animation-duration:${1.0 + Math.random() * 1.0}s`,
      `animation-delay:${Math.random() * 0.45}s`,
      `--drift:${(Math.random() - 0.5) * 160}px`,
      `--spin:${(Math.random() - 0.5) * 60}deg`,
    ].join(';');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

/* ─── Instagram Story Share ──────────────────────────────── */
async function shareItemAsStory(item) {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1 — background colour
  ctx.fillStyle = item.colorCode || '#111111';
  ctx.fillRect(0, 0, W, H);

  // 2 — food photo (cover-fill, centred)
  if (item.imageUrl) {
    try {
      const img = await loadImage(item.imageUrl);
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } catch { /* no image — solid colour bg is fine */ }
  }

  // 3 — dark gradient overlay (bottom 65%)
  const grad = ctx.createLinearGradient(0, H * 0.25, 0, H);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1,   'rgba(0,0,0,0.93)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 4 — top branding pill
  const brandX = W / 2, brandY = 130;
  ctx.save();
  roundRect(ctx, brandX - 160, brandY - 44, 320, 68, 50);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐱 Green Neko', brandX, brandY + 6);

  // 5 — bottom text block
  const bX = 80, bY = H - 320;

  // category chip
  ctx.save();
  const catW = ctx.measureText(item.category?.toUpperCase() || '').width + 60;
  roundRect(ctx, bX, bY, catW, 52, 30);
  ctx.fillStyle = 'rgba(74,222,128,0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(74,222,128,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText((item.category || '').toUpperCase(), bX + 30, bY + 34);

  // item name (wrap at 2 lines)
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 86px -apple-system, BlinkMacSystemFont, sans-serif';
  const nameLines = wrapText(ctx, item.name, W - bX - 80, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, bX, bY + 110 + i * 96));

  // price
  ctx.fillStyle = '#4ade80';
  ctx.font      = 'bold 72px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`₹${item.price}`, bX, bY + 110 + nameLines.length * 96 + 20);

  // 6 — website watermark
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font      = '30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('greenneko.com', W / 2, H - 80);

  // 7 — share or download
  canvas.toBlob(async blob => {
    const file = new File([blob], `greenneko-${item.id}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: item.name, text: `${item.name} at Green Neko` });
        return;
      } catch { /* user cancelled or unsupported — fall through to download */ }
    }
    // Desktop fallback: trigger download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `greenneko-${item.name.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) { lines[maxLines - 1] += '…'; return lines; }
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function toggleLike(itemId) {
  const btn      = document.getElementById('bottom-like-btn');
  const liked    = getLikedSet();
  const wasLiked = liked.has(itemId);
  if (btn) btn.disabled = true;
  try {
    const getR = await fetch(
      `${SB_URL}/rest/v1/likes?item_id=eq.${encodeURIComponent(itemId)}&select=count`,
      { headers: SB_HDR }
    );
    const rows = await getR.json();
    const cur  = parseInt(rows[0]?.count) || 0;
    const next = wasLiked ? Math.max(0, cur - 1) : cur + 1;

    await fetch(`${SB_URL}/rest/v1/likes`, {
      method:  'POST',
      headers: { ...SB_HDR, 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({ item_id: itemId, count: next })
    });

    wasLiked ? liked.delete(itemId) : liked.add(itemId);
    saveLikedSet(liked);
    document.getElementById('bottom-like-heart').textContent = liked.has(itemId) ? '❤️' : '🤍';
    document.getElementById('bottom-like-count').textContent = next;
    if (!wasLiked) burstHearts(btn);
  } catch { /* fail silently */ }
  finally { if (btn) btn.disabled = false; }
}

function syncBottomLikeBtn() {
  const item = state.filtered[state.currentIndex];
  if (!item) return;
  const liked = getLikedSet();
  document.getElementById('bottom-like-heart').textContent = liked.has(item.id) ? '❤️' : '🤍';
  document.getElementById('bottom-like-count').textContent = '–';
  fetchLikeCount(item.id).then(n => {
    if (state.filtered[state.currentIndex]?.id !== item.id) return;
    document.getElementById('bottom-like-count').textContent = n;
    // Update on-card love badge if feature is enabled
    if (state.showLoveCount) {
      const badge = getTopCard()?.querySelector('.card-love-badge');
      if (badge && n > 0) {
        badge.textContent = `❤️ ${n} ${n === 1 ? 'love' : 'loves'}`;
        badge.classList.remove('hidden');
      }
    }
  });
}

/* ─── Boot ───────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  let data;
  try {
    const res = await fetch('menu.json');
    data = await res.json();
  } catch(e) {
    data = window.MENU_DATA; // fallback to data.js when served as file://
  }
  if (!data) {
    document.body.innerHTML = '<p style="color:#fff;padding:32px;font-family:sans-serif">Error: could not load menu.json.</p>';
    return;
  }

  // Support new schema (data.menu + data["café"]) and legacy (data.items + data.cafe)
  let allItems;
  if (data.menu) {
    allItems = Object.values(data.menu).flat();
    state.config = data['café'] || data.cafe || {};
  } else {
    allItems = data.items || [];
    state.config = data.cafe || {};
  }
  state.allItems     = allItems;
  state.addOns       = data.addOns || [];
  state.showLoveCount   = !!(data.settings?.showLoveCount);
  state.showMoodDeck    = !!(data.settings?.showMoodDeck);
  state.showPersonality = !!(data.settings?.showPersonality);
  loadFilterPrefs();
  applyFilters();

  registerSW();
  initInstallBanner();
  initMuteToggle();
  bindModal();
});

/* ─── PWA: Service Worker ────────────────────────────────── */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  // Remember if a SW was already controlling this page before registration.
  // If not, this is a first install — don't show the update banner.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('./sw.js').then(reg => {
    // Poll for updates every time the user focuses the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  }).catch(() => {});

  // Option C — when a new SW takes control (skipWaiting already fired),
  // show the soft update banner so the user can reload at their convenience
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showUpdateBanner();
  });
}

function showUpdateBanner() {
  const banner  = document.getElementById('update-banner');
  const reload  = document.getElementById('update-reload-btn');
  const dismiss = document.getElementById('update-dismiss-btn');
  if (!banner) return;
  banner.classList.remove('hidden');
  reload.addEventListener('click',  () => location.reload());
  dismiss.addEventListener('click', () => banner.classList.add('hidden'));
}

/* ─── PWA: Install Banner ────────────────────────────────── */
function initInstallBanner() {
  const banner  = document.getElementById('install-banner');
  const hint    = document.getElementById('install-hint');
  const action  = document.getElementById('install-action');
  const dismiss = document.getElementById('install-dismiss');

  // Already installed as PWA — don't show banner
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  if (isStandalone) return;

  // Already dismissed this session
  if (sessionStorage.getItem('installDismissed')) return;

  const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  let deferredPrompt = null;

  // Android / Chrome: capture the native install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });

  function showBanner() {
    if (isIOS) {
      hint.textContent = 'Tap  Share → Add to Home Screen';
      action.textContent = 'Got it';
      action.addEventListener('click', hideBanner);
    } else if (deferredPrompt) {
      hint.textContent = 'Open full screen like a native app';
      action.textContent = 'Install';
      action.addEventListener('click', async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') hideBanner();
        deferredPrompt = null;
      });
    }
    banner.classList.remove('hidden');
    setTimeout(hideBanner, 5000);
  }

  dismiss.addEventListener('click', hideBanner);

  function hideBanner() {
    banner.classList.add('hidden');
    sessionStorage.setItem('installDismissed', '1');
  }

  // Show iOS banner automatically after 4 seconds
  if (isIOS) setTimeout(showBanner, 4000);
  // Android banner shows when beforeinstallprompt fires (handled above)
}

/* ─── Modal ─────────────────────────────────────────────── */
function enterApp() {
  document.getElementById('main').classList.remove('hidden');
  const el  = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
  initApp();
}

function applyMoodSort(mood) {
  const boostTags = MOOD_TAGS[mood] || [];
  if (!boostTags.length) return;
  state.filtered.sort((a, b) => {
    const scoreA = (a.tags || []).filter(t => boostTags.includes(t.toLowerCase())).length;
    const scoreB = (b.tags || []).filter(t => boostTags.includes(t.toLowerCase())).length;
    return scoreB - scoreA;
  });
}

function showMoodPicker() {
  const overlay = document.getElementById('mood-overlay');
  overlay.classList.remove('hidden');

  function dismiss() { overlay.classList.add('hidden'); enterApp(); }

  overlay.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      track('mood_selected', { mood: btn.dataset.mood });
      applyMoodSort(btn.dataset.mood);
      dismiss();
    }, { once: true });
  });

  document.getElementById('mood-skip-btn').addEventListener('click', dismiss, { once: true });
}

function bindModal() {
  const isReturning = localStorage.getItem('gn_guided') === '1';

  if (isReturning) {
    document.getElementById('table-modal').classList.add('hidden');
    if (state.showMoodDeck) {
      showMoodPicker();
    } else {
      enterApp();
    }
    return;
  }

  // First visit — show the how-to-use guide
  document.getElementById('start-btn').addEventListener('click', () => {
    localStorage.setItem('gn_guided', '1');
    document.getElementById('table-modal').classList.add('hidden');
    enterApp();
  });
}

/* ─── Your Usual ─────────────────────────────────────────── */
function showUsualSheet() {
  let lastOrder;
  try { lastOrder = JSON.parse(localStorage.getItem('gn_last_order') || 'null'); } catch { return; }
  if (!lastOrder || lastOrder.length === 0) return;

  const overlay = document.getElementById('usual-overlay');
  if (!overlay) return;

  const total = lastOrder.reduce((s, c) => s + (c.price != null ? c.price * c.quantity : 0), 0);
  const summary = lastOrder.map(c => `${c.quantity > 1 ? c.quantity + '× ' : ''}${c.name}`).join(' · ');

  document.getElementById('usual-summary').textContent = summary;
  document.getElementById('usual-total').textContent   = `₹${total.toFixed(2)}`;

  overlay.classList.remove('hidden');

  document.getElementById('usual-order-btn').onclick = () => {
    lastOrder.forEach(c => {
      state.cart.push({ id: c.id, name: c.name, price: c.price, image: c.image || '', quantity: c.quantity });
    });
    updateCartBadge();
    playSound('add');
    showToast(`💚 Last order added to cart`);
    overlay.classList.add('hidden');
  };

  document.getElementById('usual-skip-btn').onclick = () => overlay.classList.add('hidden');
}

/* ─── Init App ───────────────────────────────────────────── */
function initApp() {
  renderCategories();
  renderStack();
  bindSwipeButtons();
  bindCartUI();
  initCategoryDrag();
  initFilters();
  showUsualSheet();
}

/* ─── Filters (Veg + Allergens) ──────────────────────────── */
function syncFilterUI() {
  // Veg toggle
  const vegBtn = document.getElementById('veg-toggle');
  vegBtn.classList.toggle('active', state.vegOnly);

  // Allergen badge
  const badge = document.getElementById('allergen-badge');
  const count = state.activeAllergens.size;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);

  // Allergen chips in sheet
  document.querySelectorAll('.allergen-chip').forEach(chip => {
    chip.classList.toggle('active', state.activeAllergens.has(chip.dataset.allergen));
  });
}

function initFilters() {
  syncFilterUI();

  // Veg toggle
  document.getElementById('veg-toggle').addEventListener('click', () => {
    state.vegOnly = !state.vegOnly;
    saveFilterPrefs();
    applyFilters();
    syncFilterUI();
    document.getElementById('card-stack').innerHTML = '';
    renderStack();
  });

  // Open allergen sheet
  const overlay = document.getElementById('allergen-overlay');
  document.getElementById('allergen-btn').addEventListener('click', () => {
    overlay.classList.remove('hidden');
  });

  // Chip toggles
  document.querySelectorAll('.allergen-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const a = chip.dataset.allergen;
      state.activeAllergens.has(a) ? state.activeAllergens.delete(a) : state.activeAllergens.add(a);
      chip.classList.toggle('active', state.activeAllergens.has(a));
      const badge = document.getElementById('allergen-badge');
      badge.textContent = state.activeAllergens.size;
      badge.classList.toggle('hidden', state.activeAllergens.size === 0);
    });
  });

  // Clear all
  document.getElementById('allergen-clear').addEventListener('click', () => {
    state.activeAllergens.clear();
    document.querySelectorAll('.allergen-chip').forEach(c => c.classList.remove('active'));
    document.getElementById('allergen-badge').classList.add('hidden');
  });

  // Done — apply and close
  document.getElementById('allergen-done').addEventListener('click', () => {
    saveFilterPrefs();
    applyFilters();
    syncFilterUI();
    overlay.classList.add('hidden');
    document.getElementById('card-stack').innerHTML = '';
    renderStack();
  });

  // Tap backdrop to dismiss without applying
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
}

/* ─── Categories ─────────────────────────────────────────── */
function renderCategories() {
  const el   = document.getElementById('categories');
  const cats = ['All', ...new Set(state.allItems.map(i => i.category)), 'Extras'];

  el.innerHTML = cats.map(cat => `
    <button class="cat-tab${cat === state.category ? ' active' : ''}"
            data-cat="${escHtml(cat)}">${escHtml(cat)}</button>
  `).join('');
  // Selection is handled in pointerup inside initCategoryDrag — no click listeners needed

  scrollActiveTabIntoView(false);
}

/* Custom pointer drag — drag to scroll, tap to select */
function initCategoryDrag() {
  const el = document.getElementById('categories');
  let startX = 0, startScroll = 0, dragging = false;

  el.addEventListener('pointerdown', e => {
    dragging    = true;
    startX      = e.clientX;
    startScroll = el.scrollLeft;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    el.scrollLeft = startScroll + (startX - e.clientX);
  });

  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');

    // If finger barely moved it's a tap — find which tab is under the finger
    if (Math.abs(e.clientX - startX) < 8) {
      const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cat-tab');
      if (tab) setCategory(tab.dataset.cat);
    }
  });

  el.addEventListener('pointercancel', () => {
    dragging = false;
    el.classList.remove('dragging');
  });
}

function scrollActiveTabIntoView(smooth = true) {
  const active = document.querySelector('.cat-tab.active');
  if (!active) return;
  const el = document.getElementById('categories');
  const tabLeft   = active.offsetLeft;
  const tabWidth  = active.offsetWidth;
  const elWidth   = el.offsetWidth;
  const target    = tabLeft - (elWidth / 2) + (tabWidth / 2);
  if (smooth) {
    el.scrollTo({ left: target, behavior: 'smooth' });
  } else {
    el.scrollLeft = target;
  }
}

function setCategory(cat) {
  if (cat === state.category) return;
  state.category = cat;

  document.querySelectorAll('.cat-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === cat)
  );
  scrollActiveTabIntoView(true);

  const extrasOverlay = document.getElementById('extras-overlay');

  if (cat === 'Extras') {
    extrasOverlay.classList.remove('hidden');
    document.getElementById('card-stack').innerHTML = '';
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('swipe-buttons').classList.add('hidden');
    renderExtrasGrid();
    return;
  }

  extrasOverlay.classList.add('hidden');
  applyFilters();
  document.getElementById('card-stack').innerHTML = '';
  renderStack();
}

/* ─── Extras Grid ────────────────────────────────────────── */
function renderExtrasGrid() {
  const grid = document.getElementById('extras-grid');
  if (!grid) return;

  grid.innerHTML = state.addOns.map(addon => {
    const cartEntry = state.cart.find(c => c.id === addon.id);
    const qty = cartEntry ? cartEntry.quantity : 0;
    return `
      <div class="addon-card${qty > 0 ? ' addon-card--active' : ''}">
        <div class="addon-top">
          <div class="addon-name">${escHtml(addon.name)}</div>
          ${addon.quantity ? `<div class="addon-weight">${escHtml(addon.quantity)}</div>` : ''}
        </div>
        <div class="addon-bottom">
          <span class="addon-price">+₹${addon.price}</span>
          <div class="addon-counter">
            ${qty > 0 ? `<button class="addon-dec" data-id="${escAttr(addon.id)}">−</button>
            <span class="addon-count">${qty}</span>` : ''}
            <button class="addon-inc" data-id="${escAttr(addon.id)}">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.addon-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      const addon = state.addOns.find(a => a.id === btn.dataset.id);
      if (!addon) return;
      playSound('add');
      addToCart(addon, 1);
      renderExtrasGrid();
    });
  });

  grid.querySelectorAll('.addon-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.id, 1);
      renderExtrasGrid();
    });
  });
}

/* ─── Card Stack ─────────────────────────────────────────── */
function renderStack() {
  const stack      = document.getElementById('card-stack');
  const emptyState = document.getElementById('empty-state');
  const swipeBtns  = document.getElementById('swipe-buttons');
  const remaining  = state.filtered.length - state.currentIndex;

  if (remaining <= 0) {
    // Clean up any previous personality card
    emptyState.classList.remove('has-personality');
    document.getElementById('personality-card')?.remove();

    const p = state.showPersonality ? computePersonality() : null;
    if (p) {
      renderPersonalityCard(p);
      emptyState.classList.add('has-personality');
    } else {
      const isAll = state.category === 'All';
      document.getElementById('empty-cat-label').textContent = isAll ? '' : `in ${state.category}`;
    }

    emptyState.classList.remove('hidden');
    swipeBtns.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  swipeBtns.classList.remove('hidden');

  // Render cards back-to-front so last in DOM = visually on top
  const count = Math.min(STACK_DEPTH, remaining);
  for (let i = count - 1; i >= 0; i--) {
    const item = state.filtered[state.currentIndex + i];
    const card = buildCard(item, i);
    stack.appendChild(card);
  }

  attachDrag(getTopCard());
  syncBottomLikeBtn();
}

/* ─── Build Card DOM ─────────────────────────────────────── */
function buildCard(item, pos) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.itemId = item.id;
  applyStackTransform(card, pos, false);

  // Normalize fields — support new schema (imageUrl, colorCode, boolean spicy) and legacy
  const image      = item.imageUrl || item.image || '';
  const color      = item.colorCode || item.color || '#1a1a1a';
  const spicyLevel = typeof item.spicy === 'boolean' ? (item.spicy ? 1 : 0) : (item.spicy || 0);
  const hasCalories   = item.calories != null;
  const n             = item.nutrition || {};
  const hasNutrition  = hasCalories || Object.values(n).some(v => v != null);
  const priceStr = (() => {
    if (item.price == null) return 'See menu';
    const reg = `₹${item.price}`;
    if (item.priceLarge != null) return `${reg} <span class="price-large">· L ₹${item.priceLarge}</span>`;
    return reg;
  })();

  const spicyHtml = spicyLevel > 0 ? `<span class="badge badge-spicy">${'🌶'.repeat(spicyLevel)}</span>` : '';
  const vegHtml   = item.vegetarian ? `<span class="badge badge-veg">🌿</span>` : '';
  const newHtml   = item.tags?.includes('new')            ? `<span class="badge badge-new">✦ NEW</span>` : '';
  const popHtml   = item.tags?.includes('popular')        ? `<span class="badge badge-popular">⭐ Popular</span>` : '';
  const chefHtml  = item.tags?.includes("chef's special") ? `<span class="badge badge-popular">👨‍🍳 Chef's Pick</span>` : '';
  const sigHtml   = item.signature                        ? `<span class="badge badge-signature">✦ Signature</span>` : '';
  const stampHtml = item.placeholderImage ? `
    <div class="image-stamp">
      <span class="image-stamp-icon">📷</span>
      <span class="image-stamp-title">Placeholder Image</span>
      <span class="image-stamp-sub">Actual photo coming soon</span>
    </div>` : '';
  const calBtnHtml = hasNutrition
    ? `<button class="cal-toggle">🔥 <span class="cal-text">Calories</span></button>`
    : '';
  const likedSet  = getLikedSet();

  card.innerHTML = `
    <div class="card-bg" style="background-color:${escAttr(color)}"></div>
    <div class="card-gradient"></div>
    ${stampHtml}

    <div class="card-side-badges">${sigHtml}${popHtml}${newHtml}${chefHtml}</div>

    <div class="nutrition-panel hidden"></div>

    <div class="desc-panel hidden">
      <div class="desc-panel-name">${escHtml(item.name)}</div>
      <div class="desc-panel-text">${escHtml(item.description)}</div>
      <p class="desc-panel-hint">Tap to close</p>
    </div>

    <div class="like-indicator">DEVOUR<br>💚</div>
    <div class="nope-indicator">NOPE<br>✕</div>

    <div class="card-info">
      <div class="card-category">${escHtml(item.category)}</div>
      <div class="card-name">${escHtml(item.name)}</div>
      <div class="card-description">${escHtml(item.description)}</div>
      <div class="card-love-badge hidden"></div>
      <div class="card-meta">
        <span class="card-price">${priceStr}</span>
        <div class="card-meta-right">
          ${calBtnHtml}
          ${vegHtml}
          ${spicyHtml}
        </div>
      </div>
    </div>
  `;

  // Full description panel — open on name/description tap, close on panel tap
  const descPanel = card.querySelector('.desc-panel');
  const openDesc  = e => { e.stopPropagation(); descPanel.classList.remove('hidden'); };
  card.querySelector('.card-name').addEventListener('click', openDesc);
  card.querySelector('.card-description').addEventListener('click', openDesc);
  // Prevent the drag handler from firing when tapping name/description
  card.querySelector('.card-name').addEventListener('pointerdown', e => e.stopPropagation());
  card.querySelector('.card-description').addEventListener('pointerdown', e => e.stopPropagation());
  descPanel.addEventListener('click', () => descPanel.classList.add('hidden'));


  // Load image via probe: shimmer runs until load, stops on success, no-image class on failure/absent
  const bg = card.querySelector('.card-bg');
  if (image) {
    const probe = new Image();
    probe.onload  = () => { bg.style.backgroundImage = `url('${image}')`; };
    probe.onerror = () => { bg.classList.add('no-image'); };
    probe.src = image;
  } else {
    bg.classList.add('no-image');
  }

  // Nutrition panel — only wired up when there's data
  if (hasNutrition) {
    const panel = card.querySelector('.nutrition-panel');
    const fmtVal = (val, key) => {
      if (val == null) return null;
      if (typeof val === 'string') return val;
      const units = { protein: 'g', carbs: 'g', fat: 'g', fiber: 'g', sodium: 'mg', cholesterol: 'mg' };
      return `${val}${units[key] || ''}`;
    };
    const rows = [
      ['🔥', 'Calories',      hasCalories ? `${item.calories} kcal` : null],
      ['💪', 'Protein',       fmtVal(n.protein, 'protein')],
      ['🍰', 'Carbohydrates', fmtVal(n.carbs, 'carbs')],
      ['🧈', 'Fat',           fmtVal(n.fat, 'fat')],
      ['🌿', 'Fiber',         fmtVal(n.fiber, 'fiber')],
      ['🧂', 'Sodium',        fmtVal(n.sodium, 'sodium')],
      ['❤️', 'Cholesterol',  fmtVal(n.cholesterol, 'cholesterol')],
    ].filter(r => r[2]);
    panel.innerHTML = `
      <div class="nutrition-title">Nutrition Facts</div>
      ${rows.map(([icon, label, val]) =>
        `<div class="nutrition-row"><span>${icon} ${label}</span><span>${val}</span></div>`
      ).join('')}
      <p class="nutrition-hint">Tap anywhere to close</p>
    `;
    const calToggle = card.querySelector('.cal-toggle');
    if (calToggle) {
      calToggle.addEventListener('pointerdown', e => e.stopPropagation());
      calToggle.addEventListener('click', () => panel.classList.toggle('hidden'));
    }
    panel.addEventListener('click', () => panel.classList.add('hidden'));
  }

  return card;
}

function applyStackTransform(card, pos, animate = true) {
  const p = Math.min(pos, STACK_STEPS.length - 1);
  if (animate) card.style.transition = 'transform .35s cubic-bezier(0.25,0.46,0.45,0.94)';
  else         card.style.transition = 'none';
  card.style.transform = `scale(${SCALE_STEPS[p]}) translateY(${TY_STEPS[p]}px)`;
}

/* ─── Helpers ────────────────────────────────────────────── */
function getTopCard() {
  const cards = stackCards();
  return cards.length ? cards[cards.length - 1] : null;
}

function stackCards() {
  return Array.from(document.querySelectorAll('#card-stack .card'));
}

/* ─── Drag / Swipe ───────────────────────────────────────── */
function attachDrag(card) {
  if (!card || card._dragAttached) return;
  card._dragAttached = true;

  let startX = 0, startY = 0, dragging = false;

  function onStart(e) {
    if (e.target.closest('.cal-toggle')) return;
    startX   = e.clientX;
    startY   = e.clientY;
    dragging = true;
    card.style.transition = 'none';
    if (e.pointerId !== undefined) card.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();

    const dx  = e.clientX - startX;
    const dy  = (e.clientY - startY) * 0.25;
    const rot = clamp(dx * 0.055, -25, 25);

    card.style.transform = `translateX(${dx}px) translateY(${dy}px) rotate(${rot}deg) scale(1)`;

    // Swipe indicators
    const progress = Math.min(Math.abs(dx) / SWIPE_THRESH, 1);
    card.querySelector('.like-indicator').style.opacity = dx > 20 ? progress : 0;
    card.querySelector('.nope-indicator').style.opacity = dx < -20 ? progress : 0;

    // Animate behind cards
    const behind = stackCards().slice(0, -1);
    behind.forEach((c, idx) => {
      const pos     = behind.length - 1 - idx + 1;
      const nextPos = pos - 1;
      const scale   = lerp(SCALE_STEPS[pos] ?? 0.88, SCALE_STEPS[nextPos] ?? SCALE_STEPS[0], progress);
      const ty      = lerp(TY_STEPS[pos]   ?? 54,   TY_STEPS[nextPos]   ?? TY_STEPS[0],    progress);
      c.style.transition = 'none';
      c.style.transform  = `scale(${scale}) translateY(${ty}px)`;
    });
  }

  function onEnd(e) {
    if (!dragging) return;
    dragging = false;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    card.querySelector('.like-indicator').style.opacity = 0;
    card.querySelector('.nope-indicator').style.opacity = 0;

    if (Math.abs(dx) >= SWIPE_THRESH) {
      executeSwipe(card, dx > 0 ? 'right' : 'left');
    } else {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) peekCard(card);
      springBack(card);
    }
  }

  card.addEventListener('pointerdown', onStart);
  card.addEventListener('pointermove', onMove, { passive: false });
  card.addEventListener('pointerup',   onEnd);
  card.addEventListener('pointercancel', () => { dragging = false; springBack(card); });
}

function peekCard(card) {
  const panel = card.querySelector('.nutrition-panel');
  if (panel && !panel.classList.contains('hidden')) return;
  card.classList.add('card--peek');
  clearTimeout(card._peekTimer);
  card._peekTimer = setTimeout(() => card.classList.remove('card--peek'), 1000);
}

function springBack(card) {
  card.style.transition = 'transform .45s cubic-bezier(0.175,0.885,0.32,1.275)';
  card.style.transform  = 'translateX(0) translateY(0) rotate(0deg) scale(1)';

  const behind = stackCards().slice(0, -1);
  behind.forEach((c, idx) => {
    const pos = behind.length - 1 - idx + 1;
    applyStackTransform(c, pos, true);
  });
}

/* ─── Size Picker Sheet ──────────────────────────────────── */
function showSizeSheet(item) {
  const sheet = document.getElementById('size-sheet');
  const overlay = document.getElementById('size-overlay');

  document.getElementById('size-item-name').textContent = item.name;
  document.getElementById('size-reg-price').textContent  = `₹${item.price}`;
  document.getElementById('size-large-price').textContent = `₹${item.priceLarge}`;

  let dismissTimer;

  function pick(size) {
    clearTimeout(dismissTimer);
    overlay.classList.add('hidden');
    playSound('add');
    if (size === 'regular') {
      addToCart(item, 1);
    } else {
      addToCart({ ...item, id: item.id + '_L', name: item.name + ' (Large)', price: item.priceLarge }, 1);
    }
  }

  document.getElementById('size-btn-reg').onclick   = () => pick('regular');
  document.getElementById('size-btn-large').onclick = () => pick('large');
  document.getElementById('size-close-btn').onclick = () => {
    clearTimeout(dismissTimer);
    overlay.classList.add('hidden');
    addToCart(item, 1); // default to regular on dismiss
  };

  overlay.classList.remove('hidden');
  dismissTimer = setTimeout(() => { overlay.classList.add('hidden'); addToCart(item, 1); }, 8000);
}

/* ─── Execute Swipe ──────────────────────────────────────── */
function executeSwipe(cardEl, direction) {
  const itemId = cardEl.dataset.itemId;
  const item   = state.filtered.find(i => String(i.id) === itemId);
  if (!item) return;

  state.history.push({ item, direction, qty: 1 });
  if (state.history.length > 15) state.history.shift();
  state.sessionSeen++;
  if (direction === 'right') state.sessionYes++;

  if (direction === 'right') {
    playSound('right');
    if (item.priceLarge != null) {
      showSizeSheet(item);
    } else {
      addToCart(item, 1);
    }
  } else {
    playSound('left');
  }

  // Fly off screen
  const vw     = window.innerWidth;
  const flyX   = direction === 'right' ? vw * 1.5 : -vw * 1.5;
  const flyRot = direction === 'right' ? 40 : -40;

  cardEl.style.transition = 'transform .42s cubic-bezier(0.4,0,1,1), opacity .42s ease';
  cardEl.style.transform  = `translateX(${flyX}px) rotate(${flyRot}deg) scale(0.9)`;
  cardEl.style.opacity    = '0';
  cardEl.style.pointerEvents = 'none';

  state.currentIndex++;

  // Attach drag to the next card immediately — don't wait for fly + promote timeouts
  const cards = stackCards();
  const nextTop = cards[cards.length - 2];
  if (nextTop) attachDrag(nextTop);

  setTimeout(() => {
    cardEl.remove();
    promoteStack();
  }, 430);
}

/* ─── Promote Stack After Swipe ─────────────────────────── */
function promoteStack() {
  const remaining  = state.filtered.length - state.currentIndex;
  const cards      = stackCards();

  if (remaining <= 0 && cards.length === 0) {
    renderStack(); // Will show empty state
    return;
  }

  // Animate remaining cards into new positions
  cards.forEach((c, idx) => {
    const newPos = cards.length - 1 - idx;
    applyStackTransform(c, newPos, true);
  });

  // Add the next card at back of stack if available
  const nextIdx = state.currentIndex + cards.length;
  if (state.filtered[nextIdx]) {
    const newCard = buildCard(state.filtered[nextIdx], cards.length);
    newCard.style.opacity    = '0';
    newCard.style.transition = 'none';
    document.getElementById('card-stack').insertBefore(newCard, document.getElementById('card-stack').firstChild);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newCard.style.transition = 'opacity .3s ease';
        newCard.style.opacity    = '1';
      });
    });
  }

  // Re-attach drag to the new top card after animations
  setTimeout(() => {
    const top = getTopCard();
    if (top) attachDrag(top);
    if (remaining <= 0) renderStack(); // Triggers empty state
    else syncBottomLikeBtn();
  }, 370);
}

/* ─── Programmatic Swipe (buttons) ───────────────────────── */
function triggerSwipe(direction) {
  const card = getTopCard();
  if (!card) return;

  // Quick visual flash of the indicator
  const indEl = card.querySelector(direction === 'right' ? '.like-indicator' : '.nope-indicator');
  indEl.style.opacity = '1';
  setTimeout(() => { indEl.style.opacity = '0'; }, 200);

  setTimeout(() => executeSwipe(card, direction), 120);
}

/* ─── Undo ───────────────────────────────────────────────── */
function undoLast() {
  const last = state.history.pop();
  if (!last) { showToast('Nothing to undo'); return; }
  playSound('undo');

  if (last.direction === 'right') {
    removeFromCart(last.item.id, last.qty);
  }

  state.currentIndex--;
  // Remove the current top card (we're going back)
  const stack  = document.getElementById('card-stack');
  const topOld = getTopCard();

  // Demote existing cards
  const cards = stackCards();
  cards.forEach((c, idx) => {
    const newPos = cards.length - idx; // shift everyone back
    applyStackTransform(c, newPos, true);
  });

  // Insert restored card as new top
  const restoredCard = buildCard(last.item, 0);
  restoredCard.style.opacity    = '0';
  restoredCard.style.transform  = `translateX(${last.direction === 'right' ? 300 : -300}px) rotate(${last.direction === 'right' ? 20 : -20}deg) scale(1)`;
  restoredCard.style.transition = 'none';
  stack.appendChild(restoredCard);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    restoredCard.style.transition = 'opacity .35s ease, transform .45s cubic-bezier(0.25,0.46,0.45,0.94)';
    restoredCard.style.opacity    = '1';
    restoredCard.style.transform  = 'translateX(0) translateY(0) rotate(0deg) scale(1)';
  }));

  // Remove excess back card
  if (cards.length >= STACK_DEPTH) {
    setTimeout(() => { if (stack.firstChild && stack.firstChild !== restoredCard) stack.firstChild.remove(); }, 400);
  }

  setTimeout(() => { attachDrag(restoredCard); syncBottomLikeBtn(); }, 460);
  showToast('↩ Brought back');

  document.getElementById('swipe-buttons').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

/* ─── Restart / Browse Again ─────────────────────────────── */
function restartDeck() {
  state.currentIndex = 0;
  state.history      = [];
  state.sessionSeen  = 0;
  state.sessionYes   = 0;
  document.getElementById('card-stack').innerHTML = '';
  renderStack();
}

/* ─── Personality Summary ────────────────────────────────── */
function computePersonality() {
  const yesItems = state.history.filter(h => h.direction === 'right').map(h => h.item);
  if (yesItems.length < 2) return null;

  const cats    = new Set(yesItems.map(i => i.category));
  const spicyCt = yesItems.filter(i => i.spicy).length;
  const drinkCt = yesItems.filter(i => ['Coffee', 'Boba Tea', 'Tea & Desserts'].includes(i.category)).length;
  const vegCt   = yesItems.filter(i => i.vegetarian).length;
  const yesRate = yesItems.length / Math.max(state.sessionSeen, 1);

  let emoji, title, sub;
  if (spicyCt >= 2) {
    emoji = '🔥'; title = 'The Spice Hunter';
    sub   = `Went spicy ${spicyCt} time${spicyCt > 1 ? 's' : ''}`;
  } else if (vegCt >= yesItems.length * 0.5) {
    emoji = '🌿'; title = 'The Green Soul';
    sub   = 'Mostly plant-based choices';
  } else if (drinkCt >= yesItems.length * 0.4) {
    emoji = '☕'; title = 'The Caffeine Devotee';
    sub   = 'You really love your drinks';
  } else if (cats.size >= 4) {
    emoji = '🌟'; title = 'The Adventurous Omnivore';
    sub   = `Picked across ${cats.size} categories`;
  } else if (yesRate < 0.25 && state.sessionSeen >= 6) {
    emoji = '👑'; title = 'The Selective Gourmet';
    sub   = 'You know exactly what you want';
  } else {
    emoji = '🌙'; title = 'The Comfort Seeker';
    sub   = 'Good food, every time';
  }

  return { emoji, title, sub, seen: state.sessionSeen, yesCount: state.sessionYes };
}

function renderPersonalityCard(p) {
  const card = document.createElement('div');
  card.id        = 'personality-card';
  card.className = 'personality-card';
  card.innerHTML = `
    <div class="p-emoji">${p.emoji}</div>
    <div class="p-type">You are</div>
    <div class="p-title">${p.title}</div>
    <div class="p-sub">${p.sub}</div>
    <div class="p-stats">
      <span class="p-stat"><span class="p-stat-val">${p.seen}</span> swiped</span>
      <span class="p-stat-sep">·</span>
      <span class="p-stat"><span class="p-stat-val">${p.yesCount}</span> added</span>
    </div>
    <button class="p-share-btn" id="p-share-btn">📸 Share my result</button>
  `;
  const actions = document.querySelector('.empty-actions');
  document.getElementById('empty-state').insertBefore(card, actions);
  document.getElementById('p-share-btn').addEventListener('click', () => sharePersonality(p), { once: true });
}

async function sharePersonality(p) {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1f12'); bg.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(W/2, H*0.45, 0, W/2, H*0.45, 600);
  glow.addColorStop(0, 'rgba(74,222,128,0.08)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // Branding
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐱 Green Neko', W/2, 148);

  ctx.strokeStyle = 'rgba(74,222,128,0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W/2 - 220, 178); ctx.lineTo(W/2 + 220, 178); ctx.stroke();

  // Big emoji
  ctx.font = '220px serif';
  ctx.fillText(p.emoji, W/2, H*0.44);

  // "You are" label
  ctx.font = '500 52px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('You are', W/2, H*0.44 + 90);

  // Title
  ctx.font = 'bold 100px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#ffffff';
  const titleLines = wrapText(ctx, p.title, W - 160, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, W/2, H*0.44 + 210 + i * 116));

  // Sub
  ctx.font = '52px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#4ade80';
  ctx.fillText(p.sub, W/2, H*0.44 + 210 + titleLines.length * 116 + 76);

  // Stats pill
  const statsY = H*0.44 + 210 + titleLines.length * 116 + 76 + 100;
  ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, sans-serif';
  const statsText = `${p.seen} swiped · ${p.yesCount} said yes`;
  const pillW = ctx.measureText(statsText).width + 90;
  ctx.save();
  roundRect(ctx, W/2 - pillW/2, statsY - 48, pillW, 78, 50);
  ctx.fillStyle = 'rgba(74,222,128,0.12)'; ctx.fill();
  ctx.strokeStyle = 'rgba(74,222,128,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(statsText, W/2, statsY + 14);

  // Watermark
  ctx.font = '36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('Try Green Neko', W/2, H - 90);

  canvas.toBlob(async blob => {
    const file = new File([blob], 'greenneko-personality.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: p.title, text: `I am ${p.title} at Green Neko!` });
        return;
      } catch { /* fall through to download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'greenneko-personality.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
}

/* ─── Cart ───────────────────────────────────────────────── */
function addToCart(item, qty) {
  const existing = state.cart.find(c => c.id === item.id);
  if (existing) {
    existing.quantity += qty;
  } else {
    state.cart.push({ id: item.id, name: item.name, price: item.price, image: item.imageUrl || item.image || '', quantity: qty });
  }
  updateCartBadge();
  showToast(`💚 ${qty > 1 ? qty + '× ' : ''}${item.name} added`);

  track('add_to_cart', {
    items: [{ item_id: item.id, item_name: item.name, price: item.price, quantity: qty }]
  });
}

function removeFromCart(itemId, qty) {
  const idx = state.cart.findIndex(c => c.id === itemId);
  if (idx === -1) return;
  state.cart[idx].quantity -= qty;
  if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
  updateCartBadge();
}

function addCurrentToCart() {
  const top = getTopCard();
  if (!top) return;
  triggerSwipe('right'); // executeSwipe handles addToCart + advance
}

function updateCartBadge() {
  const total = state.cart.reduce((s, c) => s + c.quantity, 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = total;
  badge.classList.toggle('hidden', total === 0);
}

/* ─── Cart UI ────────────────────────────────────────────── */
function openCart() {
  renderCartItems();
  document.getElementById('cart-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cart-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  const totalEl   = document.getElementById('cart-total');
  const tableEl   = document.getElementById('cart-table-label');

  tableEl.textContent = state.tableNumber ? `Table ${state.tableNumber}` : 'Walk-in';

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:rgba(255,255,255,0.4);font-size:14px;">
        <div style="font-size:40px;margin-bottom:12px;">🛒</div>
        Your cart is empty.<br>Swipe right on items you'd like!
      </div>`;
    totalEl.textContent = '₹0.00';
    return;
  }

  container.innerHTML = state.cart.map(c => `
    <div class="cart-item" data-id="${c.id}">
      ${c.image
        ? `<img class="cart-item-img" src="${escAttr(c.image)}" alt="" loading="lazy" />`
        : `<div class="cart-item-img cart-item-img--addon">+</div>`}
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(c.name)}</div>
        <div class="cart-item-price">${c.price != null ? `₹${(c.price * c.quantity).toFixed(2)}` : 'See menu'}</div>
      </div>
      <div class="cart-item-qty">
        <button class="cart-qty-btn" data-action="dec" data-id="${c.id}">−</button>
        <span class="cart-qty-num">${c.quantity}</span>
        <button class="cart-qty-btn" data-action="inc" data-id="${c.id}">+</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.cart-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = btn.dataset.id;
      const inc = btn.dataset.action === 'inc';
      const entry = state.cart.find(c => String(c.id) === id);
      if (!entry) return;
      if (inc) {
        entry.quantity++;
      } else {
        entry.quantity--;
        if (entry.quantity <= 0) state.cart.splice(state.cart.indexOf(entry), 1);
      }
      updateCartBadge();
      renderCartItems();
    });
  });

  const total = state.cart.reduce((s, c) => s + (c.price != null ? c.price * c.quantity : 0), 0);
  totalEl.textContent = `₹${total.toFixed(2)}`;

  // Upsell strip — only add-ons relevant to items currently in cart
  const relevantAddonIds = new Set(
    state.cart.flatMap(c => {
      const menuItem = state.allItems.find(i => String(i.id) === String(c.id));
      return menuItem?.addOnIds || [];
    })
  );
  const relevantAddons = state.addOns.filter(a => relevantAddonIds.has(a.id));

  if (relevantAddons.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'cart-upsell';
    strip.innerHTML = `
      <p class="cart-upsell-title">✦ Enhance your order</p>
      <div class="cart-upsell-chips">
        ${relevantAddons.map(addon => `
          <button class="upsell-chip" data-id="${escAttr(addon.id)}">
            <span class="upsell-chip-name">${escHtml(addon.name)}</span>
            <span class="upsell-chip-price">+₹${addon.price}</span>
          </button>
        `).join('')}
      </div>
    `;
    container.appendChild(strip);
    strip.querySelectorAll('.upsell-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const addon = state.addOns.find(a => a.id === chip.dataset.id);
        if (!addon) return;
        playSound('add');
        addToCart(addon, 1);
        renderCartItems();
      });
    });
  }
}

/* ─── Counter View ────────────────────────────────────────── */
function showCounterView() {
  if (state.cart.length === 0) { showToast('Your cart is empty!'); return; }

  const total = state.cart.reduce((s, c) => s + (c.price != null ? c.price * c.quantity : 0), 0);
  const table = state.tableNumber ? `Table ${state.tableNumber}` : 'Walk-in';

  track('show_to_counter', {
    value: total,
    currency: 'INR',
    items: state.cart.map(c => ({ item_id: c.id, item_name: c.name, quantity: c.quantity }))
  });

  document.getElementById('counter-table').textContent = table;
  document.getElementById('counter-total').textContent = `₹${total.toFixed(2)}`;
  document.getElementById('counter-items').innerHTML = state.cart.map(c => `
    <div class="counter-item">
      <span class="counter-item-qty">${c.quantity}×</span>
      <span class="counter-item-name">${escHtml(c.name)}</span>
      <span class="counter-item-price">${c.price != null ? `₹${(c.price * c.quantity).toFixed(2)}` : 'See menu'}</span>
    </div>
  `).join('');

  // Save this order as "your usual" for next visit
  try {
    localStorage.setItem('gn_last_order', JSON.stringify(
      state.cart.map(c => ({ id: c.id, name: c.name, price: c.price, image: c.image, quantity: c.quantity }))
    ));
  } catch { /* storage full — ignore */ }

  document.getElementById('counter-overlay').classList.remove('hidden');
  closeCart();
}

function hideCounterView() {
  document.getElementById('counter-overlay').classList.add('hidden');
}

/* ─── Quantity Controls ───────────────────────────────────── */

/* ─── Swipe Hint Buttons ─────────────────────────────────── */
function bindSwipeButtons() {
  document.getElementById('undo-btn').addEventListener('click', undoLast);

  document.getElementById('bottom-like-btn').addEventListener('click', () => {
    const item = state.filtered[state.currentIndex];
    if (item) toggleLike(item.id);
  });

  document.getElementById('share-btn').addEventListener('click', () => {
    const item = state.filtered[state.currentIndex];
    if (item) shareItemAsStory(item);
  });
}

/* ─── Cart UI Bindings ───────────────────────────────────── */
function bindCartUI() {
  document.getElementById('cart-btn').addEventListener('click', openCart);
  document.getElementById('close-cart-btn').addEventListener('click', closeCart);
  document.getElementById('counter-btn').addEventListener('click', showCounterView);
  document.getElementById('counter-close').addEventListener('click', hideCounterView);
  document.getElementById('view-cart-empty-btn').addEventListener('click', openCart);
  document.getElementById('restart-btn').addEventListener('click', restartDeck);

  // Close on backdrop click
  document.getElementById('cart-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCart();
  });
}

/* ─── Toast ──────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ─── Sound Design ───────────────────────────────────────── */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function isMuted() { return localStorage.getItem('gn_mute') === '1'; }

function playSound(type) {
  if (isMuted()) return;
  try {
    const ctx = getAudioCtx();
    if      (type === 'right') playSoundRight(ctx);
    else if (type === 'left')  playSoundLeft(ctx);
    else if (type === 'add')   playSoundAdd(ctx);
    else if (type === 'undo')  playSoundUndo(ctx);
  } catch(e) { /* silent fail — AudioContext blocked */ }
}

function playSoundRight(ctx) {
  // Ascending two-note chime: C6 → E6
  [1047, 1319].forEach((freq, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.11;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t); osc.stop(t + 0.45);
  });
}

function playSoundLeft(ctx) {
  // Downward sawtooth whoosh
  const osc = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  osc.connect(f); f.connect(g); g.connect(ctx.destination);
  osc.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.6;
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(550, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.start(t); osc.stop(t + 0.22);
}

function playSoundAdd(ctx) {
  // Short soft pop
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = 'sine';
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(540, t);
  osc.frequency.exponentialRampToValueAtTime(260, t + 0.07);
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.start(t); osc.stop(t + 0.07);
}

function playSoundUndo(ctx) {
  // Descending two-note: E6 → C6
  [1319, 1047].forEach((freq, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.09;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t); osc.stop(t + 0.3);
  });
}

function initMuteToggle() {
  const btn = document.getElementById('mute-btn');
  if (!btn) return;
  const update = () => btn.textContent = isMuted() ? '🔇' : '🔔';
  update();
  btn.addEventListener('click', () => {
    localStorage.setItem('gn_mute', isMuted() ? '0' : '1');
    update();
  });
}

/* ─── Utilities ──────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function escAttr(str) { return escHtml(str); }

'use strict';

/* ─── State ─────────────────────────────────────────────── */
const state = {
  allItems:      [],
  filtered:      [],
  currentIndex:  0,
  cart:          [],   // [{id, name, price, image, quantity}]
  category:      'All',
  tableNumber:   '',
  history:       [],   // [{item, direction}] for undo
  config:        {},
};

/* ─── Constants ─────────────────────────────────────────── */
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
    return d[0]?.count ?? 0;
  } catch { return 0; }
}

function burstHearts(btn) {
  const rect   = btn.getBoundingClientRect();
  const emojis = ['❤️', '🩷', '💕', '💗', '💖'];
  const count  = 7 + Math.floor(Math.random() * 4); // 7–10 hearts
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className   = 'heart-burst';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const startX = rect.left + rect.width / 2 + (Math.random() - 0.5) * 40;
    const startY = rect.top + rect.height / 2;
    el.style.cssText = [
      `left:${startX}px`,
      `top:${startY}px`,
      `font-size:${10 + Math.random() * 16}px`,
      `animation-duration:${0.9 + Math.random() * 0.8}s`,
      `animation-delay:${Math.random() * 0.3}s`,
      `--drift:${(Math.random() - 0.5) * 90}px`,
      `--spin:${(Math.random() - 0.5) * 40}deg`,
    ].join(';');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

async function toggleLike(itemId, btn) {
  const liked   = getLikedSet();
  const wasLiked = liked.has(itemId);
  btn.disabled  = true;
  try {
    const fn = wasLiked ? 'decrement_like' : 'increment_like';
    const r  = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: SB_HDR,
      body: JSON.stringify({ p_item_id: itemId })
    });
    const newCount = await r.json();
    wasLiked ? liked.delete(itemId) : liked.add(itemId);
    saveLikedSet(liked);
    btn.querySelector('.like-heart').textContent = liked.has(itemId) ? '❤️' : '🤍';
    btn.querySelector('.like-count').textContent = newCount;
    if (!wasLiked) burstHearts(btn);
  } catch { /* fail silently */ }
  finally { btn.disabled = false; }
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
  state.allItems = allItems;
  state.filtered = [...allItems];

  registerSW();
  initInstallBanner();
  bindModal();
});

/* ─── PWA: Service Worker ────────────────────────────────── */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
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
function bindModal() {
  const input     = document.getElementById('table-input');
  const startBtn  = document.getElementById('start-btn');
  const skipBtn   = document.getElementById('skip-table-btn');

  const launch = () => {
    state.tableNumber = input.value.trim() || '';
    document.getElementById('table-modal').classList.add('hidden');
    document.getElementById('main').classList.remove('hidden');
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) req.call(el).catch(() => {});
    initApp();
  };

  startBtn.addEventListener('click', launch);
  skipBtn.addEventListener('click', launch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') launch(); });
}

/* ─── Init App ───────────────────────────────────────────── */
function initApp() {
  renderCategories();
  renderStack();
  bindSwipeButtons();
  bindCartUI();
  initCategoryDrag();
}

/* ─── Categories ─────────────────────────────────────────── */
function renderCategories() {
  const el   = document.getElementById('categories');
  const cats = ['All', ...new Set(state.allItems.map(i => i.category))];

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
  state.category     = cat;
  state.currentIndex = 0;
  state.filtered = cat === 'All'
    ? [...state.allItems]
    : state.allItems.filter(i => i.category === cat);

  document.querySelectorAll('.cat-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === cat)
  );
  scrollActiveTabIntoView(true);

  document.getElementById('card-stack').innerHTML = '';
  renderStack();
}

/* ─── Card Stack ─────────────────────────────────────────── */
function renderStack() {
  const stack      = document.getElementById('card-stack');
  const emptyState = document.getElementById('empty-state');
  const swipeBtns  = document.getElementById('swipe-buttons');
  const remaining  = state.filtered.length - state.currentIndex;

  if (remaining <= 0) {
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
  const priceStr      = item.price != null ? `₹${item.price.toFixed(2)}` : 'See menu';

  const spicyHtml = spicyLevel > 0 ? `<span class="badge badge-spicy">${'🌶'.repeat(spicyLevel)}</span>` : '';
  const vegHtml   = item.vegetarian ? `<span class="badge badge-veg">🌿</span>` : '';
  const newHtml   = item.tags?.includes('new')            ? `<span class="badge badge-new">✦ NEW</span>` : '';
  const popHtml   = item.tags?.includes('popular')        ? `<span class="badge badge-popular">⭐ Popular</span>` : '';
  const chefHtml  = item.tags?.includes("chef's special") ? `<span class="badge badge-popular">👨‍🍳 Chef's Pick</span>` : '';
  const calBtnHtml = hasNutrition
    ? `<button class="cal-toggle">🔥 <span class="cal-text">Calories</span></button>`
    : '';
  const likedSet  = getLikedSet();
  const likeBtnHtml = `<button class="like-btn"><span class="like-heart">${likedSet.has(item.id) ? '❤️' : '🤍'}</span><span class="like-count">…</span></button>`;

  card.innerHTML = `
    <div class="card-bg" style="background-color:${escAttr(color)}"></div>
    <div class="card-gradient"></div>

    <div class="card-side-badges">${popHtml}${vegHtml}${spicyHtml}${newHtml}${chefHtml}</div>

    <div class="nutrition-panel hidden"></div>

    <div class="desc-panel hidden">
      <div class="desc-panel-name">${escHtml(item.name)}</div>
      <div class="desc-panel-text">${escHtml(item.description)}</div>
      <p class="desc-panel-hint">Tap to close</p>
    </div>

    <div class="like-indicator">LIKE<br>💚</div>
    <div class="nope-indicator">NOPE<br>✕</div>

    <div class="card-info">
      <div class="card-category">${escHtml(item.category)}</div>
      <div class="card-name">${escHtml(item.name)}</div>
      <div class="card-description">${escHtml(item.description)}</div>
      <div class="card-meta">
        <span class="card-price">${priceStr}</span>
        ${calBtnHtml}
        ${likeBtnHtml}
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

  // Like button
  const likeBtn = card.querySelector('.like-btn');
  likeBtn.addEventListener('pointerdown', e => e.stopPropagation());
  likeBtn.addEventListener('click', e => { e.stopPropagation(); toggleLike(item.id, likeBtn); });
  fetchLikeCount(item.id).then(n => {
    const el = likeBtn.querySelector('.like-count');
    if (el) el.textContent = n;
  });

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
  if (!card) return;

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

/* ─── Execute Swipe ──────────────────────────────────────── */
function executeSwipe(cardEl, direction) {
  const itemId = cardEl.dataset.itemId;
  const item   = state.filtered.find(i => String(i.id) === itemId);
  if (!item) return;

  state.history.push({ item, direction, qty: 1 });
  if (state.history.length > 15) state.history.shift();

  if (direction === 'right') {
    addToCart(item, 1);
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

  setTimeout(() => attachDrag(restoredCard), 460);
  showToast('↩ Brought back');

  document.getElementById('swipe-buttons').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

/* ─── Restart / Browse Again ─────────────────────────────── */
function restartDeck() {
  state.currentIndex = 0;
  document.getElementById('card-stack').innerHTML = '';
  renderStack();
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
      <img class="cart-item-img" src="${escAttr(c.image)}" alt="${escAttr(c.name)}" loading="lazy" />
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
}

/* ─── Counter View ────────────────────────────────────────── */
function showCounterView() {
  if (state.cart.length === 0) { showToast('Your cart is empty!'); return; }

  const total = state.cart.reduce((s, c) => s + (c.price != null ? c.price * c.quantity : 0), 0);
  const table = state.tableNumber ? `Table ${state.tableNumber}` : 'Walk-in';

  document.getElementById('counter-table').textContent = table;
  document.getElementById('counter-total').textContent = `₹${total.toFixed(2)}`;
  document.getElementById('counter-items').innerHTML = state.cart.map(c => `
    <div class="counter-item">
      <span class="counter-item-qty">${c.quantity}×</span>
      <span class="counter-item-name">${escHtml(c.name)}</span>
      <span class="counter-item-price">${c.price != null ? `₹${(c.price * c.quantity).toFixed(2)}` : 'See menu'}</span>
    </div>
  `).join('');

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

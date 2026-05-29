#!/usr/bin/env node
'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const ROOT  = __dirname;
const MENU  = path.join(ROOT, 'menu.json');
const PORT  = process.env.PORT || 3333;

const SB_URL = 'https://twdrocixrvplgrdwncdu.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3ZHJvY2l4cnZwbGdyZHduY2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTAzNjYsImV4cCI6MjA5NTI4NjM2Nn0.9xlrD-0m_Iqi3pRs5xlM1kim75tqconC-aSvhrV2Oj8';

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

// Token cache: avoid hitting Supabase on every single request
const tokenCache = new Map(); // token → { valid: bool, expiresAt: ms }
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

async function validateSupabaseToken(token) {
  const cached = tokenCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return cached.valid;

  const valid = await new Promise(resolve => {
    const u = new URL(`${SB_URL}/auth/v1/user`);
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname,
      method:   'GET',
      headers:  { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` }
    }, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.end();
  });

  tokenCache.set(token, { valid, expiresAt: Date.now() + CACHE_TTL });
  return valid;
}

function readMenu() {
  return JSON.parse(fs.readFileSync(MENU, 'utf8'));
}

function writeMenu(data) {
  fs.writeFileSync(MENU, JSON.stringify(data, null, 2), 'utf8');
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end',  () => { try { resolve(JSON.parse(s)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function findItem(data, id) {
  for (const [section, items] of Object.entries(data.menu)) {
    const idx = items.findIndex(it => it.id === id);
    if (idx !== -1) return { section, index: idx };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();
  const p      = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* ── Auth guard (API routes only — static files are public) ── */
  if (p.startsWith('/api/')) {
    const authHeader = req.headers['authorization'] || '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token || !(await validateSupabaseToken(token))) {
      return json(res, 401, { error: 'Unauthorized' });
    }
  }

  /* ── API routes ── */
  if (p === '/api/menu' && method === 'GET') {
    return json(res, 200, readMenu());
  }

  if (p === '/api/items' && method === 'POST') {
    try {
      const item = await body(req);
      const data = readMenu();
      const sec  = item._section || 'breakfast';
      delete item._section;
      if (!data.menu[sec]) data.menu[sec] = [];
      data.menu[sec].push(item);
      writeMenu(data);
      return json(res, 201, { ok: true, item });
    } catch(e) { return json(res, 400, { error: e.message }); }
  }

  if (p.startsWith('/api/items/') && method === 'PUT') {
    try {
      const id      = decodeURIComponent(p.slice('/api/items/'.length));
      const updates = await body(req);
      const data    = readMenu();
      const loc     = findItem(data, id);
      if (!loc) return json(res, 404, { error: 'not found' });

      const newSec = updates._section;
      delete updates._section;

      if (newSec && newSec !== loc.section) {
        data.menu[loc.section].splice(loc.index, 1);
        if (!data.menu[newSec]) data.menu[newSec] = [];
        data.menu[newSec].push(updates);
      } else {
        data.menu[loc.section][loc.index] = updates;
      }
      writeMenu(data);
      return json(res, 200, { ok: true });
    } catch(e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/settings' && method === 'GET') {
    const data = readMenu();
    return json(res, 200, data.settings || {});
  }

  if (p === '/api/settings' && method === 'PUT') {
    try {
      const updates = await body(req);
      const data    = readMenu();
      data.settings = Object.assign(data.settings || {}, updates);
      writeMenu(data);
      return json(res, 200, { ok: true, settings: data.settings });
    } catch(e) { return json(res, 400, { error: e.message }); }
  }

  if (p.startsWith('/api/items/') && method === 'DELETE') {
    const id   = decodeURIComponent(p.slice('/api/items/'.length));
    const data = readMenu();
    const loc  = findItem(data, id);
    if (!loc) return json(res, 404, { error: 'not found' });
    data.menu[loc.section].splice(loc.index, 1);
    writeMenu(data);
    return json(res, 200, { ok: true });
  }

  /* ── Static file server ── */
  let filePath = path.join(ROOT, p === '/' ? 'admin.html' : p);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Admin UI → http://localhost:${PORT}`);
  console.log(`  Auth     → Supabase (manage users at supabase.com/dashboard)\n`);
});

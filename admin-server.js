#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const MENU = path.join(ROOT, 'menu.json');
const PORT = 3333;

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

// Find item across all sections; returns { section, index } or null
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

      // Handle section change
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
  // Security: prevent path traversal
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Admin UI → http://localhost:${PORT}\n`);
});

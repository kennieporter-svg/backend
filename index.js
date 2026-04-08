'use strict';
require('dotenv').config();

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

const { seed } = require('./db');
const authRoutes = require('./auth');
const listingRoutes = require('./listings');
const orderRoutes = require('./orders');
const chatRoutes = require('./chat');
const adminRoutes = require('./admin');
const miscRoutes = require('./misc');
const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── MIDDLEWARE ────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── ROUTES ────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api',          miscRoutes);

// ── HEALTH ────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  time: new Date().toISOString(),
  demo: process.env.DEMO_MODE !== 'false',
  version: '1.0.0',
}));

// ── 404 ───────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));

// ── ERROR HANDLER ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message
  });
});

// ── START ─────────────────────────────────────────
seed().then(() => {
  server.listen(PORT, () => {
    const demo = process.env.DEMO_MODE !== 'false';
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║  VaultMarket Backend Running           ║');
    console.log('║  Port : ' + PORT + '                          ║');
    console.log('║  Mode : ' + (demo ? 'DEMO' : 'PRODUCTION') + '                        ║');
    console.log('║  CORS : ' + FRONTEND_URL.padEnd(29) + '║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    if (demo) {
      console.log('Demo logins (password: Password1!):');
      console.log('  Admin  → admin@vault.com');
      console.log('  Buyer  → john@vault.com');
      console.log('  Seller → sv@vault.com');
    } else {
      console.log('Production mode. Admin: ' + process.env.ADMIN_EMAIL);
    }
    console.log('');
  });
});

module.exports = { app, server };

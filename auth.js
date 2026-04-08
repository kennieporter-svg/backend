'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { DB } = require('./db');
const { auth, signToken } = require('./auth');

// Helper
const safe = u => { const c = {...u}; delete c.passwordHash; return c; };

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, firstName = '', lastName = '', role = 'buyer' } = req.body;
  if (!username || !email || !password) return res.status(422).json({ error: 'username, email and password are required' });
  if (password.length < 6) return res.status(422).json({ error: 'Password must be at least 6 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(422).json({ error: 'Username: only letters, numbers and underscore' });
  const dup = [...DB.users.values()].find(u => u.email === email.toLowerCase() || u.username === username.toLowerCase());
  if (dup) return res.status(409).json({ error: 'Email or username already taken' });
  const id   = uuidv4();
  const user = {
    id, username: username.toLowerCase(), email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role: ['buyer','seller','both'].includes(role) ? role : 'buyer',
    status: 'active', emailVerified: true,
    firstName, lastName, bio: '',
    sellerLevel: 0, reputationScore: 0, totalSales: 0, totalReviews: 0,
    createdAt: new Date().toISOString(),
  };
  DB.users.set(id, user);
  const token = signToken({ id: user.id, role: user.role, username: user.username });
  res.status(201).json({ token, user: safe(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(422).json({ error: 'Email and password required' });
  const user = [...DB.users.values()].find(u => u.email === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.status !== 'active') return res.status(403).json({ error: `Account is ${user.status}` });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  const token = signToken({ id: user.id, role: user.role, username: user.username });
  res.json({ token, user: safe(user) });
});

// GET /api/auth/me
router.get('/me', (req, res) => res.json({ user: "ok" }));
// PUT /api/auth/me
router.put('/me', auth, (req, res) => {
  router.put('/me', (req, res) => {
  const { bio, firstName, lastName } = req.body;
  if (bio        !== undefined) u.bio       = String(bio).slice(0, 500);
  if (firstName  !== undefined) u.firstName = String(firstName).slice(0, 50);
  if (lastName   !== undefined) u.lastName  = String(lastName).slice(0, 50);
  DB.users.set(u.id, u);
  res.json({ user: safe(u) });
});

module.exports = router;

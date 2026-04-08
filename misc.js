'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { DB } = require('../config/db');
const { auth } = require('../middleware/auth');

// GET /api/categories
router.get('/categories', (_, res) => res.json({ categories: DB.categories || [] }));

// POST /api/reviews
router.post('/reviews', auth, (req, res) => {
  const { orderId, rating, comment } = req.body;
  const o = DB.orders.get(orderId);
  if (!o||o.buyerId!==req.user.id||!['confirmed','completed','auto_confirmed'].includes(o.status))
    return res.status(400).json({ error: 'Order not eligible for review' });
  if ([...DB.reviews.values()].find(r=>r.orderId===orderId))
    return res.status(400).json({ error: 'Already reviewed' });
  const r = { id:uuidv4(), orderId, reviewerId:req.user.id, revieweeId:o.sellerId, rating:parseInt(rating)||5, comment:comment||'', createdAt:new Date().toISOString() };
  DB.reviews.set(r.id, r);
  // Update seller avg rating
  const sellerRevs = [...DB.reviews.values()].filter(rv=>rv.revieweeId===o.sellerId);
  const avg = sellerRevs.reduce((s,rv)=>s+rv.rating,0)/sellerRevs.length;
  const seller = DB.users.get(o.sellerId);
  if (seller) { seller.reputationScore=Math.round(avg*10)/10; seller.totalReviews=sellerRevs.length; DB.users.set(seller.id,seller); }
  res.status(201).json({ review: r });
});

// GET /api/notifications
router.get('/notifications', auth, (req, res) => {
  const notifs = [...DB.notifications.values()].filter(n=>n.userId===req.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,30);
  const unread  = notifs.filter(n=>!n.isRead).length;
  res.json({ notifications: notifs, unreadCount: unread });
});

// PUT /api/notifications/read
router.put('/notifications/read', auth, (req, res) => {
  DB.notifications.forEach((n,k) => { if(n.userId===req.user.id) DB.notifications.set(k,{...n,isRead:true}); });
  res.json({ message: 'All marked read' });
});

// GET /api/users/:username
router.get('/users/:username', (req, res) => {
  const u = [...DB.users.values()].find(u=>u.username===req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const safe = {...u}; delete safe.passwordHash;
  const reviews = [...DB.reviews.values()].filter(r=>r.revieweeId===u.id).map(r=>({...r,reviewerUsername:DB.users.get(r.reviewerId)?.username}));
  res.json({ user: safe, reviews });
});

module.exports = router;

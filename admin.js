'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { DB } = require('../config/db');
const { auth, adminOnly } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(auth, adminOnly);

// GET /api/admin/stats
router.get('/stats', (_, res) => {
  const activeUsers    = [...DB.users.values()].filter(u=>u.status==='active').length;
  const activeListings = [...DB.listings.values()].filter(l=>l.status==='active').length;
  const pendingListings= [...DB.listings.values()].filter(l=>l.status==='pending_review').length;
  const totalOrders    = [...DB.orders.values()].length;
  const revenue        = [...DB.orders.values()].filter(o=>['confirmed','completed'].includes(o.status)).reduce((s,o)=>s+o.platformFee,0);
  const escrowed       = [...DB.escrow.values()].filter(e=>e.status==='held').reduce((s,e)=>s+e.usdAmount,0);
  const openDisputes   = [...DB.disputes.values()].filter(d=>d.status==='open').length;
  res.json({ activeUsers, activeListings, pendingListings, totalOrders, totalRevenue: parseFloat(revenue.toFixed(2)), escrowed: parseFloat(escrowed.toFixed(2)), openDisputes });
});

// GET /api/admin/listings/pending
router.get('/listings/pending', (_, res) => {
  const enrich = l => { const s=DB.users.get(l.sellerId); const c=DB.categories?.find(x=>x.id===l.categoryId); return {...l, sellerUsername:s?.username, categoryName:c?.name, categoryIcon:c?.icon}; };
  const items = [...DB.listings.values()].filter(l=>l.status==='pending_review').map(enrich);
  res.json({ listings: items, count: items.length });
});

// POST /api/admin/listings/:id/approve
router.post('/listings/:id/approve', (req, res) => {
  const l = DB.listings.get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  DB.listings.set(l.id, { ...l, status:'active', adminId:req.user.id, reviewedAt:new Date().toISOString() });
  addNotif(l.sellerId,'LISTING_APPROVED','✅ Listing Approved!',`"${l.title}" is now live.`);
  res.json({ message: 'Listing approved and live' });
});

// POST /api/admin/listings/:id/reject
router.post('/listings/:id/reject', (req, res) => {
  const l = DB.listings.get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  DB.listings.set(l.id, { ...l, status:'rejected', adminNote:req.body.reason||'Does not meet guidelines', reviewedAt:new Date().toISOString() });
  addNotif(l.sellerId,'LISTING_REJECTED','❌ Listing Rejected',`"${l.title}" was rejected. ${req.body.reason||''}`);
  res.json({ message: 'Listing rejected' });
});

// GET /api/admin/disputes
router.get('/disputes', (_, res) => {
  const items = [...DB.disputes.values()].map(d => ({
    ...d,
    raisedByUsername: DB.users.get(d.raisedBy)?.username,
    againstUsername:  DB.users.get(d.against)?.username,
    orderAmount:      DB.orders.get(d.orderId)?.totalCharged,
  }));
  res.json({ disputes: items });
});

// POST /api/admin/disputes/:id/resolve
router.post('/disputes/:id/resolve', (req, res) => {
  const d = DB.disputes.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { decision, resolution } = req.body;
  DB.disputes.set(d.id, { ...d, status:`resolved_${decision}`, resolution, adminId:req.user.id, resolvedAt:new Date().toISOString() });
  const o   = DB.orders.get(d.orderId);
  const esc = [...DB.escrow.values()].find(e=>e.orderId===d.orderId);
  if (o && esc) {
    const newStatus = decision==='buyer' ? 'refunded' : 'completed';
    DB.orders.set(o.id, {...o, status:newStatus});
    DB.escrow.set(esc.id, {...esc, status:decision==='buyer'?'refunded':'released', releasedAt:new Date().toISOString(), releaseReason:`admin_${decision}`});
  }
  res.json({ message: `Dispute resolved in favor of ${decision}` });
});

// GET /api/admin/users
router.get('/users', (_, res) => {
  const safe = u => { const c={...u}; delete c.passwordHash; return c; };
  res.json({ users: [...DB.users.values()].map(safe) });
});

// POST /api/admin/users/:id/:action
router.post('/users/:id/:action', (req, res) => {
  const u = DB.users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const map = { suspend:'suspended', ban:'banned', activate:'active' };
  const newStatus = map[req.params.action];
  if (!newStatus) return res.status(400).json({ error: 'Invalid action' });
  DB.users.set(u.id, { ...u, status:newStatus });
  res.json({ message: `User ${req.params.action}d` });
});

// GET /api/admin/escrow
router.get('/escrow', (_, res) => {
  const items = [...DB.escrow.values()].map(e => {
    const o = DB.orders.get(e.orderId);
    return { ...e, buyerUsername:DB.users.get(o?.buyerId)?.username, sellerUsername:DB.users.get(o?.sellerId)?.username };
  });
  res.json({ escrows: items });
});

// POST /api/admin/escrow/:orderId/:action
router.post('/escrow/:orderId/:action', (req, res) => {
  const esc = [...DB.escrow.values()].find(e=>e.orderId===req.params.orderId);
  const o   = DB.orders.get(req.params.orderId);
  if (!esc||!o) return res.status(404).json({ error: 'Not found' });
  const release = req.params.action === 'release';
  DB.escrow.set(esc.id, {...esc, status:release?'released':'refunded', releasedAt:new Date().toISOString(), releaseReason:release?'admin_override':'admin_refund'});
  DB.orders.set(o.id, {...o, status:release?'completed':'refunded'});
  res.json({ message: `Escrow ${req.params.action}d` });
});

function addNotif(userId, type, title, body) {
  const n = { id:uuidv4(), userId, type, title, body, isRead:false, createdAt:new Date().toISOString() };
  DB.notifications.set(n.id, n);
}

module.exports = router;

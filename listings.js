'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { DB } = require('./db');
const { auth, sellerOnly } = require('../middleware/auth');

function enrich(l) {
  const s   = DB.users.get(l.sellerId);
  const cat = DB.categories?.find(c => c.id === l.categoryId);
  return { ...l, sellerUsername: s?.username, sellerRating: s?.reputationScore, sellerSales: s?.totalSales, sellerLevel: s?.sellerLevel, categoryName: cat?.name, categorySlug: cat?.slug, categoryIcon: cat?.icon };
}
DB.categories = DB.categories || [];

// GET /api/listings
router.get('/', (req, res) => {
  const { q='', category='', sort='newest', page=1, limit=12, featured } = req.query;
  let items = [...DB.listings.values()]
    .filter(l => l.status === 'active')
    .filter(l => !q || l.title.toLowerCase().includes(q.toLowerCase()) || (l.description||'').toLowerCase().includes(q.toLowerCase()))
    .filter(l => !category || DB.categories.find(c=>c.id===l.categoryId)?.slug === category)
    .filter(l => featured !== 'true' || l.featured);

  if (sort === 'price-low')  items.sort((a,b) => a.price - b.price);
  else if (sort === 'price-high') items.sort((a,b) => b.price - a.price);
  else if (sort === 'rating') items.sort((a,b) => (DB.users.get(b.sellerId)?.reputationScore||0) - (DB.users.get(a.sellerId)?.reputationScore||0));
  else items.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total  = items.length;
  const p      = parseInt(page), l = parseInt(limit);
  const paged  = items.slice((p-1)*l, p*l);
  res.json({ listings: paged.map(enrich), pagination: { total, page: p, pages: Math.ceil(total/l), limit: l } });
});

// GET /api/listings/:id
router.get('/:id', (req, res) => {
  const l = DB.listings.get(req.params.id);
  if (!l || l.status === 'draft') return res.status(404).json({ error: 'Listing not found' });
  DB.listings.set(l.id, { ...l, viewCount: (l.viewCount||0) + 1 });
  const reviews = [...DB.reviews.values()]
    .filter(r => { const o = DB.orders.get(r.orderId); return o && o.sellerId === l.sellerId; })
    .map(r => ({ ...r, reviewerUsername: DB.users.get(r.reviewerId)?.username }))
    .slice(0, 10);
  res.json({ listing: enrich(l), reviews });
});

// POST /api/listings
router.post('/', auth, sellerOnly, (req, res) => {
  const { title, description, categoryId, price, deliveryMethod='manual', tags=[] } = req.body;
  if (!title || !description || !categoryId || !price) return res.status(422).json({ error: 'title, description, categoryId, price are required' });
  if (String(title).length < 10) return res.status(422).json({ error: 'Title must be at least 10 characters' });
  if (String(description).length < 20) return res.status(422).json({ error: 'Description must be at least 20 characters' });
  const l = {
    id: uuidv4(), sellerId: req.user.id, title, description, categoryId,
    price: parseFloat(price), deliveryMethod,
    tags: Array.isArray(tags) ? tags : [],
    status: 'pending_review', featured: false,
    viewCount: 0, orderCount: 0,
    createdAt: new Date().toISOString(),
  };
  DB.listings.set(l.id, l);
  res.status(201).json({ listing: enrich(l), message: 'Submitted for admin review.' });
});

// PUT /api/listings/:id
router.put('/:id', auth, sellerOnly, (req, res) => {
  const l = DB.listings.get(req.params.id);
  if (!l || (l.sellerId !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Not found' });
  const { title, description, price } = req.body;
  const updated = { ...l, ...(title&&{title}), ...(description&&{description}), ...(price&&{price:parseFloat(price)}), status:'pending_review', updatedAt: new Date().toISOString() };
  DB.listings.set(l.id, updated);
  res.json({ listing: enrich(updated) });
});

// DELETE /api/listings/:id
router.delete('/:id', auth, (req, res) => {
  const l = DB.listings.get(req.params.id);
  if (!l || (l.sellerId !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Not found' });
  DB.listings.set(l.id, { ...l, status: 'expired' });
  res.json({ message: 'Listing removed' });
});

// GET /api/categories (mounted under /api, but placed here)
router.get('/categories/all', (req, res) => res.json({ categories: DB.categories }));

module.exports = router;

'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { DB, PLATFORM_FEE, ahead } = require('../config/db');
const { auth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');

// GET /api/orders
router.get('/', auth, (req, res) => {
  const { role = 'buyer', status, page = 1, limit = 20 } = req.query;
  let items = [...DB.orders.values()]
    .filter(o => (role === 'seller' ? o.sellerId : o.buyerId) === req.user.id)
    .filter(o => !status || o.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const p = parseInt(page), l = parseInt(limit);
  const paged = items.slice((p-1)*l, p*l);
  const enriched = paged.map(o => {
    const listing = DB.listings.get(o.listingId);
    const cat     = DB.categories?.find(c => c.id === listing?.categoryId);
    const other   = DB.users.get(role === 'seller' ? o.buyerId : o.sellerId);
    const esc     = [...DB.escrow.values()].find(e => e.orderId === o.id);
    return { ...o, listingTitle: listing?.title, categoryIcon: cat?.icon, otherUsername: other?.username, escrowStatus: esc?.status };
  });
  res.json({ orders: enriched, total: items.length });
});

// GET /api/orders/:id
router.get('/:id', auth, (req, res) => {
  const o = DB.orders.get(req.params.id);
  if (!o || (o.buyerId !== req.user.id && o.sellerId !== req.user.id && req.user.role !== 'admin'))
    return res.status(404).json({ error: 'Order not found' });
  const listing = DB.listings.get(o.listingId);
  const esc     = [...DB.escrow.values()].find(e => e.orderId === o.id);
  const disp    = [...DB.disputes.values()].find(d => d.orderId === o.id);
  const result  = {
    ...o,
    listingTitle:    listing?.title,
    listingDesc:     listing?.description,
    buyerUsername:   DB.users.get(o.buyerId)?.username,
    sellerUsername:  DB.users.get(o.sellerId)?.username,
    sellerId:        o.sellerId,
    escrow: esc,
    dispute: disp,
  };
  if (req.user.id === o.buyerId && o.deliveryData && ['delivered','confirmed','completed','auto_confirmed'].includes(o.status)) {
    result.deliveryContent = decrypt(o.deliveryData);
  }
  delete result.deliveryData;
  res.json({ order: result });
});

// POST /api/orders — create order + crypto charge
router.post('/', auth, (req, res) => {
  const { listingId, quantity = 1, cryptoCurrency = 'BTC' } = req.body;
  const listing = DB.listings.get(listingId);
  if (!listing || listing.status !== 'active') return res.status(400).json({ error: 'Listing not available' });
  if (listing.sellerId === req.user.id) return res.status(400).json({ error: 'Cannot buy your own listing' });

  const qty        = parseInt(quantity);
  const itemPrice  = parseFloat(listing.price) * qty;
  const fee        = parseFloat((itemPrice * PLATFORM_FEE).toFixed(2));
  const payout     = parseFloat((itemPrice - fee).toFixed(2));
  const total      = parseFloat((itemPrice + fee).toFixed(2));

  const orderId = uuidv4();
  const order   = {
    id: orderId, listingId, buyerId: req.user.id, sellerId: listing.sellerId,
    quantity: qty, itemPrice, platformFee: fee, sellerPayout: payout, totalCharged: total,
    status: 'pending', currency: 'USD', autoReleaseAt: ahead(3),
    createdAt: new Date().toISOString(),
  };
  DB.orders.set(orderId, order);

  // Simulated crypto charge
  const rates  = { BTC: 65000, ETH: 3200, USDT: 1, LTC: 90 };
  const rate   = rates[cryptoCurrency] || 65000;
  const cryptoAmt   = (total / rate).toFixed(8);
  const depositAddr = { BTC: 'bc1qvaultmarket...btc', ETH: '0xVaultMarket...eth', USDT: 'TVaultMarket...usdt', LTC: 'LVaultMarket...ltc' }[cryptoCurrency] || 'bc1q...';

  DB.escrow.set('esc_' + orderId, {
    id: 'esc_' + orderId, orderId,
    paymentMethod: cryptoCurrency.toLowerCase(),
    usdAmount: total, cryptoAmount: parseFloat(cryptoAmt), cryptoCurrency,
    depositAddress: depositAddr, exchangeRate: rate,
    status: 'awaiting_payment',
    expiresAt: ahead(1), createdAt: new Date().toISOString(),
  });

  // Notify seller
  addNotif(listing.sellerId, 'NEW_ORDER', '🛒 New Order!', `Order for "${listing.title}" — $${total}`);

  res.status(201).json({
    order,
    payment: { depositAddress: depositAddr, cryptoAmount: parseFloat(cryptoAmt), currency: cryptoCurrency, usdAmount: total, expiresAt: ahead(1) }
  });
});

// POST /api/orders/:id/pay-simulate
router.post('/:id/pay-simulate', auth, (req, res) => {
  const o = DB.orders.get(req.params.id);
  if (!o || o.buyerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (o.status !== 'pending') return res.status(400).json({ error: 'Order not pending' });
  o.status = 'in_escrow';
  DB.orders.set(o.id, o);
  const esc = [...DB.escrow.values()].find(e => e.orderId === o.id);
  if (esc) { esc.status = 'held'; esc.txHashIn = 'sim_' + require('crypto').randomBytes(16).toString('hex'); esc.heldAt = new Date().toISOString(); DB.escrow.set(esc.id, esc); }
  addNotif(o.buyerId,  'PAYMENT_CONFIRMED', '🔐 Funds Held in Escrow', 'Your payment is secured. Awaiting delivery.');
  addNotif(o.sellerId, 'ESCROW_FUNDED',     '💰 Escrow Funded!',       'Buyer paid. Please deliver the item now.');
  res.json({ message: 'Payment simulated — order is now in escrow.', order: o });
});

// POST /api/orders/:id/deliver
router.post('/:id/deliver', auth, (req, res) => {
  const o = DB.orders.get(req.params.id);
  if (!o || o.sellerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (o.status !== 'in_escrow') return res.status(400).json({ error: 'Order must be in_escrow to deliver' });
  const { deliveryContent, deliveryNote } = req.body;
  if (!deliveryContent) return res.status(422).json({ error: 'deliveryContent is required' });
  const updated = { ...o, status:'delivered', deliveryData: encrypt(deliveryContent), deliveryNote: deliveryNote||'', deliveredAt: new Date().toISOString() };
  DB.orders.set(o.id, updated);
  addNotif(o.buyerId, 'ORDER_DELIVERED', '📦 Item Delivered!', 'Please confirm receipt to release payment to seller.');
  res.json({ message: 'Marked as delivered. Buyer notified.' });
});

// POST /api/orders/:id/confirm
router.post('/:id/confirm', auth, (req, res) => {
  const o = DB.orders.get(req.params.id);
  if (!o || o.buyerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (o.status !== 'delivered') return res.status(400).json({ error: 'Order must be delivered to confirm' });
  DB.orders.set(o.id, { ...o, status:'confirmed', confirmedAt: new Date().toISOString() });
  const esc = [...DB.escrow.values()].find(e => e.orderId === o.id);
  if (esc) { esc.status = 'released'; esc.releasedAt = new Date().toISOString(); esc.releaseReason = 'buyer_confirmed'; DB.escrow.set(esc.id, esc); }
  const seller = DB.users.get(o.sellerId);
  if (seller) { seller.totalSales = (seller.totalSales||0) + 1; DB.users.set(seller.id, seller); }
  addNotif(o.sellerId, 'PAYMENT_RELEASED', '💸 Payment Released!', `$${o.sellerPayout} sent to your wallet.`);
  res.json({ message: 'Delivery confirmed! Funds released to seller.' });
});

// POST /api/orders/:id/dispute
router.post('/:id/dispute', auth, (req, res) => {
  const o = DB.orders.get(req.params.id);
  if (!o || o.buyerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (!['in_escrow','delivered'].includes(o.status)) return res.status(400).json({ error: 'Cannot dispute this order' });
  const { reason='other', description } = req.body;
  if (!description) return res.status(422).json({ error: 'description is required' });
  const d = { id: uuidv4(), orderId: o.id, raisedBy: req.user.id, against: o.sellerId, reason, description, status:'open', evidence:[], createdAt: new Date().toISOString() };
  DB.disputes.set(d.id, d);
  DB.orders.set(o.id, { ...o, status:'disputed', disputeId: d.id });
  const esc = [...DB.escrow.values()].find(e => e.orderId === o.id);
  if (esc) { esc.status = 'disputed'; DB.escrow.set(esc.id, esc); }
  addNotif(o.sellerId, 'DISPUTE_OPENED', '⚖️ Dispute Opened', 'A buyer opened a dispute. Admin will review.');
  res.status(201).json({ message: 'Dispute opened. Admin will review within 24 hours.', dispute: d });
});

function addNotif(userId, type, title, body) {
  const n = { id: uuidv4(), userId, type, title, body, isRead: false, createdAt: new Date().toISOString() };
  DB.notifications.set(n.id, n);
}

module.exports = router;

'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { encrypt } = require('./crypto');

// ── IN-MEMORY STORE ───────────────────────────────
// Replace with PostgreSQL in production: see README
const DB = {
  users:      new Map(),
  listings:   new Map(),
  orders:     new Map(),
  escrow:     new Map(),
  disputes:   new Map(),
  messages:   new Map(),
  chatRooms:  new Map(),
  reviews:    new Map(),
  notifications: new Map(),
  categories: [],
};

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_FEE || '5') / 100;
const IS_DEMO      = process.env.DEMO_MODE !== 'false';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL    || 'admin@vault.com';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'Password1!';

function ago(days)   { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString(); }
function ahead(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString(); }

async function seed() {
  // Categories always loaded
  DB.categories = [
    { id: 'cat1', name: 'Bank Accounts',   slug: 'bank',    icon: '🏦' },
    { id: 'cat2', name: 'Payment Cards',   slug: 'card',    icon: '💳' },
    { id: 'cat3', name: 'Digital Wallets', slug: 'wallet',  icon: '👛' },
    { id: 'cat4', name: 'Cash Transfers',  slug: 'cashapp', icon: '📱' },
  ];

  // Real admin from env
  const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
  DB.users.set('admin1', {
    id: 'admin1', username: 'admin', email: ADMIN_EMAIL,
    passwordHash: adminHash, role: 'admin', status: 'active',
    emailVerified: true, sellerLevel: 2, reputationScore: 5.0,
    totalSales: 0, bio: 'Platform administrator',
    createdAt: ago(180),
  });

  if (!IS_DEMO) {
    console.log('Production mode — no demo data');
    return;
  }

  // Demo users
  const pw = await bcrypt.hash('Password1!', 10);
  const demoUsers = [
    { id:'u2', username:'secure_vault', email:'sv@vault.com',   role:'seller', sellerLevel:2, reputationScore:5.0, totalSales:451 },
    { id:'u3', username:'fast_trade',   email:'ft@vault.com',   role:'seller', sellerLevel:1, reputationScore:4.7, totalSales:89  },
    { id:'u4', username:'crypto_king',  email:'ck@vault.com',   role:'both',   sellerLevel:2, reputationScore:4.9, totalSales:312 },
    { id:'u5', username:'john_buyer',   email:'john@vault.com', role:'buyer',  sellerLevel:0, reputationScore:0,   totalSales:0   },
    { id:'u6', username:'flash_drops',  email:'fd@vault.com',   role:'seller', sellerLevel:1, reputationScore:4.6, totalSales:156 },
  ];
  demoUsers.forEach(u => DB.users.set(u.id, {
    ...u, passwordHash: pw, status: 'active', emailVerified: true,
    bio: '', createdAt: ago(Math.floor(Math.random() * 300 + 30)),
  }));

  // Demo listings
  const listings = [
    { id:'l1', sellerId:'u2', categoryId:'cat1', title:'Chase Bank Account — $4,200 Balance',    price:89,  featured:true  },
    { id:'l2', sellerId:'u3', categoryId:'cat2', title:'Visa Gift Card $500 — Ready to Use',     price:42,  featured:true  },
    { id:'l3', sellerId:'u2', categoryId:'cat3', title:'PayPal Business Account $3,000',          price:120, featured:true  },
    { id:'l4', sellerId:'u6', categoryId:'cat4', title:'CashApp Personal Wallet $1,500',          price:67,  featured:false },
    { id:'l5', sellerId:'u4', categoryId:'cat1', title:'Bank of America Savings — $8,000',        price:200, featured:false },
    { id:'l6', sellerId:'u3', categoryId:'cat2', title:'MasterCard Prepaid $250',                 price:22,  featured:false },
    { id:'l7', sellerId:'u2', categoryId:'cat3', title:'Venmo Account $2,000',                    price:85,  featured:false },
    { id:'l8', sellerId:'u4', categoryId:'cat4', title:'Zelle Transfer $500',                     price:38,  featured:false },
    { id:'l9', sellerId:'u6', categoryId:'cat1', title:'Wells Fargo Account $6,500',              price:155, featured:false },
    { id:'l10',sellerId:'u4', categoryId:'cat1', title:'TD Bank Account — Pending Review',        price:75,  featured:false, status:'pending_review' },
  ];
  const descs = {
    cat1: 'Fully verified bank account. Clean history. Full login and email access included.',
    cat2: 'Prepaid card with full balance. Digital code delivered after escrow release.',
    cat3: 'Aged digital wallet, verified identity. Full account access included.',
    cat4: 'Instant cash transfer. US-based. Delivery within 1 hour of escrow confirmation.',
  };
  listings.forEach(l => DB.listings.set(l.id, {
    deliveryMethod: 'manual', status: 'active', viewCount: Math.floor(Math.random()*1500+100),
    orderCount: Math.floor(Math.random()*20+1), tags: [], createdAt: ago(Math.floor(Math.random()*30+1)),
    description: descs[l.categoryId] || 'Quality digital item with full details upon delivery.',
    ...l,
  }));

  // Demo orders
  const o1fee = 42 * PLATFORM_FEE;
  const o2fee = 120 * PLATFORM_FEE;
  const o3fee = 67 * PLATFORM_FEE;
  DB.orders.set('o1', { id:'o1', listingId:'l2', buyerId:'u5', sellerId:'u3', quantity:1, itemPrice:42,  platformFee:parseFloat(o1fee.toFixed(2)), sellerPayout:parseFloat((42-o1fee).toFixed(2)),   totalCharged:parseFloat((42+o1fee).toFixed(2)),   status:'delivered',  deliveryData:encrypt('CODE: VISA5241-8821-3341-9920'), autoReleaseAt:ahead(1), createdAt:ago(1) });
  DB.orders.set('o2', { id:'o2', listingId:'l3', buyerId:'u5', sellerId:'u2', quantity:1, itemPrice:120, platformFee:parseFloat(o2fee.toFixed(2)), sellerPayout:parseFloat((120-o2fee).toFixed(2)), totalCharged:parseFloat((120+o2fee).toFixed(2)), status:'completed',  deliveryData:encrypt('paypal@johndoe.com / Pass: Str0ng#2024'), confirmedAt:ago(1), createdAt:ago(5) });
  DB.orders.set('o3', { id:'o3', listingId:'l4', buyerId:'u5', sellerId:'u6', quantity:1, itemPrice:67,  platformFee:parseFloat(o3fee.toFixed(2)), sellerPayout:parseFloat((67-o3fee).toFixed(2)),  totalCharged:parseFloat((67+o3fee).toFixed(2)),  status:'in_escrow',  autoReleaseAt:ahead(2), createdAt:ago(0) });
  DB.orders.set('o4', { id:'o4', listingId:'l9', buyerId:'u5', sellerId:'u6', quantity:1, itemPrice:155, platformFee:7.75, sellerPayout:147.25, totalCharged:162.75, status:'disputed', createdAt:ago(3) });

  // Demo escrow
  DB.escrow.set('e1', { id:'e1', orderId:'o1', paymentMethod:'btc',  usdAmount:44.10,  cryptoAmount:0.00098, cryptoCurrency:'BTC',  depositAddress:'bc1qvault01...', txHashIn:'a1b2c3...', status:'held',     heldAt:ago(1) });
  DB.escrow.set('e2', { id:'e2', orderId:'o2', paymentMethod:'eth',  usdAmount:126.00, cryptoAmount:0.05040, cryptoCurrency:'ETH',  depositAddress:'0x1234vault...',  txHashIn:'0xabc...',  status:'released', heldAt:ago(5), releasedAt:ago(1), releaseReason:'buyer_confirmed' });
  DB.escrow.set('e3', { id:'e3', orderId:'o3', paymentMethod:'usdt', usdAmount:70.35,  cryptoAmount:70.35,   cryptoCurrency:'USDT', depositAddress:'TRXvault...',     txHashIn:'trx_abc...',status:'held',     heldAt:ago(0) });
  DB.escrow.set('e4', { id:'e4', orderId:'o4', paymentMethod:'btc',  usdAmount:162.75, cryptoAmount:0.00361, cryptoCurrency:'BTC',  depositAddress:'bc1qvault04...', txHashIn:'btc_abc...',  status:'disputed', heldAt:ago(3) });

  DB.disputes.set('d1', { id:'d1', orderId:'o4', raisedBy:'u5', against:'u6', reason:'not_as_described', description:'Account balance does not match listing description.', status:'open', evidence:[], createdAt:ago(2) });

  // Demo chat
  DB.chatRooms.set('r1', { id:'r1', buyerId:'u5', sellerId:'u3', orderId:'o1', lastMsgAt:ago(0) });
  DB.chatRooms.set('r2', { id:'r2', buyerId:'u5', sellerId:'u2', orderId:'o2', lastMsgAt:ago(1) });
  DB.chatRooms.set('r3', { id:'r3', buyerId:'u5', sellerId:'u4', orderId:null, lastMsgAt:ago(0) });

  [
    { id:'m1', roomId:'r1', senderId:'u3', content:'Hi! Order received. Delivering shortly.' },
    { id:'m2', roomId:'r1', senderId:'u5', content:'Please send to my email once ready.' },
    { id:'m3', roomId:'r1', senderId:'u3', content:'Delivered! Please confirm on your order page.' },
    { id:'m4', roomId:'r2', senderId:'u2', content:'Thank you for your purchase! Delivered.' },
    { id:'m5', roomId:'r2', senderId:'u5', content:'All working great, leaving 5-star review!' },
    { id:'m6', roomId:'r3', senderId:'u5', content:'Hi, is the Chase account price negotiable?' },
    { id:'m7', roomId:'r3', senderId:'u4', content:'I can do $75. Fast delivery in 30 min.' },
  ].forEach((m, i) => DB.messages.set(m.id, { ...m, msgType:'text', isRead: i < 5, createdAt:ago(i < 3 ? 0 : 1) }));

  DB.reviews.set('rv1', { id:'rv1', orderId:'o2', reviewerId:'u5', revieweeId:'u2', rating:5, comment:'Perfect! Exactly as described. Fast delivery. Will buy again!', createdAt:ago(1) });

  console.log('Demo data loaded — 5 users, 10 listings, 4 orders');
}

module.exports = { DB, seed, ago, ahead, PLATFORM_FEE, IS_DEMO };

'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { DB } = require('../config/db');
const { auth } = require('../middleware/auth');

// GET /api/chat/rooms
router.get('/rooms', auth, (req, res) => {
  const rooms = [...DB.chatRooms.values()]
    .filter(r => r.buyerId === req.user.id || r.sellerId === req.user.id)
    .sort((a, b) => new Date(b.lastMsgAt) - new Date(a.lastMsgAt))
    .map(r => {
      const otherId = r.buyerId === req.user.id ? r.sellerId : r.buyerId;
      const other   = DB.users.get(otherId);
      const msgs    = [...DB.messages.values()].filter(m => m.roomId === r.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
      const unread  = msgs.filter(m => m.senderId !== req.user.id && !m.isRead).length;
      return { ...r, otherUsername: other?.username, otherId, lastMessage: msgs[0]?.content?.slice(0,60)||'', unreadCount: unread };
    });
  res.json({ rooms });
});

// GET /api/chat/rooms/:roomId/messages
router.get('/rooms/:roomId/messages', auth, (req, res) => {
  const room = DB.chatRooms.get(req.params.roomId);
  if (!room || (room.buyerId !== req.user.id && room.sellerId !== req.user.id))
    return res.status(403).json({ error: 'Access denied' });
  const msgs = [...DB.messages.values()]
    .filter(m => m.roomId === req.params.roomId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(m => ({ ...m, senderUsername: DB.users.get(m.senderId)?.username }));
  msgs.forEach(m => { if (m.senderId !== req.user.id && !m.isRead) { m.isRead=true; DB.messages.set(m.id,m); }});
  res.json({ messages: msgs });
});

// POST /api/chat/rooms/:roomId/messages
router.post('/rooms/:roomId/messages', auth, (req, res) => {
  const room = DB.chatRooms.get(req.params.roomId);
  if (!room || (room.buyerId !== req.user.id && room.sellerId !== req.user.id))
    return res.status(403).json({ error: 'Access denied' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(422).json({ error: 'Content required' });
  const m = { id: uuidv4(), roomId: req.params.roomId, senderId: req.user.id, content: content.trim(), msgType:'text', isRead:false, createdAt: new Date().toISOString() };
  DB.messages.set(m.id, m);
  DB.chatRooms.set(room.id, { ...room, lastMsgAt: m.createdAt });
  res.status(201).json({ message: { ...m, senderUsername: req.user.username } });
});

// POST /api/chat/rooms — get or create
router.post('/rooms', auth, (req, res) => {
  const { otherUserId, orderId } = req.body;
  const existing = [...DB.chatRooms.values()].find(r =>
    ((r.buyerId===req.user.id && r.sellerId===otherUserId)||(r.sellerId===req.user.id && r.buyerId===otherUserId)) && r.orderId===(orderId||null)
  );
  if (existing) return res.json({ room: existing });
  const r = { id: uuidv4(), buyerId: req.user.id, sellerId: otherUserId, orderId: orderId||null, lastMsgAt: new Date().toISOString() };
  DB.chatRooms.set(r.id, r);
  res.status(201).json({ room: r });
});

module.exports = router;

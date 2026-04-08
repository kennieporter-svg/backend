'use strict';
const crypto = require('crypto');

const KEY_RAW = process.env.ENCRYPT_KEY || '';
const KEY = KEY_RAW.length >= 32
  ? Buffer.from(KEY_RAW.slice(0, 32), 'utf8')
  : crypto.scryptSync(KEY_RAW || 'default_dev_key', 'salt', 32);

function encrypt(text) {
  if (!text) return null;
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    const [ivHex, encHex] = ciphertext.split(':');
    const d = crypto.createDecipheriv('aes-256-cbc', KEY, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch { return '[encrypted content]'; }
}

module.exports = { encrypt, decrypt };

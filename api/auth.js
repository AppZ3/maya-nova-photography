import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';

// Each save writes a NEW timestamped pathname (settings/auth-{ts}.json) and
// deletes the previous ones. Overwriting a fixed pathname doesn't work here:
// the Blob CDN caches by pathname (query strings ignored) for 60s minimum,
// which made password changes lag behind.
const AUTH_PREFIX = 'settings/auth';
const PBKDF2_ITERS = 120000;

// Seed hash: the password the site shipped with. Replaced in the settings
// blob the first time Maya changes her password from the admin console.
const SEED_PASSWORD = 'maya-admin-2026';

function hashPassword(password, salt, iterations) {
  return crypto
    .pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256')
    .toString('hex');
}

function makeRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    iterations: PBKDF2_ITERS,
    hash: hashPassword(password, salt, PBKDF2_ITERS),
    updatedAt: new Date().toISOString(),
  };
}

async function listAuthBlobs() {
  const res = await list({ prefix: AUTH_PREFIX });
  return res.blobs.filter((b) => /^settings\/auth(-\d+)?\.json$/.test(b.pathname));
}

async function loadRecord() {
  const blobs = await listAuthBlobs();
  if (!blobs.length) return null;
  // Newest timestamped record wins; the legacy fixed-path auth.json sorts last.
  blobs.sort((a, b) => (b.pathname > a.pathname ? 1 : -1));
  const newest = blobs.find((b) => b.pathname !== 'settings/auth.json') || blobs[0];
  const resp = await fetch(newest.url, { cache: 'no-store' });
  if (!resp.ok) return null;
  return resp.json();
}

async function saveRecord(record) {
  const previous = await listAuthBlobs();
  await put(`${AUTH_PREFIX}-${Date.now()}.json`, JSON.stringify(record), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
  });
  if (previous.length) {
    await del(previous.map((b) => b.url)).catch(() => {});
  }
}

function verify(record, password) {
  const candidate = hashPassword(password, record.salt, record.iterations);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const password = typeof body?.password === 'string' ? body.password : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    let record = await loadRecord();
    if (!record) {
      record = makeRecord(SEED_PASSWORD);
      await saveRecord(record);
    }

    if (!verify(record, password)) {
      await sleep(400); // flat cost on failures; keeps brute force boring
      return res.status(401).json({ error: 'Incorrect password' });
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      await saveRecord(makeRecord(newPassword));
      return res.status(200).json({ ok: true, changed: true });
    }

    // Successful login hands back the gallery admin key so the client
    // galleries tab works without a second credential.
    return res.status(200).json({ ok: true, adminKey: process.env.ADMIN_KEY || null });
  } catch (err) {
    console.error('auth error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

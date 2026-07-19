import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';

const ID_RE = /^[a-f0-9]{16}$/;

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized' });
}

function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key.length > 0 && key === process.env.ADMIN_KEY;
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function handlePost(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  if (!clientName) {
    return res.status(400).json({ error: 'clientName is required' });
  }
  if (clientName.length > 80) {
    return res.status(400).json({ error: 'clientName must be 80 characters or fewer' });
  }

  let months = 3;
  if (body.months !== undefined && body.months !== null && body.months !== '') {
    const m = Number(body.months);
    if (m !== 2 && m !== 3) {
      return res.status(400).json({ error: 'months must be 2 or 3' });
    }
    months = m;
  }

  let pin = null;
  if (body.pin !== undefined && body.pin !== null && body.pin !== '') {
    if (typeof body.pin !== 'string' || !/^\d{4,8}$/.test(body.pin)) {
      return res.status(400).json({ error: 'pin must be 4 to 8 digits' });
    }
    pin = body.pin;
  }

  const id = crypto.randomBytes(8).toString('hex');
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + months);

  // meta.json lives on a public blob URL, so only a hash of the PIN is stored
  const meta = {
    id,
    clientName,
    pinHash: pin ? crypto.createHash('sha256').update(pin).digest('hex') : null,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  await put(`galleries/${id}/meta.json`, JSON.stringify(meta), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
  });

  return res.status(200).json({
    id,
    expiresAt: meta.expiresAt,
    url: `/client.html?g=${id}`,
  });
}

async function handleGet(req, res) {
  const all = await listAll('galleries/');
  const metaBlobs = all.filter((b) => /^galleries\/[a-f0-9]{16}\/meta\.json$/.test(b.pathname));
  const now = Date.now();

  const galleries = await Promise.all(
    metaBlobs.map(async (blob) => {
      const id = blob.pathname.split('/')[1];
      let meta;
      try {
        const resp = await fetch(blob.url);
        if (!resp.ok) return null;
        meta = await resp.json();
      } catch {
        return null;
      }

      const photoPrefix = `galleries/${id}/photos/`;
      let photoCount = 0;
      let totalBytes = 0;
      for (const b of all) {
        if (b.pathname.startsWith(photoPrefix)) {
          photoCount += 1;
          totalBytes += b.size || 0;
        }
      }

      return {
        id,
        clientName: meta.clientName,
        createdAt: meta.createdAt,
        expiresAt: meta.expiresAt,
        expired: now > new Date(meta.expiresAt).getTime(),
        pinProtected: Boolean(meta.pinHash),
        photoCount,
        totalBytes,
        url: `/client.html?g=${id}`,
      };
    })
  );

  const result = galleries
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return res.status(200).json({ galleries: result });
}

async function handleDelete(req, res) {
  const id = req.query?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid gallery id' });
  }

  const blobs = await listAll(`galleries/${id}/`);
  if (blobs.length > 0) {
    await del(blobs.map((b) => b.url));
  }

  return res.status(200).json({ deleted: blobs.length });
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return unauthorized(res);

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('galleries error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

import crypto from 'node:crypto';
import { list } from '@vercel/blob';

const ID_RE = /^[a-f0-9]{16}$/;

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid gallery id' });
  }

  try {
    const metaList = await list({ prefix: `galleries/${id}/meta.json`, limit: 1 });
    const metaBlob = metaList.blobs.find((b) => b.pathname === `galleries/${id}/meta.json`);
    if (!metaBlob) {
      return res.status(404).json({ error: 'Gallery not found' });
    }

    const metaResp = await fetch(metaBlob.url);
    if (!metaResp.ok) {
      return res.status(404).json({ error: 'Gallery not found' });
    }
    const meta = await metaResp.json();

    if (Date.now() > new Date(meta.expiresAt).getTime()) {
      return res.status(410).json({ expired: true, clientName: meta.clientName });
    }

    if (meta.pinHash) {
      const pin = req.query?.pin;
      const pinHash =
        typeof pin === 'string' && pin
          ? crypto.createHash('sha256').update(pin).digest('hex')
          : null;
      if (pinHash !== meta.pinHash) {
        return res.status(401).json({ pinRequired: true });
      }
    }

    const [photoBlobs, thumbBlobs] = await Promise.all([
      listAll(`galleries/${id}/photos/`),
      listAll(`galleries/${id}/thumbs/`),
    ]);

    const thumbsByName = new Map();
    for (const t of thumbBlobs) {
      thumbsByName.set(t.pathname.split('/').pop(), t.url);
    }

    const photos = photoBlobs
      .sort((a, b) => a.pathname.localeCompare(b.pathname))
      .map((p) => {
        const name = p.pathname.split('/').pop();
        return {
          name,
          url: p.url,
          thumbUrl: thumbsByName.get(name) || p.url,
          size: p.size || 0,
        };
      });

    return res.status(200).json({
      clientName: meta.clientName,
      expiresAt: meta.expiresAt,
      photos,
    });
  } catch (err) {
    console.error('gallery error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

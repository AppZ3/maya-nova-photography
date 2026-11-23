// Deletes Videos-tab blobs (site-videos/ only) after the admin publishes a
// list that no longer references them. Auth = x-admin-key, like /api/gh.
import { del } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const urls = Array.isArray(body && body.urls) ? body.urls : [];
  const ok = urls.filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && x.hostname.endsWith('.public.blob.vercel-storage.com') &&
        x.pathname.startsWith('/site-videos/');
    } catch { return false; }
  });
  if (!ok.length) return res.status(200).json({ deleted: 0 });
  try {
    await del(ok);
    return res.status(200).json({ deleted: ok.length });
  } catch (err) {
    console.error('videos delete error:', err);
    return res.status(500).json({ error: 'Delete failed' });
  }
}

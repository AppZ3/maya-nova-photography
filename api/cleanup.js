import { list, del } from '@vercel/blob';

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
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['authorization'];
  if (
    typeof auth !== 'string' ||
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await listAll('galleries/');
    const metaBlobs = all.filter((b) => /^galleries\/[a-f0-9]{16}\/meta\.json$/.test(b.pathname));
    const now = Date.now();

    const deletedGalleries = [];
    let deletedBlobs = 0;

    for (const metaBlob of metaBlobs) {
      const id = metaBlob.pathname.split('/')[1];
      let meta;
      try {
        const resp = await fetch(metaBlob.url);
        if (!resp.ok) continue;
        meta = await resp.json();
      } catch {
        continue;
      }

      if (new Date(meta.expiresAt).getTime() < now) {
        const galleryBlobs = all.filter((b) => b.pathname.startsWith(`galleries/${id}/`));
        if (galleryBlobs.length > 0) {
          await del(galleryBlobs.map((b) => b.url));
        }
        deletedGalleries.push(id);
        deletedBlobs += galleryBlobs.length;
      }
    }

    return res.status(200).json({ deletedGalleries, deletedBlobs });
  } catch (err) {
    console.error('cleanup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

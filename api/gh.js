// Server-side GitHub proxy for the admin panel. The GitHub token lives in the
// GITHUB_TOKEN env var, never in a browser, so a revoked or missing per-browser
// token can't lock Maya out. Auth = the same x-admin-key the password login
// hands back. Only this repo's /contents/ API is reachable.
const OWNER = 'AppZ3';
const REPO = 'maya-nova-photography';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const path = String(req.query.path || '');
  if (!path || path.includes('..') || path.startsWith('/')) {
    return res.status(400).json({ error: 'Bad path' });
  }
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}` +
    (req.method === 'GET' && req.query.ref ? `?ref=${encodeURIComponent(req.query.ref)}` : '');
  const init = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'maya-nova-admin',
    },
  };
  if (req.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    console.error('gh proxy error:', err);
    return res.status(502).json({ error: 'GitHub unreachable' });
  }
}

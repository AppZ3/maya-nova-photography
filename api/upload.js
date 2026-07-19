import { handleUpload } from '@vercel/blob/client';

const PATH_RE = /^galleries\/[a-f0-9]{16}\/(photos|thumbs)\/[a-z0-9._-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload;
        try {
          payload = JSON.parse(clientPayload || '{}');
        } catch {
          throw new Error('Invalid client payload');
        }

        if (
          typeof payload.adminKey !== 'string' ||
          payload.adminKey.length === 0 ||
          payload.adminKey !== process.env.ADMIN_KEY
        ) {
          throw new Error('Unauthorized');
        }

        if (!PATH_RE.test(pathname)) {
          throw new Error('Invalid upload pathname');
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
          maximumSizeInBytes: 60 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do; photo lists are derived from blob list() at read time.
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('upload error:', err);
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
}

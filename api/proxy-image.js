export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  
  // Solo Firebase Storage
  if (!url.includes('firebasestorage.googleapis.com')) {
    return res.status(403).json({ error: 'Only Firebase Storage URLs allowed' });
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch image' });
    
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: 'Proxy error', detail: e.message });
  }
}

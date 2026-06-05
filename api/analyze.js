export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { listingImage, liveImage, gemName } = req.body;

    const msgContent = [];

    if (listingImage) {
      const base64Data = listingImage.split(',')[1];
      const mimeType = listingImage.split(';')[0].split(':')[1] || 'image/jpeg';
      msgContent.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: base64Data }
      });
      msgContent.push({ type: 'text', text: 'This is the LISTING PHOTO (as shown on eBay/Catawiki/Etsy).' });
    }

    if (liveImage) {
      const base64Data = liveImage.split(',')[1];
      msgContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64Data }
      });
      msgContent.push({ type: 'text', text: 'This is the LIVE PHOTO taken in natural daylight via TrueColorGem app.' });
    }

    msgContent.push({
      type: 'text',
      text: `You are an expert gemstone photography analyst for TrueColorGem certification system.

Gemstone: ${gemName}

Carefully compare the two photos:
1. LISTING PHOTO: used in the online listing
2. LIVE PHOTO: taken in natural daylight, unedited

Analyze:
- Color accuracy: does listing photo color match live photo?
- Saturation: is listing photo artificially enhanced or filtered?
- Light source of live photo: genuine natural daylight?
- Overall photographic accuracy

Return ONLY valid JSON, no markdown:

{
  "score": <integer 0-100>,
  "color_match": "<percentage>% ✓ or ✗",
  "saturation": "<Natural ✓ or Artificially enhanced ✗>",
  "filter_detected": "<None detected ✓ or Filters detected ✗>",
  "light_source": "<Natural daylight ✓ or Artificial light ✗>",
  "verdict": "<CERTIFIED or REJECTED>",
  "reason": "<one sentence result>",
  "assessment": "<2-3 sentences comparing the two photos>"
}

Score below 70 = REJECTED. Be precise and honest.`
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: msgContent }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

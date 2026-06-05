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
      msgContent.push({ type: 'text', text: 'IMAGE 1 — LISTING PHOTO: The photo the seller uses in their online listing.' });
    }

    if (liveImage) {
      const base64Data = liveImage.split(',')[1];
      msgContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64Data }
      });
      msgContent.push({ type: 'text', text: 'IMAGE 2 — LIVE PHOTO: Taken right now by the seller via TrueColorGem app in natural diffused daylight. Not edited.' });
    }

    msgContent.push({
      type: 'text',
      text: `You are a professional gemstone photography honesty analyst for TrueColorGem certification.

GEMSTONE: ${gemName}

YOUR CORE TASK:
Determine whether the LISTING PHOTO creates unrealistic buyer expectations compared to how the gemstone actually looks in natural daylight (shown in the LIVE PHOTO).

THE KEY DISTINCTION — read carefully:

HONEST PHOTOGRAPHY (score HIGH 85-100):
- Listing photo taken in natural light, even if the quality is lower than the live photo
- Listing photo taken with simple indoor lighting that doesn't dramatically alter color
- Gemstone appears similar color, saturation and character in both photos
- A seller who photographed poorly but honestly — the real stone is even better than the listing photo — this is FINE and should score HIGH
- Minor differences in angle, background, framing, JPEG compression = totally normal

DECEPTIVE PHOTOGRAPHY (score LOW 0-69):
- Listing photo uses concentrated spot lighting, ring lights, or accent lights that make the gemstone appear FAR more brilliant, saturated or vivid than it really is
- Listing photo uses studio lighting that dramatically shifts the perceived color (e.g. appears bright pink in listing but is dark purple in natural light)
- The buyer would be significantly disappointed when receiving the gemstone because it looks much less impressive in normal conditions
- Digital filters, HDR, heavy saturation boost = also deceptive

IMPORTANT GEMOLOGICAL CONTEXT:
- Some gems (tanzanite, alexandrite, color-change garnet) genuinely look different under different light sources — this is a natural optical property, NOT deception. If the gem type is known to be color-change, be lenient.
- Professional macro photography with neutral lighting can reveal brilliance that casual photos miss — this is acceptable
- The question is always: "Would a buyer be disappointed when they receive this gemstone and look at it in normal daylight?" If YES = low score. If NO = high score.

SCORING:
85-100 = CERTIFIED: Listing photo is honest, buyer expectations will be met
70-84 = CERTIFIED: Minor enhancement, buyer will not be significantly disappointed  
0-69 = REJECTED: Listing photo creates unrealistic expectations through deceptive lighting or manipulation

Return ONLY this JSON, no markdown:
{
  "score": <integer 0-100>,
  "color_match": "<percentage>% ✓ or ✗",
  "saturation": "<Natural ✓ or Artificially enhanced ✗>",
  "filter_detected": "<None detected ✓ or Filters detected ✗>",
  "light_source": "<Natural daylight ✓ or Artificial accent light ✗>",
  "verdict": "<CERTIFIED or REJECTED>",
  "reason": "<one precise sentence: what specifically passes or fails>",
  "assessment": "<2-3 sentences: describe what you see in each photo and why the score is justified>"
}`
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
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

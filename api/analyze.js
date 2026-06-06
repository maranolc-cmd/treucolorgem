export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { listingImage, liveImage, gemName, certPdfData } = req.body;
    const msgContent = [];

    // Certificato gemologico (opzionale) — PDF o immagine
    if (certPdfData) {
      const certMime = certPdfData.split(';')[0].split(':')[1] || 'application/pdf';
      const certBase64 = certPdfData.split(',')[1];
      if (certMime === 'application/pdf') {
        msgContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: certBase64 }
        });
      } else {
        msgContent.push({
          type: 'image',
          source: { type: 'base64', media_type: certMime, data: certBase64 }
        });
      }
      msgContent.push({ type: 'text', text: 'DOCUMENT — GEMOLOGICAL CERTIFICATE: Use this to identify the gemstone species, origin, treatments, and any optical properties (pleochroism, color-change) that should be considered when evaluating the listing photo. Do NOT use the certificate photo as a color reference — lab cert photos are explicitly approximate. Use only the text data.' });
    }

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
      msgContent.push({ type: 'text', text: 'IMAGE 2 — LIVE REFERENCE PHOTO: Taken right now via TrueColorGem app in natural diffused daylight. Not edited.' });
    }

    msgContent.push({
      type: 'text',
      text: `You are a gemstone photo certification expert for TrueColorGem. Your sole purpose is to determine whether a seller's LISTING PHOTO honestly represents a gemstone's appearance compared to a LIVE REFERENCE PHOTO taken in natural diffused daylight.

Gemstone: ${gemName}

YOUR TASK: Compare the two images and determine if the listing photo honestly represents the gemstone, or if artificial lighting or post-processing has been used to deceptively enhance its appearance.

CRITICAL EVALUATION PRINCIPLE:
The ONLY factor that matters is whether the listing photo's lighting or editing artificially inflates the gemstone's perceived color saturation, vividness, or brilliance beyond its true appearance.
You are NOT judging photo quality, composition, or professionalism. You are judging HONESTY.

STEP 0 — OBJECT IDENTITY CHECK (evaluate FIRST, before color analysis):
Before evaluating lighting or color, verify that both photos show the SAME gemstone or jewelry piece.
Look for: same cut shape, same approximate size, same setting style, same number of stones, same distinctive features.
If the two photos clearly show DIFFERENT objects (different cut, different shape, different jewelry piece):
- Set score to 0
- Set verdict to REJECTED
- Set reason to "The listing photo and live reference photo appear to show different gemstones or jewelry pieces. Certification requires both photos to depict the same item."
- Do NOT analyze lighting or color — object mismatch overrides all other evaluation.
Only proceed to color/lighting analysis if you are reasonably confident both photos show the same item.

WHAT IS ACCEPTABLE (HIGH SCORE 70-100):
- Listing photo shows gemstone looking similar to or less impressive than the live reference
- Neutral artificial lighting (white LED, softbox, 4500K-6500K) that doesn't exaggerate color
- Minor white balance differences that don't significantly alter perceived saturation
- Slightly underexposed or less vibrant listing photos (seller underselling is honest)
- Lower photo quality, casual photography, less sharp focus
- Natural pleochroism or color-change properties (tanzanite blue vs violet, alexandrite color shift)
- Gemstones that naturally appear more vibrant when well-lit due to high refractive index

WHAT IS DECEPTIVE (LOW SCORE 0-59):
- Spot lighting, ring lights, or accent lighting creating artificially intense brilliance not present in natural light
- Backlighting making stones appear more transparent or saturated than reality
- Heavy saturation boosting — colors appear unnaturally vivid or "electric" compared to reference
- HDR or Instagram-style filters creating unrealistic contrast or color pop
- Color shifting — hue is materially different (not explainable by known optical properties)
- Listing photo shows a dramatically more impressive stone than the live reference

GEMSTONE-SPECIFIC CONTEXT:
- Pleochroic gems (tanzanite, iolite, tourmaline): Different colors at different angles/lighting is NATURAL
- Color-change gems (alexandrite, some garnets): Different colors under different light sources — NOT deception
- High-dispersion gems (diamond, sphene, zircon): More fire under point-source lighting is natural, but excessive ring-light "disco ball" effect is deceptive
- Phenomenal gems (star sapphires, cat's eye, moonstone): Phenomena visibility varies — be lenient

SCORING:
90-100 = CERTIFIED: Listing faithfully represents or undersells the gemstone
70-89 = CERTIFIED: Minor differences, buyer would not feel misled
60-69 = CERTIFIED: Possibly concerning but not egregious
0-59 = REJECTED: Clear evidence of deceptive lighting or editing

IMPORTANT:
- Err slightly toward the seller when evidence is ambiguous
- Focus on saturation and brilliance, not minor color temperature shifts
- Quality ≠ Honesty — professional photo is not inherently deceptive
- Never assume deception — look for positive evidence of manipulation

Return ONLY this JSON, no markdown:
{
  "score": <integer 0-100>,
  "color_match": "<percentage>% ✓ or ✗",
  "saturation": "<Natural ✓ or Artificially enhanced ✗>",
  "filter_detected": "<None detected ✓ or Filters detected ✗>",
  "light_source": "<Natural daylight ✓ or Artificial accent light ✗>",
  "verdict": "<CERTIFIED or REJECTED>",
  "reason": "<one precise sentence: what specifically passes or fails>",
  "assessment": "<2-4 sentences: specific visual evidence from both photos and why score is justified>"
}`
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

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
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API error ${response.status}: ${errBody.error?.message || JSON.stringify(errBody)}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    if (!text) throw new Error('Empty response from Anthropic API');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Validazione campi obbligatori
    const required = ['score', 'verdict', 'reason', 'assessment', 'color_match', 'saturation', 'filter_detected', 'light_source'];
    for (const field of required) {
      if (result[field] === undefined) throw new Error(`Missing required field: ${field}`);
    }
    if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) {
      throw new Error('Invalid score value');
    }

    res.status(200).json(result);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timeout - please try again' });
    }
    res.status(500).json({ error: err.message });
  }
}

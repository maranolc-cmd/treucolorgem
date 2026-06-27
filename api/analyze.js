import Anthropic from "@anthropic-ai/sdk";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ipRequests = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW; }
  entry.count++;
  ipRequests.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait before trying again." });

  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required." });

  const deviceId = req.headers['x-device-id'];

  let uid = null;
  try {
    const token = authHeader.split("Bearer ")[1];
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!decoded.email_verified) return res.status(403).json({ error: "Please verify your email before using this feature." });
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }

  const { listingImage, liveImage, gemName, vertical, listingSessionCode, liveSessionCode, listingCapturedInApp } = req.body;

  if (!listingImage) return res.status(400).json({ error: "Listing image required." });

  try {
    const content = [];

    if (listingImage) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: listingImage.replace(/^data:image\/\w+;base64,/, "") } });
      content.push({ type: "text", text: "IMAGE 1 — LISTING PHOTO (the photo the seller uses in their online listing):" });
    }

    if (liveImage) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: liveImage.replace(/^data:image\/\w+;base64,/, "") } });
      content.push({ type: "text", text: "IMAGE 2 — LIVE REFERENCE PHOTO (taken immediately after by the seller, same session):" });
    }

    content.push({
      type: "text",
      text: `You are LiveProof's AI photo certification engine. Item: "${gemName || "item"}" (category: ${vertical || "general"}).

MISSION: LiveProof certifies PHOTO HONESTY only — whether the listing photo accurately represents what a buyer will see when the item arrives. You do NOT evaluate item authenticity, condition, or physical properties. You ONLY evaluate the photography.

SCORING SYSTEM — Start at 100 and subtract penalties:

COLOR ACCURACY (compare listing photo vs live reference):
- Estimated ΔE (Delta-E color difference) 0–2: no penalty (imperceptible)
- Estimated ΔE 2–5: -5 (slightly perceptible but acceptable)
- Estimated ΔE 5–10: -15 (noticeable color difference)
- Estimated ΔE > 10: -30 (significant color misrepresentation)

LIGHTING MANIPULATION:
- Natural daylight or neutral LED (4000–6500K, no directional enhancement): no penalty
- Warm incandescent light (2700–3500K) that exaggerates warm colors: -12
- Cool studio light (>6500K) that exaggerates blues: -12
- Ring light detected (circular catchlights visible on item surface): -15
- Lightbox detected (unnaturally uniform illumination, no shadows, white background): -15
- Multiple studio lights creating unnatural specular highlights: -10

DIGITAL MANIPULATION:
- Saturation boosting / color filter applied to listing photo: -20
- White balance forcefully shifted toward ideal hue: -12
- HDR / tone mapping applied (smooth transitions, no natural specular clipping): -10
- Photo of a screen or print (moiré pattern, pixel grid, flat luminosity): -40

CONSISTENCY BETWEEN PHOTOS:
- Different item in listing vs live photo: -50
- Significantly different shooting angle that alters perceived color: -10
- Extreme macro in listing without scale reference (misleading size): -8

IMPORTANT RULES:
1. Normal indoor LED lighting is ACCEPTABLE — do not penalize it.
2. A slight angle difference between photos is ACCEPTABLE if it does not alter color perception significantly.
3. Judge objectively — do not favor sellers or buyers. Apply penalties consistently.
4. If only ONE photo is provided (no live reference), apply a flat -20 for inability to verify consistency.
5. The final score must reflect the sum of all penalties applied. Do not round scores to convenient numbers like 85, 90, 95 — be precise.

SCORE INTERPRETATION:
- 90–100: Excellent photo honesty, no significant issues
- 75–89: Good, minor issues present
- 60–74: Acceptable but with notable concerns
- 40–59: Significant issues, likely to disappoint buyer
- 0–39: Clear manipulation or misrepresentation detected

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{
  "score": <integer 0-100, calculated from penalties above>,
  "certified": <true if score >= 70>,
  "penalties": [{"reason": "<what was detected>", "points": <penalty applied>}],
  "deltaE": <estimated Delta-E 0-50>,
  "lightingOk": <true|false>,
  "estimatedColorTemp": "<warm_manipulated|neutral_acceptable|cool_manipulated|unknown>",
  "artificialEnhancement": <true|false>,
  "consistencyOk": <true|false>,
  "colorMatch": "<excellent|good|fair|poor>",
  "summary": "<2-3 sentences explaining the specific issues found and the verdict>",
  "flags": ["<specific issue 1>", "<specific issue 2>"]
}`
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0].text.trim();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const raw = JSON.parse(cleaned);

    // Enforce score boundaries
    const score = Math.max(0, Math.min(100, Math.round(raw.score)));
    const certified = score >= 70;

    const result = {
      score,
      verdict: certified ? 'CERTIFIED' : 'REJECTED',
      color_match: raw.colorMatch === 'excellent' ? '✓ Excellent' :
                   raw.colorMatch === 'good' ? '✓ Good' :
                   raw.colorMatch === 'fair' ? '⚠ Fair' : '✗ Poor',
      saturation: raw.artificialEnhancement ? '✗ Enhanced' : '✓ Natural',
      filter_detected: raw.artificialEnhancement ? '✗ Detected' : '✓ None',
      light_source: raw.lightingOk ? '✓ ' + (raw.estimatedColorTemp || 'Acceptable') : '✗ Manipulated',
      assessment: raw.summary || '',
      reason: raw.flags?.length > 0 ? raw.flags.join('. ') : (certified ? 'Photo accurately represents the item.' : 'Issues detected that may mislead the buyer.'),
      flags: raw.flags || [],
      penalties: raw.penalties || [],
      deltaE: raw.deltaE,
      uid,
    };

    return res.status(200).json(result);
  } catch (e) {
    console.error("Analysis error:", e);
    return res.status(500).json({ error: "Analysis failed. Please try again.", detail: e.message });
  }
}

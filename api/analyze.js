import Anthropic from "@anthropic-ai/sdk";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// ── FIREBASE ADMIN INIT ──
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

// ── RATE LIMIT (in-memory per serverless instance) ──
const ipRequests = new Map();
const RATE_LIMIT = 10; // max richieste per ora per IP
const RATE_WINDOW = 60 * 60 * 1000; // 1 ora

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW;
  }
  entry.count++;
  ipRequests.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── IP RATE LIMIT ──
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait before trying again." });
  }

  // ── FIREBASE TOKEN VALIDATION ──
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required. Please log in." });
  }

  // ── DEVICE FINGERPRINT CHECK ──
  const deviceId = req.headers['x-device-id'];

  let uid = null;
  try {
    const token = authHeader.split("Bearer ")[1];
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!decoded.email_verified) {
      return res.status(403).json({ error: "Please verify your email before using this feature." });
    }
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }

  // ── ANALISI ANTHROPIC ──
  const {
    listingImage,
    liveImage,
    gemName,
    vertical,
    isBeta,
    certPdfData,
    listingSessionCode,
    liveSessionCode,
    listingCapturedInApp,
    listingSensorSnap,
    liveSensorSnap,
  } = req.body;

  if (!listingImage) {
    return res.status(400).json({ error: "Listing image required." });
  }

  try {
    const content = [];

    if (listingImage) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: listingImage.replace(/^data:image\/\w+;base64,/, "") } });
      content.push({ type: "text", text: "LISTING PHOTO (the photo the seller uses in their listing):" });
    }

    if (liveImage) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: liveImage.replace(/^data:image\/\w+;base64,/, "") } });
      content.push({ type: "text", text: "LIVE REFERENCE PHOTO (taken immediately after, same device):" });
    }

    const sessionInfo = listingSessionCode && liveSessionCode
      ? `Session codes: listing=${listingSessionCode}, live=${liveSessionCode}. In-app capture: ${listingCapturedInApp}.`
      : "";

    content.push({
      type: "text",
      text: `You are LiveProof's AI certification engine. Analyze these photos for the item: "${gemName || "item"}" (category: ${vertical || "general"}).

${sessionInfo}

Your task: determine if the listing photo HONESTLY represents what the buyer will receive when they open the package.

SCIENTIFIC CONTEXT (apply this knowledge):
- Delta-E color distance: ΔE < 2 = imperceptible difference | ΔE 2–10 = noticeable | ΔE > 10 = significant misrepresentation. Flag anything above ΔE 5 between listing and live shot.
- CRI (Color Rendering Index): light sources below CRI 90 alter color perception significantly. Warm incandescent (2700K–3500K) exaggerates reds and rubies. Cool studio lights (>6500K) over-enhance blue sapphires and aquamarines. Neutral daylight (5000K–6500K, CRI 95+) is the reference standard.
- Gemstone-specific risks: pleochroic stones (alexandrite, tanzanite, tourmaline) show dramatically different colors under different light angles — flag if lighting appears directional or manipulated. High-saturation red/pink stones (rubies, spinels, rhodolites) are most vulnerable to artificial warm-light enhancement. Fluorescent lighting can cause UV fluorescence in some diamonds and rubies, artificially brightening them.
- Studio artifacts: ring lights create circular catchlights on facets. Lightboxes produce unnaturally uniform illumination with no ambient shadows. Softboxes cause very soft, diffused reflections inconsistent with normal viewing conditions. These are detectable from specular highlights and shadow patterns on the stone.
- Saturation manipulation: post-processing typically shifts hue uniformly, increases chroma beyond natural limits, and reduces texture detail in deep color zones. Compare local saturation in both images.
- Background color cast: a colored background reflects light onto the stone and shifts its perceived color. Black backgrounds make stones look darker and more saturated; white/colored backgrounds bleed onto the stone. Flag if the listing background appears chosen to flatter the stone vs the live shot.
- Wet look / oiling: emeralds and corundum are often wetted or oiled to intensify color and hide inclusions. Detect from excessively glossy, uniform surface reflections and loss of inclusion texture compared to the live reference.
- Shooting angle consistency: transparent gems show more color when shot obliquely (more optical path length) and less when shot face-up. If the listing is oblique and the live shot is face-up, color will differ from geometry alone. Verify the viewing angle is comparable between the two photos.
- Scale / magnification discrepancy: extreme macro without a scale reference can make a stone look much larger. Compare the stone-to-frame ratio between both photos for size honesty.
- Tone mapping / HDR: aggressive HDR processing recovers facet highlight detail unnaturally. Detect from overly smooth transitions between bright and dark zones and absence of natural specular clipping.
- White balance forcing: a manually pushed white balance can shift the entire color rendering toward the stone's "ideal" hue. Assess neutrality of points that should appear white or grey.

WHAT TO CHECK:
1. COLOR MATCH — estimate Delta-E color distance between listing and live reference. Flag if ΔE > 5.
2. ARTIFICIAL ENHANCEMENT — saturation boosting, filters, presets, post-processing. Look for unnatural chroma levels and loss of texture in saturated areas.
3. LIGHTING CONDITIONS — detect ring lights (circular catchlights), lightboxes (uniform illumination, white background, no shadows), studio setups (CRI-distorted color rendering). Flag if color temperature appears manipulated for the stone type.
4. CONSISTENCY — same item in both photos? Check shape, size, inclusions, facet pattern. No swaps, no substitutions.
5. BACKGROUND & ANGLE — flag flattering background color cast, oiling/wet look, mismatched shooting angle, or scale/magnification tricks between the two photos.

IMPORTANT: The goal is not to require perfect natural light — it is to verify that conditions do NOT significantly alter the item's true appearance. Normal LED room lighting (CRI >90, 4000–6500K) is acceptable. Studio setups that dramatically change perceived color or saturation are not.

Be seller-friendly: if in doubt, lean toward certifying. Only fail if the discrepancy would genuinely disappoint a buyer.

Respond ONLY with valid JSON, no markdown:
{
  "score": <0-100>,
  "certified": <true if score >= 70>,
  "colorMatch": "<excellent|good|fair|poor>",
  "deltaE": <estimated Delta-E value 0-50>,
  "lightingOk": <true|false>,
  "estimatedColorTemp": "<warm_manipulated|neutral_acceptable|cool_manipulated|unknown>",
  "artificialEnhancement": <true|false>,
  "consistencyOk": <true|false>,
  "summary": "<2-3 sentences explaining the verdict>",
  "flags": ["<list of specific issues found, empty if none>"]
}`
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0].text.trim();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const raw = JSON.parse(cleaned);

    // Map Anthropic response fields to frontend-expected fields
    const result = {
      score: raw.score,
      verdict: raw.certified ? 'CERTIFIED' : 'REJECTED',
      color_match: raw.colorMatch === 'excellent' ? '✓ Excellent' :
                   raw.colorMatch === 'good' ? '✓ Good' :
                   raw.colorMatch === 'fair' ? '⚠ Fair' : '✗ Poor',
      saturation: raw.artificialEnhancement ? '✗ Enhanced' : '✓ Natural',
      filter_detected: raw.artificialEnhancement ? '✗ Detected' : '✓ None',
      light_source: raw.lightingOk ? '✓ ' + (raw.estimatedColorTemp || 'Acceptable') : '✗ Manipulated',
      assessment: raw.summary || '',
      reason: raw.flags && raw.flags.length > 0 ? raw.flags.join('. ') : (raw.certified ? 'Listing accurately represents the item.' : 'Color or lighting discrepancy detected.'),
      flags: raw.flags || [],
      deltaE: raw.deltaE,
      uid,
    };

    return res.status(200).json(result);
  } catch (e) {
    console.error("Analysis error:", e);
    return res.status(500).json({ error: "Analysis failed. Please try again.", detail: e.message });
  }
}

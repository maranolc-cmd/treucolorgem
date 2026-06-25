import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  single:  'price_1TmCrXQv9UnL7ZMx1hd25Y7Q',
  silver:  'price_1TmCsgQv9UnL7ZMxWlPRSZLu',
  gold:    'price_1TmCtCQv9UnL7ZMxyzfDUGy0',
  diamond: 'price_1TmCtqQv9UnL7ZMxgbAp6uwU',
};

const PLAN_MODE = {
  single:  'payment',       // one-time
  silver:  'subscription',
  gold:    'subscription',
  diamond: 'subscription',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase token
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let uid, email;
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
    if (!decoded.email_verified) {
      return res.status(403).json({ error: 'Please verify your email first.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Invalid session. Please log in again.' });
  }

  const { plan } = req.body;
  if (!plan || !PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan selected.' });
  }

  const appUrl = process.env.APP_URL || 'https://liveproof.ai';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: PLAN_MODE[plan],
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      metadata: { uid, plan },
      success_url: `${appUrl}?payment=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}?payment=cancelled`,
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    return res.status(500).json({ error: 'Could not create checkout session. Please try again.' });
  }
}

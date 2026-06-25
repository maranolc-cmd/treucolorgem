import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
const db = getFirestore();

const PLAN_FROM_PRICE = {
  'price_1TmCrXQv9UnL7ZMx1hd25Y7Q': 'single',
  'price_1TmCsgQv9UnL7ZMxWlPRSZLu': 'silver',
  'price_1TmCtCQv9UnL7ZMxyzfDUGy0': 'gold',
  'price_1TmCtqQv9UnL7ZMxgbAp6uwU': 'diamond',
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.metadata?.uid;
        const plan = session.metadata?.plan;
        if (!uid || !plan) break;

        if (plan === 'single') {
          // Increment single certifications balance
          const userRef = db.collection('users').doc(uid);
          const userDoc = await userRef.get();
          const current = userDoc.exists ? (userDoc.data().singleCredits || 0) : 0;
          await userRef.set({
            singleCredits: current + 1,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        } else {
          // Set subscription plan
          await db.collection('users').doc(uid).set({
            plan,
            stripeCustomerId: session.customer,
            stripeSessionId: session.id,
            planActivatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = PLAN_FROM_PRICE[priceId];
        if (!plan) break;

        // Find user by stripeCustomerId
        const usersSnap = await db.collection('users')
          .where('stripeCustomerId', '==', sub.customer)
          .limit(1).get();

        if (!usersSnap.empty) {
          await usersSnap.docs[0].ref.set({
            plan,
            planStatus: sub.status,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const usersSnap = await db.collection('users')
          .where('stripeCustomerId', '==', sub.customer)
          .limit(1).get();

        if (!usersSnap.empty) {
          await usersSnap.docs[0].ref.set({
            plan: 'free',
            planStatus: 'cancelled',
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const usersSnap = await db.collection('users')
          .where('stripeCustomerId', '==', invoice.customer)
          .limit(1).get();

        if (!usersSnap.empty) {
          await usersSnap.docs[0].ref.set({
            planStatus: 'payment_failed',
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

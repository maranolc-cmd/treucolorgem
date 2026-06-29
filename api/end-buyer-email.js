import { Resend } from 'resend';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

const resend = new Resend(process.env.RESEND_API_KEY);
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });

  let uid;
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Invalid session.' });
  }

  const { certId, buyerEmail } = req.body;
  if (!certId || !buyerEmail) return res.status(400).json({ error: 'certId and buyerEmail required.' });

  // Verifica che il certificato appartenga all'utente
  const snap = await db.collection('certifications')
    .where('id', '==', certId)
    .where('uid', '==', uid)
    .limit(1).get();

  if (snap.empty) return res.status(404).json({ error: 'Certification not found.' });

  const certDoc = snap.docs[0];
  const certData = certDoc.data();

  // Genera codice 6 cifre
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 giorni

  // Salva codice su Firestore
  await certDoc.ref.set({
    buyerEmail,
    buyerVerifyCode: code,
    buyerVerifyCodeExpiresAt: expiresAt,
  }, { merge: true });

  // Manda email
  const verifyUrl = `https://www.liveproof.ai/verify/${certId}`;
  const itemName = certData.gemName || certData.name || 'item';

  await resend.emails.send({
    from: 'LiveProof <noreply@liveproof.ai>',
    to: buyerEmail,
    subject: `Verify your purchase — ${itemName} (${certId})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#080808;color:#f5f0e8;padding:32px;border-radius:8px">
        <div style="font-size:22px;color:#c9a84c;letter-spacing:2px;margin-bottom:8px">LiveProof</div>
        <div style="font-size:13px;color:#777;margin-bottom:24px">Buyer Verification</div>
        <p style="font-size:14px;line-height:1.7">You received <strong>${itemName}</strong> from a seller who used LiveProof to certify their listing photo.</p>
        <p style="font-size:14px;line-height:1.7">To confirm that the item matches the certified photo, visit the certificate page and enter your verification code:</p>
        <div style="background:#1a1a1a;border:1px solid #c9a84c;border-radius:6px;padding:20px;text-align:center;margin:24px 0">
          <div style="font-size:32px;letter-spacing:8px;color:#c9a84c;font-weight:bold">${code}</div>
          <div style="font-size:11px;color:#777;margin-top:8px">Valid for 7 days</div>
        </div>
        <a href="${verifyUrl}" style="display:block;background:#c9a84c;color:#000;text-align:center;padding:14px;border-radius:4px;text-decoration:none;font-weight:bold;letter-spacing:1px;font-size:12px">VIEW CERTIFICATE</a>
        <p style="font-size:11px;color:#555;margin-top:24px;line-height:1.6">Certificate ID: ${certId}<br>If you did not purchase this item, ignore this email.</p>
      </div>
    `
  });

  return res.status(200).json({ success: true });
}

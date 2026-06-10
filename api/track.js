// api/track.js  —  JARVIS Telegram access alert
// V4.3.2  —  Full rewrite: proper async, no parse_mode, real error logging

export default async function handler(req, res) {

  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── ENV VARS ──
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[track] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in Vercel env');
    return res.status(500).json({ ok: false, error: 'Missing Telegram env vars' });
  }

  // ── CLIENT INFO ──
  const ip = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'Unknown'
  );

  const ua      = (req.headers['user-agent'] || 'Unknown').slice(0, 200);
  const referer = req.headers['referer'] || 'Direct';
  const time    = new Date().toLocaleString('en-NG', {
    timeZone:  'Africa/Lagos',
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  // ── OPTIONAL BODY FIELDS (sent by frontend) ──
  let locationLine = '';
  try {
    if (req.body) {
      const { city, country, lat, lon } = req.body;
      if (city || country) locationLine = `\n📍 Location : ${city || ''}${country ? ', ' + country : ''}`;
      if (lat && lon)      locationLine += ` (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`;
    }
  } catch {}

  // ── BUILD MESSAGE — plain text only, zero parse_mode ──
  // Any Markdown/HTML special char in parse_mode causes silent Telegram rejection.
  const message = [
    '🔓 JARVIS ACCESS ALERT',
    '─────────────────────',
    `🕐 Time      : ${time}`,
    `🌐 IP        : ${ip}`,
    locationLine,
    `📱 User-Agent: ${ua}`,
    `🔗 Referer   : ${referer}`,
    '─────────────────────',
    'System: ONLINE | AES-256 ACTIVE'
  ].filter(Boolean).join('\n');

  // ── SEND TO TELEGRAM ──
  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text:    message
          // NO parse_mode — intentionally omitted
        })
      }
    );

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      // Print full Telegram error in Vercel function logs
      console.error('[track] Telegram rejected message:', JSON.stringify(tgData));
      return res.status(502).json({
        ok:    false,
        error: tgData.description || 'Telegram API error',
        code:  tgData.error_code
      });
    }

    console.log('[track] Alert sent. Message ID:', tgData.result?.message_id);
    return res.status(200).json({ ok: true, message_id: tgData.result?.message_id });

  } catch (err) {
    console.error('[track] Network/fetch error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
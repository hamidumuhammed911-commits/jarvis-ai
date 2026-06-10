// api/track.js  —  JARVIS access alert → Telegram
// V4.3.2 fix: proper async handling, error logging, no parse_mode issues

export default async function handler(req, res) {
  // Allow OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  // Guard: env vars must exist
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[track] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({ ok: false, error: 'Telegram env vars not set' });
  }

  // Build info from request
  const ip      = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
               || req.headers['x-real-ip']
               || req.socket?.remoteAddress
               || 'Unknown';

  const ua      = req.headers['user-agent'] || 'Unknown';
  const referer = req.headers['referer']    || 'Direct';
  const time    = new Date().toLocaleString('en-US', {
    timeZone:     'Africa/Lagos',
    dateStyle:    'medium',
    timeStyle:    'short'
  });

  // Extra body fields (if client POSTs location etc.)
  let extra = '';
  if (req.method === 'POST' && req.body) {
    const { city, country, lat, lon } = req.body;
    if (city)    extra += `\nCity: ${city}`;
    if (country) extra += ` (${country})`;
    if (lat && lon) extra += `\nCoords: ${lat}, ${lon}`;
  }

  // Plain text message — NO parse_mode so special chars never break it
  const message =
    `JARVIS ACCESS ALERT\n` +
    `Time: ${time}\n` +
    `IP: ${ip}` +
    extra +
    `\nUA: ${ua.slice(0, 120)}\n` +
    `Referer: ${referer}`;

  const telegramUrl =
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const tgRes = await fetch(telegramUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text:    message
        // deliberately NO parse_mode — avoids silent failures from special chars
      })
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      // Log the real Telegram error in Vercel function logs
      console.error('[track] Telegram API error:', JSON.stringify(tgData));
      return res.status(502).json({ ok: false, telegram_error: tgData.description });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[track] fetch error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
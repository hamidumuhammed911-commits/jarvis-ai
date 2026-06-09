export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Telegram env vars not set' });
  }

  try {
    const body = req.body || {};
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'Unknown';
    const now = new Date().toUTCString();
    const ua = req.headers['user-agent'] || 'Unknown';
    const device = ua.includes('Android') ? 'Android' : ua.includes('iPhone') ? 'iPhone' : ua.includes('Windows') ? 'Windows' : 'Unknown';
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Unknown';
    const location = body.location || 'Not provided';
    const event = body.event || 'PAGE_OPEN';

    const message = `JARVIS ACCESS ALERT\n\nTime: ${now}\nEvent: ${event}\nDevice: ${device} / ${browser}\nIP: ${ip}\nLocation: ${location}\n\nStark Industries - Restricted Access Log`;

    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
        }),
      }
    );

    const tgData = await tgRes.json();
    if (!tgData.ok) throw new Error(tgData.description);
    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
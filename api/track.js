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
    const now = new Date();
    const timeStr = now.toUTCString();
    const ua = req.headers['user-agent'] || 'Unknown';
    const device = ua.includes('Android') ? '📱 Android'
                 : ua.includes('iPhone')  ? '📱 iPhone'
                 : ua.includes('Windows') ? '💻 Windows'
                 : ua.includes('Mac')     ? '💻 Mac'
                 : '🖥 Unknown Device';
    const browser = ua.includes('Chrome')  ? 'Chrome'
                  : ua.includes('Firefox') ? 'Firefox'
                  : ua.includes('Safari')  ? 'Safari'
                  : 'Unknown Browser';
    const location = body.location || 'Not provided';
    const event    = body.event    || 'PAGE_OPEN';
    const eventEmoji = {
      PAGE_OPEN:    '🟢',
      PASSCODE_OK:  '🔓',
      PASSCODE_FAIL:'🔴',
      VOICE_START:  '🎙',
      MESSAGE_SENT: '💬',
    }[event] || '📡';

    const message = `${eventEmoji} *JARVIS ACCESS ALERT*\n\n`
      + `📅 *Time:* ${timeStr}\n`
      + `🌐 *Event:* ${event}\n`
      + `${device} / ${browser}\n`
      + `🔌 *IP:* \`${ip}\`\n`
      + `📍 *Location:* ${location}\n`
      + `\n_Stark Industries — Restricted Access Log_`;

    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    CHAT_ID,
          text:       message,
          parse_mode: 'Markdown',
        }),
      }
    );

    const tgData = await tgRes.json();
    if (!tgData.ok) throw new Error(tgData.description);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[JARVIS track]', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
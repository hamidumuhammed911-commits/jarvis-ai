export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;

  try {
    const body = await req.json().catch(() => ({}));

    // ── Get IP ──────────────────────────────────────────
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'Unknown';

    // ── Get User Agent info ─────────────────────────────
    const ua = req.headers['user-agent'] || 'Unknown';
    const device = parseUA(ua);

    // ── Get Referrer ────────────────────────────────────
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';

    // ── Get IP Geolocation ──────────────────────────────
    let location = 'Unknown';
    let isp      = 'Unknown';
    let country  = body.country || '';
    let city     = body.city    || '';
    let lat      = body.lat     || null;
    let lon      = body.lon     || null;
    let botScore = 10;

    try {
      const geo = await fetch(`https://ip-api.com/json/${ip}?fields=city,regionName,country,isp,org,mobile,proxy,hosting,lat,lon,query`);
      const gj  = await geo.json();
      if (gj.city)    city    = gj.city;
      if (gj.country) country = gj.country;
      if (gj.lat)     lat     = gj.lat;
      if (gj.lon)     lon     = gj.lon;
      location = `${gj.city || '?'}, ${gj.regionName || '?'}, ${gj.country || '?'}`;
      isp      = gj.isp || gj.org || 'Unknown';
      const isProxy   = gj.proxy   ? 40 : 0;
      const isHosting = gj.hosting ? 30 : 0;
      const isMobile  = gj.mobile  ? -10 : 0;
      botScore = Math.min(100, Math.max(0, 10 + isProxy + isHosting + isMobile));
    } catch {}

    // ── Risk Level ──────────────────────────────────────
    const risk = botScore >= 70 ? '🔴 HIGH' : botScore >= 40 ? '🟡 MEDIUM' : '🟢 LOW';

    // ── Coordinates & Maps Link ─────────────────────────
    const coordsLine = lat && lon
      ? `🗺️ *Coords*     : ${parseFloat(lat).toFixed(4)}° N, ${parseFloat(lon).toFixed(4)}° E`
      : `🗺️ *Coords*     : Unavailable`;

    const mapsLine = lat && lon
      ? `🔗 *Maps*       : [Open in Google Maps](https://maps.google.com/?q=${lat},${lon})`
      : `🔗 *Maps*       : Unavailable`;

    // ── Time ────────────────────────────────────────────
    const now = new Date().toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    // ── Build Telegram Message ──────────────────────────
    const msg = [
      `🛡️ *JARVIS SECURITY MONITOR*`,
      `─────────────────────────`,
      `🕐 *Time*       : ${now}`,
      `🌐 *IP*         : \`${ip}\``,
      `📱 *Device*     : ${device}`,
      `🔗 *Referrer*   : ${referrer}`,
      ``,
      `📍 *Location*   : ${location}`,
      coordsLine,
      mapsLine,
      `🏢 *ISP*        : ${isp}`,
      `🧠 *Bot Score*  : ${botScore}/100 (${botScore < 30 ? 'Likely Human' : botScore < 60 ? 'Uncertain' : 'Likely Bot'})`,
      `⚠️ *Risk Level* : ${risk}`,
      `─────────────────────────`,
      `✅ *STATUS: ALLOWED ACCESS*`,
    ].join('\n');

    // ── Send to Telegram ────────────────────────────────
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: msg,
        parse_mode: 'Markdown'
      })
    });

    res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[track] error:', err);
    res.status(200).json({ ok: false });
  }
}

// ── Parse User Agent ──────────────────────────────────
function parseUA(ua) {
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';

  if (/Android (\d+)/.test(ua))            os = `Android ${RegExp.$1}`;
  else if (/iPhone OS ([\d_]+)/.test(ua))  os = `iOS ${RegExp.$1.replace(/_/g,'.')}`;
  else if (/Windows NT ([\d.]+)/.test(ua)) {
    const v = {'10.0':'10','6.3':'8.1','6.2':'8','6.1':'7'}[RegExp.$1] || RegExp.$1;
    os = `Windows ${v}`;
  }
  else if (/Mac OS X ([\d_]+)/.test(ua))   os = `macOS ${RegExp.$1.replace(/_/g,'.')}`;
  else if (/Linux/.test(ua))               os = 'Linux';

  if (/Chrome\/([\d]+)/.test(ua) && !/Chromium|Edg|OPR/.test(ua))
    browser = `Chrome ${RegExp.$1}`;
  else if (/Edg\/([\d]+)/.test(ua))        browser = `Edge ${RegExp.$1}`;
  else if (/OPR\/([\d]+)/.test(ua))        browser = `Opera ${RegExp.$1}`;
  else if (/Firefox\/([\d]+)/.test(ua))    browser = `Firefox ${RegExp.$1}`;
  else if (/Safari\/([\d]+)/.test(ua))     browser = `Safari`;

  return `${os} / ${browser}`;
}

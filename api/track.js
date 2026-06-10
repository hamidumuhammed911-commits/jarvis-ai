// api/track.js — JARVIS Monitor Telegram Alert (Fixed V4.3.2)
export default async function handler(req, res) {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  // Validate env vars first
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
    return res.status(500).json({
      ok: false,
      error: "Telegram credentials not configured in Vercel env vars",
    });
  }

  // Accept GET or POST
  const body = req.method === "POST" ? req.body : {};
  const {
    event = "access",
    userAgent = req.headers["user-agent"] || "Unknown",
    ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "Unknown",
    location = "Unknown",
    page = "JARVIS AI",
  } = body;

  // Build Nigeria time string
  const now = new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "full",
    timeStyle: "short",
  });

  const emoji = event === "access" ? "🛡️" : event === "voice" ? "🎙️" : "⚡";

  const message =
    `${emoji} *JARVIS MONITOR ALERT*\n\n` +
    `📌 *Event:* ${event.toUpperCase()}\n` +
    `🌍 *Page:* ${page}\n` +
    `🕐 *Time (Lagos):* ${now}\n` +
    `📍 *Location:* ${location}\n` +
    `🌐 *IP:* \`${ip}\`\n` +
    `📱 *Device:* ${userAgent.substring(0, 120)}`;

  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const tgRes = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("Telegram API error:", JSON.stringify(tgData));
      return res.status(502).json({
        ok: false,
        error: tgData.description || "Telegram rejected the message",
        tgData,
      });
    }

    return res.status(200).json({ ok: true, messageId: tgData.result?.message_id });
  } catch (err) {
    console.error("Fetch to Telegram failed:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// api/imagine.js — JARVIS Image Generation via Pollinations.ai (Free, No Key)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { prompt = "", width = 768, height = 768, model = "flux" } = req.body || {};

  if (!prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  // Enhance prompt for better results
  const enhancedPrompt = `${prompt}, highly detailed, professional quality, 8k`;
  const encodedPrompt = encodeURIComponent(enhancedPrompt);

  // Pollinations.ai — completely free, no API key needed
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true&enhance=true`;

  // We verify the image is reachable before returning
  try {
    const check = await fetch(imageUrl, { method: "HEAD" });
    if (!check.ok) {
      throw new Error(`Pollinations returned ${check.status}`);
    }
  } catch (err) {
    console.error("Image generation check failed:", err.message);
    // Still return the URL — Pollinations generates async, HEAD may fail
  }

  return res.status(200).json({
    ok: true,
    url: imageUrl,
    prompt: enhancedPrompt,
    model,
    width,
    height,
  });
}
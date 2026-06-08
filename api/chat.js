// api/chat.js — JARVIS backend with Groq + web search + location

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, location } = req.body;

  // Build location block
  let locationBlock = "";
  if (location && location.lat && location.lon) {
    locationBlock = `
Current location of Boss Muhammed Aali:
  Coordinates : ${location.lat}, ${location.lon}
  City        : ${location.city || "unknown"}
  Country     : ${location.country || "unknown"}
Use this for weather, directions, or local queries. Never repeat coordinates verbatim unless asked.`;
  }

  const systemPrompt = `You are JARVIS, the personal AI assistant of Boss Muhammed Aali.
Rules:
- Address him as "Boss Muhammed Aali" on the very first greeting, then use "Sir" for all subsequent turns.
- Never refer to him in the third person.
- Be concise — maximum 3 sentences unless a list or factual answer genuinely requires more.
- You have access to a web_search tool. Use it automatically whenever the query involves:
  news, weather, scores, stock prices, current events, live data, or anything time-sensitive.
  Do NOT explain that you are searching — just search, then answer naturally.
- For weather queries without an explicit location, use Boss Muhammed Aali's current location below.
- If location is unavailable, ask "Shall I use your current location, Sir?"
${locationBlock}`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 512,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: [
          {
            type: "function",
            function: {
              name: "web_search",
              description:
                "Search the web for real-time info: news, weather, sports scores, stock prices, current events.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query",
                  },
                },
                required: ["query"],
              },
            },
          },
        ],
        tool_choice: "auto",
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Groq error:", data);
      return res.status(500).json({ error: data.error?.message || "Groq API error" });
    }

    const choice = data.choices?.[0];

    // Handle tool call — web search
    if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const { query } = JSON.parse(toolCall.function.arguments);

      const searchResult = await performWebSearch(query);

      const followUp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 512,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
            choice.message,
            {
              role: "tool",
              tool_call_id: toolCall.id,
              content: searchResult,
            },
          ],
        }),
      });

      const followData = await followUp.json();
      const finalText = followData.choices?.[0]?.message?.content || "I couldn't retrieve that, Sir.";
      return res.status(200).json({ reply: finalText });
    }

    // Normal response
    const reply = choice?.message?.content || "I didn't catch that, Sir.";
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Web search — supports Serper (recommended), SerpAPI, or Brave
async function performWebSearch(query) {
  try {
    // OPTION A: Serper.dev — set SERPER_KEY in Vercel env vars (2500 free/month)
    if (process.env.SERPER_KEY) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      const d = await r.json();
      const snippets = [
        ...(d.answerBox
          ? [`${d.answerBox.title || ""}: ${d.answerBox.answer || d.answerBox.snippet || ""}`]
          : []),
        ...(d.organic?.slice(0, 4).map((x) => `${x.title}: ${x.snippet}`) || []),
      ].join("\n");
      return snippets || "No results found.";
    }

    // OPTION B: SerpAPI — set SERPAPI_KEY in Vercel env vars (100 free/month)
    if (process.env.SERPAPI_KEY) {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=5&api_key=${process.env.SERPAPI_KEY}`;
      const r = await fetch(url);
      const d = await r.json();
      const snippets = [
        ...(d.answer_box ? [`Answer: ${d.answer_box.answer || d.answer_box.snippet}`] : []),
        ...(d.organic_results?.slice(0, 4).map((x) => `${x.title}: ${x.snippet}`) || []),
      ].join("\n");
      return snippets || "No results found.";
    }

    // OPTION C: Brave Search — set BRAVE_SEARCH_KEY in Vercel env vars (2000 free/day)
    if (process.env.BRAVE_SEARCH_KEY) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
      const r = await fetch(url, {
        headers: {
          "X-Subscription-Token": process.env.BRAVE_SEARCH_KEY,
          Accept: "application/json",
        },
      });
      const d = await r.json();
      const snippets = d.web?.results
        ?.slice(0, 4)
        .map((x) => `${x.title}: ${x.description}`)
        .join("\n");
      return snippets || "No results found.";
    }

    return "Web search not configured. Add SERPER_KEY, SERPAPI_KEY, or BRAVE_SEARCH_KEY to Vercel environment variables.";
  } catch (e) {
    console.error("Search error:", e);
    return "Search temporarily unavailable.";
  }
}
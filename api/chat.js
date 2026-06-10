// api/chat.js - JARVIS V4.4.0
// Features: Groq LLM + Tool Calling (Search/News) + Redis Memory + Weather/Time + Offline Queue Sync

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, lat, lon, userId = 'anonymous', pendingQueue = [] } = req.body;

    if (!message && pendingQueue.length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Process pending queue if coming from offline sync
    let fullMessage = message;
    if (pendingQueue.length > 0) {
      fullMessage = `[SYNCING ${pendingQueue.length} OFFLINE MESSAGES]\n` + 
                    pendingQueue.map((m, i) => `${i+1}. ${m}`).join('\n') + 
                    `\n\nCurrent message: ${message}`;
    }

    // 1. Get location & weather
    let location = 'Nigeria';
    let weather = 'unknown';
    
    if (lat && lon) {
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
        const geoData = await geoRes.json();
        location = geoData.address?.city || geoData.address?.town || geoData.address?.state || 'Nigeria';
        
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const weatherData = await weatherRes.json();
        if (weatherData.current_weather) {
          const temp = weatherData.current_weather.temperature;
          const wind = weatherData.current_weather.windspeed;
          weather = `${temp}°C, wind ${wind} km/h`;
        }
      } catch (err) {
        console.error('Weather/location error:', err);
      }
    }

    // 2. Get current Nigeria time
    const nigeriaTime = new Date().toLocaleString('en-NG', { 
      timeZone: 'Africa/Lagos',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // 3. Memory retrieval (last 5 exchanges summary)
    const memoryKey = `memory:${userId}`;
    let userMemory = await redis.get(memoryKey);
    let conversationSummary = userMemory ? `Previous context: ${userMemory}` : 'New user, no prior context.';
    
    // Also get last 3 raw messages for continuity
    const historyKey = `history:${userId}`;
    let recentHistory = await redis.lrange(historyKey, 0, 2);
    
    // 4. Tool definitions for LLM
    const tools = {
      search: async (query) => {
        try {
          const serperRes = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
              'X-API-KEY': process.env.SERPER_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ q: query, num: 3 })
          });
          const data = await serperRes.json();
          const organic = data.organic || [];
          return organic.map(r => `• ${r.title}: ${r.snippet} (${r.link})`).join('\n');
        } catch (err) {
          return `Search failed: ${err.message}`;
        }
      },
      
      news: async (category = 'general') => {
        try {
          const topics = { general: 'top-news', tech: 'technology', business: 'business' };
          const serperRes = await fetch('https://google.serper.dev/news', {
            method: 'POST',
            headers: {
              'X-API-KEY': process.env.SERPER_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ q: topics[category] || category, num: 5 })
          });
          const data = await serperRes.json();
          const newsItems = data.news || [];
          return newsItems.map(n => `• ${n.title} - ${n.source} (${n.link})`).slice(0, 5).join('\n');
        } catch (err) {
          return `News fetch failed: ${err.message}`;
        }
      }
    };

    // 5. System prompt with memory injection
    const systemPrompt = `You are JARVIS, Tony Stark's AI assistant. You address the user as "Sir" or "Boss Muhammed Aali" with respect.

Current context:
- User location: ${location}
- Weather: ${weather}
- Nigeria time: ${nigeriaTime}
- ${conversationSummary}
- Recent messages: ${recentHistory.join(' | ') || 'None'}

You have REAL-TIME TOOLS available:
- If user asks for current information, weather, sports scores, stocks, or unknown facts → USE search(query) in your response.
- If user asks for news or headlines → USE news(category) where category is: general, tech, business.
- For calculations, file operations, or general conversation → respond directly.

CRITICAL RULES:
1. When using a tool, output EXACTLY: search('your query here') or news('category')
2. After receiving tool results, you MUST incorporate them naturally into your response.
3. Keep responses concise (2-3 sentences max unless asked for details).
4. Use female voice tone (warm, efficient, slightly formal).
5. If user asks about their own preferences/facts, recall from memory context above.

Respond directly to the user: ${fullMessage}`;

    // 6. First LLM call to detect tool usage
    let llmResponse = await callGroq(systemPrompt, fullMessage);
    
    // 7. Tool execution loop (max 2 iterations)
    let maxIterations = 2;
    let iteration = 0;
    let finalResponse = llmResponse;
    
    while (iteration < maxIterations) {
      const searchMatch = finalResponse.match(/search\(['"]([^'"]+)['"]\)/);
      const newsMatch = finalResponse.match(/news\(['"]([^'"]+)['"]\)/);
      
      if (!searchMatch && !newsMatch) break;
      
      let toolResult = '';
      if (searchMatch) {
        const query = searchMatch[1];
        toolResult = await tools.search(query);
        finalResponse = finalResponse.replace(/search\(['"][^'"]+['"]\)/, `[SEARCH RESULTS]\n${toolResult}`);
      } else if (newsMatch) {
        const category = newsMatch[1];
        toolResult = await tools.news(category);
        finalResponse = finalResponse.replace(/news\(['"][^'"]+['"]\)/, `[NEWS RESULTS]\n${toolResult}`);
      }
      
      // Second LLM call to incorporate tool results
      const secondPrompt = `${systemPrompt}\n\nYou just received tool results:\n${toolResult}\n\nNow provide your final natural response to: "${fullMessage}"`;
      finalResponse = await callGroq(secondPrompt, fullMessage);
      iteration++;
    }
    
    // 8. Update memory (store summary every 5 interactions)
    const interactionCountKey = `count:${userId}`;
    let interactionCount = parseInt(await redis.get(interactionCountKey) || '0');
    interactionCount++;
    await redis.set(interactionCountKey, interactionCount.toString());
    
    // Store raw message in history (keep last 5)
    await redis.lpush(historyKey, `User: ${fullMessage}\nJARVIS: ${finalResponse}`);
    await redis.ltrim(historyKey, 0, 4);
    
    // Every 5 interactions, compress to summary
    if (interactionCount % 5 === 0) {
      const lastConversations = await redis.lrange(historyKey, 0, 4);
      const summaryPrompt = `Summarize key facts about the user from this conversation history (keep under 100 words):\n${lastConversations.join('\n')}`;
      const summary = await callGroq(summaryPrompt, 'Summarize the key facts about this user');
      await redis.set(memoryKey, summary);
    } else if (!userMemory) {
      // Initialize memory after first interaction
      const firstSummary = `User is known as Boss Muhammed Aali. First interaction: ${fullMessage.substring(0, 100)}...`;
      await redis.set(memoryKey, firstSummary);
    }
    
    // 9. Return response with queue sync acknowledgment
    res.status(200).json({ 
      response: finalResponse,
      synced: pendingQueue.length > 0 ? `${pendingQueue.length} offline messages synced` : null,
      memoryUpdated: interactionCount % 5 === 0
    });
    
  } catch (error) {
    console.error('JARVIS API Error:', error);
    res.status(500).json({ 
      response: "Systems are nominal but I encountered an issue, Sir. Check your network and try again.",
      error: error.message 
    });
  }
}

// Helper: Call Groq API
async function callGroq(systemPrompt, userMessage) {
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });
  
  const data = await groqRes.json();
  if (!groqRes.ok) throw new Error(data.error?.message || 'Groq API failed');
  
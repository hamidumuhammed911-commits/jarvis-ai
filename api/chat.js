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
// api/chat.js - JARVIS V5.0.0
// Features: Groq LLM + Tool Calling + Redis Memory + Weather/Time + Offline Queue + Rate Limiting + Streaming

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const redis = Redis.fromEnv();

// Rate limiter: 30 requests per minute per user
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '60 s'),
});

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      message, 
      lat, 
      lon, 
      userId = 'anonymous', 
      pendingQueue = [],
      stream = false,
      conversationId = null
    } = req.body;

    if (!message && pendingQueue.length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Rate limiting
    const { success, limit, reset, remaining } = await ratelimit.limit(userId);
    if (!success) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        limit,
        reset,
        remaining 
      });
    }

    // Streaming support
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    // Process pending queue from offline sync
    let fullMessage = message;
    let syncNote = '';
    if (pendingQueue.length > 0) {
      syncNote = `[SYNCED ${pendingQueue.length} OFFLINE MESSAGES]\n`;
      fullMessage = syncNote + 
                    pendingQueue.map((m, i) => `${i+1}. ${m}`).join('\n') + 
                    `\n\nCurrent: ${message}`;
    }

    // 1. Enhanced location & weather
    let locationData = await getLocationAndWeather(lat, lon);
    
    // 2. Time context
    const timeData = getTimeContext();
    
    // 3. Memory retrieval (with TTL)
    const memoryKey = `memory:${userId}`;
    const historyKey = `history:${userId}:${conversationId || 'default'}`;
    const userMemory = await redis.get(memoryKey);
    const recentHistory = await redis.lrange(historyKey, 0, 5);
    const userPreferences = await redis.hgetall(`prefs:${userId}`);
    
    // 4. Enhanced tool definitions
    const tools = {
      search: async (query, options = {}) => {
        try {
          const serperRes = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
              'X-API-KEY': process.env.SERPER_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              q: query, 
              num: options.num || 5,
              gl: options.country || 'ng',
              hl: options.lang || 'en'
            })
          });
          const data = await serperRes.json();
          const organic = data.organic || [];
          const knowledgeGraph = data.knowledgeGraph;
          
          let result = '';
          if (knowledgeGraph?.description) {
            result += `📚 ${knowledgeGraph.description}\n\n`;
          }
          result += organic.map((r, i) => `${i+1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.link}`).join('\n\n');
          return result || 'No results found.';
        } catch (err) {
          return `🔍 Search failed: ${err.message}`;
        }
      },
      
      news: async (category = 'general', region = 'ng') => {
        try {
          const categories = {
            general: 'top-news',
            tech: 'technology',
            business: 'business',
            sports: 'sports',
            entertainment: 'entertainment',
            health: 'health'
          };
          
          const query = categories[category] || category;
          const serperRes = await fetch('https://google.serper.dev/news', {
            method: 'POST',
            headers: {
              'X-API-KEY': process.env.SERPER_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              q: `${query} ${region === 'ng' ? 'Nigeria' : ''}`,
              num: 7,
              gl: region
            })
          });
          const data = await serperRes.json();
          const newsItems = data.news || [];
          
          return newsItems.slice(0, 7).map((n, i) => {
            const date = n.date ? new Date(n.date).toLocaleTimeString() : '';
            return `${i+1}. 📰 **${n.title}**\n   📍 ${n.source} ${date ? `🕐 ${date}` : ''}\n   🔗 ${n.link}`;
          }).join('\n\n');
        } catch (err) {
          return `📰 News fetch failed: ${err.message}`;
        }
      },
      
      calculate: async (expression) => {
        try {
          // Safe evaluation with math.js or basic eval for simple ops
          const math = await import('mathjs');
          const result = math.evaluate(expression);
          return `🧮 Result: ${expression} = ${result}`;
        } catch {
          return `❌ Could not calculate: ${expression}`;
        }
      },
      
      getTimeIn: async (city, timezone) => {
        try {
          const time = new Date().toLocaleString('en-US', {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          return `🕐 Current time in ${city}: ${time}`;
        } catch {
          return `❌ Could not get time for ${city}`;
        }
      },
      
      remember: async (key, value) => {
        await redis.hset(`user:${userId}:facts`, { [key]: value });
        return `✅ I'll remember that ${key}: ${value}`;
      },
      
      recall: async (key) => {
        const value = await redis.hget(`user:${userId}:facts`, key);
        return value ? `📝 You told me ${key}: ${value}` : `❌ I don't recall any ${key}`;
      }
    };

    // 5. Enhanced system prompt
    const systemPrompt = `You are JARVIS, Tony Stark's sophisticated AI assistant. You address the user as "Sir" with warm respect.

📍 **CONTEXT**
- User: ${userId === 'anonymous' ? 'New session' : 'Known user'}
- Location: ${locationData.location}
- Weather: ${locationData.weather}
- Time (Nigeria): ${timeData.nigeria}
- Time (UTC): ${timeData.utc}
- Day status: ${timeData.dayStatus}

💾 **MEMORY**
${userMemory ? `Previous context: ${userMemory}` : 'No prior memory (new user)'}
${recentHistory.length ? `Recent messages: ${recentHistory.join(' | ')}` : ''}
${userPreferences ? `User preferences: ${JSON.stringify(userPreferences)}` : ''}

⚙️ **CAPABILITIES**
You have REAL-TIME tools. When needed, output EXACTLY:
- search('query', {num:3, country:'ng'})
- news('category', 'region')
- calculate('2+2')
- getTimeIn('Lagos', 'Africa/Lagos')
- remember('key', 'value')
- recall('key')

🎯 **PERSONALITY RULES**
1. Tool-first: Always verify facts via search if uncertain
2. Concise but warm: 2-3 sentences, occasionally 4 if valuable info
3. Female voice: Elegant, efficient, slightly playful with "Sir"
4. Culturally aware: Reference Nigerian culture when relevant
5. Proactive: Offer help before being asked
6. Memory-driven: Use recall() for user's past requests
7. Emoji use: 🎯 🤖 ✨ 🔍 📰 ☁️ (sparingly, 1-2 per response)

${syncNote ? `⚠️ ${syncNote}` : ''}

Respond to the user naturally: "${fullMessage}"`;

    // 6. Streaming or standard response
    let finalResponse;
    
    if (stream) {
      finalResponse = await handleStreaming(systemPrompt, fullMessage, tools, res);
    } else {
      finalResponse = await handleStandardResponse(systemPrompt, fullMessage, tools);
    }
    
    // 7. Update memory systems
    const interactionCountKey = `count:${userId}`;
    let interactionCount = parseInt(await redis.get(interactionCountKey) || '0');
    interactionCount++;
    await redis.set(interactionCountKey, interactionCount.toString());
    
    // Store in history with metadata
    await redis.lpush(historyKey, JSON.stringify({
      user: fullMessage,
      assistant: finalResponse,
      timestamp: Date.now(),
      location: locationData.location,
      weather: locationData.weather
    }));
    await redis.ltrim(historyKey, 0, 9); // Keep last 10
    
    // Smart memory compression (every 3 interactions for active users)
    if (interactionCount % 3 === 0 && interactionCount > 0) {
      await compressMemory(userId, historyKey, memoryKey);
    } else if (!userMemory) {
      await redis.set(memoryKey, `Boss Muhammed Aali. Started at ${timeData.nigeria}. First interest: ${fullMessage.substring(0, 80)}...`);
    }
    
    // 8. Track analytics
    await redis.hincrby(`analytics:${userId}`, 'total_interactions', 1);
    await redis.hincrby(`analytics:${userId}`, `topic_${detectTopic(fullMessage)}`, 1);
    
    // 9. Return response
    const response = {
      response: finalResponse,
      synced: pendingQueue.length > 0 ? `${pendingQueue.length} messages synced` : null,
      memoryUpdated: interactionCount % 3 === 0,
      rateLimit: { limit, remaining, reset },
      conversationId: conversationId || `conv_${Date.now()}`,
      timestamp: Date.now()
    };
    
    if (!stream) {
      res.status(200).json(response);
    } else {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
    
  } catch (error) {
    console.error('JARVIS API Error:', error);
    const errorResponse = {
      response: "Systems nominal but I've encountered an anomaly, Sir. Check your connection and try again.",
      error: error.message,
      fallback: true
    };
    
    if (req.body?.stream) {
      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      res.end();
    } else {
      res.status(500).json(errorResponse);
    }
  }
}

// ============= HELPER FUNCTIONS =============

async function getLocationAndWeather(lat, lon) {
  let location = 'Nigeria';
  let weather = 'Unknown';
  
  if (lat && lon) {
    try {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`);
      const geoData = await geoRes.json();
      
      const city = geoData.address?.city || geoData.address?.town;
      const state = geoData.address?.state;
      const country = geoData.address?.country;
      
      location = [city, state, country].filter(Boolean).join(', ') || 'Nigeria';
      
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,relative_humidity_2m`);
      const weatherData = await weatherRes.json();
      
      if (weatherData.current_weather) {
        const temp = weatherData.current_weather.temperature;
        const wind = weatherData.current_weather.windspeed;
        const condition = getWeatherCondition(temp, weatherData.current_weather.weathercode);
        weather = `${condition}, ${temp}°C, 💨 ${wind} km/h`;
      }
    } catch (err) {
      console.error('Weather/location error:', err);
    }
  }
  
  return { location, weather };
}

function getTimeContext() {
  const nigeria = new Date().toLocaleString('en-NG', { 
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  
  const utc = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const hour = new Date().getHours();
  
  let dayStatus = '🌞 Day';
  if (hour < 6) dayStatus = '🌙 Late night';
  else if (hour < 12) dayStatus = '🌅 Morning';
  else if (hour < 18) dayStatus = '☀️ Afternoon';
  else dayStatus = '🌆 Evening';
  
  return { nigeria, utc, dayStatus };
}

function getWeatherCondition(temp, code) {
  if (code === 0) return '☀️ Clear sky';
  if (code < 30) return '⛅ Partly cloudy';
  if (code < 50) return '🌫️ Foggy';
  if (code < 70) return '🌧️ Rainy';
  return '⛈️ Stormy';
}

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
      max_tokens: 500,
      top_p: 0.9
    })
  });
  
  const data = await grogRes.json();
  if (!groqRes.ok) throw new Error(data.error?.message || 'Groq API failed');
  return data.choices[0].message.content;
}

async function handleStandardResponse(systemPrompt, userMessage, tools) {
  let llmResponse = await callGroq(systemPrompt, userMessage);
  
  // Tool execution loop
  let maxIterations = 3;
  let iteration = 0;
  let currentResponse = llmResponse;
  
  while (iteration < maxIterations) {
    const searchMatch = currentResponse.match(/search\(['"]([^'"]+)['"]\)/);
    const newsMatch = currentResponse.match(/news\(['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?\)/);
    const calcMatch = currentResponse.match(/calculate\(['"]([^'"]+)['"]\)/);
    const timeMatch = currentResponse.match(/getTimeIn\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
    
    let toolResult = '';
    
    if (searchMatch) {
      toolResult = await tools.search(searchMatch[1]);
      currentResponse = currentResponse.replace(/search\(['"][^'"]+['"]\)/, `\n\n${toolResult}`);
    } else if (newsMatch) {
      const category = newsMatch[1];
      const region = newsMatch[2] || 'ng';
      toolResult = await tools.news(category, region);
      currentResponse = currentResponse.replace(/news\([^)]+\)/, `\n\n${toolResult}`);
    } else if (calcMatch) {
      toolResult = await tools.calculate(calcMatch[1]);
      currentResponse = currentResponse.replace(/calculate\([^)]+\)/, toolResult);
    } else if (timeMatch) {
      toolResult = await tools.getTimeIn(timeMatch[1], timeMatch[2]);
      currentResponse = currentResponse.replace(/getTimeIn\([^)]+\)/, toolResult);
    } else {
      break;
    }
    
    // Refine response with tool results
    const refinePrompt = `${systemPrompt}\n\nTool returned:\n${toolResult}\n\nNow provide your final natural response.`;
    currentResponse = await callGroq(refinePrompt, userMessage);
    iteration++;
  }
  
  return currentResponse;
}

async function handleStreaming(systemPrompt, userMessage, tools, res) {
  // Simplified streaming - for production, implement proper SSE with Groq streaming
  const response = await callGroq(systemPrompt, userMessage);
  
  // Stream character by character (or word by word for efficiency)
  const words = response.split(' ');
  for (let i = 0; i < words.length; i++) {
    res.write(`data: ${JSON.stringify({ token: words[i] + (i < words.length - 1 ? ' ' : '') })}\n\n`);
    await new Promise(resolve => setTimeout(resolve, 30)); // Simulate typing
  }
  
  return response;
}

async function compressMemory(userId, historyKey, memoryKey) {
  try {
    const history = await redis.lrange(historyKey, 0, 9);
    const conversations = history.map(item => {
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;
        return `User: ${parsed.user}\nJARVIS: ${parsed.assistant}`;
      } catch {
        return item;
      }
    }).join('\n\n');
    
    const summaryPrompt = `Extract key facts, preferences, and recurring topics about the user from this conversation. Keep under 150 words. Be specific:\n${conversations}`;
    const summary = await callGroq(summaryPrompt, 'Summarize key user information');
    
    await redis.set(memoryKey, summary);
    await redis.expire(memoryKey, 604800); // 7 days TTL
  } catch (err) {
    console.error('Memory compression failed:', err);
  }
}

function detectTopic(message) {
  const topics = {
    tech: ['code', 'programming', 'ai', 'api', 'javascript', 'python'],
    business: ['business', 'startup', 'money', 'investment', 'stock'],
    weather: ['weather', 'rain', 'temperature', 'sunny'],
    news: ['news', 'headline', 'current events', 'happening'],
    personal: ['my', 'i feel', 'i think', 'remember'],
    entertainment: ['movie', 'music', 'song', 'artist']
  };
  
  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some(kw => message.toLowerCase().includes(kw))) {
      return topic;
    }
  }
  return 'general';
}
  
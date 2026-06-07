// api/chat.js — JARVIS backend v2
// Features: Groq tool-calling (web search), location injection,
//           WhatsApp intent token, Tasker app-switch token

export const config = { runtime: 'edge' };

const GROQ_API   = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL      = 'llama-3.3-70b-versatile';
const GROQ_KEY   = process.env.GROQ_API_KEY;

// ── Groq tool definitions ────────────────────────────────────────────────────
const TOOLS = [
{
type: 'function',
function: {
name: 'web_search',
description:
'Search the web for real-time information: news, weather, sports scores, ' +
'stock prices, or any current data. Call this whenever the user asks about ' +
'something that may have changed recently.',
parameters: {
type: 'object',
properties: {
query: {
type: 'string',
description: 'The search query to look up.',
},
},
required: ['query'],
},
},
},
];

// ── Lightweight web-search via DuckDuckGo Instant Answer API ────────────────
async function runWebSearch(query) {
try {
const url =
`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

const r = await fetch(url, { headers: { 'User-Agent': 'JARVIS-AI/2.0' } });
const d = await r.json();

const parts = [];

if (d.AbstractText) parts.push(d.AbstractText);
if (d.Answer) parts.push(`Answer: ${d.Answer}`);

(d.RelatedTopics || []).slice(0, 4).forEach(t => {
if (t.Text) parts.push(t.Text);
});

if (d.Infobox?.content) {
d.Infobox.content.slice(0, 4).forEach(c => {
if (c.label && c.value) parts.push(`${c.label}: ${c.value}`);
});
}

return parts.length
? parts.join('\n')
: `No instant result found for "${query}". Summarise based on general knowledge.`;

} catch (e) {
return `Search error: ${e.message}`;
}
}

// ── Agentic loop: call Groq, handle tool calls, re-call until text reply ─────
async function groqWithTools(messages, systemPrompt) {
const maxIterations = 4;

const msgsForGroq = [
{ role: 'system', content: systemPrompt },
...messages,
];

for (let i = 0; i < maxIterations; i++) {
const resp = await fetch(GROQ_API, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
Authorization: `Bearer ${GROQ_KEY}`,
},
body: JSON.stringify({
model: MODEL,
messages: msgsForGroq,
tools: TOOLS,
tool_choice: 'auto',
max_tokens: 400,
temperature: 0.7,
}),
});

if (!resp.ok) {
const err = await resp.text();
throw new Error(`Groq error ${resp.status}: ${err}`);
}

const data = await resp.json();
const choice = data.choices[0];
const message = choice.message;

// ── Final text reply ──────────────────────────────────────────────
if (choice.finish_reason === 'stop' || message.content) {
return message.content || '';
}

// ── Tool call ─────────────────────────────────────────────────────
if (choice.finish_reason === 'tool_calls' && message.tool_calls?.length) {
msgsForGroq.push(message);

for (const tc of message.tool_calls) {
let result = '';

if (tc.function.name === 'web_search') {
const { query } = JSON.parse(tc.function.arguments);
result = await runWebSearch(query);
}

msgsForGroq.push({
role: 'tool',
tool_call_id: tc.id,
content: result,
});
}

continue;
}

break;
}

return 'I was unable to retrieve that information, Sir.';
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
if (req.method !== 'POST') {
return new Response('Method Not Allowed', { status: 405 });
}

let body;
try {
body = await req.json();
} catch {
return new Response('Bad Request', { status: 400 });
}

const { messages = [], location = null } = body;

// ── UPDATED LOCATION + TIME INJECTION ────────────────────────────────

// Always inject current time
const now = new Date();
const timeStr = now.toLocaleString('en-US', {
weekday: 'long',
year: 'numeric',
month: 'long',
day: 'numeric',
hour: '2-digit',
minute: '2-digit',
timeZone: location?.timezone || 'Asia/Karachi',
});

let locationLine = `\nCurrent date and time: ${timeStr}.`;

if (location?.lat && location?.lon) {
locationLine += ` Boss Muhammed Aali's location: ${location.lat.toFixed(4)}°, ${location.lon.toFixed(4)}° (${location.city || 'location acquired'}). Use for weather, directions, or local queries.`;
}

// ── System Prompt ───────────────────────────────────────────────────
const SYSTEM = `You are JARVIS, a highly intelligent personal AI assistant. You are speaking DIRECTLY to Boss Muhammed Aali — he is the one talking to you right now. Greet him as "Boss Muhammed Aali" on the first message, then use "Sir" after that. Never refer to him in third person. Be precise, helpful, slightly formal but friendly. Keep responses concise — max 3 sentences.${locationLine}

SPECIAL ACTIONS — when the intent clearly matches, embed ONE of these tokens at the very END of your reply:

WhatsApp: [WHATSAPP:+<countrycode><number>:<message text>]
Open App: [OPEN_APP:<app name>]

Never fabricate phone numbers — if you don't know the contact's number, ask.`;

try {
const reply = await groqWithTools(messages, SYSTEM);

return new Response(JSON.stringify({ reply }), {
status: 200,
headers: {
'Content-Type': 'application/json',
'Access-Control-Allow-Origin': '*',
},
});

} catch (e) {
console.error('JARVIS API error:', e);
return new Response(
JSON.stringify({ reply: 'Systems error, Sir. Please try again.' }),
{ status: 500, headers: { 'Content-Type': 'application/json' } }
);
}
}
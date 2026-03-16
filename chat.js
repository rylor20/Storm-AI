// ================================================================
//  Storm AI — chat.js (Smart auto-fix, like Rebirth AI)
//  Uses llama-3.3-70b-versatile with smart context management
// ================================================================
const https  = require("https");
const Pusher = require("pusher");

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID,
  key:     process.env.PUSHER_KEY,
  secret:  process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS:  true,
});

if (typeof global.actionQueues === "undefined") global.actionQueues = {};
if (typeof global.trees        === "undefined") global.trees        = {};
if (typeof global.sources      === "undefined") global.sources      = {};
if (typeof global.errors       === "undefined") global.errors       = {};

// ── Groq API ──────────────────────────────────────────────────
function callGroq(apiKey, messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       "llama-3.3-70b-versatile",
      max_tokens:  3000,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-4),
      ],
    });
    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const p = JSON.parse(data);
          if (p.error) reject(new Error(p.error.message || JSON.stringify(p.error)));
          else resolve(p.choices?.[0]?.message?.content || "");
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Anthropic fallback ────────────────────────────────────────
function callAnthropic(key, messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4096, system,
      messages: messages.slice(-6),
    });
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const p = JSON.parse(data);
          if (p.error) reject(new Error(p.error.message));
          else resolve(p.content?.[0]?.text || "");
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

// ── Smart script finder ───────────────────────────────────────
// Finds relevant scripts based on keywords in the message
function findRelevantScripts(message, sources) {
  if (!sources || Object.keys(sources).length === 0) return {};

  const msgLower = message.toLowerCase();

  // Keywords to search for
  const keywords = msgLower
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter(w => w.length > 3)
    .filter(w => !["this","that","with","from","have","will","your","make","when","then","find","script","scripts","fix","the","and","for","not","are"].includes(w));

  const scored = {};

  for (const [path, source] of Object.entries(sources)) {
    const pathLower = path.toLowerCase();
    const srcLower  = source.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (pathLower.includes(kw)) score += 10; // path match = high score
      if (srcLower.includes(kw))  score += 1;  // source match = lower score
    }

    // Boost scripts in key services
    if (path.startsWith("ServerScriptService")) score += 5;
    if (path.startsWith("StarterGui"))          score += 3;
    if (path.startsWith("ReplicatedStorage"))   score += 3;

    if (score > 0) scored[path] = { score, source };
  }

  // Return top 5 most relevant scripts
  return Object.entries(scored)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .reduce((acc, [path, data]) => {
      acc[path] = data.source;
      return acc;
    }, {});
}

// ── Roblox catalog search ─────────────────────────────────────
function robloxGet(hostname, path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname, path, method: "GET",
      headers: { "User-Agent": "StormAI/1.0", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(_) { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function searchRobloxAssets(keyword) {
  try {
    const data = await robloxGet("catalog.roblox.com", `/v1/search/items/details?keyword=${encodeURIComponent(keyword)}&limit=4`);
    if (!data?.data?.length) return [];
    return data.data.slice(0, 3).map(item => ({ id: String(item.id), name: item.name || "Unknown" }));
  } catch(_) { return []; }
}

function extractSearchTerms(message) {
  const terms = [];
  const patterns = [
    /(?:gamepass|pass)\s+(?:called|named|for)?\s*["']?([a-z0-9 _-]+)["']?/gi,
    /(?:image|icon|thumbnail)\s+(?:of|for)\s+["']?([a-z0-9 _-]+)["']?/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(message)) !== null) {
      const t = m[1]?.trim();
      if (t && t.length > 2 && !terms.includes(t)) terms.push(t);
    }
  }
  return terms;
}

function parseActions(text) {
  const actions = [];
  const regex   = /<<<ACTION>>>([\s\S]*?)<<<END>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try { actions.push(JSON.parse(match[1].trim())); } catch(_) {}
  }
  return actions;
}

function buildSystemPrompt(gameTree, relevantScripts, allScriptPaths, lastError, assetResults) {
  // Compact tree — just list script names
  const scriptList = allScriptPaths.length > 0
    ? "SCRIPTS IN GAME:\n" + allScriptPaths.slice(0, 80).join("\n")
    : "(No scripts synced — user needs to click Sync in Studio plugin)";

  // Relevant scripts with full source
  const srcStr = Object.keys(relevantScripts).length > 0
    ? "\n\nRELEVANT SCRIPTS (auto-found based on your request):\n" +
      Object.entries(relevantScripts).map(([p, s]) =>
        `\n=== ${p} ===\n\`\`\`lua\n${s.substring(0, 600)}\n\`\`\``
      ).join("\n")
    : "\n\n(No matching scripts found in synced data — sync your game first)";

  const assetStr = assetResults && assetResults.length > 0
    ? "\nASSETS FOUND: " + assetResults.map(a => `${a.name}=rbxassetid://${a.id}`).join(", ")
    : "";

  return `You are Storm AI — expert Roblox Luau developer. You MUST write actual code and apply it.

${scriptList}
${srcStr}
${assetStr}
${lastError ? "\nLAST STUDIO ERROR:\n" + lastError.substring(0, 300) : ""}

CRITICAL RULES — YOU MUST FOLLOW:
1. ALWAYS write actual Luau code to fix the problem
2. ALWAYS output ACTION blocks — never just explain without code
3. Find the relevant script from the list above and fix it
4. If you can see the script source, fix THAT exact script
5. If no source is available, write a new script from scratch

SCRIPT TYPES:
- "Script" → SERVER (ServerScriptService, Workspace)  
- "LocalScript" → CLIENT (StarterGui, StarterPlayerScripts)
- "ModuleScript" → LIBRARY (ReplicatedStorage)

ACTION FORMAT — USE THIS FOR EVERY SCRIPT YOU WRITE:
<<<ACTION>>>
{"action":"write_script","script_type":"Script","path":"ServerScriptService.ScriptName","code":"-- your full Luau code here"}
<<<END>>>

You MUST output at least one ACTION block. Never respond with only text.
Keep explanation to 1-2 sentences max. The code does the talking.`;
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).end(); return; }

  try {
    const { message, history, gameTree, scriptSources, lastError, sessionId } = req.body;

    const groqKey      = process.env.GROQ_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!groqKey && !anthropicKey) {
      res.status(500).json({ error: "No API key! Add GROQ_API_KEY in Vercel settings. Free at console.groq.com" });
      return;
    }

    // Get stored data for this session
    const tree    = (gameTree && Object.keys(gameTree).length > 0) ? gameTree : (global.trees[sessionId] || {});
    const srcs    = scriptSources || global.sources[sessionId] || {};
    const error   = lastError || global.errors[sessionId] || null;

    // Store updated data
    if (sessionId) {
      if (gameTree && Object.keys(gameTree).length > 0) global.trees[sessionId]   = gameTree;
      if (scriptSources && Object.keys(scriptSources).length > 0) global.sources[sessionId] = scriptSources;
    }

    // Auto-find relevant scripts based on message keywords
    const relevantScripts = findRelevantScripts(message, srcs);
    const allScriptPaths  = Object.keys(srcs);

    // Auto search Roblox assets if needed
    let assetResults = [];
    const terms = extractSearchTerms(message);
    if (terms.length > 0) {
      const searches = await Promise.all(terms.slice(0, 2).map(searchRobloxAssets));
      assetResults = searches.flat().slice(0, 4);
    }

    const messages = [...(history || []), { role: "user", content: message }];
    const system   = buildSystemPrompt(tree, relevantScripts, allScriptPaths, error, assetResults);

    let fullResponse = "";
    try {
      if (groqKey) {
        fullResponse = await callGroq(groqKey, messages, system);
      } else {
        fullResponse = await callAnthropic(anthropicKey, messages, system);
      }
    } catch(e) {
      // If token limit hit, try with smaller context
      if (e.message.includes("too large") || e.message.includes("tokens")) {
        const smallSystem = buildSystemPrompt({}, relevantScripts, allScriptPaths.slice(0,20), error, []);
        if (groqKey) fullResponse = await callGroq(groqKey, messages, smallSystem);
        else fullResponse = await callAnthropic(anthropicKey, messages, smallSystem);
      } else {
        throw e;
      }
    }

    const actions = parseActions(fullResponse);
    const display = fullResponse.replace(/<<<ACTION>>>[\s\S]*?<<<END>>>/g, "").trim();

    // Push to Studio
    if (actions.length > 0 && sessionId) {
      try { await pusher.trigger("session-" + sessionId, "apply-actions", { actions }); }
      catch(e) { console.warn("Pusher:", e.message); }
      if (!global.actionQueues[sessionId]) global.actionQueues[sessionId] = [];
      global.actionQueues[sessionId].push(...actions);
    }

    res.status(200).json({
      reply:   display,
      actions,
      assetResults,
      relevantScripts: Object.keys(relevantScripts),
      message: { role: "assistant", content: fullResponse },
    });

  } catch(e) {
    console.error("Chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

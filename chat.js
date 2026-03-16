// ================================================================
//  Storm AI — chat.js (Fixed token limit for Groq free tier)
//  Uses llama-3.1-8b-instant — higher token limits, still smart
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
if (typeof global.errors       === "undefined") global.errors       = {};

// ── Groq API ──────────────────────────────────────────────────
function callGroq(apiKey, messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       "llama-3.1-8b-instant",
      max_tokens:  2048,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-6), // only last 6 messages to save tokens
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
    const data = await robloxGet(
      "catalog.roblox.com",
      `/v1/search/items/details?keyword=${encodeURIComponent(keyword)}&limit=4`
    );
    if (!data?.data?.length) return [];
    const ids = data.data.map(i => i.id).filter(Boolean);
    const thumbData = await robloxGet(
      "thumbnails.roblox.com",
      `/v1/assets?${ids.map(id => `assetIds=${id}`).join("&")}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
    );
    const thumbMap = {};
    for (const t of thumbData?.data || []) thumbMap[t.targetId] = t.imageUrl || "";
    return data.data.slice(0, 3).map(item => ({
      id: String(item.id), name: item.name || "Unknown",
      imageUrl: thumbMap[item.id] || "", type: item.itemType || "",
    }));
  } catch(_) { return []; }
}

function extractSearchTerms(message) {
  const terms = [];
  const patterns = [
    /(?:gamepass|pass)\s+(?:called|named|for)?\s*["']?([a-z0-9 _-]+)["']?/gi,
    /(?:image|icon|thumbnail)\s+(?:of|for)\s+["']?([a-z0-9 _-]+)["']?/gi,
    /(?:shop|store).*?(?:with|for|selling)\s+["']?([a-z0-9 _-]+)["']?/gi,
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

function buildSystemPrompt(gameTree, scriptSources, lastError, assetResults) {
  // Trim game tree to avoid token overflow
  const treeStr = gameTree && Object.keys(gameTree).length > 0
    ? JSON.stringify(gameTree).substring(0, 3000)
    : "(No game tree yet — click Sync in Studio plugin)";

  // Only include first 3 scripts, max 300 chars each
  const srcStr = scriptSources && Object.keys(scriptSources).length > 0
    ? "\n\nKEY SCRIPTS:\n" +
      Object.entries(scriptSources).slice(0, 3).map(([p, s]) =>
        `[${p}]\n${s.substring(0, 300)}`
      ).join("\n\n")
    : "";

  const assetStr = assetResults && assetResults.length > 0
    ? "\nASSETS FOUND:\n" + assetResults.map(a => `• ${a.name} — rbxassetid://${a.id}`).join("\n")
    : "";

  return `You are Storm AI — expert Roblox Luau developer inside Roblox Studio.

GAME TREE: ${treeStr}
${srcStr}
${assetStr}
${lastError ? "\nLAST ERROR:\n" + lastError.substring(0, 200) : ""}

SCRIPT TYPES:
- "Script" → SERVER (ServerScriptService, Workspace)
- "LocalScript" → CLIENT (StarterGui, StarterPlayerScripts)  
- "ModuleScript" → LIBRARY (ReplicatedStorage, ServerStorage)

ACTION FORMAT:
<<<ACTION>>>
{"action":"write_script","script_type":"Script","path":"ServerScriptService.MyScript","code":"-- code here"}
<<<END>>>

RULES:
- Valid Luau only. Use game:GetService(). Use task.wait() not wait().
- If feature needs server+client, output BOTH as separate ACTION blocks.
- Fix errors using LAST ERROR above.
- Be concise — short explanation + working code.`;
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

    const tree  = (gameTree && Object.keys(gameTree).length > 0) ? gameTree : (sessionId ? global.trees[sessionId] || {} : {});
    const error = lastError || (sessionId ? global.errors[sessionId] : null);

    // Auto search Roblox assets
    let assetResults = [];
    const terms = extractSearchTerms(message);
    if (terms.length > 0) {
      const searches = await Promise.all(terms.slice(0, 2).map(searchRobloxAssets));
      assetResults = searches.flat().slice(0, 4);
    }

    const messages = [...(history || []), { role: "user", content: message }];
    const system   = buildSystemPrompt(tree, scriptSources, error, assetResults);

    let fullResponse = "";
    if (groqKey) {
      fullResponse = await callGroq(groqKey, messages, system);
    } else {
      fullResponse = await callAnthropic(anthropicKey, messages, system);
    }

    const actions = parseActions(fullResponse);
    const display = fullResponse.replace(/<<<ACTION>>>[\s\S]*?<<<END>>>/g, "").trim();

    if (actions.length > 0 && sessionId) {
      try { await pusher.trigger("session-" + sessionId, "apply-actions", { actions }); }
      catch(e) { console.warn("Pusher:", e.message); }
      if (!global.actionQueues[sessionId]) global.actionQueues[sessionId] = [];
      global.actionQueues[sessionId].push(...actions);
    }

    res.status(200).json({ reply: display, actions, assetResults, message: { role: "assistant", content: fullResponse } });

  } catch(e) {
    console.error("Chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

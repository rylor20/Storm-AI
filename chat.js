// ================================================================
//  Storm AI — chat.js v7
//  Never guesses script names — only uses real scripts from sync
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

function callGroq(apiKey, messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       "llama-3.3-70b-versatile",
      max_tokens:  4000,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-2),
      ],
    });
    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/chat/completions",
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
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
    req.write(body); req.end();
  });
}

function callAnthropic(key, messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4096, system,
      messages: messages.slice(-4),
    });
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    }, (res) => {
      let data = ""; res.on("data", c => data += c);
      res.on("end", () => {
        try { const p = JSON.parse(data); if (p.error) reject(new Error(p.error.message)); else resolve(p.content?.[0]?.text || ""); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

function robloxGet(hostname, path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname, path, method: "GET",
      headers: { "User-Agent": "StormAI/1.0", "Accept": "application/json" },
    }, (res) => {
      let data = ""; res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(_) { resolve(null); } });
    });
    req.on("error", () => resolve(null)); req.end();
  });
}

async function searchRobloxAssets(keyword) {
  try {
    const data = await robloxGet("catalog.roblox.com", `/v1/search/items/details?keyword=${encodeURIComponent(keyword)}&limit=3`);
    if (!data?.data?.length) return [];
    return data.data.slice(0, 3).map(item => ({ id: String(item.id), name: item.name || "Unknown" }));
  } catch(_) { return []; }
}

function extractSearchTerms(message) {
  const terms = [];
  const patterns = [
    /(?:gamepass|pass)\s+(?:called|named|for)?\s*["']?([a-z0-9 _-]+)["']?/gi,
    /(?:image|icon)\s+(?:of|for)\s+["']?([a-z0-9 _-]+)["']?/gi,
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

function findRelevantScripts(message, sources) {
  if (!sources || Object.keys(sources).length === 0) return {};
  const msgLower = message.toLowerCase();
  const stopWords = new Set(["this","that","with","from","have","will","your","make","when","then","find","script","scripts","fix","the","and","for","not","are","can","should","would","please","just","also","into","active","because","without"]);
  const keywords = msgLower.replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length > 3 && !stopWords.has(w));

  const scored = {};
  for (const [path, source] of Object.entries(sources)) {
    const pathLower = path.toLowerCase();
    const srcLower  = source.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (pathLower.includes(kw)) score += 20; // path match is strongest signal
      const matches = (srcLower.match(new RegExp(kw, "g")) || []).length;
      score += Math.min(matches * 2, 10);
    }
    if (path.startsWith("ServerScriptService")) score += 3;
    if (path.startsWith("ReplicatedStorage"))   score += 3;
    if (path.startsWith("StarterGui"))          score += 2;
    if (score > 0) scored[path] = { score, source };
  }

  return Object.entries(scored)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 4)
    .reduce((acc, [path, data]) => { acc[path] = data.source; return acc; }, {});
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

function buildSystemPrompt(relevantScripts, allScriptPaths, lastError, assetResults) {
  // Give AI the EXACT list of real script paths so it never guesses
  const scriptList = allScriptPaths.length > 0
    ? "EXACT SCRIPT PATHS IN YOUR GAME (use ONLY these paths — never invent new ones):\n" +
      allScriptPaths.slice(0, 80).join("\n")
    : "NO SCRIPTS SYNCED YET — tell user to click Sync Game in the Studio plugin first.";

  const srcStr = Object.keys(relevantScripts).length > 0
    ? "RELEVANT SCRIPTS FOUND (read and fix these):\n" +
      Object.entries(relevantScripts).map(([p, s]) =>
        `\n=== ${p} ===\n\`\`\`lua\n${s.substring(0, 600)}\n\`\`\``
      ).join("\n")
    : "No matching scripts found in synced data yet.";

  const assetStr = assetResults?.length > 0
    ? "\nASSETS FOUND: " + assetResults.map(a => `${a.name}=rbxassetid://${a.id}`).join(", ")
    : "";

  return `You are Storm AI — expert Roblox Luau developer assistant.

${scriptList}

${srcStr}
${lastError ? "\nLAST STUDIO ERROR:\n" + lastError.substring(0, 200) : ""}
${assetStr}

STRICT RULES — FOLLOW EXACTLY:
1. ONLY use script paths from the EXACT SCRIPT PATHS list above — NEVER invent or guess paths
2. If you see the script source above, fix THAT exact code — do not rewrite from scratch
3. ALWAYS output ACTION blocks with complete working code — never respond with only text
4. One ACTION block per script — max 3 scripts per response
5. If NO scripts are synced yet, tell the user to sync first — do not guess

SCRIPT TYPES:
- "Script"       → SERVER (ServerScriptService, Workspace, ServerStorage)
- "LocalScript"  → CLIENT (StarterGui, StarterPlayerScripts, StarterCharacterScripts)
- "ModuleScript" → LIBRARY (ReplicatedStorage, ServerStorage)

ACTION FORMAT:
<<<ACTION>>>
{"action":"write_script","script_type":"ModuleScript","path":"ReplicatedStorage.MapVariantManager","code":"-- complete fixed Luau code here"}
<<<END>>>

Write COMPLETE script code. Output 1-3 ACTION blocks only. Keep explanation to 1 sentence.`;
}

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

    // Store session data
    if (sessionId) {
      if (gameTree && Object.keys(gameTree).length > 0)           global.trees[sessionId]   = gameTree;
      if (scriptSources && Object.keys(scriptSources).length > 0) global.sources[sessionId] = scriptSources;
      if (lastError) global.errors[sessionId] = lastError;
    }

    const srcs  = global.sources[sessionId] || scriptSources || {};
    const error = lastError || global.errors[sessionId] || null;

    // Auto-find relevant scripts
    const relevantScripts = findRelevantScripts(message, srcs);
    const allScriptPaths  = Object.keys(srcs);

    // Asset search
    let assetResults = [];
    const terms = extractSearchTerms(message);
    if (terms.length > 0) {
      const searches = await Promise.all(terms.slice(0, 2).map(searchRobloxAssets));
      assetResults = searches.flat().slice(0, 3);
    }

    const messages = [...(history || []), { role: "user", content: message }];
    const system   = buildSystemPrompt(relevantScripts, allScriptPaths, error, assetResults);

    let fullResponse = "";
    try {
      fullResponse = groqKey
        ? await callGroq(groqKey, messages, system)
        : await callAnthropic(anthropicKey, messages, system);
    } catch(e) {
      if (e.message.includes("too large") || e.message.includes("tokens")) {
        const minSystem = buildSystemPrompt(relevantScripts, allScriptPaths.slice(0, 10), null, []);
        fullResponse = groqKey
          ? await callGroq(groqKey, [{ role: "user", content: message }], minSystem)
          : await callAnthropic(anthropicKey, [{ role: "user", content: message }], minSystem);
      } else throw e;
    }

    const actions = parseActions(fullResponse);
    const display = fullResponse.replace(/<<<ACTION>>>[\s\S]*?<<<END>>>/g, "").trim();

    if (actions.length > 0 && sessionId) {
      try { await pusher.trigger("session-" + sessionId, "apply-actions", { actions }); }
      catch(e) { console.warn("Pusher:", e.message); }
      if (!global.actionQueues[sessionId]) global.actionQueues[sessionId] = [];
      global.actionQueues[sessionId].push(...actions);
    }

    res.status(200).json({
      reply:        display,
      actions,
      assetResults,
      foundScripts: Object.keys(relevantScripts),
      message:      { role: "assistant", content: fullResponse },
    });

  } catch(e) {
    console.error("Chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

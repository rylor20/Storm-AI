// ================================================================
//  Storm AI — chat.js (Groq free tier, llama-3.3-70b-versatile)
//  Free API key at: console.groq.com — no credit card needed
//  14,400 free requests/day — resets every day
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

// ── Groq API call (OpenAI-compatible format) ──────────────────
function callGroq(apiKey, messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       "llama-3.3-70b-versatile",
      max_tokens:  4096,
      temperature: 0.3, // lower = more consistent code output
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
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
      `/v1/search/items/details?keyword=${encodeURIComponent(keyword)}&limit=6`
    );
    if (!data?.data?.length) return [];
    const ids = data.data.map(i => i.id).filter(Boolean);
    const thumbData = await robloxGet(
      "thumbnails.roblox.com",
      `/v1/assets?${ids.map(id => `assetIds=${id}`).join("&")}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
    );
    const thumbMap = {};
    for (const t of thumbData?.data || []) thumbMap[t.targetId] = t.imageUrl || "";
    return data.data.slice(0, 5).map(item => ({
      id:       String(item.id),
      name:     item.name || "Unknown",
      imageUrl: thumbMap[item.id] || "",
      type:     item.itemType || "",
      price:    item.price ?? null,
    }));
  } catch(_) { return []; }
}

function extractAssetSearchTerms(message) {
  const terms = [];
  const patterns = [
    /(?:gamepass|pass)\s+(?:called|named|for)?\s*["']?([a-z0-9 _-]+)["']?/gi,
    /(?:image|icon|thumbnail|picture)\s+(?:of|for)\s+["']?([a-z0-9 _-]+)["']?/gi,
    /(?:shop|store).*?(?:with|for|selling)\s+["']?([a-z0-9 _-]+)["']?/gi,
    /(?:add|put|include)\s+["']?([a-z0-9 _-]+)["']?\s+(?:gamepass|pass|item|product)/gi,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(message)) !== null) {
      const term = m[1]?.trim();
      if (term && term.length > 2 && !terms.includes(term)) terms.push(term);
    }
  }
  return terms;
}

// ── Parse action blocks from AI response ─────────────────────
function parseActions(text) {
  const actions = [];
  const regex   = /<<<ACTION>>>([\s\S]*?)<<<END>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try { actions.push(JSON.parse(match[1].trim())); } catch(_) {}
  }
  return actions;
}

// ── System prompt ─────────────────────────────────────────────
function buildSystemPrompt(gameTree, scriptSources, lastError, assetResults) {
  const treeStr = gameTree && Object.keys(gameTree).length > 0
    ? JSON.stringify(gameTree, null, 2)
    : "(No game tree yet — user needs to click Sync in the Studio plugin)";

  const srcStr = scriptSources && Object.keys(scriptSources).length > 0
    ? "\n\nSCRIPT SOURCES:\n" + Object.entries(scriptSources)
        .map(([p, s]) => `\n[${p}]\n\`\`\`lua\n${s}\n\`\`\``).join("\n")
    : "";

  const assetStr = assetResults && assetResults.length > 0
    ? "\n\nROBLOX ASSET SEARCH RESULTS — use these IDs directly in your code:\n" +
      assetResults.map(a =>
        `• "${a.name}" — assetId: ${a.id} — use as: rbxassetid://${a.id}`
      ).join("\n")
    : "";

  return `You are Storm AI — an expert Roblox Luau developer assistant built into Roblox Studio.
You have full context of the user's game shown below.

GAME TREE:
${treeStr}
${srcStr}
${assetStr}
${lastError ? "\nLAST STUDIO ERROR:\n" + lastError + "\n" : ""}

════════════════════════════════════════
SCRIPT TYPE RULES — ALWAYS FOLLOW
════════════════════════════════════════

Always include "script_type" in every write_script action.

  "Script"       SERVER side. Game logic, datastores, killing players, physics.
                 Parent: ServerScriptService, ServerStorage, Workspace

  "LocalScript"  CLIENT side. GUIs, input, camera, animations.
                 Parent: StarterGui, StarterPlayerScripts,
                         StarterCharacterScripts, StarterPack, ReplicatedFirst

  "ModuleScript" Reusable shared library. No standalone execution.
                 Parent: ReplicatedStorage (shared), ServerStorage (server-only)

If a feature needs BOTH server and client code, output BOTH as separate ACTION blocks.

════════════════════════════════════════
ACTION FORMAT — USE THIS EXACTLY
════════════════════════════════════════

<<<ACTION>>>
{
  "action": "write_script",
  "script_type": "LocalScript",
  "path": "StarterGui.ShopGui",
  "code": "-- full Luau code here"
}
<<<END>>>

Other actions:
  {"action":"delete_script","path":"ServerScriptService.OldScript"}
  {"action":"create_folder","path":"ReplicatedStorage.Modules"}

Multiple scripts = multiple ACTION blocks, one per script.

════════════════════════════════════════
ASSET & IMAGE RULES
════════════════════════════════════════

When writing GUIs with images or shop items:
- If ROBLOX ASSET SEARCH RESULTS are shown above, use those IDs directly
- Set ImageLabel.Image = "rbxassetid://ID_FROM_SEARCH"
- For gamepasses: MarketplaceService:UserOwnsGamePassAsync(userId, GAMEPASS_ID)
- For purchase: MarketplaceService:PromptGamePassPurchase(player, GAMEPASS_ID)
- If no search results, use: Image = "rbxassetid://0" -- TODO: replace with real ID

════════════════════════════════════════
CODING RULES
════════════════════════════════════════
- Valid Luau ONLY. No io, os.exit, or bare Lua syntax.
- Use game:GetService() for all services.
- Use task.wait() NOT wait(). Use task.spawn() NOT spawn().
- For shop GUIs: ScreenGui → Frame → ScrollingFrame → buttons per item.
- Always add RemoteEvents in ReplicatedStorage for client↔server communication.
- When fixing errors: address the LAST STUDIO ERROR directly and precisely.
- Check GAME TREE before creating — if script already exists, write_script updates it.
- Be concise: 1-3 sentences explanation max. Let the code speak.`;
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

    // Check for Groq key first, fall back to Anthropic if set
    const groqKey      = process.env.GROQ_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!groqKey && !anthropicKey) {
      res.status(500).json({
        error: "No API key found. Add GROQ_API_KEY to your Vercel environment variables. Get a free key at console.groq.com"
      });
      return;
    }

    // Auto-search Roblox assets if message mentions items/images
    let assetResults = [];
    const searchTerms = extractAssetSearchTerms(message);
    if (searchTerms.length > 0) {
      const searches = await Promise.all(searchTerms.slice(0, 3).map(searchRobloxAssets));
      assetResults = searches.flat().slice(0, 8);
    }

    const messages = [...(history || []), { role: "user", content: message }];
    const system   = buildSystemPrompt(gameTree, scriptSources, lastError, assetResults);

    let fullResponse = "";

    if (groqKey) {
      // Use Groq (free, fast)
      fullResponse = await callGroq(groqKey, messages, system);
    } else {
      // Fall back to Anthropic if only that key exists
      fullResponse = await callAnthropic(anthropicKey, messages, system);
    }

    const actions = parseActions(fullResponse);
    const display = fullResponse.replace(/<<<ACTION>>>[\s\S]*?<<<END>>>/g, "").trim();

    // Push actions to Studio via Pusher + queue
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
      message:      { role: "assistant", content: fullResponse },
    });

  } catch(e) {
    console.error("Chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// ── Anthropic fallback (only used if no Groq key) ─────────────
function callAnthropic(key, messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 4096, system, messages,
    });
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { const p = JSON.parse(data); if (p.error) reject(new Error(p.error.message)); else resolve(p.content?.[0]?.text || ""); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

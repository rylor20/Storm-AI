// ================================================================
//  /api/deobfuscate — Sends obfuscated script to Claude
//  Claude deobfuscates and returns clean readable Luau
// ================================================================
const https = require("https");

function callClaude(key, code) {
  return new Promise((resolve, reject) => {
    const system = `You are an expert Roblox Luau reverse engineer and deobfuscator.
Your job is to take obfuscated Luau/Lua code and rewrite it as clean, readable, well-commented Luau.

You handle ALL types of obfuscation:

1. STRING.CHAR() OBFUSCATION
   - Decode string.char(72,101,108,108,111) → "Hello"
   - Evaluate all string.byte, string.rep, string.reverse patterns
   - Replace all encoded strings with their actual values

2. VARIABLE NAME SCRAMBLING
   - Rename single-letter or random vars (a,b,c,_0x1a2b) to meaningful names
   - Infer purpose from context (e.g. a variable holding Players → name it "Players")
   - Rename functions based on what they do

3. LUARMOR / IRONBREW / BYTECODE OBFUSCATION
   - These use a VM with opcodes. Identify the VM pattern.
   - Extract and reconstruct the original logic as best as possible
   - If full deobfuscation is impossible, explain the structure and what each section does
   - Comment the VM chunks with what they likely do

4. SAVEINSTANCE() / EXECUTOR DUMPS
   - These often have decompiler artifacts: -- DECOMPILED, unknown variables, goto statements
   - Clean up decompiler artifacts
   - Replace goto with proper if/while/repeat blocks
   - Fix incorrect upvalue references
   - Restore proper Roblox API calls (game:GetService, Instance.new, etc.)

OUTPUT RULES:
- Return ONLY the cleaned Luau code, no explanation text outside the code
- Add helpful comments explaining what each section does
- Use proper Roblox Luau style: local variables, game:GetService(), task.wait()
- If a section is truly impossible to deobfuscate (encrypted bytecode), wrap it in a comment block explaining what it likely does
- Keep ALL original functionality intact — do not simplify or remove logic`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8096,
      system,
      messages: [{ role: "user", content: `Deobfuscate this Roblox Luau script completely:\n\n\`\`\`lua\n${code}\n\`\`\`` }],
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
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
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).end(); return; }

  try {
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: "No code provided" }); return; }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)  { res.status(500).json({ error: "No API key" }); return; }

    const result = await callClaude(key, code);

    // Extract code from markdown if Claude wrapped it
    const cleaned = result.replace(/^```(?:lua|luau)?\n?/, "").replace(/\n?```$/, "").trim();

    res.status(200).json({ result: cleaned });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

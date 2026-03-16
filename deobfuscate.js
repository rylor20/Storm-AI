// ================================================================
//  /api/deobfuscate -- Now uses Groq (free) instead of Anthropic
// ================================================================
const https = require("https");

function callGroq(apiKey, code) {
  return new Promise((resolve, reject) => {
    const system = `You are an expert Roblox Luau reverse engineer and deobfuscator.
Your job is to take obfuscated Luau/Lua code and rewrite it as clean, readable, well-commented Luau.

You handle ALL types of obfuscation:

1. STRING.CHAR() OBFUSCATION
   - Decode string.char(72,101,108,108,111) to actual strings
   - Evaluate all string.byte, string.rep, string.reverse patterns

2. VARIABLE NAME SCRAMBLING
   - Rename single-letter or random vars (a,b,c,_0x1a2b) to meaningful names
   - Infer purpose from context

3. LUARMOR / IRONBREW / BYTECODE
   - These use a VM with opcodes
   - Extract and reconstruct the original logic
   - Comment each section with what it likely does

4. SAVEINSTANCE / EXECUTOR DUMPS
   - Clean up decompiler artifacts
   - Replace goto with proper if/while/repeat blocks
   - Fix incorrect upvalue references
   - Restore proper Roblox API calls

OUTPUT RULES:
- Return ONLY the cleaned Luau code
- Add helpful comments explaining what each section does
- Use proper Roblox Luau style: local variables, game:GetService(), task.wait()
- If a section is truly impossible to deobfuscate, wrap it in a comment block`;

    const body = JSON.stringify({
      model:       "llama-3.3-70b-versatile",
      max_tokens:  4000,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: `Deobfuscate this Roblox Luau script:\n\`\`\`lua\n${code.substring(0, 6000)}\n\`\`\`` }
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).end(); return; }

  try {
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: "No code provided" }); return; }

    const key = process.env.GROQ_API_KEY;
    if (!key)  { res.status(500).json({ error: "No GROQ_API_KEY in Vercel environment variables" }); return; }

    const result = await callGroq(key, code);

    // Extract code from markdown if wrapped
    const cleaned = result
      .replace(/^```(?:lua|luau)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    res.status(200).json({ result: cleaned });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

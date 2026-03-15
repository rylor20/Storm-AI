// ================================================================
//  /api/parse-rbxlx
//  Receives a .rbxlx file (XML), parses it into a game tree
//  and extracts full source code of every script
// ================================================================

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).end(); return; }

  try {
    const { xml } = req.body;
    if (!xml) { res.status(400).json({ error: "No XML provided" }); return; }

    const result = parseRbxlx(xml);
    res.status(200).json(result);
  } catch(e) {
    console.error("Parse error:", e);
    res.status(500).json({ error: e.message });
  }
};

// ── Core parser ───────────────────────────────────────────────
function parseRbxlx(xml) {
  const tree    = {};   // nested object for the explorer
  const scripts = {};   // path -> { type, source }

  // ── Tiny XML helpers (no external deps) ──────────────────────
  function getAttr(tag, attr) {
    const m = tag.match(new RegExp(`${attr}="([^"]*)"`, "i"));
    return m ? m[1] : "";
  }

  function getTagContent(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null) results.push(m[1]);
    return results;
  }

  function getFirstTagContent(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1] : null;
  }

  // ── Property reader ───────────────────────────────────────────
  function getProp(itemXml, propName) {
    // <string name="PropName">value</string>
    const patterns = [
      new RegExp(`<string\\s+name="${propName}"[^>]*>([\\s\\S]*?)<\\/string>`, "i"),
      new RegExp(`<ProtectedString\\s+name="${propName}"[^>]*>([\\s\\S]*?)<\\/ProtectedString>`, "i"),
      new RegExp(`<BinaryString\\s+name="${propName}"[^>]*>([\\s\\S]*?)<\\/BinaryString>`, "i"),
    ];
    for (const p of patterns) {
      const m = itemXml.match(p);
      if (m) return m[1].trim();
    }
    return null;
  }

  // ── Recursively walk <Item> elements ──────────────────────────
  // We parse the XML manually since we can't use DOM APIs in Vercel
  function walkItems(xmlChunk, parentPath) {
    // Match top-level <Item> tags (not nested ones — we recurse)
    const itemRe = /<Item\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/Item>/g;
    let m;

    while ((m = itemRe.exec(xmlChunk)) !== null) {
      const className  = m[1];
      const innerXml   = m[2];

      // Get the Name property
      const name = getProp(innerXml, "Name") || className;

      // Build the full dot path
      const fullPath = parentPath ? `${parentPath}.${name}` : name;

      // Store in tree
      const pathParts = fullPath.split(".");
      let node = tree;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!node[pathParts[i]]) node[pathParts[i]] = { __type: "Folder" };
        node = node[pathParts[i]];
      }
      const leafName = pathParts[pathParts.length - 1];
      if (!node[leafName]) node[leafName] = { __type: className };
      else node[leafName].__type = className;

      // Extract script source
      if (className === "Script" || className === "LocalScript" || className === "ModuleScript") {
        const source = getProp(innerXml, "Source") || "";
        // Decode CDATA if present
        const cleanSource = source
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
          .replace(/&lt;/g,  "<")
          .replace(/&gt;/g,  ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g,'"')
          .replace(/&apos;/g,"'");

        scripts[fullPath] = {
          type:   className,
          source: cleanSource,
          name,
        };
      }

      // Recurse into children
      // Find the <Item> children inside this item's xml
      walkItems(innerXml, fullPath);
    }
  }

  // Top-level services to look for
  const services = [
    "Workspace", "ServerScriptService", "ServerStorage",
    "ReplicatedStorage", "StarterGui", "StarterPack",
    "StarterPlayer", "Lighting", "ReplicatedFirst",
    "Teams", "SoundService", "Chat"
  ];

  // Find each service in the XML and walk its children
  for (const svc of services) {
    const svcRe = new RegExp(
      `<Item\\s+class="${svc}"[^>]*>([\\s\\S]*?)<\\/Item>`, "i"
    );
    const m = xml.match(svcRe);
    if (m) {
      tree[svc] = { __type: svc };
      walkItems(m[1], svc);
    }
  }

  // Count stats
  const scriptCount  = Object.keys(scripts).length;
  const serviceCount = Object.keys(tree).length;

  return {
    tree,
    scripts,
    stats: { scriptCount, serviceCount },
  };
}

// ================================================================
//  /api/scan-assets
//  Scans a game tree for animation IDs and sound IDs
// ================================================================
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const { xmlContent } = req.body;
    if (!xmlContent) { res.status(400).json({ error: "No content" }); return; }

    const assets = [];
    const seen   = new Set();

    // Find AnimationId properties
    const animRegex = /<string name="AnimationId"[^>]*>rbxassetid:\/\/(\d+)<\/string>/gi;
    let m;
    while ((m = animRegex.exec(xmlContent)) !== null) {
      const id = m[1];
      if (!seen.has("anim_" + id)) {
        seen.add("anim_" + id);
        // Try to get context (parent name) from surrounding XML
        const before = xmlContent.substring(Math.max(0, m.index - 500), m.index);
        const nameMatch = before.match(/<string name="Name"[^>]*>([^<]+)<\/string>/gi);
        const name = nameMatch ? nameMatch[nameMatch.length-1].replace(/<[^>]+>/g,"") : "Animation";
        assets.push({ id, type: "Animation", name, originalUrl: "rbxassetid://" + id });
      }
    }

    // Find SoundId properties
    const soundRegex = /<string name="SoundId"[^>]*>rbxassetid:\/\/(\d+)<\/string>/gi;
    while ((m = soundRegex.exec(xmlContent)) !== null) {
      const id = m[1];
      if (!seen.has("sound_" + id)) {
        seen.add("sound_" + id);
        const before = xmlContent.substring(Math.max(0, m.index - 500), m.index);
        const nameMatch = before.match(/<string name="Name"[^>]*>([^<]+)<\/string>/gi);
        const name = nameMatch ? nameMatch[nameMatch.length-1].replace(/<[^>]+>/g,"") : "Sound";
        assets.push({ id, type: "Sound", name, originalUrl: "rbxassetid://" + id });
      }
    }

    // Also find numeric-only asset IDs in scripts (common pattern)
    const scriptAssetRegex = /Animation(?:Id|Track)[^\d]*?(\d{6,})/g;
    while ((m = scriptAssetRegex.exec(xmlContent)) !== null) {
      const id = m[1];
      if (!seen.has("anim_" + id)) {
        seen.add("anim_" + id);
        assets.push({ id, type: "Animation", name: "Script Animation", originalUrl: id });
      }
    }

    res.status(200).json({ assets });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

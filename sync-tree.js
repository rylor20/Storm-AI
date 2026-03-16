if (typeof global.trees   === "undefined") global.trees   = {};
if (typeof global.sources === "undefined") global.sources = {};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method === "POST") {
    try {
      const { sessionId, tree, sources } = req.body || {};
      if (sessionId) {
        if (tree)    global.trees[sessionId]   = tree;
        if (sources) global.sources[sessionId] = sources;
      }
      res.status(200).json({ ok: true });
    } catch(e) {
      res.status(200).json({ ok: true });
    }
    return;
  }

  if (req.method === "GET") {
    const sessionId = req.query && req.query.sessionId;
    res.status(200).json({
      tree:    global.trees[sessionId]   || {},
      sources: global.sources[sessionId] || {},
    });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
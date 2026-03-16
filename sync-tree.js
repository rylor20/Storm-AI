if (typeof global.trees === "undefined") global.trees = {};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method === "POST") {
    const { sessionId, tree } = req.body || {};
    if (sessionId && tree) global.trees[sessionId] = tree;
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const sessionId = req.query?.sessionId;
    res.status(200).json({ tree: global.trees[sessionId] || {} });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};

// Receives game tree from Studio plugin and stores it in memory
// (In production you'd use a DB, but for personal use memory is fine)

const trees = {}; // sessionId -> gameTree

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method === "POST") {
    const { sessionId, tree } = req.body;
    if (sessionId && tree) {
      trees[sessionId] = tree;
      console.log(`Tree synced for session ${sessionId}`);
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const { sessionId } = req.query;
    res.status(200).json({ tree: trees[sessionId] || {} });
    return;
  }

  res.status(405).end();
};

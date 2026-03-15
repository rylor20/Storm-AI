// Receives console errors from Studio plugin
const errors = {};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method === "POST") {
    const { sessionId, error } = req.body;
    if (sessionId) errors[sessionId] = error;
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const { sessionId } = req.query;
    res.status(200).json({ error: errors[sessionId] || null });
    return;
  }

  res.status(405).end();
};

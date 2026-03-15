// Plugin polls this to get pending actions
const queues = {};

// Allow other API functions to push actions here
global.actionQueues = global.actionQueues || queues;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const sessionId = req.query.sessionId || req.body?.sessionId;
  if (!sessionId) { res.status(400).json({ error: "No sessionId" }); return; }

  if (req.method === "POST") {
    // Server pushes actions into the queue
    const { actions } = req.body;
    if (!global.actionQueues[sessionId]) global.actionQueues[sessionId] = [];
    global.actionQueues[sessionId].push(...(actions || []));
    res.status(200).json({ ok: true });
    return;
  }

  // GET — plugin polling
  const pending = global.actionQueues[sessionId] || [];
  global.actionQueues[sessionId] = [];
  res.status(200).json({ actions: pending });
};

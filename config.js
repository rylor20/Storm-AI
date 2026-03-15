module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(`
    window.PUSHER_KEY     = "${process.env.PUSHER_KEY || ""}";
    window.PUSHER_CLUSTER = "${process.env.PUSHER_CLUSTER || "ap3"}";
  `);
};

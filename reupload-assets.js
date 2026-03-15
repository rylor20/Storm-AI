// ================================================================
//  /api/reupload-assets
//  Reuploads animations/sounds from old IDs to the user's account
//  Requires ROBLOSECURITY cookie in environment variables
// ================================================================
const https = require("https");

// ── Make an authenticated request to Roblox API ───────────────
function robloxRequest(options, body, cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        "Content-Type":  "application/json",
        "Cookie":        `.ROBLOSECURITY=${cookie}`,
        "User-Agent":    "StormAI/1.0",
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch(_) { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Get CSRF token (required by Roblox for POST requests) ─────
async function getCsrf(cookie) {
  const res = await robloxRequest({
    hostname: "auth.roblox.com",
    path:     "/v2/logout",
    method:   "POST",
  }, "{}", cookie);
  return res.headers["x-csrf-token"] || "";
}

// ── Get authenticated user info ───────────────────────────────
async function getMyUserId(cookie) {
  const res = await robloxRequest({
    hostname: "users.roblox.com",
    path:     "/v1/users/authenticated",
    method:   "GET",
  }, null, cookie);
  return res.body?.id || null;
}

// ── Fetch original asset info ─────────────────────────────────
async function getAssetInfo(assetId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "economy.roblox.com",
      path:     `/v2/assets/${assetId}/details`,
      method:   "GET",
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(_) { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

// ── Download original asset content ──────────────────────────
async function downloadAsset(assetId, cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "assetdelivery.roblox.com",
      path:     `/v1/asset/?id=${assetId}`,
      method:   "GET",
      headers:  { "Cookie": `.ROBLOSECURITY=${cookie}` },
    }, (res) => {
      // Handle redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) {
          const url = new URL(loc);
          const req2 = https.request({
            hostname: url.hostname,
            path:     url.pathname + url.search,
            method:   "GET",
          }, (res2) => {
            const chunks = [];
            res2.on("data", c => chunks.push(c));
            res2.on("end", () => resolve({ data: Buffer.concat(chunks), contentType: res2.headers["content-type"] || "" }));
          });
          req2.on("error", reject);
          req2.end();
          return;
        }
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ data: Buffer.concat(chunks), contentType: res.headers["content-type"] || "" }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Upload animation to user's account ───────────────────────
async function uploadAnimation(name, xmlData, cookie, csrf) {
  const res = await robloxRequest({
    hostname: "www.roblox.com",
    path:     "/ide/publish/uploadnewanimation",
    method:   "POST",
    headers:  {
      "X-CSRF-TOKEN":  csrf,
      "Content-Type":  "application/xml",
    },
  }, xmlData.toString(), cookie);

  // Response is the new asset ID as plain text
  const newId = parseInt(res.body?.toString?.() || res.body);
  return isNaN(newId) ? null : newId;
}

// ── Upload sound (audio) — uses the Open Cloud or legacy API ─
async function uploadAudio(name, audioData, contentType, cookie, csrf, userId) {
  // Roblox audio upload requires multipart form
  const boundary = "----StormAIBoundary" + Date.now();
  const nameField = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}`;
  const typeField = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="assetTypeId"\r\n\r\n3`;
  const groupField= `\r\n--${boundary}\r\nContent-Disposition: form-data; name="groupId"\r\n\r\n`;
  const fileField = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}.mp3"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const closing   = `\r\n--${boundary}--\r\n`;

  const bodyParts = [
    Buffer.from(nameField + typeField + groupField + fileField),
    audioData,
    Buffer.from(closing),
  ];
  const bodyBuffer = Buffer.concat(bodyParts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "data.roblox.com",
      path:     "/ide/publish/uploadnewasset",
      method:   "POST",
      headers: {
        "Cookie":        `.ROBLOSECURITY=${cookie}`,
        "X-CSRF-TOKEN":  csrf,
        "Content-Type":  `multipart/form-data; boundary=${boundary}`,
        "Content-Length": bodyBuffer.length,
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const newId = parseInt(data);
        resolve(isNaN(newId) ? null : newId);
      });
    });
    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).end(); return; }

  try {
    const { assets } = req.body; // [{ id, type, name, path }]
    const cookie = process.env.ROBLOSECURITY;
    if (!cookie) { res.status(500).json({ error: "No ROBLOSECURITY cookie configured in Vercel environment variables" }); return; }
    if (!assets || !assets.length) { res.status(400).json({ error: "No assets provided" }); return; }

    // Validate cookie + get user
    const userId = await getMyUserId(cookie);
    if (!userId)  { res.status(401).json({ error: "Invalid ROBLOSECURITY cookie — please update it in Vercel settings" }); return; }

    const csrf    = await getCsrf(cookie);
    const results = [];

    for (const asset of assets) {
      try {
        const info = await getAssetInfo(asset.id);
        const name = info?.Name || asset.name || `Asset_${asset.id}`;

        if (asset.type === "Animation") {
          // Download the animation XML
          const { data } = await downloadAsset(asset.id, cookie);
          const newId    = await uploadAnimation(name, data, cookie, csrf);
          results.push({ oldId: asset.id, newId, type: "Animation", name, path: asset.path, success: !!newId });

        } else if (asset.type === "Sound") {
          const { data, contentType } = await downloadAsset(asset.id, cookie);
          const newId = await uploadAudio(name, data, contentType, cookie, csrf, userId);
          results.push({ oldId: asset.id, newId, type: "Sound", name, path: asset.path, success: !!newId });

        } else {
          results.push({ oldId: asset.id, newId: null, type: asset.type, name, path: asset.path, success: false, error: "Unsupported type" });
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));

      } catch(e) {
        results.push({ oldId: asset.id, newId: null, type: asset.type, name: asset.name, path: asset.path, success: false, error: e.message });
      }
    }

    res.status(200).json({ results });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

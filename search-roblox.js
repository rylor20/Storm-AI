// ================================================================
//  /api/search-roblox
//  Searches Roblox catalog for assets (gamepasses, images, etc.)
//  and returns their IDs + thumbnail URLs
// ================================================================
const https = require("https");

function robloxGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: "GET",
      headers: { "User-Agent": "StormAI/1.0", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(_) { resolve(null); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Get thumbnail URLs for a list of asset IDs
async function getThumbnails(assetIds, type = "Asset") {
  if (!assetIds.length) return {};
  const params = assetIds.map(id => `assetIds=${id}`).join("&");
  const data = await robloxGet(
    "thumbnails.roblox.com",
    `/v1/assets?${params}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
  );
  const map = {};
  if (data?.data) {
    for (const item of data.data) {
      map[item.targetId] = item.imageUrl || "";
    }
  }
  return map;
}

// Search catalog for items
async function searchCatalog(keyword, category) {
  // Category 34 = GamePasses, 0 = All
  const cat = category || 0;
  const data = await robloxGet(
    "catalog.roblox.com",
    `/v1/search/items/details?keyword=${encodeURIComponent(keyword)}&limit=10&category=${cat}`
  );
  return data?.data || [];
}

// Search for gamepasses specifically (different API)
async function searchGamepasses(keyword) {
  const data = await robloxGet(
    "apis.roblox.com",
    `/search/v1/catalog?keyword=${encodeURIComponent(keyword)}&limit=10&subcategory=GamePasses`
  );
  return data?.data || [];
}

// Get asset details by ID
async function getAssetDetails(assetId) {
  const data = await robloxGet(
    "economy.roblox.com",
    `/v2/assets/${assetId}/details`
  );
  return data;
}

// Get thumbnail for a single asset
async function getSingleThumbnail(assetId) {
  const data = await robloxGet(
    "thumbnails.roblox.com",
    `/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`
  );
  return data?.data?.[0]?.imageUrl || "";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const { query, type, assetId } = req.method === "POST" ? req.body : req.query;

    // If assetId given directly — just get its details + thumbnail
    if (assetId) {
      const [details, thumb] = await Promise.all([
        getAssetDetails(assetId),
        getSingleThumbnail(assetId),
      ]);
      res.status(200).json({
        results: details ? [{
          id:          assetId,
          name:        details.Name || "Unknown",
          description: details.Description || "",
          imageUrl:    thumb,
          assetType:   details.AssetTypeId,
          creatorName: details.Creator?.Name || "",
        }] : [],
      });
      return;
    }

    if (!query) { res.status(400).json({ error: "No query provided" }); return; }

    // Search catalog
    let items = await searchCatalog(query, type === "gamepass" ? 34 : 0);

    // If no results from catalog, try gamepass search
    if (!items.length && type === "gamepass") {
      items = await searchGamepasses(query);
    }

    if (!items.length) {
      res.status(200).json({ results: [] }); return;
    }

    // Get thumbnails for all results
    const ids = items.map(i => i.id || i.assetId).filter(Boolean);
    const thumbs = await getThumbnails(ids);

    const results = items.slice(0, 8).map(item => {
      const id = item.id || item.assetId;
      return {
        id:          String(id),
        name:        item.name || item.Name || "Unknown",
        description: item.description || item.Description || "",
        imageUrl:    thumbs[id] || "",
        assetType:   item.assetType || item.itemType || "",
        creatorName: item.creatorName || item.Creator?.Name || "",
        price:       item.price ?? item.Price ?? null,
      };
    });

    res.status(200).json({ results });

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

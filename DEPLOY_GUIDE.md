# ⚡ Storm AI — Deploy Guide

## Step 1 — GitHub
1. Go to github.com → New repository → name: storm-ai → Public
2. Click "uploading an existing file"
3. Drag ALL files from this folder into GitHub
4. Click "Commit changes"

## Step 2 — Pusher (free real-time)
1. Go to pusher.com → Sign up free
2. Create App → name: storm-ai → pick your region
3. Click "App Keys" and note down:
   - app_id, key, secret, cluster

## Step 3 — Vercel (free hosting)
1. Go to vercel.com → Sign up with GitHub
2. Click "Add New Project" → Import storm-ai repo
3. Add Environment Variables:
   - ANTHROPIC_API_KEY  =  sk-ant-YOUR-KEY
   - PUSHER_APP_ID      =  (from Pusher)
   - PUSHER_KEY         =  (from Pusher)
   - PUSHER_SECRET      =  (from Pusher)
   - PUSHER_CLUSTER     =  (from Pusher, e.g. ap3)
4. Click Deploy → get your URL (e.g. storm-ai-xyz.vercel.app)

## Step 4 — Studio Plugin
1. Open studio-plugin/StormAIPlugin.lua
2. Change line 13 to your Vercel URL:
   local WEBSITE_URL = "https://storm-ai-xyz.vercel.app"
3. Copy the file to Studio Plugins folder
4. Restart Studio
5. Game Settings → Security → Allow HTTP Requests ✅

## Step 5 — Use it!
1. In Studio: File → Save to File As → .rbxlx
2. Open your website → drag .rbxlx file onto the sidebar
3. Your full game tree + all script code appears instantly
4. Copy the 6-char Session Code → paste into Studio plugin → Connect
5. Ask Storm AI anything — code changes appear in Studio automatically!

---

## ADDING YOUR ROBLOSECURITY COOKIE (for Asset Reuploader)

After deploying to Vercel, add one more environment variable:

Name: ROBLOSECURITY
Value: (your cookie — see below how to get it)

HOW TO GET YOUR .ROBLOSECURITY COOKIE:
1. Open Chrome and go to roblox.com — make sure you're logged in
2. Press F12 to open DevTools
3. Click "Application" tab (top menu)
4. In the left sidebar: Cookies → https://www.roblox.com
5. Find the cookie named ".ROBLOSECURITY"
6. Copy the value (it's a very long string)
7. Paste it into Vercel environment variables as ROBLOSECURITY

IMPORTANT:
- Never share this cookie with anyone — it's your login token
- Since it's only in YOUR Vercel environment variables, it's private
- If you ever feel it's compromised, go to roblox.com → Settings → Sign out all sessions

To update it in Vercel:
Settings → Environment Variables → find ROBLOSECURITY → Edit → paste new value → Redeploy


---

## USING GROQ (FREE — RECOMMENDED)

Instead of ANTHROPIC_API_KEY, use GROQ_API_KEY in Vercel:

1. Go to console.groq.com — sign up free (no credit card)
2. Click API Keys → Create API Key → copy it (starts with gsk_...)
3. In Vercel Environment Variables:
   Add: GROQ_API_KEY = gsk_your_key_here
   (remove ANTHROPIC_API_KEY if you had it)
4. Redeploy — done!

Free limits: 14,400 requests/day, resets midnight. More than enough for personal use.
Model used: llama-3.3-70b-versatile — excellent at Roblox Luau code.

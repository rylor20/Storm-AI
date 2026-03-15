-- ================================================================
--  ⚡ Storm AI — Studio Plugin
--  1. Enter your Session Code from the website
--  2. Changes from the website apply here automatically
--  !! Change WEBSITE_URL after deploying to Vercel !!
-- ================================================================

local HttpService          = game:GetService("HttpService")
local Selection            = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local LogService           = game:GetService("LogService")

local WEBSITE_URL   = "https://YOUR-APP.vercel.app"
local SESSION_ID    = ""
local POLL_INTERVAL = 1.5

-- ════════════════════════════════════════════════════════════
--  SMART SCRIPT TYPE DETECTION
-- ════════════════════════════════════════════════════════════
local LOCAL_PARENTS  = {StarterGui=true,StarterPlayerScripts=true,StarterCharacterScripts=true,StarterPack=true,ReplicatedFirst=true}
local LOCAL_HINTS    = {"client","gui","hud","ui","local","input","camera","display","screen"}
local MODULE_HINTS   = {"module","shared","util","library","lib","data","config","types","constants","manager"}

local function topSvc(path)  return string.split(path,".")[1] or "" end
local function leafName(path) local p=string.split(path,"."); return p[#p] or "" end
local function hasHint(name,hints) local l=string.lower(name); for _,h in ipairs(hints) do if string.find(l,h) then return true end end return false end

local function resolveType(action)
    local declared=action.script_type
    local path=action.path or ""
    local svc=topSvc(path); local name=leafName(path)
    if declared and declared~="" then
        if LOCAL_PARENTS[svc] and declared=="Script" then return "LocalScript" end
        return declared
    end
    if LOCAL_PARENTS[svc] then return "LocalScript" end
    if hasHint(name,MODULE_HINTS) then return "ModuleScript" end
    if hasHint(name,LOCAL_HINTS)  then return "LocalScript"  end
    return "Script"
end

-- ════════════════════════════════════════════════════════════
--  UI
-- ════════════════════════════════════════════════════════════
local toolbar  = plugin:CreateToolbar("Storm AI")
local mainBtn  = toolbar:CreateButton("Storm AI","Toggle panel","rbxassetid://6031090990")
local syncBtn  = toolbar:CreateButton("Sync","Sync game","rbxassetid://6031281279")

local wi=DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right,true,false,280,480,200,300)
local widget=plugin:CreateDockWidgetPluginGui("StormAI",wi)
widget.Title="⚡ Storm AI"

local frame=Instance.new("Frame")
frame.Size=UDim2.new(1,0,1,0); frame.BackgroundColor3=Color3.fromRGB(7,7,13)
frame.BorderSizePixel=0; frame.Parent=widget

local pad=Instance.new("UIPadding",frame)
pad.PaddingLeft=UDim.new(0,12);pad.PaddingRight=UDim.new(0,12)
pad.PaddingTop=UDim.new(0,12);pad.PaddingBottom=UDim.new(0,12)

local ll=Instance.new("UIListLayout",frame)
ll.SortOrder=Enum.SortOrder.LayoutOrder; ll.Padding=UDim.new(0,8)
ll.FillDirection=Enum.FillDirection.Vertical

local function lbl(txt,sz,col,ord)
    local l=Instance.new("TextLabel",frame)
    l.Size=UDim2.new(1,0,0,sz); l.BackgroundTransparency=1
    l.Font=Enum.Font.GothamBold; l.TextSize=sz-6
    l.TextColor3=col; l.Text=txt
    l.TextXAlignment=Enum.TextXAlignment.Left; l.LayoutOrder=ord; return l
end
local function mkbtn(txt,bg,tc,ord)
    local b=Instance.new("TextButton",frame)
    b.Size=UDim2.new(1,0,0,34); b.BackgroundColor3=bg
    b.BorderSizePixel=0; b.Font=Enum.Font.GothamBold
    b.TextSize=13; b.TextColor3=tc; b.Text=txt; b.LayoutOrder=ord
    Instance.new("UICorner",b).CornerRadius=UDim.new(0,6); return b
end

-- Header
local header=Instance.new("TextLabel",frame)
header.Size=UDim2.new(1,0,0,30); header.BackgroundTransparency=1
header.Font=Enum.Font.GothamBold; header.TextSize=18
header.Text="⚡ Storm AI"; header.TextXAlignment=Enum.TextXAlignment.Left
header.TextColor3=Color3.fromRGB(110,231,247); header.LayoutOrder=1

local statusLbl=lbl("Status: Enter session code",18,Color3.fromRGB(80,80,120),2)
statusLbl.Font=Enum.Font.Code; statusLbl.TextSize=11

-- Session input
lbl("SESSION CODE FROM WEBSITE:",14,Color3.fromRGB(60,60,90),3).Font=Enum.Font.Code

local sessionInput=Instance.new("TextBox",frame)
sessionInput.Size=UDim2.new(1,0,0,38); sessionInput.BackgroundColor3=Color3.fromRGB(15,15,25)
sessionInput.BorderSizePixel=0; sessionInput.Font=Enum.Font.Code; sessionInput.TextSize=18
sessionInput.TextColor3=Color3.fromRGB(110,231,247); sessionInput.Text=""
sessionInput.PlaceholderText="e.g.  A1B2C3"
sessionInput.PlaceholderColor3=Color3.fromRGB(50,50,80)
sessionInput.ClearTextOnFocus=false; sessionInput.LayoutOrder=4
Instance.new("UICorner",sessionInput).CornerRadius=UDim.new(0,6)
local sip=Instance.new("UIPadding",sessionInput)
sip.PaddingLeft=UDim.new(0,12);sip.PaddingRight=UDim.new(0,12)

local connectBtn=mkbtn("✓  Connect",Color3.fromRGB(15,20,40),Color3.fromRGB(110,231,247),5)
local syncButton=mkbtn("↑  Sync Game to Website",Color3.fromRGB(20,30,25),Color3.fromRGB(93,232,176),6)

local div=Instance.new("Frame",frame); div.Size=UDim2.new(1,0,0,1)
div.BackgroundColor3=Color3.fromRGB(30,30,50); div.BorderSizePixel=0; div.LayoutOrder=7

local logTitle=lbl("ACTIVITY LOG",14,Color3.fromRGB(50,50,80),8)
logTitle.Font=Enum.Font.Code

local logScroll=Instance.new("ScrollingFrame",frame)
logScroll.Size=UDim2.new(1,0,1,-265); logScroll.BackgroundColor3=Color3.fromRGB(10,10,18)
logScroll.BorderSizePixel=0; logScroll.ScrollBarThickness=2
logScroll.AutomaticCanvasSize=Enum.AutomaticSize.Y
logScroll.CanvasSize=UDim2.new(1,0,0,0); logScroll.LayoutOrder=9
Instance.new("UICorner",logScroll).CornerRadius=UDim.new(0,6)
local lp=Instance.new("UIPadding",logScroll)
lp.PaddingLeft=UDim.new(0,8);lp.PaddingRight=UDim.new(0,8)
lp.PaddingTop=UDim.new(0,6);lp.PaddingBottom=UDim.new(0,6)
local logLL=Instance.new("UIListLayout",logScroll)
logLL.SortOrder=Enum.SortOrder.LayoutOrder; logLL.Padding=UDim.new(0,2)

local CYAN=Color3.fromRGB(110,231,247); local GREEN=Color3.fromRGB(93,232,176)
local PURPLE=Color3.fromRGB(167,139,250); local RED=Color3.fromRGB(255,77,106)
local YELLOW=Color3.fromRGB(247,201,72);  local GRAY=Color3.fromRGB(80,80,120)

local logIdx=0
local function addLog(text,color)
    logIdx+=1
    local e=Instance.new("TextLabel",logScroll)
    e.Size=UDim2.new(1,0,0,0); e.AutomaticSize=Enum.AutomaticSize.Y
    e.BackgroundTransparency=1; e.Font=Enum.Font.Code; e.TextSize=10
    e.TextColor3=color or GRAY; e.Text=text
    e.TextXAlignment=Enum.TextXAlignment.Left; e.TextWrapped=true; e.LayoutOrder=logIdx
    if logIdx>60 then
        for _,c in ipairs(logScroll:GetChildren()) do
            if c:IsA("TextLabel") and c.LayoutOrder<=logIdx-60 then c:Destroy() end
        end
    end
    task.defer(function() logScroll.CanvasPosition=Vector2.new(0,logScroll.AbsoluteCanvasSize.Y) end)
end

local function setStatus(msg,color)
    statusLbl.Text="Status: "..msg; statusLbl.TextColor3=color or GRAY; addLog(msg,color or GRAY)
end

-- ════════════════════════════════════════════════════════════
--  PATH RESOLVER
-- ════════════════════════════════════════════════════════════
local function resolvePath(pathStr)
    local parts=string.split(pathStr,".")
    local cur=game
    for _,part in ipairs(parts) do
        local found=cur:FindFirstChild(part)
        if not found then
            local ok,svc=pcall(function() return game:GetService(part) end)
            if ok and svc then found=svc end
        end
        if not found then return nil,"Not found: "..part end
        cur=found
    end
    return cur,nil
end

local function resolveParent(pathStr)
    local parts=string.split(pathStr,".")
    local name=table.remove(parts)
    local parent,err=resolvePath(table.concat(parts,"."))
    return parent,name,err
end

-- ════════════════════════════════════════════════════════════
--  ACTION APPLIER
-- ════════════════════════════════════════════════════════════
local function applyAction(action)
    local aType=action.action or ""; local path=action.path or ""; local code=action.code or ""
    ChangeHistoryService:SetWaypoint("StormAI: "..aType.." "..path)

    if aType=="write_script" then
        local sType=resolveType(action)
        addLog("→ "..sType..": "..path,PURPLE)
        local existing,_=resolvePath(path)
        if existing and existing:IsA("LuaSourceContainer") then
            if existing.ClassName~=sType then
                local par=existing.Parent; local nm=existing.Name; existing:Destroy()
                local ns=Instance.new(sType); ns.Name=nm; ns.Source=code; ns.Parent=par
                addLog("✅ Replaced as "..sType..": "..nm,GREEN)
                Selection:Set({ns}); plugin:OpenScript(ns)
            else
                existing.Source=code
                addLog("✏️  Updated: "..path,GREEN)
                Selection:Set({existing}); plugin:OpenScript(existing)
            end
            return true
        end
        local parent,sName,err=resolveParent(path)
        if not parent then addLog("❌ Bad path: "..tostring(err),RED); return false end
        local ns=Instance.new(sType); ns.Name=sName; ns.Source=code; ns.Parent=parent
        addLog("✅ Created "..sType..": "..sName,GREEN)
        Selection:Set({ns}); plugin:OpenScript(ns); return true

    elseif aType=="delete_script" then
        local obj,err=resolvePath(path)
        if obj then obj:Destroy(); addLog("🗑️  Deleted: "..path,YELLOW); return true end
        addLog("❌ Delete failed: "..tostring(err),RED); return false

    elseif aType=="create_folder" then
        local parent,fname,err=resolveParent(path)
        if parent then
            local f=Instance.new("Folder"); f.Name=fname; f.Parent=parent
            addLog("📁 Folder: "..path,GREEN); return true
        end
        addLog("❌ Folder failed: "..tostring(err),RED); return false
    end
    addLog("⚠️  Unknown: "..tostring(aType),YELLOW); return false
end

-- ════════════════════════════════════════════════════════════
--  GAME TREE SYNC (optional — website also reads from rbxlx)
-- ════════════════════════════════════════════════════════════
local function buildTree(inst,depth)
    if depth>5 then return nil end
    local r={__type=inst.ClassName}
    for _,child in ipairs(inst:GetChildren()) do
        local cd=buildTree(child,depth+1)
        if cd then r[child.Name]=cd end
    end
    return r
end

local function doSync()
    if SESSION_ID=="" then setStatus("Enter session code first",RED); return end
    setStatus("Syncing...",CYAN)
    local tree={}
    for _,svcName in ipairs({"Workspace","ServerScriptService","ServerStorage","ReplicatedStorage","StarterGui","StarterPack","StarterPlayer","Lighting","ReplicatedFirst"}) do
        local ok,svc=pcall(function() return game:GetService(svcName) end)
        if ok and svc then local ok2,t=pcall(buildTree,svc,0); if ok2 and t then tree[svcName]=t end end
    end
    local ok,err=pcall(function()
        HttpService:PostAsync(WEBSITE_URL.."/api/sync-tree",
            HttpService:JSONEncode({sessionId=SESSION_ID,tree=tree}),
            Enum.HttpContentType.ApplicationJson)
    end)
    if ok then setStatus("✅ Synced",GREEN) else setStatus("❌ "..tostring(err):sub(1,40),RED) end
end

-- ════════════════════════════════════════════════════════════
--  ERROR REPORTING
-- ════════════════════════════════════════════════════════════
LogService.MessageOut:Connect(function(msg,msgType)
    if msgType==Enum.MessageType.MessageError then
        addLog("🔴 "..msg:sub(1,80),RED)
        if SESSION_ID~="" then
            pcall(function()
                HttpService:PostAsync(WEBSITE_URL.."/api/report-error",
                    HttpService:JSONEncode({sessionId=SESSION_ID,error=msg}),
                    Enum.HttpContentType.ApplicationJson)
            end)
        end
    end
end)

-- ════════════════════════════════════════════════════════════
--  POLL FOR ACTIONS
-- ════════════════════════════════════════════════════════════
local isPolling=false
local function pollActions()
    while isPolling do
        if SESSION_ID~="" then
            local ok,result=pcall(function()
                return HttpService:GetAsync(WEBSITE_URL.."/api/get-actions?sessionId="..SESSION_ID,true)
            end)
            if ok and result then
                local ok2,data=pcall(HttpService.JSONDecode,HttpService,result)
                if ok2 and data and data.actions and #data.actions>0 then
                    addLog("📥 "..#data.actions.." action(s) from website",PURPLE)
                    for _,act in ipairs(data.actions) do applyAction(act) end
                    task.delay(1,doSync)
                end
            end
        end
        task.wait(POLL_INTERVAL)
    end
end

-- ════════════════════════════════════════════════════════════
--  BUTTONS
-- ════════════════════════════════════════════════════════════
connectBtn.MouseButton1Click:Connect(function()
    local code=sessionInput.Text:upper():gsub("%s","")
    if #code<4 then setStatus("Code too short",RED); return end
    SESSION_ID=code
    setStatus("Connected: "..SESSION_ID,GREEN)
    connectBtn.Text="✓  Connected: "..SESSION_ID
    connectBtn.BackgroundColor3=Color3.fromRGB(8,25,15)
    connectBtn.TextColor3=GREEN
    doSync()
end)

syncButton.MouseButton1Click:Connect(doSync)
syncBtn.Click:Connect(doSync)
mainBtn.Click:Connect(function() widget.Enabled=not widget.Enabled end)

-- ════════════════════════════════════════════════════════════
--  START
-- ════════════════════════════════════════════════════════════
isPolling=true
task.spawn(pollActions)
plugin.Unloading:Connect(function() isPolling=false end)

addLog("⚡ Storm AI loaded",CYAN)
addLog("Website: "..WEBSITE_URL,GRAY)
addLog("Enter session code from website",GRAY)

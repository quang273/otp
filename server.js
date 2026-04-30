
require("dotenv").config();

const fetch = require("node-fetch");
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const GRIZZLY_URL = "https://api.grizzlysms.com/stubs/handler_api.php";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "";

const DEFAULT_CONFIG = {
  admin_password: process.env.ADMIN_PASSWORD || "123456",
  access_password: process.env.ACCESS_PASSWORD || "123456",
  grizzly_api_key: process.env.GRIZZLY_API_KEY || "",
  service: "lf",
  country: "6",
  country_name: "Indonesia",
  dial: "+62",
  cost: 0.01,
  quick_text: ""
};

const COUNTRY = {
  "0":["Russia","+7","🇷🇺"],"1":["Ukraine","+380","🇺🇦"],"2":["Kazakhstan","+7","🇰🇿"],"3":["China","+86","🇨🇳"],"4":["Philippines","+63","🇵🇭"],
  "5":["Myanmar","+95","🇲🇲"],"6":["Indonesia","+62","🇮🇩"],"7":["Malaysia","+60","🇲🇾"],"8":["Kenya","+254","🇰🇪"],"9":["Tanzania","+255","🇹🇿"],
  "10":["Vietnam","+84","🇻🇳"],"11":["Kyrgyzstan","+996","🇰🇬"],"12":["United States virtual","+1","🇺🇸"],"13":["Israel","+972","🇮🇱"],
  "14":["Hong Kong","+852","🇭🇰"],"15":["Poland","+48","🇵🇱"],"16":["United Kingdom","+44","🇬🇧"],"22":["India","+91","🇮🇳"],
  "30":["Brazil","+55","🇧🇷"],"32":["Romania","+40","🇷🇴"],"33":["Colombia","+57","🇨🇴"],"36":["Canada","+1","🇨🇦"],
  "43":["Germany","+49","🇩🇪"],"46":["Sweden","+46","🇸🇪"],"48":["Netherlands","+31","🇳🇱"],"52":["Thailand","+66","🇹🇭"],
  "56":["Spain","+34","🇪🇸"],"73":["France","+33","🇫🇷"],"78":["Italy","+39","🇮🇹"],"86":["Mexico","+52","🇲🇽"],
  "117":["Portugal","+351","🇵🇹"],"182":["Japan","+81","🇯🇵"],"187":["United States","+1","🇺🇸"]
};

function domainFromReq(req) {
  const h = req.headers["x-forwarded-host"] || req.headers.host || "default";
  return String(Array.isArray(h) ? h[0] : h).split(":")[0].replace(/^www\./i, "").toLowerCase().trim();
}

function needSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("MISSING_SUPABASE_ENV");
}

async function sb(pathname, options = {}) {
  needSupabase();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}

async function getConfig(domain) {
  const rows = await sb(`domain_configs?domain=eq.${encodeURIComponent(domain)}&select=*`);
  if (Array.isArray(rows) && rows.length) return { ...DEFAULT_CONFIG, ...rows[0] };

  const row = { domain, ...DEFAULT_CONFIG };
  await sb("domain_configs", { method:"POST", body:JSON.stringify(row), prefer:"return=minimal" });
  return row;
}

async function saveConfig(domain, config) {
  await sb("domain_configs", {
    method:"POST",
    body:JSON.stringify({
      domain,
      admin_password: config.admin_password,
      access_password: config.access_password,
      grizzly_api_key: config.grizzly_api_key,
      service: config.service,
      country: config.country,
      country_name: config.country_name,
      dial: config.dial,
      cost: Number(config.cost || 0),
      quick_text: config.quick_text || "",
      updated_at: new Date().toISOString()
    }),
    prefer:"resolution=merge-duplicates,return=minimal"
  });
}

function mask(k) {
  if (!k) return "chưa có";
  return k.length > 8 ? `${k.slice(0,4)}...${k.slice(-4)}` : "********";
}

async function access(req, res, next) {
  try {
    const domain = domainFromReq(req);
    const config = await getConfig(domain);
    if (String(req.headers["x-access-password"] || "") !== config.access_password) {
      return res.status(403).json({ ok:false, error:"ACCESS_PASSWORD_INVALID", domain });
    }
    req.domainKey = domain;
    req.config = config;
    next();
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
}

async function admin(req, res, next) {
  try {
    const domain = domainFromReq(req);
    const config = await getConfig(domain);
    if (String(req.headers["x-admin-password"] || "") !== config.admin_password) {
      return res.status(403).json({ ok:false, error:"ADMIN_PASSWORD_INVALID", domain });
    }
    req.domainKey = domain;
    req.config = config;
    next();
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
}

async function grizzly(config, params) {
  if (!config.grizzly_api_key) throw new Error("MISSING_GRIZZLY_API_KEY");
  const url = new URL(GRIZZLY_URL);
  url.searchParams.set("api_key", config.grizzly_api_key);
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const r = await fetch(url);
  return (await r.text()).trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req,res) => res.json({ ok:true, domain:domainFromReq(req), supabase:Boolean(SUPABASE_URL && SUPABASE_KEY) }));

app.post("/api/auth/check-access", access, (req,res) => res.json({ ok:true, domain:req.domainKey }));

app.get("/api/app/config", access, (req,res) => {
  const c = req.config;
  res.json({
    ok:true,
    domain:req.domainKey,
    quickText:c.quick_text || "",
    selected:{ service:c.service, country:c.country, name:c.country_name, dial:c.dial, cost:c.cost }
  });
});

app.get("/api/balance", async (req,res) => {
  try {
    const domain = domainFromReq(req);
    const config = await getConfig(domain);
    const raw = await grizzly(config, { action:"getBalance" });
    res.json({ ok:true, balance: raw.startsWith("ACCESS_BALANCE:") ? raw.split(":")[1] : raw, raw, domain });
  } catch(e) {
    res.json({ ok:false, error:e.message, domain:domainFromReq(req) });
  }
});

app.post("/api/admin/login", admin, (req,res) => {
  const c = req.config;
  res.json({ ok:true, domain:req.domainKey, settings:{ keyMasked:mask(c.grizzly_api_key), service:c.service, country:c.country, name:c.country_name, dial:c.dial, cost:c.cost, quickText:c.quick_text || "" } });
});

app.get("/api/admin/prices", admin, async (req,res) => {
  try {
    const raw = await grizzly(req.config, { action:"getPrices", service:"lf" });
    const data = JSON.parse(raw);
    const rows = [];
    for (const [country, services] of Object.entries(data || {})) {
      if (!services || !services.lf) continue;
      const item = services.lf;
      const count = Number(item.count || 0);
      const cost = Number(item.cost || 0);
      if (count <= 0) continue;
      const info = COUNTRY[country] || ["Country "+country, "+", "🌍"];
      rows.push({ country, service:"lf", name:info[0], dial:info[1], flag:info[2], count, cost });
    }
    rows.sort((a,b) => a.cost === b.cost ? b.count - a.count : a.cost - b.cost);
    res.json({ ok:true, prices:rows });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post("/api/admin/save", admin, async (req,res) => {
  try {
    const c = { ...req.config };
    const adminPassword = String(req.body.adminPassword || "").trim();
    const accessPassword = String(req.body.accessPassword || "").trim();
    const apiKey = String(req.body.apiKey || "").trim();

    if (adminPassword && adminPassword.length < 4) return res.json({ ok:false, error:"Mật khẩu admin quá ngắn" });
    if (accessPassword && accessPassword.length < 4) return res.json({ ok:false, error:"Mật khẩu truy cập quá ngắn" });

    if (adminPassword) c.admin_password = adminPassword;
    if (accessPassword) c.access_password = accessPassword;
    if (apiKey) c.grizzly_api_key = apiKey;
    c.quick_text = String(req.body.quickText ?? c.quick_text ?? "").trim();

    if (req.body.country) {
      c.service = "lf";
      c.country = String(req.body.country);
      c.country_name = String(req.body.name || c.country_name);
      c.dial = String(req.body.dial || c.dial);
      c.cost = Number(req.body.cost || 0);
    }

    await saveConfig(req.domainKey, c);
    res.json({ ok:true, settings:{ keyMasked:mask(c.grizzly_api_key), service:c.service, country:c.country, name:c.country_name, dial:c.dial, cost:c.cost, quickText:c.quick_text || "" } });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post("/api/rent", access, async (req,res) => {
  try {
    const c = req.config;
    const raw = await grizzly(c, { action:"getNumber", service:c.service, country:c.country });
    if (raw.startsWith("ACCESS_NUMBER:")) {
      const [, id, phone] = raw.split(":");
      return res.json({ ok:true, id, phone, selected:{ name:c.country_name, dial:c.dial, cost:c.cost } });
    }
    res.json({ ok:false, error:raw });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get("/api/status", access, async (req,res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) return res.status(400).json({ ok:false, error:"MISSING_ID" });
    const raw = await grizzly(req.config, { action:"getStatus", id });
    if (raw.startsWith("STATUS_OK:")) return res.json({ ok:true, code:raw.split(":").slice(1).join(":") });
    res.json({ ok:true, status:"waiting", raw });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post("/api/cancel", access, async (req,res) => {
  try {
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({ ok:false, error:"MISSING_ID" });
    const raw = await grizzly(req.config, { action:"setStatus", status:"8", id });
    res.json({ ok:true, raw });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get("/api/saved-2fa", access, async (req,res) => {
  try {
    const rows = await sb(`saved_2fa_accounts?domain=eq.${encodeURIComponent(req.domainKey)}&select=id,combo,created_at&order=created_at.desc`);
    res.json({ ok:true, rows });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post("/api/saved-2fa", access, async (req,res) => {
  try {
    const combo = String(req.body.combo || "").trim();
    if (!combo || !combo.includes("|")) return res.status(400).json({ ok:false, error:"BAD_COMBO" });
    await sb("saved_2fa_accounts", { method:"POST", body:JSON.stringify({ domain:req.domainKey, combo }), prefer:"return=minimal" });
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.delete("/api/saved-2fa", access, async (req,res) => {
  try {
    await sb(`saved_2fa_accounts?domain=eq.${encodeURIComponent(req.domainKey)}`, { method:"DELETE", prefer:"return=minimal" });
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.listen(PORT, () => console.log("OTP Tool running on port " + PORT));

require("dotenv").config();
const fs = require("fs");
const fetch = require("node-fetch");
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, "config.json");
const GRIZZLY_URL = "https://api.grizzlysms.com/stubs/handler_api.php";

const DEFAULT_DOMAIN_CONFIG = {
  adminPassword: process.env.ADMIN_PASSWORD || "123456",
  accessPassword: process.env.ACCESS_PASSWORD || "123456",
  grizzlyApiKey: process.env.GRIZZLY_API_KEY || "",
  service: "lf",
  country: "6",
  countryName: "Indonesia",
  dial: "+62",
  cost: 0.01
};

const COUNTRY = {
  "0":["Russia","+7","🇷🇺"],"1":["Ukraine","+380","🇺🇦"],"2":["Kazakhstan","+7","🇰🇿"],"3":["China","+86","🇨🇳"],
  "4":["Philippines","+63","🇵🇭"],"5":["Myanmar","+95","🇲🇲"],"6":["Indonesia","+62","🇮🇩"],"7":["Malaysia","+60","🇲🇾"],
  "8":["Kenya","+254","🇰🇪"],"9":["Tanzania","+255","🇹🇿"],"10":["Vietnam","+84","🇻🇳"],"11":["Kyrgyzstan","+996","🇰🇬"],
  "12":["United States virtual","+1","🇺🇸"],"13":["Israel","+972","🇮🇱"],"14":["Hong Kong","+852","🇭🇰"],"15":["Poland","+48","🇵🇱"],
  "16":["United Kingdom","+44","🇬🇧"],"22":["India","+91","🇮🇳"],"30":["Brazil","+55","🇧🇷"],"32":["Romania","+40","🇷🇴"],
  "33":["Colombia","+57","🇨🇴"],"36":["Canada","+1","🇨🇦"],"43":["Germany","+49","🇩🇪"],"46":["Sweden","+46","🇸🇪"],
  "48":["Netherlands","+31","🇳🇱"],"52":["Thailand","+66","🇹🇭"],"56":["Spain","+34","🇪🇸"],"73":["France","+33","🇫🇷"],
  "78":["Italy","+39","🇮🇹"],"86":["Mexico","+52","🇲🇽"],"117":["Portugal","+351","🇵🇹"],"182":["Japan","+81","🇯🇵"],
  "187":["United States","+1","🇺🇸"]
};

function cleanHost(host) {
  return String(host || "default").split(":")[0].replace(/^www\./i, "").toLowerCase().trim() || "default";
}
function domainFromReq(req) {
  const forwarded = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.headers.host || "default");
  return cleanHost(host);
}
function readStore() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const initial = { domains: { default: { ...DEFAULT_DOMAIN_CONFIG } } };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!data.domains) {
      const migrated = { domains: { default: { ...DEFAULT_DOMAIN_CONFIG, ...data } } };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(migrated, null, 2));
      return migrated;
    }
    return data;
  } catch {
    return { domains: { default: { ...DEFAULT_DOMAIN_CONFIG } } };
  }
}
function writeStore(store) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(store, null, 2));
}
function getDomainConfig(domain) {
  const store = readStore();
  if (!store.domains[domain]) {
    const fallback = store.domains.default || DEFAULT_DOMAIN_CONFIG;
    store.domains[domain] = { ...DEFAULT_DOMAIN_CONFIG, ...fallback };
    writeStore(store);
  }
  return { ...DEFAULT_DOMAIN_CONFIG, ...store.domains[domain] };
}
function setDomainConfig(domain, config) {
  const store = readStore();
  store.domains[domain] = { ...DEFAULT_DOMAIN_CONFIG, ...config };
  writeStore(store);
}
function mask(k) {
  if (!k) return "chưa có";
  return k.length > 8 ? k.slice(0,4) + "..." + k.slice(-4) : "********";
}
function authAccess(req, res, next) {
  const domain = domainFromReq(req);
  const config = getDomainConfig(domain);
  if (String(req.headers["x-access-password"] || "") !== config.accessPassword) {
    return res.status(403).json({ ok:false, error:"ACCESS_PASSWORD_INVALID", domain });
  }
  req.domainKey = domain;
  req.domainConfig = config;
  next();
}
function authAdmin(req, res, next) {
  const domain = domainFromReq(req);
  const config = getDomainConfig(domain);
  if (String(req.headers["x-admin-password"] || "") !== config.adminPassword) {
    return res.status(403).json({ ok:false, error:"ADMIN_PASSWORD_INVALID", domain });
  }
  req.domainKey = domain;
  req.domainConfig = config;
  next();
}
async function grizzly(config, params) {
  if (!config.grizzlyApiKey) throw new Error("MISSING_GRIZZLY_API_KEY");
  const url = new URL(GRIZZLY_URL);
  url.searchParams.set("api_key", config.grizzlyApiKey);
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const r = await fetch(url);
  return (await r.text()).trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/check-access", authAccess, (req,res) => res.json({ ok:true, domain:req.domainKey }));

app.get("/api/app/config", authAccess, (req,res) => {
  const c = req.domainConfig;
  res.json({ ok:true, domain:req.domainKey, selected:{ service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost } });
});

app.post("/api/admin/login", authAdmin, (req,res) => {
  const c = req.domainConfig;
  res.json({ ok:true, domain:req.domainKey, settings:{ keyMasked:mask(c.grizzlyApiKey), service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost } });
});

app.get("/api/admin/prices", authAdmin, async (req,res) => {
  try {
    const raw = await grizzly(req.domainConfig, { action:"getPrices", service:"lf" });
    const data = JSON.parse(raw);
    const rows = [];
    for (const [country, services] of Object.entries(data || {})) {
      if (!services || !services.lf) continue;
      const item = services.lf;
      const count = Number(item.count || 0);
      const cost = Number(item.cost || 0);
      if (count <= 0) continue;
      const info = COUNTRY[country] || ["Country " + country, "+", "🌍"];
      rows.push({ country, service:"lf", name:info[0], dial:info[1], flag:info[2], count, cost });
    }
    rows.sort((a,b) => a.cost === b.cost ? b.count - a.count : a.cost - b.cost);
    res.json({ ok:true, domain:req.domainKey, prices:rows });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message, domain:req.domainKey });
  }
});

app.post("/api/admin/save", authAdmin, (req,res) => {
  const c = { ...req.domainConfig };
  const adminPassword = String(req.body.adminPassword || "").trim();
  const accessPassword = String(req.body.accessPassword || "").trim();
  const apiKey = String(req.body.apiKey || "").trim();

  if (adminPassword && adminPassword.length < 4) return res.json({ ok:false, error:"Mật khẩu admin quá ngắn" });
  if (accessPassword && accessPassword.length < 4) return res.json({ ok:false, error:"Mật khẩu truy cập quá ngắn" });

  if (adminPassword) c.adminPassword = adminPassword;
  if (accessPassword) c.accessPassword = accessPassword;
  if (apiKey) c.grizzlyApiKey = apiKey;

  if (req.body.country) {
    c.service = "lf";
    c.country = String(req.body.country);
    c.countryName = String(req.body.name || c.countryName);
    c.dial = String(req.body.dial || c.dial);
    c.cost = Number(req.body.cost || 0);
  }

  setDomainConfig(req.domainKey, c);
  res.json({ ok:true, domain:req.domainKey, settings:{ keyMasked:mask(c.grizzlyApiKey), service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost } });
});

app.post("/api/rent", authAccess, async (req,res) => {
  try {
    const c = req.domainConfig;
    const raw = await grizzly(c, { action:"getNumber", service:c.service, country:c.country });
    if (raw.startsWith("ACCESS_NUMBER:")) {
      const [, id, phone] = raw.split(":");
      return res.json({ ok:true, domain:req.domainKey, id, phone, selected:{ name:c.countryName, dial:c.dial, cost:c.cost } });
    }
    res.json({ ok:false, error:raw, domain:req.domainKey });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message, domain:req.domainKey });
  }
});

app.get("/api/status", authAccess, async (req,res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) return res.status(400).json({ ok:false, error:"MISSING_ID" });
    const raw = await grizzly(req.domainConfig, { action:"getStatus", id });
    if (raw.startsWith("STATUS_OK:")) return res.json({ ok:true, code:raw.split(":").slice(1).join(":"), domain:req.domainKey });
    res.json({ ok:true, status:"waiting", raw, domain:req.domainKey });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message, domain:req.domainKey });
  }
});

app.post("/api/cancel", authAccess, async (req,res) => {
  try {
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({ ok:false, error:"MISSING_ID" });
    const raw = await grizzly(req.domainConfig, { action:"setStatus", status:"8", id });
    res.json({ ok:true, raw, domain:req.domainKey });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message, domain:req.domainKey });
  }
});

app.listen(PORT, () => console.log("OTP multi-domain tool running on port " + PORT));
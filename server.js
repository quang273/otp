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

const DEFAULT_CONFIG = {
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
  "6": ["Indonesia", "+62", "🇮🇩"],
  "10": ["Vietnam", "+84", "🇻🇳"],
  "16": ["United Kingdom", "+44", "🇬🇧"],
  "36": ["Canada", "+1", "🇨🇦"],
  "52": ["Thailand", "+66", "🇹🇭"],
  "73": ["France", "+33", "🇫🇷"],
  "182": ["Japan", "+81", "🇯🇵"],
  "187": ["United States", "+1", "🇺🇸"]
};

function cfg() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
      return { ...DEFAULT_CONFIG };
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveCfg(c) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
}

function mask(k) {
  if (!k) return "chưa có";
  return k.length > 8 ? k.slice(0,4) + "..." + k.slice(-4) : "********";
}

function authAccess(req, res, next) {
  if (String(req.headers["x-access-password"] || "") !== cfg().accessPassword) {
    return res.status(403).json({ ok:false, error:"ACCESS_PASSWORD_INVALID" });
  }
  next();
}

function authAdmin(req, res, next) {
  if (String(req.headers["x-admin-password"] || "") !== cfg().adminPassword) {
    return res.status(403).json({ ok:false, error:"ADMIN_PASSWORD_INVALID" });
  }
  next();
}

async function grizzly(params) {
  const c = cfg();
  if (!c.grizzlyApiKey) throw new Error("MISSING_GRIZZLY_API_KEY");

  const url = new URL(GRIZZLY_URL);
  url.searchParams.set("api_key", c.grizzlyApiKey);
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const r = await fetch(url);
  return (await r.text()).trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/check-access", authAccess, (req,res) => res.json({ok:true}));

app.get("/api/app/config", authAccess, (req,res) => {
  const c = cfg();
  res.json({ok:true, selected:{service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost}});
});

app.post("/api/admin/login", authAdmin, (req,res) => {
  const c = cfg();
  res.json({ok:true, settings:{keyMasked:mask(c.grizzlyApiKey), service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost}});
});

app.get("/api/admin/prices", authAdmin, async (req,res) => {
  try {
    const raw = await grizzly({action:"getPrices", service:"lf"});
    const data = JSON.parse(raw);
    const rows = [];

    for (const [country, services] of Object.entries(data || {})) {
      if (!services || !services.lf) continue;
      const item = services.lf;
      const count = Number(item.count || 0);
      const cost = Number(item.cost || 0);
      if (count <= 0) continue;

      const info = COUNTRY[country] || ["Country " + country, "+", "🌍"];
      rows.push({country, service:"lf", name:info[0], dial:info[1], flag:info[2], count, cost});
    }

    rows.sort((a,b) => a.cost === b.cost ? b.count - a.count : a.cost - b.cost);
    res.json({ok:true, prices:rows});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

app.post("/api/admin/save", authAdmin, (req,res) => {
  const c = cfg();
  const adminPassword = String(req.body.adminPassword || "").trim();
  const accessPassword = String(req.body.accessPassword || "").trim();
  const apiKey = String(req.body.apiKey || "").trim();

  if (adminPassword && adminPassword.length < 4) return res.json({ok:false, error:"Mật khẩu admin quá ngắn"});
  if (accessPassword && accessPassword.length < 4) return res.json({ok:false, error:"Mật khẩu truy cập quá ngắn"});

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

  saveCfg(c);
  res.json({ok:true, settings:{keyMasked:mask(c.grizzlyApiKey), service:c.service, country:c.country, name:c.countryName, dial:c.dial, cost:c.cost}});
});

app.post("/api/rent", authAccess, async (req,res) => {
  try {
    const c = cfg();
    const raw = await grizzly({action:"getNumber", service:c.service, country:c.country});
    if (raw.startsWith("ACCESS_NUMBER:")) {
      const [, id, phone] = raw.split(":");
      return res.json({ok:true, id, phone, selected:{name:c.countryName, dial:c.dial, cost:c.cost}});
    }
    res.json({ok:false, error:raw});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

app.get("/api/status", authAccess, async (req,res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) return res.status(400).json({ok:false, error:"MISSING_ID"});
    const raw = await grizzly({action:"getStatus", id});
    if (raw.startsWith("STATUS_OK:")) return res.json({ok:true, code:raw.split(":").slice(1).join(":")});
    res.json({ok:true, status:"waiting", raw});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

app.post("/api/cancel", authAccess, async (req,res) => {
  try {
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({ok:false, error:"MISSING_ID"});
    const raw = await grizzly({action:"setStatus", status:"8", id});
    res.json({ok:true, raw});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

app.listen(PORT, () => console.log("OTP tool running on port " + PORT));
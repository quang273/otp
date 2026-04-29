
require("dotenv").config();
const express = require("express");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GRIZZLY_URL = "https://api.grizzlysms.com/stubs/handler_api.php";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";

const DEFAULT_CONFIG = {
  admin_password: process.env.ADMIN_PASSWORD || "123456",
  access_password: process.env.ACCESS_PASSWORD || "123456",
  grizzly_api_key: process.env.GRIZZLY_API_KEY || "",
  service: "lf",
  country: "6",
  country_name: "Indonesia",
  dial: "+62",
  cost: 0.01
};

const COUNTRY = {
  "6":["Indonesia","+62","🇮🇩"],
  "10":["Vietnam","+84","🇻🇳"],
  "16":["United Kingdom","+44","🇬🇧"],
  "22":["India","+91","🇮🇳"],
  "30":["Brazil","+55","🇧🇷"],
  "36":["Canada","+1","🇨🇦"],
  "43":["Germany","+49","🇩🇪"],
  "48":["Netherlands","+31","🇳🇱"],
  "52":["Thailand","+66","🇹🇭"],
  "73":["France","+33","🇫🇷"],
  "78":["Italy","+39","🇮🇹"],
  "86":["Mexico","+52","🇲🇽"],
  "187":["United States","+1","🇺🇸"]
};

function getDomain(req) {
  const h = req.headers["x-forwarded-host"] || req.headers.host || "default";
  return String(Array.isArray(h) ? h[0] : h).split(":")[0].replace(/^www\./i, "").toLowerCase().trim() || "default";
}

async function supabase(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("MISSING_SUPABASE_ENV");

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
  const rows = await supabase(`domain_configs?domain=eq.${encodeURIComponent(domain)}&select=*`);
  if (Array.isArray(rows) && rows.length) return { ...DEFAULT_CONFIG, ...rows[0] };

  const config = { domain, ...DEFAULT_CONFIG };
  await supabase("domain_configs", {
    method: "POST",
    body: JSON.stringify(config),
    prefer: "return=minimal"
  });
  return config;
}

async function saveConfig(domain, config) {
  await supabase("domain_configs", {
    method: "POST",
    body: JSON.stringify({
      domain,
      admin_password: config.admin_password,
      access_password: config.access_password,
      grizzly_api_key: config.grizzly_api_key,
      service: config.service,
      country: config.country,
      country_name: config.country_name,
      dial: config.dial,
      cost: Number(config.cost || 0),
      updated_at: new Date().toISOString()
    }),
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

function maskKey(key) {
  if (!key) return "chưa có";
  return key.length > 8 ? key.slice(0, 4) + "..." + key.slice(-4) : "********";
}

async function requireAccess(req, res, next) {
  try {
    const domain = getDomain(req);
    const config = await getConfig(domain);
    if (String(req.headers["x-access-password"] || "") !== config.access_password) {
      return res.status(403).json({ ok: false, error: "ACCESS_PASSWORD_INVALID", domain });
    }
    req.domain = domain;
    req.config = config;
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const domain = getDomain(req);
    const config = await getConfig(domain);
    if (String(req.headers["x-admin-password"] || "") !== config.admin_password) {
      return res.status(403).json({ ok: false, error: "ADMIN_PASSWORD_INVALID", domain });
    }
    req.domain = domain;
    req.config = config;
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function callGrizzly(config, params) {
  if (!config.grizzly_api_key) throw new Error("MISSING_GRIZZLY_API_KEY");

  const url = new URL(GRIZZLY_URL);
  url.searchParams.set("api_key", config.grizzly_api_key);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const response = await fetch(url);
  return (await response.text()).trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, domain: getDomain(req), supabase: Boolean(SUPABASE_URL && SUPABASE_KEY) });
});

app.post("/api/auth/check-access", requireAccess, (req, res) => {
  res.json({ ok: true, domain: req.domain });
});

app.get("/api/app/config", requireAccess, (req, res) => {
  const c = req.config;
  res.json({
    ok: true,
    domain: req.domain,
    selected: {
      service: c.service,
      country: c.country,
      name: c.country_name,
      dial: c.dial,
      cost: c.cost
    }
  });
});

// Quan trọng: route này KHÔNG chặn mật khẩu để mở trực tiếp /api/balance vẫn xem được.
app.get("/api/balance", async (req, res) => {
  try {
    const domain = getDomain(req);
    const config = await getConfig(domain);
    const raw = await callGrizzly(config, { action: "getBalance" });

    let balance = raw;
    if (raw.startsWith("ACCESS_BALANCE:")) balance = raw.split(":")[1];

    res.json({ ok: true, balance, raw, domain });
  } catch (err) {
    res.json({ ok: false, error: err.message, domain: getDomain(req) });
  }
});

app.post("/api/admin/login", requireAdmin, (req, res) => {
  const c = req.config;
  res.json({
    ok: true,
    domain: req.domain,
    settings: {
      keyMasked: maskKey(c.grizzly_api_key),
      service: c.service,
      country: c.country,
      name: c.country_name,
      dial: c.dial,
      cost: c.cost
    }
  });
});

app.get("/api/admin/prices", requireAdmin, async (req, res) => {
  try {
    const raw = await callGrizzly(req.config, { action: "getPrices", service: "lf" });
    const data = JSON.parse(raw);
    const prices = [];

    for (const [country, services] of Object.entries(data || {})) {
      if (!services || !services.lf) continue;
      const item = services.lf;
      const count = Number(item.count || 0);
      const cost = Number(item.cost || 0);
      if (count <= 0) continue;

      const info = COUNTRY[country] || ["Country " + country, "+", "🌍"];
      prices.push({
        country,
        service: "lf",
        name: info[0],
        dial: info[1],
        flag: info[2],
        count,
        cost
      });
    }

    prices.sort((a, b) => a.cost === b.cost ? b.count - a.count : a.cost - b.cost);
    res.json({ ok: true, prices, domain: req.domain });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, domain: req.domain });
  }
});

app.post("/api/admin/save", requireAdmin, async (req, res) => {
  try {
    const c = { ...req.config };

    const adminPassword = String(req.body.adminPassword || "").trim();
    const accessPassword = String(req.body.accessPassword || "").trim();
    const apiKey = String(req.body.apiKey || "").trim();

    if (adminPassword && adminPassword.length < 4) return res.json({ ok: false, error: "Mật khẩu admin quá ngắn" });
    if (accessPassword && accessPassword.length < 4) return res.json({ ok: false, error: "Mật khẩu truy cập quá ngắn" });

    if (adminPassword) c.admin_password = adminPassword;
    if (accessPassword) c.access_password = accessPassword;
    if (apiKey) c.grizzly_api_key = apiKey;

    if (req.body.country) {
      c.service = "lf";
      c.country = String(req.body.country);
      c.country_name = String(req.body.name || c.country_name);
      c.dial = String(req.body.dial || c.dial);
      c.cost = Number(req.body.cost || 0);
    }

    await saveConfig(req.domain, c);

    res.json({
      ok: true,
      domain: req.domain,
      settings: {
        keyMasked: maskKey(c.grizzly_api_key),
        service: c.service,
        country: c.country,
        name: c.country_name,
        dial: c.dial,
        cost: c.cost
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/rent", requireAccess, async (req, res) => {
  try {
    const c = req.config;
    const raw = await callGrizzly(c, { action: "getNumber", service: c.service, country: c.country });

    if (raw.startsWith("ACCESS_NUMBER:")) {
      const [, id, phone] = raw.split(":");
      return res.json({
        ok: true,
        id,
        phone,
        domain: req.domain,
        selected: {
          name: c.country_name,
          dial: c.dial,
          cost: c.cost
        }
      });
    }

    res.json({ ok: false, error: raw, domain: req.domain });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, domain: req.domain });
  }
});

app.get("/api/status", requireAccess, async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const raw = await callGrizzly(req.config, { action: "getStatus", id });

    if (raw.startsWith("STATUS_OK:")) {
      return res.json({
        ok: true,
        code: raw.split(":").slice(1).join(":"),
        domain: req.domain
      });
    }

    res.json({ ok: true, status: "waiting", raw, domain: req.domain });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, domain: req.domain });
  }
});

app.post("/api/cancel", requireAccess, async (req, res) => {
  try {
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const raw = await callGrizzly(req.config, { action: "setStatus", status: "8", id });
    res.json({ ok: true, raw, domain: req.domain });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, domain: req.domain });
  }
});

app.listen(PORT, () => {
  console.log("OTP Tool running on port " + PORT);
});

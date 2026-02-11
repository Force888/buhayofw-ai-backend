const path = require("path");
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
app.set("trust proxy", 1); // IMPORTANT when behind nginx / cloudflare
app.use(cookieParser());
app.use(express.json());

function getDeviceId(req) {
  // Prefer header sent by your frontend
  const h = req.get("x-device-id");
  if (h && typeof h === "string" && h.length >= 8) return h;

  // Fallback to cookie (if header missing)
  const c = req.cookies && req.cookies.kb_device_id;
  if (c && typeof c === "string" && c.length >= 8) return c;

  return "no_device";
}

function getAnonKey(req) {
  const ip = ipKeyGenerator(req);      // safe for IPv4/IPv6 + proxies
  const dev = getDeviceId(req);        // your header/cookie device id
  return `${ip}|${dev}`;
}

// Burst protection (stops spam clicking / bots)
const burstLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 6,              // 6 requests/min per ip+device
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAnonKey,
  handler: (req, res) => {
    return res.status(429).json({
      error: "RATE_LIMIT",
      message: "Too many requests. Please wait a bit and try again."
    });
  }
});

// Daily free quota for anonymous users
const anonDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours rolling
  max: 1,                        // 1 question/day
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAnonKey,
  handler: (req, res) => {
    return res.status(429).json({
      error: "DAILY_LIMIT",
      message: "You’ve used your free question for today. Please come back tomorrow or sign up."
    });
  }
});


// Serve the UI
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// OpenAI client
function stripLatex(text = "") {
  // Remove common LaTeX block delimiters
  let out = text
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "");

  // Replace some LaTeX commands with plain text equivalents
  out = out
    .replace(/\\times/g, " * ")
    .replace(/\\cdot/g, " * ")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1/$2)")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\!/g, "")
    .replace(/\s{2,}/g, " ");

  return out.trim();
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Ask endpoint
app.post("/ask", burstLimiter, anonDailyLimiter, async (req, res) => {
  try {
    const { question, history } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }
    // ---- thread memory from frontend (optional) ----
    let safeHistory = Array.isArray(history) ? history : [];

    // keep only last 8 messages (4 turns) + only allow user/assistant roles
    safeHistory = safeHistory
      .slice(-8)
      .filter(m =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
      )
      .map(m => ({ role: m.role, content: m.content.trim() }));

    // Avoid duplicating the current question if it is already the last user message
    const last = safeHistory[safeHistory.length - 1];
    const shouldAppendQuestion =
      !(last && last.role === "user" && last.content === question.trim());

        const completion = await client.responses.create({
  model: "gpt-4.1-mini",
 input: [
  {
    role: "system",
    content:
      "You are BuhayOFW AI. Answer clearly in plain text only. Do not use LaTeX, TeX, math blocks, backslashes, or special math symbols."
  },
  ...safeHistory,
  ...(shouldAppendQuestion ? [{ role: "user", content: question.trim() }] : [])
]


});



    const answer =
  completion.output_text ||
  completion.output?.[0]?.content?.[0]?.text ||
  "";

const cleaned = answer.replace(/\\n/g, "\n").trim();

    res.json({ answer: cleaned });
  } catch (err) {
    console.error("AI error:", err?.message || err);
    res.status(500).json({ error: "AI request failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "127.0.0.1", () => {
  console.log(`AI app listening on http://127.0.0.1:${port}`);
});

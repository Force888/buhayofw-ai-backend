const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const registerAdminRoutes = require("./admin-routes");
const { CHARACTER_CONFIG } = require("./character-config");
const { loadMemory, saveMemory, mergeMemory } = require("./memory-store");
const { buildInputMessages } = require("./prompt-builder");
const { extractMemoryUpdates } = require("./memory-extractor");
const { getNews } = require("./news-fetcher");
const multer = require("multer");
const sharp = require("sharp");
const { Resend } = require("resend");


dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {

    const allowed = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
];

    if (!allowed.includes(file.mimetype)) {
	return cb(new Error("Only JPEG, PNG, WebP, HEIC, or HEIF images are allowed."));
    }
    cb(null, true);
  }
});


function handleAskUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();

    console.error("Upload error:", err);

    return res.status(400).json({
      error: "IMAGE_UPLOAD_FAILED",
      message: err?.message || "Image upload failed."
    });
  });
}


async function prepareImageForOpenAI(file) {
  if (!file || !file.buffer) return null;


  const output = await sharp(file.buffer)

    .rotate()
    .resize({
      width: 1100,
      height: 1100,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 68,
      mozjpeg: true
    })
    .toBuffer();


  return {
    mimeType: "image/jpeg",
    base64: output.toString("base64"),
    bytes: output.length
  };
}


const DATA_DIR = path.join(__dirname, "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.jsonl");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");
const PENDING_NEWS_FILE = path.join(DATA_DIR, "pending_news.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

ensureJsonFile(SESSIONS_FILE, []);
ensureJsonFile(USERS_FILE, []);
ensureJsonFile(CONVERSATIONS_FILE, []);
ensureJsonFile(PENDING_NEWS_FILE, []);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJsonLine(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n");
}

function nowIso() {
  return new Date().toISOString();
}

function getManilaNowParts() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(now);

  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }

  return {
    isoUtc: now.toISOString(),
    weekday: map.weekday,
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    dayPeriod: (map.dayPeriod || "").toLowerCase(),
    display: `${map.weekday}, ${map.month}/${map.day}/${map.year}, ${map.hour}:${map.minute} ${map.dayPeriod}`
  };
}

function getManilaHour24(dateInput = new Date()) {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    hour12: false
  }).format(new Date(dateInput));

  return Number(hourStr);
}

function getManilaDateKey(dateInput = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(dateInput));
}

function getManilaDayPart(dateInput = new Date()) {
  const hour = getManilaHour24(dateInput);

  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "late night";
}

function formatIsoToManilaDisplay(isoString) {
  if (!isoString) return "";

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(new Date(isoString));
  } catch (_) {
    return String(isoString || "");
  }
}

function describeElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";

  const minutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function buildTimeContext({
  isLoggedIn,
  authUser,
  activeConversationId
}) {
  const manilaNow = getManilaNowParts();
  const dayPart = getManilaDayPart();

  let lastChatIso = null;
  let lastChatSource = "";

  if (activeConversationId) {
    const previousMessages = listConversationMessages(activeConversationId);

    if (previousMessages.length > 0) {
      const lastMsg = previousMessages[previousMessages.length - 1];
      lastChatIso = lastMsg.created_at || null;
      lastChatSource = "current conversation";
    }
  }

  if (!lastChatIso && isLoggedIn && authUser) {
    const previousConversations = listUserConversations(authUser.user_id)
      .filter((c) => c.conversation_id !== activeConversationId);

    if (previousConversations.length > 0) {
      const latestConversation = previousConversations[0];
      lastChatIso = latestConversation.updated_at || latestConversation.created_at || null;
      lastChatSource = "previous conversation";
    }
  }

  let elapsedText = "";
  let lastChatManila = "";

  if (lastChatIso) {
    const elapsedMs = Date.now() - new Date(lastChatIso).getTime();
    elapsedText = describeElapsed(elapsedMs);
    lastChatManila = formatIsoToManilaDisplay(lastChatIso);
  }

  const lines = [
    "Time context:",
    `- Current local time in Manila: ${manilaNow.display}`,
    `- Local time of day: ${dayPart}`
  ];

  if (lastChatIso) {
    lines.push(`- Last chat time in Manila: ${lastChatManila}`);
    lines.push(`- Time since last chat: ${elapsedText}`);
    lines.push(`- Last chat source: ${lastChatSource}`);
  } else {
    lines.push("- No prior chat time context is available.");
  }

  lines.push("Use this context naturally, but do not ignore it.");
  lines.push("If the user sends a short greeting like 'hi', 'hello', or similar, especially after a time gap, you should usually respond with an appropriate greeting based on time of day.");
  lines.push("For example: good morning, good afternoon, good evening, or natural Tagalog equivalents like 'kumusta ngayong umaga/gabi'.");
  lines.push("If there was a noticeable gap (more than 24 hours or days), you may gently acknowledge it (e.g., 'matagal-tagal na rin since last usap natin').");
  lines.push("Do not force time references in every reply, but prioritize them in greetings and re-openings of conversation.");

  return lines.join("\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hashPassword(password, salt = "") {
  return crypto
    .createHash("sha256")
    .update(`${salt}::${String(password || "")}`)
    .digest("hex");
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  return hashPassword(password, salt) === expectedHash;
}


function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashResetToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}


function readUsers() {
  return readJson(USERS_FILE, []);
}

function writeUsers(users) {
  writeJson(USERS_FILE, users);
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    plan_type: user.plan_type || "free",
    created_at: user.created_at
  };
}

function findUserByEmail(email) {
  const users = readUsers();
  const normalized = String(email || "").trim().toLowerCase();
  return users.find((u) => String(u.email || "").trim().toLowerCase() === normalized) || null;
}

function findUserById(userId) {
  const users = readUsers();
  return users.find((u) => u.user_id === userId) || null;
}

function readConversations() {
  return readJson(CONVERSATIONS_FILE, []);
}

function writeConversations(conversations) {
  writeJson(CONVERSATIONS_FILE, conversations);
}

function findConversationById(conversationId) {
  const conversations = readConversations();
  return conversations.find((c) => c.conversation_id === conversationId) || null;
}

function listUserConversations(userId) {
  const conversations = readConversations();
  return conversations
    .filter((c) => c.user_id === userId)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

function createConversation(userId, firstMessage = "", characterId = "general") {
  const conversations = readConversations();

  const titleBase = String(firstMessage || "").trim() || "New chat";
  const title = titleBase.length > 60 ? `${titleBase.slice(0, 60).trim()}…` : titleBase;

  const conversation = {
    conversation_id: crypto.randomUUID(),
    user_id: userId,
    title,
    character_id: characterId || "general",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  conversations.push(conversation);
  writeConversations(conversations);
  return conversation;
}

function touchConversation(conversationId, maybeTitle = "") {
  const conversations = readConversations();
  const idx = conversations.findIndex((c) => c.conversation_id === conversationId);
  if (idx === -1) return null;

  const current = conversations[idx];
  const next = {
    ...current,
    updated_at: nowIso()
  };

  if ((!current.title || current.title === "New chat") && maybeTitle) {
    const titleBase = String(maybeTitle).trim();
    next.title = titleBase.length > 60 ? `${titleBase.slice(0, 60).trim()}…` : titleBase;
  }

  conversations[idx] = next;
  writeConversations(conversations);
  return next;
}

function listConversationMessages(conversationId) {
  const lines = fs.existsSync(MESSAGES_FILE)
    ? fs.readFileSync(MESSAGES_FILE, "utf8").split("\n").filter(Boolean)
    : [];

  const messages = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.conversation_id === conversationId) {
        messages.push(item);
      }
    } catch (_) {}
  }

  return messages.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function listAllMessages() {
  const lines = fs.existsSync(MESSAGES_FILE)
    ? fs.readFileSync(MESSAGES_FILE, "utf8").split("\n").filter(Boolean)
    : [];

  const messages = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch (_) {}
  }

  return messages.sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );
}

function getLatestGuestSessionForDevice(deviceId) {
  const sessions = readJson(SESSIONS_FILE, []);
  return sessions
    .filter((s) => s.device_id === deviceId)
    .sort((a, b) =>
      String(b.last_active_at || b.created_at || "").localeCompare(
        String(a.last_active_at || a.created_at || "")
      )
    )[0] || null;
}

function getLatestOwnerActivity({ userId, deviceId }) {
  const allMessages = listAllMessages();

  if (userId) {
    const ownerMessages = allMessages.filter((m) => m.user_id === userId);
    const latestAny = ownerMessages[0] || null;
    const latestUser = ownerMessages.find((m) => m.role === "user") || null;

    return {
      lastSeenIso: latestAny?.created_at || null,
      lastUserText: latestUser?.content || ""
    };
  }

  const sessions = readJson(SESSIONS_FILE, [])
    .filter((s) => s.device_id === deviceId);

  const sessionIds = new Set(sessions.map((s) => s.session_id));

  const latestSession = sessions
    .sort((a, b) =>
      String(b.last_active_at || b.created_at || "").localeCompare(
        String(a.last_active_at || a.created_at || "")
      )
    )[0] || null;

  const guestMessages = allMessages.filter(
    (m) => !m.user_id && sessionIds.has(m.session_id)
  );

  const latestUser = guestMessages.find((m) => m.role === "user") || null;

  return {
    lastSeenIso: latestSession?.last_active_at || latestSession?.created_at || null,
    lastUserText: latestUser?.content || ""
  };
}

function extractMeaningfulTopicSnippet(text = "") {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .trim();

  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();

  const trivialSet = new Set([
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "test",
    "haha",
    "heh"
  ]);

  if (trivialSet.has(lower)) return "";
  if (cleaned.length < 10) return "";

  const clipped =
    cleaned.length > 72 ? `${cleaned.slice(0, 72).trim()}...` : cleaned;

  return clipped;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildLongTimeNoSeeGreeting(name = "") {
  const namePart = name ? `, ${name}` : "";

  return pickRandom([
    `Hi ulit${namePart}. Matagal-tagal na rin since last usap natin.`,
    `Ngayon ka lang ulit bumalik${namePart}. Kumusta ka?`,
    `Matagal ka ring nawala ah${namePart}. Kumusta naman?`,
    `Musta${namePart}. Ngayon lang kita ulit nakita.`
  ]);
}

function buildTimeGreetingFallback({ dayPart, name = "" }) {
  const namePart = name ? `, ${name}` : "";

  const byPart = {
    morning: [
      `Good morning${namePart}. Kumusta ka ngayon?`,
      `Magandang umaga${namePart}. May gusto ka bang pag-usapan?`
    ],
    afternoon: [
      `Good afternoon${namePart}. Kumusta ka ngayon?`,
      `Magandang hapon${namePart}. Ano ang nasa isip mo ngayon?`
    ],
    evening: [
      `Good evening${namePart}. Kumusta ang araw mo?`,
      `Magandang gabi${namePart}. May gusto ka bang pag-usapan?`
    ],
    "late night": [
      `Hi${namePart}. Medyo late na rin. Kumusta ka?`,
      `Gabi na rin${namePart}. Ano ang nasa isip mo?`
    ]
  };

  return pickRandom(byPart[dayPart] || byPart.afternoon);
}

function detectMajorNewsHeadline(newsData) {
  if (!newsData) return "";

  const allTitles = [
    ...(newsData.philippines || [])
  ]
    .map((item) => String(item?.title || "").trim())
    .filter(Boolean);

  const majorKeywords = [
    "earthquake",
    "quake",
    "heatwave",
    "typhoon",
    "storm",
    "flood",
    "landslide",
    "eruption",
    "volcano",
    "tsunami",
    "war",
    "missile",
    "attack",
    "airstrike",
    "bombing",
    "explosion",
    "disaster",
    "evacuation"
  ];

  const major = allTitles.find((title) => {
    const lower = title.toLowerCase();
    return majorKeywords.some((kw) => lower.includes(kw));
  });

  return major || "";
}

function buildMajorNewsWelcome(newsData) {
  const headline = detectMajorNewsHeadline(newsData);
  if (!headline) return "";

  return pickRandom([
    "May malaking balita ngayon.",
    "May importanteng balita ngayon. Gusto mo bang i-check natin?",
    "May major news ngayon. Sabihin mo lang kung gusto mong malaman."
  ]);
}

function getPendingNewsKey({ userId, deviceId }) {
  if (userId) return `user:${userId}`;
  return `device:${deviceId || "no_device"}`;
}

function savePendingNewsContext({ userId, deviceId, headline, welcomeText }) {
  if (!headline) return;

  const items = readJson(PENDING_NEWS_FILE, []);
  const key = getPendingNewsKey({ userId, deviceId });
  const now = Date.now();

  const freshItems = items.filter((item) => {
    return item && item.key !== key && Number(item.expires_at_ms || 0) > now;
  });

  freshItems.push({
    key,
    headline: String(headline || "").trim(),
    welcome_text: String(welcomeText || "").trim(),
    created_at: nowIso(),
    expires_at_ms: now + (70 * 1000)
  });

  writeJson(PENDING_NEWS_FILE, freshItems);
}

function getPendingNewsContext({ userId, deviceId }) {
  const items = readJson(PENDING_NEWS_FILE, []);
  const key = getPendingNewsKey({ userId, deviceId });
  const now = Date.now();

  const freshItems = items.filter((item) => {
    return item && Number(item.expires_at_ms || 0) > now;
  });

  if (freshItems.length !== items.length) {
    writeJson(PENDING_NEWS_FILE, freshItems);
  }

  return freshItems.find((item) => item.key === key) || null;
}

function clearPendingNewsContext({ userId, deviceId }) {
  const items = readJson(PENDING_NEWS_FILE, []);
  const key = getPendingNewsKey({ userId, deviceId });

  writeJson(
    PENDING_NEWS_FILE,
    items.filter((item) => item && item.key !== key)
  );
}

function isVagueNewsFollowup(text = "") {
  const t = String(text || "").trim().toLowerCase();

  const patterns = [
    "gusto ko malaman",
    "gusto kong malaman",
    "sige",
    "ano yun",
    "ano",
    "ano yon",
    "ano yun?",
    "tell me",
    "yes",
    "oo",
    "okay",
    "ok",
    "sure",
    "go",
    "sabihin mo",
    "ano news",
    "ha",
    "ano balita"
  ];

   return patterns.some((p) => t === p);
}

function getAuthUserId(req) {
  const cookieUserId = req.cookies && req.cookies.xf_user_id;
  if (cookieUserId && typeof cookieUserId === "string" && cookieUserId.length >= 8) {
    return cookieUserId;
  }
  return null;
}

function setAuthCookies(res, userId) {
  res.cookie("xf_user_id", userId, {
    httpOnly: false,
    sameSite: "Lax",
    secure: true,
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookies(res) {
  res.clearCookie("xf_user_id", {
    httpOnly: false,
    sameSite: "Lax",
    secure: true
  });
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getDeviceId(req) {
  const h = req.get("x-device-id");
  if (h && typeof h === "string" && h.length >= 8) return h;

  const c = req.cookies && req.cookies.kb_device_id;
  if (c && typeof c === "string" && c.length >= 8) return c;

  return "no_device";
}

function getSessionId(req) {
  const headerSession = req.get("x-session-id");
  if (headerSession && typeof headerSession === "string" && headerSession.length >= 8) {
    return headerSession;
  }

  const cookieSession = req.cookies && req.cookies.xf_session_id;
  if (cookieSession && typeof cookieSession === "string" && cookieSession.length >= 8) {
    return cookieSession;
  }

  return crypto.randomUUID();
}

function setSessionCookie(res, sessionId) {
  res.cookie("xf_session_id", sessionId, {
    httpOnly: false,
    sameSite: "Lax",
    secure: true,
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
}

function getDeviceType(userAgent = "") {
  const ua = String(userAgent).toLowerCase();
  if (/mobile|android|iphone|ipad|ipod/.test(ua)) return "mobile";
  return "desktop";
}

function getAnonKey(req) {
  const ip = ipKeyGenerator(req);
  const dev = getDeviceId(req);
  return `${ip}|${dev}`;
}

const guestBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
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

const guestDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAnonKey,
  handler: (req, res) => {
    return res.status(429).json({
      error: "DAILY_LIMIT",
      message: "You’ve reached today’s free chat limit. Please come back tomorrow."
    });
  }
});

const userBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getAuthUserId(req) || getAnonKey(req),
  handler: (req, res) => {
    return res.status(429).json({
      error: "RATE_LIMIT",
      message: "Too many requests. Please wait a bit and try again."
    });
  }
});

const userDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getAuthUserId(req) || getAnonKey(req),
  handler: (req, res) => {
    return res.status(429).json({
      error: "DAILY_LIMIT",
      message: "You’ve reached today’s free chat limit. Your chats are saved — come back tomorrow."
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});



app.post(
  "/voice/session",
  express.text({ type: ["application/sdp", "text/plain"] }),
  async (req, res) => {
    try {
      const sdp = String(req.body || "");

      if (!sdp.trim()) {
        return res.status(400).send("Missing SDP offer");
      }

      const sessionConfig = {
        type: "realtime",
        model: "gpt-realtime",
        output_modalities: ["audio"],
        audio: {
          output: {
            voice: "alloy"
          }
        },
        instructions:
          "You are PinkX, a warm, playful AI companion. Speak naturally, briefly, and emotionally. Start with a short friendly greeting in Taglish."
      };

      const fd = new FormData();
      fd.set("sdp", sdp);
      fd.set("session", JSON.stringify(sessionConfig));

      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: fd
      });

      const answerSdp = await response.text();

      if (!response.ok) {
        console.error("Realtime call error:", answerSdp);
        return res.status(500).send(answerSdp);
      }

      res.type("application/sdp").send(answerSdp);

    } catch (err) {
      console.error("Voice session exception:", err);

      res.status(500).send(
        err?.message || "Voice session failed"
      );
    }
  }
);



function stripLatex(text = "") {
  let out = text
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "");

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

function upsertSession(sessionData) {
  const sessions = readJson(SESSIONS_FILE, []);
  const idx = sessions.findIndex((s) => s.session_id === sessionData.session_id);

  if (idx === -1) {
    sessions.push(sessionData);
  } else {
    sessions[idx] = {
      ...sessions[idx],
      ...sessionData
    };
  }

  writeJson(SESSIONS_FILE, sessions);
}

function getSession(sessionId) {
  const sessions = readJson(SESSIONS_FILE, []);
  return sessions.find((s) => s.session_id === sessionId) || null;
}

function incrementSessionUsage(sessionId, fields) {
  const sessions = readJson(SESSIONS_FILE, []);
  const idx = sessions.findIndex((s) => s.session_id === sessionId);
  if (idx === -1) return;

  const current = sessions[idx];
  sessions[idx] = {
    ...current,
    last_active_at: nowIso(),
    message_count: (current.message_count || 0) + (fields.message_count || 0),
    input_tokens: (current.input_tokens || 0) + (fields.input_tokens || 0),
    output_tokens: (current.output_tokens || 0) + (fields.output_tokens || 0),
    total_tokens: (current.total_tokens || 0) + (fields.total_tokens || 0),
    estimated_cost_usd: Number(((current.estimated_cost_usd || 0) + (fields.estimated_cost_usd || 0)).toFixed(8))
  };

  writeJson(SESSIONS_FILE, sessions);
}

function updateSessionMeta(sessionId, fields = {}) {
  const sessions = readJson(SESSIONS_FILE, []);
  const idx = sessions.findIndex((s) => s.session_id === sessionId);
  if (idx === -1) return;

  const current = sessions[idx];

  sessions[idx] = {
    ...current,
    ...fields,
    last_active_at: nowIso()
  };

  writeJson(SESSIONS_FILE, sessions);
}

function countImageUploadsToday({ userId, deviceId }) {
  const sessions = readJson(SESSIONS_FILE, []);
  const today = getManilaDateKey();

  return sessions.reduce((total, s) => {
    const sameOwner = userId
      ? s.user_id === userId
      : s.device_id === deviceId;

    if (!sameOwner) return total;
    if (s.last_image_upload_date !== today) return total;

    return total + Number(s.image_upload_count_today || 0);
  }, 0);
}

function incrementImageUploadUsage(sessionId) {
  const sessions = readJson(SESSIONS_FILE, []);
  const idx = sessions.findIndex((s) => s.session_id === sessionId);
  if (idx === -1) return;

  const today = getManilaDateKey();
  const current = sessions[idx];

  const currentCount =
    current.last_image_upload_date === today
      ? Number(current.image_upload_count_today || 0)
      : 0;

  sessions[idx] = {
    ...current,
    last_image_upload_date: today,
    image_upload_count_today: currentCount + 1,
    last_active_at: nowIso()
  };

  writeJson(SESSIONS_FILE, sessions);
}


function shouldPromptSignupNow(session, isLoggedIn, promptAt = 8, cooldownHours = 24) {
  if (isLoggedIn) return false;
  if (!session) return false;

  const messageCount = Number(session.message_count || 0);
  if (messageCount < promptAt) return false;

  const lastPromptAt = session.last_signup_prompt_at;
  if (!lastPromptAt) return true;

  const elapsedMs = Date.now() - new Date(lastPromptAt).getTime();
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  return elapsedMs >= cooldownMs;
}


function estimateCostUsd(inputTokens, outputTokens) {
  const inputCostPer1M = 0.40;
  const outputCostPer1M = 1.60;

  const cost =
    (Number(inputTokens || 0) / 1000000) * inputCostPer1M +
    (Number(outputTokens || 0) / 1000000) * outputCostPer1M;

  return Number(cost.toFixed(8));
}

app.post("/track-visit", (req, res) => {
  try {
    const visitsPath = path.join(DATA_DIR, "visits.json");

    let visits = [];

    try {
      visits = JSON.parse(
        fs.readFileSync(visitsPath, "utf8")
      );
    } catch (_) {}

    const incoming = req.body;

    let existing = visits.find(
      (v) => v.visit_id === incoming.visit_id
    );

    if (existing) {
      existing.last_activity = incoming.last_activity;

      if (incoming.asked_ai) {
        existing.asked_ai = true;
      }
    } else {
      visits.unshift({
        visit_id: incoming.visit_id,

        device_id: incoming.device_id,

        started_at: incoming.started_at,

        last_activity: incoming.last_activity,

        platform: incoming.platform,

        asked_ai: !!incoming.asked_ai
      });
    }

    fs.writeFileSync(
      visitsPath,
      JSON.stringify(visits, null, 2)
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "track visit failed"
    });
  }
});


app.post("/ask", handleAskUpload, async (req, res) => {
  const startedAt = Date.now();
  const sessionId = getSessionId(req);
  setSessionCookie(res, sessionId);

  const authUserId = getAuthUserId(req);
  const authUser = authUserId ? findUserById(authUserId) : null;
  const isLoggedIn = !!authUser;

  const applyLimiter = (limiter) =>
    new Promise((resolve, reject) => {
      let finished = false;

      const done = (err) => {
        if (finished) return;
        finished = true;
        if (err) reject(err);
        else resolve();
      };

      limiter(req, res, done);

      setImmediate(() => {
        if (res.headersSent) done();
      });
    });

  try {
    if (isLoggedIn) {
      await applyLimiter(userBurstLimiter);
      if (res.headersSent) return;
      await applyLimiter(userDailyLimiter);
      if (res.headersSent) return;
    } else {
      await applyLimiter(guestBurstLimiter);
      if (res.headersSent) return;
      await applyLimiter(guestDailyLimiter);
      if (res.headersSent) return;
    }

let {
  question,
  history = [],
  conversation_id,
  character_id
} = req.body || {};

if (typeof history === "string") {
  try {
    history = JSON.parse(history);
  } catch {
    history = [];
  }
}


    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    const trimmedQuestion = question.trim();
    const lowerQ = trimmedQuestion.toLowerCase();

    const isNewsQuery =
      lowerQ.includes("balita") ||
      lowerQ.includes("news") ||
      lowerQ.includes("what's happening now") ||
      lowerQ.includes("whats happening now") ||
      lowerQ.includes("happening now") ||
      lowerQ.includes("latest news") ||
      lowerQ.includes("latest events") ||
      lowerQ.includes("latest updates") ||
      lowerQ.includes("what's going on") ||
      lowerQ.includes("whats going on") ||
      lowerQ.includes("anong nangyayari") ||
      lowerQ.includes("ano nangyayari") ||
      lowerQ.includes("ano balita ngayon");

    if (trimmedQuestion.length > 500) {
      return res.status(400).json({
        error: "QUESTION_TOO_LONG",
        message: "Please keep your message shorter."
      });
    }

    const deviceId = getDeviceId(req);
    const clientIp = getClientIp(req);
    const ipHash = sha256(clientIp);
    const userAgent = req.get("user-agent") || "";
    const deviceType = getDeviceType(userAgent);

    const selectedCharacter =
      typeof character_id === "string" && character_id.trim()
        ? character_id.trim()
        : "general";

let preparedImage = null;

if (req.file) {
const allowedImageCharacters = new Set([
  "einx",
  "magdalena",
  "jose",
  "alexander",
  "moses",
  "wux",
  "robx",
  "sunx",
  "pinkx",
  "jax",
  "lebox",
  "general"
]);


  if (!isLoggedIn) {
    return res.status(403).json({
      error: "IMAGE_LOGIN_REQUIRED",
      message: "Please log in to upload images."
    });
  }

  if (!allowedImageCharacters.has(selectedCharacter)) {
    return res.status(400).json({
      error: "IMAGE_NOT_ALLOWED_FOR_CHARACTER",
      message: "Image upload is not available for this character."
    });
  }

  const uploadsToday = countImageUploadsToday({
    userId: authUser.user_id,
    deviceId
  });

  if (uploadsToday >= 100) {
    return res.status(429).json({
      error: "IMAGE_DAILY_LIMIT",
      message: "Daily image upload limit reached."
    });
  }

  preparedImage = await prepareImageForOpenAI(req.file);
  incrementImageUploadUsage(sessionId);
}


    if (!getSession(sessionId)) {
      upsertSession({
        session_id: sessionId,
        device_id: deviceId,
        ip_hash: ipHash,
        user_agent: userAgent,
        device_type: deviceType,
        created_at: nowIso(),
        last_active_at: nowIso(),
        message_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        is_rate_limited: false,
        is_blocked: false,
        logged_in: isLoggedIn,
        user_id: isLoggedIn ? authUser.user_id : null,
        user_name: isLoggedIn ? authUser.name : null,
        user_email: isLoggedIn ? authUser.email : null,
        last_character_id: selectedCharacter,
        last_conversation_id: null
      });
    }

    const session = getSession(sessionId);

const SIGNUP_PROMPT_AT = 16;
const SIGNUP_PROMPT_COOLDOWN_HOURS = 24;

// TEMPORARILY DISABLED SIGNUP WALL
// const SIGNUP_REQUIRED_AT = 20;
// if (!isLoggedIn && session && session.message_count >= SIGNUP_REQUIRED_AT) {
//   return res.status(403).json({
//     error: "SIGNUP_REQUIRED",
//     message: "Create a free account to save your chats, continue anytime, and enjoy higher daily limits.",
//     signup_required: true
//   });
// }

const shouldShowSignupPrompt = shouldPromptSignupNow(
  session,
  isLoggedIn,
  SIGNUP_PROMPT_AT,
  SIGNUP_PROMPT_COOLDOWN_HOURS
);


    let activeConversationId = null;


const requestedConversationId =
  typeof conversation_id === "string" && conversation_id.trim()
    ? conversation_id.trim()
    : null;

if (requestedConversationId) {
  const existingConversation =
    findConversationById(requestedConversationId);


if (
  existingConversation &&
  existingConversation.character_id &&
  existingConversation.character_id !== selectedCharacter
) {
  return res.status(400).json({
    error: "CHARACTER_MISMATCH",
    message: "Conversation belongs to a different character."
  });
}


  if (
    existingConversation &&
    (
      (isLoggedIn &&
        existingConversation.user_id === authUser.user_id)

      ||

      (!isLoggedIn &&
        !existingConversation.user_id)
    )
  ) {
    activeConversationId =
      existingConversation.conversation_id;

    touchConversation(activeConversationId, question);

  } else {
    return res.status(403).json({
      error: "INVALID_CONVERSATION",
      message: "That conversation is not available."
    });
  }

} else {

  const createdConversation = createConversation(
    isLoggedIn ? authUser.user_id : null,
    question,
    selectedCharacter
  );

  activeConversationId =
    createdConversation.conversation_id;
}



    updateSessionMeta(sessionId, {
      logged_in: isLoggedIn,
      user_id: isLoggedIn ? authUser.user_id : null,
      user_name: isLoggedIn ? authUser.name : null,
      user_email: isLoggedIn ? authUser.email : null,
      last_character_id: selectedCharacter,
      last_conversation_id: activeConversationId || null
    });

if (shouldShowSignupPrompt) {
  updateSessionMeta(sessionId, {
    last_signup_prompt_at: nowIso()
  });
}

    const memoryOwner = {
      userId: isLoggedIn ? authUser.user_id : null,
      deviceId
    };

    const currentMemory = loadMemory(memoryOwner);

    if (isLoggedIn && authUser && authUser.name) {
      const currentName = String(currentMemory.profile?.name || "").trim();

      if (!currentName) {
        currentMemory.profile = {
          ...currentMemory.profile,
          name: authUser.name
        };
      }
    }

    const { inputMessages } = buildInputMessages({
      selectedCharacter,
      memory: currentMemory,
      history,
      trimmedQuestion
    });

if (preparedImage) {
  const lastUserIndex = [...inputMessages]
    .reverse()
    .findIndex((m) => m.role === "user");

  if (lastUserIndex !== -1) {
    const realIndex = inputMessages.length - 1 - lastUserIndex;
    const originalText = String(inputMessages[realIndex].content || "");

    inputMessages[realIndex] = {
      role: "user",
      content: [
        { type: "input_text", text: originalText },
        {
          type: "input_image",
          image_url: `data:${preparedImage.mimeType};base64,${preparedImage.base64}`
        }
      ]
    };
  }
}


    const timeContextText = buildTimeContext({
      isLoggedIn,
      authUser,
      activeConversationId
    });

    inputMessages.splice(1, 0, {
      role: "system",
      content: timeContextText
    });

const pendingNewsContext = getPendingNewsContext({
  userId: isLoggedIn ? authUser.user_id : null,
  deviceId
});

const isPendingNewsFollowup =
  !isNewsQuery &&
  pendingNewsContext &&
  isVagueNewsFollowup(trimmedQuestion);

if (isNewsQuery || isPendingNewsFollowup) {

      const newsData = await getNews();

      if (newsData) {
        if (isPendingNewsFollowup && pendingNewsContext?.headline) {
          inputMessages.splice(2, 0, {
            role: "system",
            content:
              "The user is replying to the welcome-news teaser shown on the chat entry card. They want to know about this specific news item: " +
              pendingNewsContext.headline +
              "\nAnswer directly. Do not ask what news they mean."
          });

          clearPendingNewsContext({
            userId: isLoggedIn ? authUser.user_id : null,
            deviceId
          });
        }

        const formatted = `
Latest world news:
${newsData.world.map((n) => "- " + n.title).join("\n")}

Latest Philippines news:
${newsData.philippines.map((n) => "- " + n.title).join("\n")}
`;

        inputMessages.splice(2, 0, {
          role: "system",
          content:
            "The user is asking for current news. Give a direct, informative answer using the headlines below. Do NOT ask follow-up questions first. Do NOT generalize. Summarize the key news clearly.\n\n" +
            formatted
        });
      } else {
        inputMessages.splice(2, 0, {
          role: "system",
          content:
            "User is asking about current news, but live data is unavailable. Be honest and say you cannot check live news right now."
        });
      }
    }

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: inputMessages
    });

    const rawAnswer =
      completion.output_text ||
      completion.output?.[0]?.content?.[0]?.text ||
      "";

    const cleaned = stripLatex(String(rawAnswer).replace(/\\n/g, "\n")).trim();

    const usage = completion.usage || {};
    const inputTokens =
      usage.input_tokens ||
      usage.prompt_tokens ||
      0;

    const outputTokens =
      usage.output_tokens ||
      usage.completion_tokens ||
      0;

    const totalTokens =
      usage.total_tokens ||
      (inputTokens + outputTokens);

    const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens);

    const memoryUpdates = extractMemoryUpdates({
      currentMemory,
      userText: trimmedQuestion,
      assistantText: cleaned,
      selectedCharacter
    });

    const nextMemory = mergeMemory(currentMemory, memoryUpdates);
    saveMemory(memoryOwner, nextMemory);

    appendJsonLine(MESSAGES_FILE, {
      session_id: sessionId,
      conversation_id: activeConversationId,
      user_id: isLoggedIn ? authUser.user_id : null,
      character_id: selectedCharacter,
      role: "user",
      content: trimmedQuestion,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      created_at: nowIso()
    });

    appendJsonLine(MESSAGES_FILE, {
      session_id: sessionId,
      conversation_id: activeConversationId,
      user_id: isLoggedIn ? authUser.user_id : null,
      character_id: selectedCharacter,
      role: "assistant",
      content: cleaned,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: Date.now() - startedAt,
      created_at: nowIso()
    });

    incrementSessionUsage(sessionId, {
      message_count: 2,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd
    });

    return res.json({
      answer: cleaned,
      signup_prompt: shouldShowSignupPrompt,
      conversation_id: activeConversationId,
      character_id: selectedCharacter,
      meta: {
        session_id: sessionId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: estimatedCostUsd
      }
    });

  } catch (err) {

console.error("AI error:", err);

return res.status(500).json({
  error: "AI_REQUEST_FAILED",
  message: err?.message || String(err) || "May problema sa system. Pakisubukan ulit."
});



  }
});


app.post("/ask-stream", async (req, res) => {
  const startedAt = Date.now();
  const sessionId = getSessionId(req);
  setSessionCookie(res, sessionId);

  const authUserId = getAuthUserId(req);
  const authUser = authUserId ? findUserById(authUserId) : null;
  const isLoggedIn = !!authUser;

  const sendEvent = (type, data = {}) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const applyLimiter = (limiter) =>
    new Promise((resolve, reject) => {
      let finished = false;

      const done = (err) => {
        if (finished) return;
        finished = true;
        if (err) reject(err);
        else resolve();
      };

      limiter(req, res, done);

      setImmediate(() => {
        if (res.headersSent && !res.writableEnded) done();
      });
    });

  try {
    let {
      question,
      history = [],
      conversation_id,
      character_id
    } = req.body || {};

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Missing question" });
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length > 500) {
      return res.status(400).json({
        error: "QUESTION_TOO_LONG",
        message: "Please keep your message shorter."
      });
    }

    if (isLoggedIn) {
      await applyLimiter(userBurstLimiter);
      if (res.headersSent) return;
      await applyLimiter(userDailyLimiter);
      if (res.headersSent) return;
    } else {
      await applyLimiter(guestBurstLimiter);
      if (res.headersSent) return;
      await applyLimiter(guestDailyLimiter);
      if (res.headersSent) return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const deviceId = getDeviceId(req);
    const clientIp = getClientIp(req);
    const ipHash = sha256(clientIp);
    const userAgent = req.get("user-agent") || "";
    const deviceType = getDeviceType(userAgent);

    const selectedCharacter =
      typeof character_id === "string" && character_id.trim()
        ? character_id.trim()
        : "general";

    if (!getSession(sessionId)) {
      upsertSession({
        session_id: sessionId,
        device_id: deviceId,
        ip_hash: ipHash,
        user_agent: userAgent,
        device_type: deviceType,
        created_at: nowIso(),
        last_active_at: nowIso(),
        message_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        is_rate_limited: false,
        is_blocked: false,
        logged_in: isLoggedIn,
        user_id: isLoggedIn ? authUser.user_id : null,
        user_name: isLoggedIn ? authUser.name : null,
        user_email: isLoggedIn ? authUser.email : null,
        last_character_id: selectedCharacter,
        last_conversation_id: null
      });
    }

    const session = getSession(sessionId);

    const SIGNUP_PROMPT_AT = 16;
    const SIGNUP_PROMPT_COOLDOWN_HOURS = 24;

    const shouldShowSignupPrompt = shouldPromptSignupNow(
      session,
      isLoggedIn,
      SIGNUP_PROMPT_AT,
      SIGNUP_PROMPT_COOLDOWN_HOURS
    );

    let activeConversationId = null;

    const requestedConversationId =
      typeof conversation_id === "string" && conversation_id.trim()
        ? conversation_id.trim()
        : null;

    if (requestedConversationId) {
      const existingConversation = findConversationById(requestedConversationId);

      if (
        existingConversation &&
        (
          (isLoggedIn && existingConversation.user_id === authUser.user_id) ||
          (!isLoggedIn && !existingConversation.user_id)
        )
      ) {
        activeConversationId = existingConversation.conversation_id;
        touchConversation(activeConversationId, question);
      } else {
        sendEvent("error", {
          message: "That conversation is not available."
        });
        return res.end();
      }
    } else {
      const createdConversation = createConversation(
        isLoggedIn ? authUser.user_id : null,
        question,
        selectedCharacter
      );

      activeConversationId = createdConversation.conversation_id;
    }

    updateSessionMeta(sessionId, {
      logged_in: isLoggedIn,
      user_id: isLoggedIn ? authUser.user_id : null,
      user_name: isLoggedIn ? authUser.name : null,
      user_email: isLoggedIn ? authUser.email : null,
      last_character_id: selectedCharacter,
      last_conversation_id: activeConversationId || null
    });

    if (shouldShowSignupPrompt) {
      updateSessionMeta(sessionId, {
        last_signup_prompt_at: nowIso()
      });
    }

    const memoryOwner = {
      userId: isLoggedIn ? authUser.user_id : null,
      deviceId
    };

    const currentMemory = loadMemory(memoryOwner);

    if (isLoggedIn && authUser && authUser.name) {
      const currentName = String(currentMemory.profile?.name || "").trim();

      if (!currentName) {
        currentMemory.profile = {
          ...currentMemory.profile,
          name: authUser.name
        };
      }
    }

    const { inputMessages } = buildInputMessages({
      selectedCharacter,
      memory: currentMemory,
      history,
      trimmedQuestion
    });

    const timeContextText = buildTimeContext({
      isLoggedIn,
      authUser,
      activeConversationId
    });

    inputMessages.splice(1, 0, {
      role: "system",
      content: timeContextText
    });

    sendEvent("meta", {
      conversation_id: activeConversationId,
      character_id: selectedCharacter,
      signup_prompt: shouldShowSignupPrompt
    });

    let finalText = "";
    let usage = {};

    const stream = await client.responses.create({
      model: "gpt-4.1-mini",
      input: inputMessages,
      stream: true
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        finalText += event.delta;
        sendEvent("delta", { text: event.delta });
      }

      if (event.type === "response.completed") {
        usage = event.response?.usage || {};
      }
    }

    const cleaned = stripLatex(String(finalText).replace(/\\n/g, "\n")).trim();

    const inputTokens =
      usage.input_tokens ||
      usage.prompt_tokens ||
      0;

    const outputTokens =
      usage.output_tokens ||
      usage.completion_tokens ||
      0;

    const totalTokens =
      usage.total_tokens ||
      (inputTokens + outputTokens);

    const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens);

    const memoryUpdates = extractMemoryUpdates({
      currentMemory,
      userText: trimmedQuestion,
      assistantText: cleaned,
      selectedCharacter
    });

    const nextMemory = mergeMemory(currentMemory, memoryUpdates);
    saveMemory(memoryOwner, nextMemory);

    appendJsonLine(MESSAGES_FILE, {
      session_id: sessionId,
      conversation_id: activeConversationId,
      user_id: isLoggedIn ? authUser.user_id : null,
      character_id: selectedCharacter,
      role: "user",
      content: trimmedQuestion,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      created_at: nowIso()
    });

    appendJsonLine(MESSAGES_FILE, {
      session_id: sessionId,
      conversation_id: activeConversationId,
      user_id: isLoggedIn ? authUser.user_id : null,
      character_id: selectedCharacter,
      role: "assistant",
      content: cleaned,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: Date.now() - startedAt,
      created_at: nowIso()
    });

    incrementSessionUsage(sessionId, {
      message_count: 2,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd
    });

    sendEvent("done", {
      text: cleaned,
      signup_prompt: shouldShowSignupPrompt,
      conversation_id: activeConversationId,
      character_id: selectedCharacter
    });

    return res.end();

  } catch (err) {
    console.error("AI stream error:", err);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "AI_STREAM_FAILED",
        message: err?.message || String(err) || "May problema sa system."
      });
    }

    sendEvent("error", {
      message: err?.message || String(err) || "May problema sa system."
    });

    return res.end();
  }
});




app.post("/signup", (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: "INVALID_NAME", message: "Please enter your name." });
    }

    if (!cleanEmail || !cleanEmail.includes("@")) {
      return res.status(400).json({ error: "INVALID_EMAIL", message: "Please enter a valid email." });
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({ error: "INVALID_PASSWORD", message: "Password must be at least 6 characters." });
    }

    if (findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: "EMAIL_EXISTS", message: "This email is already registered." });
    }

    const users = readUsers();
    const pw = makePasswordRecord(cleanPassword);

    const user = {
      user_id: crypto.randomUUID(),
      name: cleanName,
      email: cleanEmail,
      password_salt: pw.salt,
      password_hash: pw.hash,
      plan_type: "free",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    users.push(user);
    writeUsers(users);

    setAuthCookies(res, user.user_id);

    return res.json({
      ok: true,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error("Signup error:", err?.message || err);
    return res.status(500).json({ error: "SIGNUP_FAILED", message: "Signup failed." });
  }
});

app.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Email and password are required." });
    }

    const user = findUserByEmail(cleanEmail);
    if (!user) {
      return res.status(401).json({ error: "INVALID_LOGIN", message: "Invalid email or password." });
    }

    const ok = verifyPassword(cleanPassword, user.password_salt, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "INVALID_LOGIN", message: "Invalid email or password." });
    }

    setAuthCookies(res, user.user_id);

    return res.json({
      ok: true,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error("Login error:", err?.message || err);
    return res.status(500).json({ error: "LOGIN_FAILED", message: "Login failed." });
  }
});


app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};

    const cleanEmail = String(email || "")
      .trim()
      .toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({
        error: "MISSING_EMAIL"
      });
    }

    const users = readUsers();

    const user = users.find(
      (u) => String(u.email || "").toLowerCase() === cleanEmail
    );

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        success: true
      });
    }

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);

    user.reset_token_hash = tokenHash;
    user.reset_token_expires = Date.now() + (1000 * 60 * 30);

    writeUsers(users);

    const resetLink =
      `${process.env.APP_BASE_URL}/reset-password.html?token=${token}`;

   const resendResult = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: cleanEmail,
      subject: "Reset your Xfrend password",
      html: `
        <div style="font-family: Arial, sans-serif; line-height:1.6;">
          <h2>Reset your Xfrend password</h2>

          <p>Click the button below to reset your password.</p>

          <p>
            <a href="${resetLink}"
               style="
                 display:inline-block;
                 background:#111;
                 color:#fff;
                 padding:12px 18px;
                 text-decoration:none;
                 border-radius:8px;
               ">
              Reset Password
            </a>
          </p>

          <p>This link expires in 30 minutes.</p>

          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `
    });

console.log("RESEND RESULT:", resendResult);

    return res.json({
      success: true
    });

  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);

    return res.status(500).json({
      error: "SERVER_ERROR"
    });
  }
});


app.post("/reset-password", (req, res) => {
  try {
    const { token, password } = req.body || {};

    const cleanToken = String(token || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanToken || !cleanPassword) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Reset token and new password are required."
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        error: "INVALID_PASSWORD",
        message: "Password must be at least 6 characters."
      });
    }

    const tokenHash = hashResetToken(cleanToken);
    const users = readUsers();

    const user = users.find((u) =>
      u.reset_token_hash === tokenHash &&
      Number(u.reset_token_expires || 0) > Date.now()
    );

    if (!user) {
      return res.status(400).json({
        error: "INVALID_OR_EXPIRED_TOKEN",
        message: "This reset link is invalid or expired."
      });
    }

    const pw = makePasswordRecord(cleanPassword);

    user.password_salt = pw.salt;
    user.password_hash = pw.hash;
    user.reset_token_hash = null;
    user.reset_token_expires = null;
    user.updated_at = nowIso();

    writeUsers(users);

    return res.json({
      success: true
    });

  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);

    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Password reset failed."
    });
  }
});


app.post("/logout", (req, res) => {
  clearAuthCookies(res);
  return res.json({ ok: true });
});

app.get("/conversations", (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "NOT_LOGGED_IN", message: "Please log in first." });
    }

    const user = findUserById(userId);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "NOT_LOGGED_IN", message: "Please log in first." });
    }

    const conversations = listUserConversations(user.user_id).map((c) => ({
      conversation_id: c.conversation_id,
      title: c.title || "New chat",
      character_id: c.character_id || "general",
      created_at: c.created_at,
      updated_at: c.updated_at
    }));

    return res.json({
      ok: true,
      conversations
    });
  } catch (err) {
    console.error("Conversations error:", err?.message || err);
    return res.status(500).json({ error: "CONVERSATIONS_FAILED", message: "Failed to load conversations." });
  }
});

app.get("/conversation/:id", (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "NOT_LOGGED_IN", message: "Please log in first." });
    }

    const user = findUserById(userId);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "NOT_LOGGED_IN", message: "Please log in first." });
    }

    const conversationId = String(req.params.id || "").trim();
    if (!conversationId) {
      return res.status(400).json({ error: "INVALID_CONVERSATION", message: "Conversation ID is required." });
    }

    const conversation = findConversationById(conversationId);
    if (!conversation || conversation.user_id !== user.user_id) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
    }

    const messages = listConversationMessages(conversationId).map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.created_at
    }));

    return res.json({
      ok: true,
      conversation: {
        conversation_id: conversation.conversation_id,
        title: conversation.title || "New chat",
        character_id: conversation.character_id || "general",
        created_at: conversation.created_at,
        updated_at: conversation.updated_at
      },
      messages
    });
  } catch (err) {
    console.error("Conversation detail error:", err?.message || err);
    return res.status(500).json({ error: "CONVERSATION_FAILED", message: "Failed to load conversation." });
  }
});

app.get("/me", (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.json({ logged_in: false, user: null });
    }

    const user = findUserById(userId);

let unlockMessageCount = 0;

const sessions = readJson(SESSIONS_FILE, []);

for (const s of sessions) {
  if (s.user_id === user.user_id) {
    unlockMessageCount += Number(s.message_count || 0);
  }
}

    if (!user) {
      clearAuthCookies(res);
      return res.json({ logged_in: false, user: null });
    }

return res.json({
  logged_in: true,
  user: sanitizeUser(user),

  unlocks: {
    wux: unlockMessageCount >= 6,
    magdalena: unlockMessageCount >= 12,
    alexander: unlockMessageCount >= 20
  },

  progress: {
    message_count: unlockMessageCount
  }
});


  } catch (err) {
    console.error("Me error:", err?.message || err);
    return res.status(500).json({ error: "ME_FAILED", message: "Failed to load account." });
  }
});

app.get("/welcome", async (req, res) => {

  return res.json({
    ok: true,
    text: ""
  });

  try {
    const authUserId = getAuthUserId(req);
    const authUser = authUserId ? findUserById(authUserId) : null;
    const isLoggedIn = !!authUser;
    const deviceId = getDeviceId(req);

    const activity = getLatestOwnerActivity({
      userId: isLoggedIn ? authUser.user_id : null,
      deviceId
    });

    const lastSeenIso = activity.lastSeenIso;

    if (!lastSeenIso) {
      return res.json({ ok: true, text: "" });
    }

    const absentMs = Date.now() - new Date(lastSeenIso).getTime();
    const absentHours = absentMs / (1000 * 60 * 60);

    const name = isLoggedIn && authUser?.name ? authUser.name : "";
    const dayPart = getManilaDayPart();

    let text = "";

    if (absentHours < 24) {
      text = "";
    } else if (absentHours >= 72) {
      text = buildLongTimeNoSeeGreeting(name);
    } else {

/*
      let majorNewsText = "";

try {
  const newsData = await getNews();
  const majorHeadline = detectMajorNewsHeadline(newsData);
  majorNewsText = majorHeadline ? buildMajorNewsWelcome(newsData) : "";

  if (majorNewsText) {
    savePendingNewsContext({
      userId: isLoggedIn ? authUser.user_id : null,
      deviceId,
      headline: majorHeadline,
      welcomeText: majorNewsText
    });
  }
} catch (err) {
  console.error("Welcome news check failed:", err);
}
*/

if (absentHours >= 24) {
  text = buildTimeGreetingFallback({ dayPart, name });
} else {
  text = "";
}


}

    return res.json({
      ok: true,
      text
    });
  } catch (err) {
    console.error("Welcome error:", err);
    return res.json({ ok: false, text: "" });
  }


});

app.get("/admin/stats", (req, res) => {
  try {
    const sessions = readJson(SESSIONS_FILE, []);
    const today = new Date().toISOString().slice(0, 10);

    const sessionsToday = sessions.filter((s) =>
      String(s.created_at || "").startsWith(today) ||
      String(s.last_active_at || "").startsWith(today)
    );

    const totals = sessions.reduce(
      (acc, s) => {
        acc.sessions += 1;
	acc.messages += Number(s.message_count || 0) / 2;
        acc.input_tokens += Number(s.input_tokens || 0);
        acc.output_tokens += Number(s.output_tokens || 0);
        acc.total_tokens += Number(s.total_tokens || 0);
        acc.estimated_cost_usd += Number(s.estimated_cost_usd || 0);
        return acc;
      },
      {
        sessions: 0,
        messages: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0
      }
    );

    return res.json({
      today,
      sessions_today: sessionsToday.length,
      total_sessions: totals.sessions,
      total_messages: totals.messages,
      total_input_tokens: totals.input_tokens,
      total_output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      estimated_cost_usd: Number(totals.estimated_cost_usd.toFixed(8)),
      avg_messages_per_session:
        totals.sessions > 0 ? Number((totals.messages / totals.sessions).toFixed(2)) : 0
    });
  } catch (err) {
    console.error("Admin stats error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load stats" });
  }
});

registerAdminRoutes(app, {
  SESSIONS_FILE,
  MESSAGES_FILE,
  USERS_FILE,
  CONVERSATIONS_FILE,
  readJson,
  CHARACTER_CONFIG
});

const port = process.env.PORT || 3000;
app.listen(port, "127.0.0.1", () => {
  console.log(`AI app listening on http://127.0.0.1:${port}`);
});

const fs = require("fs");

module.exports = function registerAdminRoutes(app, options) {
  const {
    SESSIONS_FILE,
    MESSAGES_FILE,
    USERS_FILE,
    CONVERSATIONS_FILE,
    readJson,
    CHARACTER_CONFIG
  } = options;

  function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Xfrend Admin"');
      return res.status(401).send("Authentication required");
    }

    const base64 = auth.split(" ")[1] || "";
    let decoded = "";

    try {
      decoded = Buffer.from(base64, "base64").toString("utf8");
    } catch (err) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Xfrend Admin"');
      return res.status(401).send("Invalid authentication");
    }

    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : "";
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";

    const expectedUser = process.env.ADMIN_USER || "";
    const expectedPass = process.env.ADMIN_PASS || "";

    if (!expectedUser || !expectedPass || user !== expectedUser || pass !== expectedPass) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Xfrend Admin"');
      return res.status(401).send("Invalid username or password");
    }

    next();
  }

  function writeSessions(sessions) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  }

  function readUsers() {
    return readJson(USERS_FILE, []);
  }

  function readConversations() {
    return readJson(CONVERSATIONS_FILE, []);
  }

  function readMessages() {
    try {
      if (!fs.existsSync(MESSAGES_FILE)) return [];
      const raw = fs.readFileSync(MESSAGES_FILE, "utf8").trim();
      if (!raw) return [];
      return raw
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (err) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      return [];
    }
  }


function readVisits() {
  const visitsFile = SESSIONS_FILE.replace(/sessions\.json$/, "visits.json");

  try {
    if (!fs.existsSync(visitsFile)) return [];
    const raw = fs.readFileSync(visitsFile, "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function formatVisitDuration(startedAt, lastActivity) {
  const start = Number(startedAt || 0);
  const end = Number(lastActivity || 0);

  if (!start || !end || end < start) return "—";

  const mins = Math.max(0, Math.round((end - start) / 60000));

  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const rem = mins % 60;

  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}



  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCharacterLabel(characterId) {
    const id = String(characterId || "general").trim() || "general";
    return CHARACTER_CONFIG?.[id]?.label || id;
  }

function getReadableUserAgent(userAgent = "") {
  const ua = String(userAgent || "");

  const lower = ua.toLowerCase();

  const isIOS =
    /iphone|ipad|ipod/.test(lower);

  const isAndroid =
    /android/.test(lower);

  const isWindows =
    /windows/.test(lower);

  const isMac =
    /macintosh|mac os/.test(lower) && !isIOS;

  const isXfrendIOS =
    /xfrendiosapp/.test(lower);

  const isXfrendAndroid =
    /xfrendandroidapp/.test(lower);

  let platform = "Unknown";

  if (isIOS) platform = "iPhone";
  else if (isAndroid) platform = "Android";
  else if (isWindows) platform = "Windows";
  else if (isMac) platform = "Mac";

  let browser = "Browser";

  if (/chrome/.test(lower) && !/edg/.test(lower)) {
    browser = "Chrome";
  } else if (/safari/.test(lower) && !/chrome/.test(lower)) {
    browser = "Safari";
  } else if (/firefox/.test(lower)) {
    browser = "Firefox";
  } else if (/edg/.test(lower)) {
    browser = "Edge";
  }

  if (isXfrendIOS) {
    return `${platform} • Xfrend iOS App`;
  }

  if (isXfrendAndroid) {
    return `${platform} • Xfrend Android App`;
  }

  return `${platform} • ${browser} • Website`;
}


  function getAuthLabel(session) {
    return session?.logged_in ? "Member" : "Guest";
  }

  function getUserDisplay(session) {
    if (!session?.logged_in) return session?.session_id || "—";
    return String(session.user_name || "").trim() || session.session_id || "—";
  }

  function formatPH(isoString) {
    if (!isoString) return "";
    try {
      return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
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

  function pageTemplate(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 24px;
      color: #222;
      background: #f7f7f7;
    }
    h1, h2, h3 { margin-top: 0; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .topnav {
      margin-bottom: 20px;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: white;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 14px;
    }
    .big {
      font-size: 24px;
      font-weight: bold;
      margin-top: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border: 1px solid #ddd;
    }
    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid #eee;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #fafafa;
    }
    .mono {
      font-family: Consolas, monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .preview {
      max-width: 360px;
      min-width: 220px;
      white-space: normal;
      line-height: 1.35;
      word-break: break-word;
    }
    .chat {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg {
      background: white;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 12px;
    }
    .msg.user {
      border-left: 5px solid #0b57d0;
    }
    .msg.assistant {
      border-left: 5px solid #0f9d58;
    }
    .meta {
      color: #666;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .content {
      white-space: pre-wrap;
      line-height: 1.45;
    }
    form.filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      background: white;
      border: 1px solid #ddd;
      padding: 12px;
      border-radius: 10px;
    }
    input, select, button {
      padding: 8px 10px;
      font-size: 14px;
    }
    .muted {
      color: #666;
      font-size: 13px;
    }
    .section {
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="topnav">
    <a href="/admin">Dashboard</a>
    <a href="/admin/sessions">Sessions</a>
    <a href="/admin/convos">Convos</a>
    <a href="/admin/users">Users</a>
    <a href="/admin/visitors">Visitors</a>
    <a href="/admin/stats">Raw stats JSON</a>


  </div>
  ${body}
</body>
</html>`;
  }

  function detectCategoryFromText(text) {
    const t = String(text || "").toLowerCase();

    const categories = [
      {
        name: "relationships",
        keywords: ["boyfriend", "girlfriend", "asawa", "husband", "wife", "ex", "break up", "breakup", "crush", "love", "relasyon", "dating", "partner"]
      },
      {
        name: "money",
        keywords: ["money", "utang", "debt", "salary", "sweldo", "bayad", "income", "negosyo", "business", "gastos", "budget", "benta", "pera", "investment"]
      },
      {
        name: "work",
        keywords: ["job", "work", "boss", "career", "office", "resume", "interview", "employee", "employer", "promotion", "freelance", "upwork", "client", "trabaho"]
      },
      {
        name: "family",
        keywords: ["family", "anak", "daughter", "son", "mother", "father", "mom", "dad", "parents", "parenting", "sister", "brother", "wife", "husband", "pamilya"]
      },
      {
        name: "emotional",
        keywords: ["lonely", "sad", "depressed", "depression", "anxiety", "worried", "takot", "iyak", "stress", "stressed", "hopeless", "empty", "pagod", "overwhelmed"]
      },
      {
        name: "health",
        keywords: ["health", "doctor", "medicine", "gamot", "itch", "rash", "ear", "cough", "blood pressure", "sick", "hospital", "symptoms", "dentist", "tooth", "gum"]
      },
      {
        name: "school",
        keywords: ["school", "homework", "teacher", "math", "study", "student", "lesson", "grade", "exam", "quiz", "integers", "assignment"]
      },
      {
        name: "technology",
        keywords: ["ai", "openai", "chatgpt", "node", "php", "server", "code", "app", "api", "javascript", "xfrend", "buhayofw", "crypto", "bitcoin"]
      },
      {
        name: "spirituality",
        keywords: ["god", "church", "faith", "pray", "prayer", "bible", "spiritual", "ministry", "christian"]
      }
    ];

    let bestCategory = "other";
    let bestScore = 0;

    for (const category of categories) {
      let score = 0;
      for (const keyword of category.keywords) {
        if (t.includes(keyword)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category.name;
      }
    }

    return bestCategory;
  }

  function getSessionCategory(messagesForSession) {
    const userText = messagesForSession
      .filter((m) => m.role === "user")
      .map((m) => String(m.content || ""))
      .join("\n");

    return detectCategoryFromText(userText);
  }

  function countByCategory(items, getCategoryFn) {
    const counts = new Map();

    for (const item of items) {
      const category = getCategoryFn(item) || "other";
      counts.set(category, (counts.get(category) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  function getFirstUserMessage(messagesForSession) {
    const firstUser = messagesForSession.find((m) => m.role === "user");
    return String(firstUser?.content || "").trim();
  }

function getLastUserMessage(messagesForSession) {
  const lastUser = [...messagesForSession]
    .reverse()
    .find((m) => m.role === "user");

  return String(lastUser?.content || "").trim();
}

  function shortenText(text, maxLen = 100) {
    const s = String(text || "").trim().replace(/\s+/g, " ");
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + "…";
  }

  function normalizePrompt(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s?+.-]/g, "")
      .trim();
  }

  function getTopUserPrompts(messages, limit = 10) {
    const counts = new Map();

    for (const m of messages) {
      if (m.role !== "user") continue;
      const normalized = normalizePrompt(m.content);
      if (!normalized) continue;
      const item = counts.get(normalized) || {
        normalized,
        sample: String(m.content || "").trim(),
        count: 0
      };
      item.count += 1;
      counts.set(normalized, item);
    }

    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  function getTopKeywords(messages, limit = 15) {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "those", "these",
      "is", "are", "was", "were", "be", "been", "being", "am",
      "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours", "they", "their",
      "he", "she", "it", "him", "her", "them",
      "to", "for", "of", "in", "on", "at", "by", "with", "from", "as", "about", "into", "over", "after",
      "what", "when", "where", "why", "how", "can", "could", "would", "should", "do", "does", "did", "will",
      "ako", "ikaw", "siya", "kami", "tayo", "kayo", "sila", "ko", "mo", "niya", "namin", "natin", "nila",
      "ang", "ng", "sa", "mga", "ito", "iyan", "yun", "yon", "po", "ba", "na", "pa", "din", "rin", "lang", "lamang",
      "may", "meron", "wala", "kasi", "pero", "para", "paano", "ano", "saan", "kailan", "bakit",
      "hello", "hi", "pls", "please"
    ]);

    const counts = new Map();

    for (const m of messages) {
      if (m.role !== "user") continue;
      const words = String(m.content || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

      for (const word of words) {
        if (word.length < 3) continue;
        if (stopWords.has(word)) continue;
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  function getBusiestHours(messages) {
    const counts = new Map();

    for (const m of messages) {
      const ts = String(m.created_at || "");
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      const hour = String(d.getUTCHours()).padStart(2, "0");
      counts.set(hour, (counts.get(hour) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  function getSessionsByDay(sessions) {
    const counts = new Map();

    for (const s of sessions) {
      const day = String(s.created_at || "").slice(0, 10);
      if (!day) continue;
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 14);
  }

  function getConversationMessageCount(messages, conversationId) {
    return messages.filter((m) => m.conversation_id === conversationId).length;
  }

  app.get("/admin/sessions/:sessionId/toggle-test", requireAdmin, (req, res) => {
    const sessionId = req.params.sessionId;
    const makeTest = String(req.query.value || "1") === "1";

    const sessions = readJson(SESSIONS_FILE, []);
    const idx = sessions.findIndex((s) => s.session_id === sessionId);

    if (idx === -1) {
      return res.status(404).send(pageTemplate("Not found", "<h1>Session not found</h1>"));
    }

    sessions[idx] = {
      ...sessions[idx],
      is_test: makeTest
    };

    writeSessions(sessions);

    return res.redirect(`/admin/sessions/${encodeURIComponent(sessionId)}`);
  });

app.get("/admin/visitors", requireAdmin, (req, res) => {
  const visits = readVisits();
  const sessions = readJson(SESSIONS_FILE, []);

  const sessionByDevice = new Map();

  for (const s of sessions) {
    if (!s.device_id) continue;

    const existing = sessionByDevice.get(s.device_id);

    if (
      !existing ||
      String(s.last_active_at || s.created_at || "").localeCompare(
        String(existing.last_active_at || existing.created_at || "")
      ) > 0
    ) {
      sessionByDevice.set(s.device_id, s);
    }
  }

  const rows = visits
    .map((v) => {
      const session = sessionByDevice.get(v.device_id) || null;

      const userLabel = session
        ? getUserDisplay(session)
        : "Guest";

      return {
        started_at: v.started_at,
        last_activity: v.last_activity,
        user: userLabel,
        platform: v.platform || "Unknown",
        duration: formatVisitDuration(v.started_at, v.last_activity),
        status: v.asked_ai ? "Asked AI" : "Browsed only"
      };
    })
    .sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0))
    .slice(0, 200);

  const browsedOnly = rows.filter((r) => r.status === "Browsed only").length;
  const askedAi = rows.filter((r) => r.status === "Asked AI").length;

  const body = `
    <h1>Visitors</h1>

    <div class="cards">
      <div class="card"><div>Total visits shown</div><div class="big">${rows.length}</div></div>
      <div class="card"><div>Browsed only</div><div class="big">${browsedOnly}</div></div>
      <div class="card"><div>Asked AI</div><div class="big">${askedAi}</div></div>
    </div>

    <div class="section">
      <table>
        <thead>
          <tr>
            <th>Time (PH)</th>
            <th>User</th>
            <th>Platform</th>
            <th>Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${escapeHtml(formatPH(r.started_at))}</td>
              <td>${escapeHtml(r.user)}</td>
              <td>${escapeHtml(r.platform)}</td>
              <td>${escapeHtml(r.duration)}</td>
              <td>${escapeHtml(r.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  res.send(pageTemplate("Visitors", body));
});


  app.get("/admin", requireAdmin, (req, res) => {
    const allSessions = readJson(SESSIONS_FILE, []);
    const includeTest = String(req.query.include_test || "0") === "1";
    const sessions = includeTest
      ? allSessions
      : allSessions.filter((s) => !s.is_test);

    const messages = readMessages();
    const users = readUsers();

    const today = new Date().toISOString().slice(0, 10);

    const sessionsToday = sessions.filter((s) =>
      String(s.created_at || "").startsWith(today) ||
      String(s.last_active_at || "").startsWith(today)
    );

    const usersToday = users.filter((u) =>
      String(u.created_at || "").startsWith(today)
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

    const avgMessagesPerSession =
      totals.sessions > 0 ? Number((totals.messages / totals.sessions).toFixed(2)) : 0;

    const avgTokensPerSession =
      totals.sessions > 0 ? Number((totals.total_tokens / totals.sessions).toFixed(2)) : 0;

    const avgCostPerSession =
      totals.sessions > 0 ? Number((totals.estimated_cost_usd / totals.sessions).toFixed(6)) : 0;

    const sessions5Plus = sessions.filter((s) => Number(s.message_count || 0) >= 5).length;
    const sessions10Plus = sessions.filter((s) => Number(s.message_count || 0) >= 10).length;

    const topPrompts = getTopUserPrompts(messages, 10);
    const topKeywords = getTopKeywords(messages, 15);
    const busiestHours = getBusiestHours(messages);
    const sessionsByDay = getSessionsByDay(sessions);

    const messageMap = new Map();
    for (const m of messages) {
      if (!messageMap.has(m.session_id)) {
        messageMap.set(m.session_id, []);
      }
      messageMap.get(m.session_id).push(m);
    }

    const sessionsWithCategory = sessions.map((s) => {
      const convo = messageMap.get(s.session_id) || [];
      const firstUserMessage = getFirstUserMessage(convo);

      return {
        ...s,
        category: getSessionCategory(convo),

first_user_message: firstUserMessage,
latest_user_message: getLastUserMessage(convo),
latest_user_preview: shortenText(getLastUserMessage(convo), 100),

        auth_label: getAuthLabel(s),
        user_display: getUserDisplay(s)
      };
    });

    const recentSessions = [...sessionsWithCategory]
      .sort((a, b) => String(b.last_active_at || "").localeCompare(String(a.last_active_at || "")))
      .slice(0, 20);

    const topCategories = countByCategory(sessionsWithCategory, (s) => s.category).slice(0, 10);

    const body = `
      <h1>Xfrend Admin Dashboard</h1>

      <div class="cards">
        <div class="card"><div>Sessions today</div><div class="big">${sessionsToday.length}</div></div>
        <div class="card"><div>Total sessions</div><div class="big">${totals.sessions}</div></div>
        <div class="card"><div>Signed-up users</div><div class="big">${users.length}</div></div>
        <div class="card"><div>Users joined today</div><div class="big">${usersToday.length}</div></div>
        <div class="card"><div>Total messages</div><div class="big">${totals.messages}</div></div>
        <div class="card"><div>Total tokens</div><div class="big">${totals.total_tokens}</div></div>
        <div class="card"><div>Input tokens</div><div class="big">${totals.input_tokens}</div></div>
        <div class="card"><div>Output tokens</div><div class="big">${totals.output_tokens}</div></div>
        <div class="card"><div>Estimated cost (USD)</div><div class="big">${Number(totals.estimated_cost_usd || 0).toFixed(6)}</div></div>
        <div class="card"><div>Avg messages/session</div><div class="big">${avgMessagesPerSession}</div></div>
        <div class="card"><div>Avg tokens/session</div><div class="big">${avgTokensPerSession}</div></div>
        <div class="card"><div>Avg cost/session</div><div class="big">${avgCostPerSession}</div></div>
        <div class="card"><div>Sessions with 5+ msgs</div><div class="big">${sessions5Plus}</div></div>
        <div class="card"><div>Sessions with 10+ msgs</div><div class="big">${sessions10Plus}</div></div>
        <div class="card"><div>Logged message rows</div><div class="big">${messages.length}</div></div>
      </div>

      <h2>Recent sessions</h2>
      <table>
        <thead>
          <tr>
            <th>Latest question</th>
            <th>Auth</th>
            <th>Name / Session</th>
            <th>Messages</th>
            <th>Time (PH)</th>
            <th>Device</th>
          </tr>
        </thead>
        <tbody>


${recentSessions.map((s) => `
  <tr>
    <td class="preview">
      <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(s.latest_user_preview || "(no user message)")}</a>
    </td>
    <td>${escapeHtml(s.auth_label || "Guest")}</td>
    <td>${escapeHtml(s.user_display || "—")}</td>
    <td>${Number(s.message_count || 0) / 2}</td>
    <td>${escapeHtml(formatPH(s.last_active_at || ""))}</td>
    <td>${escapeHtml(s.device_type || "")}</td>
  </tr>
`).join("")}

          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Top keywords</h2>
        <table>
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            ${topKeywords.map((k) => `
              <tr>
                <td>${escapeHtml(k.word)}</td>
                <td>${k.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Busiest UTC hours</h2>
        <table>
          <thead>
            <tr>
              <th>UTC hour</th>
              <th>Message count</th>
            </tr>
          </thead>
          <tbody>
            ${busiestHours.map((h) => `
              <tr>
                <td>${escapeHtml(h.hour)}:00</td>
                <td>${h.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Sessions by day</h2>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            ${sessionsByDay.map((d) => `
              <tr>
                <td>${escapeHtml(d.day)}</td>
                <td>${d.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Top categories by session</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            ${topCategories.map((c) => `
              <tr>
                <td>${escapeHtml(c.category)}</td>
                <td>${c.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    res.send(pageTemplate("Xfrend Admin", body));
  });

  app.get("/admin/sessions", requireAdmin, (req, res) => {
    const allSessions = readJson(SESSIONS_FILE, []);
    const includeTest = String(req.query.include_test || "0") === "1";
    const sessions = includeTest ? allSessions : allSessions.filter((s) => !s.is_test);

    const messages = readMessages();

    const allConvoRows = buildAdminConvoRows();

    const q = String(req.query.q || "").trim().toLowerCase();
    const minMessages = Number(req.query.min_messages || 0);
    const sort = String(req.query.sort || "latest");

    const messageMap = new Map();
    for (const m of messages) {
      if (!messageMap.has(m.session_id)) {
        messageMap.set(m.session_id, []);
      }
      messageMap.get(m.session_id).push(m);
    }

    let rows = sessions.map((s) => {
      const convo = messageMap.get(s.session_id) || [];
      const searchableText = convo.map((m) => String(m.content || "")).join("\n").toLowerCase();

const userMessageCount =
  convo.filter((m) => m.role === "user").length;

const assistantMessageCount =
  convo.filter((m) => m.role === "assistant").length;

const convoCount =
  allConvoRows.filter((r) => r.session_id === s.session_id).length;

      return {
        ...s,

user_message_count: userMessageCount,
assistant_message_count: assistantMessageCount,
convo_count: convoCount,

        searchable_text: searchableText,
        category: getSessionCategory(convo),
        first_user_message: getFirstUserMessage(convo),
        first_user_preview: shortenText(getFirstUserMessage(convo), 110),
        auth_label: getAuthLabel(s),
        user_display: getUserDisplay(s)
      };
    });

    if (minMessages > 0) {
      rows = rows.filter((s) => Number(s.message_count || 0) >= minMessages);
    }

    if (q) {
      rows = rows.filter((s) =>
        s.searchable_text.includes(q) ||
        String(s.session_id || "").toLowerCase().includes(q)
      );
    }

    if (sort === "messages") {
      rows.sort((a, b) => Number(b.message_count || 0) - Number(a.message_count || 0));
    } else {
      rows.sort((a, b) => String(b.last_active_at || "").localeCompare(String(a.last_active_at || "")));
    }

    const body = `
      <h1>Sessions</h1>

      <form method="get" action="/admin/sessions" class="filters">
        <div>
          <div class="muted">Keyword</div>
          <input type="text" name="q" value="${escapeHtml(q)}" placeholder="money, lonely, asawa">
        </div>
        <div>
          <div class="muted">Min messages</div>
          <input type="number" name="min_messages" value="${Number.isFinite(minMessages) ? minMessages : 0}" min="0">
        </div>
        <div>
          <div class="muted">Sort</div>
          <select name="sort">
            <option value="latest" ${sort === "latest" ? "selected" : ""}>Latest</option>
            <option value="messages" ${sort === "messages" ? "selected" : ""}>Most messages</option>
          </select>
        </div>
        <div style="align-self:end;">
          <button type="submit">Apply</button>
        </div>
      </form>

      <div class="muted" style="margin-bottom:10px;">
        <a href="/admin/sessions">Hide test sessions</a> |
        <a href="/admin/sessions?include_test=1">Show test sessions</a>
      </div>

      <div class="muted" style="margin-bottom:10px;">
        Showing ${rows.length} session(s)
        ${includeTest ? " · including test sessions" : " · excluding test sessions"}
      </div>

      <table>
        <thead>
          <tr>
<th>Name / Session</th>
<th>Auth</th>
<th>Messages</th>
<th>AI replies</th>
<th>Convos</th>
<th>Cost</th>
<th>Time (PH)</th>
<th>Device</th>

          </tr>
        </thead>
        <tbody>
          ${rows.map((s) => `
            <tr>
<td>
  <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">
    ${escapeHtml(s.user_display || "—")}
  </a>
</td>

<td>${escapeHtml(s.auth_label || "Guest")}</td>

<td>${s.user_message_count}</td>

<td>${s.assistant_message_count}</td>

<td>${s.convo_count}</td>

<td>$${Number(s.estimated_cost_usd || 0).toFixed(4)}</td>

              <td>${escapeHtml(formatPH(s.last_active_at || ""))}</td>
              <td>${escapeHtml(s.device_type || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    res.send(pageTemplate("Sessions", body));
  });

  app.get("/admin/sessions/:sessionId", requireAdmin, (req, res) => {
    const sessionId = req.params.sessionId;
    const sessions = readJson(SESSIONS_FILE, []);
    const messages = readMessages();

const session = sessions.find((s) => s.session_id === sessionId);

const sessionMessages = messages.filter(
  (m) => m.session_id === sessionId
);

const userMessageCount =
  sessionMessages.filter((m) => m.role === "user").length;

const assistantMessageCount =
  sessionMessages.filter((m) => m.role === "assistant").length;

const convoRows = buildAdminConvoRows()
  .filter((r) => r.session_id === sessionId);

const page = Math.max(1, Number(req.query.page || 1));
const perPage = 30;

const sortedSessionMessages = [...sessionMessages].sort((a, b) =>
  String(b.created_at || "").localeCompare(String(a.created_at || ""))
);

const totalPages = Math.max(1, Math.ceil(sortedSessionMessages.length / perPage));
const pageMessages = sortedSessionMessages.slice((page - 1) * perPage, page * perPage);


    if (!session) {
      return res.status(404).send(pageTemplate("Not found", `<h1>Session not found</h1>`));
    }

    const body = `
      <h1>Session detail</h1>

      <div class="card" style="margin-bottom:20px;">
        <div><strong>${session.logged_in ? "Name" : "Session"}:</strong> ${escapeHtml(getUserDisplay(session))}</div>
        <div><strong>Auth:</strong> ${escapeHtml(getAuthLabel(session))}</div>
        <div><strong>Email:</strong> ${escapeHtml(session.user_email || "—")}</div>

<div><strong>Messages:</strong> ${userMessageCount}</div>

<div><strong>Assistant messages:</strong> ${assistantMessageCount}</div>

<div><strong>Total rows:</strong> ${sessionMessages.length}</div>

<div><strong>Total tokens:</strong> ${Number(session.total_tokens || 0)}</div>


        <div><strong>Total cost USD:</strong> ${Number(session.estimated_cost_usd || 0).toFixed(6)}</div>
        <div><strong>Device:</strong> ${escapeHtml(session.device_type || "")}</div>

	<div><strong>User agent:</strong> ${escapeHtml(getReadableUserAgent(session.user_agent || ""))}</div>

        <div><strong>IP hash:</strong> <span class="mono">${escapeHtml(session.ip_hash || "")}</span></div>
        <div><strong>Created (PH):</strong> ${escapeHtml(formatPH(session.created_at || ""))}</div>
      </div>

<h2>Conversations in this session</h2>

<table>
  <thead>
    <tr>
      <th>Title</th>
      <th>Character</th>
      <th>Messages</th>
      <th>Updated (PH)</th>
    </tr>
  </thead>

  <tbody>
    ${convoRows.map((r) => `
      <tr>
        <td class="preview">
          <a href="/admin/convos/${encodeURIComponent(r.admin_convo_id)}">
            ${escapeHtml(r.title || "Chat")}
          </a>
        </td>

        <td>${escapeHtml(r.character_label)}</td>

        <td>${Number(r.message_count || 0)}</td>

        <td>${escapeHtml(formatPH(r.updated_at || ""))}</td>
      </tr>
    `).join("")}
  </tbody>
</table>

<h2 style="margin-top:24px;">Messages in this session</h2>

<div class="muted" style="margin-bottom:10px;">
  Showing newest first · Page ${page} of ${totalPages}
</div>


<div style="margin:12px 0 16px;">
  ${page > 1 ? `<a href="/admin/sessions/${encodeURIComponent(sessionId)}?page=${page - 1}">← Newer messages</a>` : ""}
  ${page > 1 && page < totalPages ? " | " : ""}
  ${page < totalPages ? `<a href="/admin/sessions/${encodeURIComponent(sessionId)}?page=${page + 1}">Older messages →</a>` : ""}
</div>


<div class="chat">
  ${pageMessages.map((m) => `
    <div class="msg ${escapeHtml(m.role || "")}">
      <div class="meta">
        ${escapeHtml(m.role || "")}
        · ${escapeHtml(formatPH(m.created_at || ""))}
        · ${escapeHtml(getCharacterLabel(m.character_id || ""))}
      </div>
      <div class="content">${escapeHtml(m.content || "")}</div>
    </div>
  `).join("")}
</div>

<div style="margin-top:16px;">
  ${page > 1 ? `<a href="/admin/sessions/${encodeURIComponent(sessionId)}?page=${page - 1}">← Newer messages</a>` : ""}
  ${page > 1 && page < totalPages ? " | " : ""}
  ${page < totalPages ? `<a href="/admin/sessions/${encodeURIComponent(sessionId)}?page=${page + 1}">Older messages →</a>` : ""}
</div>

    `;

    res.send(pageTemplate(`Session ${sessionId}`, body));
  });


  function buildAdminConvoRows() {
    const conversations = readConversations();
    const users = readUsers();
    const sessions = readJson(SESSIONS_FILE, []);
    const messages = readMessages();

    const userMap = new Map(users.map((u) => [u.user_id, u]));
    const sessionMap = new Map(sessions.map((s) => [s.session_id, s]));

    const grouped = new Map();

for (const c of conversations) {
  const conversationId = String(c.conversation_id || "").trim();
  if (!conversationId) continue;

  const key = `convo:${conversationId}`;

  grouped.set(key, {
    admin_convo_id: key,
    conversation_id: conversationId,
    conversation: c,
    messages: []
  });
}

    for (const m of messages) {
      const conversationId = String(m.conversation_id || "").trim();
      const sessionId = String(m.session_id || "").trim();

      const key = conversationId
        ? `convo:${conversationId}`
        : sessionId
          ? `session:${sessionId}`
          : "";

      if (!key) continue;

      if (!grouped.has(key)) {
        grouped.set(key, {
          admin_convo_id: key,
          conversation_id: conversationId || "",
          conversation: null,
          messages: []
        });
      }

      grouped.get(key).messages.push(m);
    }

    return [...grouped.values()].map((item) => {
      const msgs = item.messages.sort((a, b) =>
        String(a.created_at || "").localeCompare(String(b.created_at || ""))
      );

      const firstMsg = msgs[0] || null;
      const lastMsg = msgs[msgs.length - 1] || null;
      const firstUserMsg = msgs.find((m) => m.role === "user") || null;
      const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user") || null;

      const sessionId =
        firstMsg?.session_id ||
        item.conversation?.session_id ||
        "";

      const session = sessionMap.get(sessionId) || null;
      const user = item.conversation?.user_id ? userMap.get(item.conversation.user_id) : null;

      const loggedIn = Boolean(user || session?.logged_in);

      const title =
        item.conversation?.title ||
        shortenText(firstUserMsg?.content || "Guest chat", 80);

      const characterId =
        item.conversation?.character_id ||
        firstMsg?.character_id ||
        lastMsg?.character_id ||
        "general";

      return {
        admin_convo_id: item.admin_convo_id,
        conversation_id: item.conversation_id,
        session_id: sessionId,
        title,
        character_label: getCharacterLabel(characterId),
        auth_label: loggedIn ? "Member" : "Guest",
        name: user?.name || session?.user_name || (loggedIn ? "Member" : "Guest"),
        email: user?.email || session?.user_email || "—",

	device: session?.device_type || "—",
	platform: getReadableUserAgent(session?.user_agent || ""),
	device_id: session?.device_id || "—",

        created_at: item.conversation?.created_at || firstMsg?.created_at || session?.created_at || "",
        updated_at: item.conversation?.updated_at || lastMsg?.created_at || session?.last_active_at || "",
	message_count:
	  msgs.filter((m) => m.role === "user").length,
        first_user_preview: shortenText(firstUserMsg?.content || "", 100),
        last_user_preview: shortenText(lastUserMsg?.content || "", 100)
      };
    }).sort((a, b) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
    );
  }

  app.get("/admin/convos", requireAdmin, (req, res) => {
    const rows = buildAdminConvoRows();

    const body = `
      <h1>Convos</h1>

      <div class="muted" style="margin-bottom:10px;">
        Showing ${rows.length} convo(s), including guests and members, newest updated first
      </div>

      <table>
        <thead>
          <tr>
            <th>Title / Last user message</th>
            <th>Auth</th>
            <th>Character</th>
            <th>Name</th>
            <th>Email</th>
            <th>Device</th>
            <th>Updated (PH)</th>
            <th>Messages</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td class="preview">
                <a href="/admin/convos/${encodeURIComponent(r.admin_convo_id)}">${escapeHtml(r.title || "Chat")}</a>
                <div class="muted">${escapeHtml(r.last_user_preview || r.first_user_preview || "")}</div>
              </td>
              <td>${escapeHtml(r.auth_label)}</td>
              <td>${escapeHtml(r.character_label)}</td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.email)}</td>
              <td>${escapeHtml(r.device)}</td>
              <td>${escapeHtml(formatPH(r.updated_at || ""))}</td>
              <td>${Number(r.message_count || 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    res.send(pageTemplate("Convos", body));
  });

  app.get("/admin/convos/:adminConvoId", requireAdmin, (req, res) => {
    const adminConvoId = String(req.params.adminConvoId || "").trim();

    const rows = buildAdminConvoRows();
    const row = rows.find((r) => r.admin_convo_id === adminConvoId);

    const messages = readMessages();

    if (!row) {
      return res.status(404).send(pageTemplate("Not found", `<h1>Convo not found</h1>`));
    }

    let convoMessages = [];

    if (adminConvoId.startsWith("convo:")) {
      const realConvoId = adminConvoId.slice("convo:".length);
      convoMessages = messages.filter((m) => m.conversation_id === realConvoId);
    } else if (adminConvoId.startsWith("session:")) {
      const realSessionId = adminConvoId.slice("session:".length);
      convoMessages = messages.filter((m) =>
        String(m.session_id || "") === realSessionId &&
        !String(m.conversation_id || "").trim()
      );
    }

    convoMessages.sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    );

    const body = `
      <h1>Convo detail</h1>

      <div class="card" style="margin-bottom:20px;">
        <div><strong>Title:</strong> ${escapeHtml(row.title || "Chat")}</div>
        <div><strong>Auth:</strong> ${escapeHtml(row.auth_label)}</div>
        <div><strong>Character:</strong> ${escapeHtml(row.character_label)}</div>
        <div><strong>Name:</strong> ${escapeHtml(row.name || "—")}</div>
        <div><strong>Email:</strong> ${escapeHtml(row.email || "—")}</div>
        <div><strong>Device:</strong> ${escapeHtml(row.device || "—")}</div>

	<div><strong>Platform:</strong> ${escapeHtml(row.platform || "—")}</div>
	<div><strong>Device ID:</strong> <span class="mono">${escapeHtml(row.device_id || "—")}</span></div>

        <div><strong>Session ID:</strong> <span class="mono">${escapeHtml(row.session_id || "—")}</span></div>
        <div><strong>Conversation ID:</strong> <span class="mono">${escapeHtml(row.conversation_id || "—")}</span></div>
        <div><strong>Created (PH):</strong> ${escapeHtml(formatPH(row.created_at || ""))}</div>
        <div><strong>Updated (PH):</strong> ${escapeHtml(formatPH(row.updated_at || ""))}</div>
<div><strong>Messages:</strong> ${
  convoMessages.filter((m) => m.role === "user").length
}</div>


      </div>

      <h2>Messages</h2>
      <div class="chat">
        ${convoMessages.map((m) => `
          <div class="msg ${escapeHtml(m.role || "")}">
            <div class="meta">
              <strong>${escapeHtml(m.role || "")}</strong> ·
              ${escapeHtml(formatPH(m.created_at || ""))}
            </div>
            <div class="content">${escapeHtml(m.content || "")}</div>
          </div>
        `).join("")}
      </div>
    `;

    res.send(pageTemplate(`Convo ${adminConvoId}`, body));
  });

  app.get("/admin/users", requireAdmin, (req, res) => {
    const users = readUsers()
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    const body = `
      <h1>Users</h1>

      <div class="muted" style="margin-bottom:10px;">
        Showing ${users.length} signed-up user(s), newest first
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Joined (PH)</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${escapeHtml(u.name || "")}</td>
              <td>${escapeHtml(u.email || "")}</td>
              <td>${escapeHtml(formatPH(u.created_at || ""))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    res.send(pageTemplate("Users", body));
  });
};

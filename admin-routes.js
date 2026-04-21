const fs = require("fs");

module.exports = function registerAdminRoutes(app, options) {
  const {
    SESSIONS_FILE,
    MESSAGES_FILE,
    readJson
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
      max-width: 320px;
      min-width: 220px;
      white-space: normal;
      line-height: 1.35;
      word-break: break-word;
    }
    .col-session {
      width: 170px;
    }
    .col-small {
      width: 90px;
      white-space: nowrap;
    }
    .col-medium {
      width: 140px;
      white-space: nowrap;
    }
    .col-device {
      width: 80px;
      white-space: nowrap;
    }
    .col-hash {
      max-width: 180px;
      word-break: break-all;
      font-size: 12px;
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
      "the","a","an","and","or","but","if","then","than","that","this","those","these",
      "is","are","was","were","be","been","being","am",
      "i","me","my","mine","you","your","yours","we","our","ours","they","their",
      "he","she","it","him","her","them",
      "to","for","of","in","on","at","by","with","from","as","about","into","over","after",
      "what","when","where","why","how","can","could","would","should","do","does","did","will",
      "ako","ikaw","siya","kami","tayo","kayo","sila","ko","mo","niya","namin","natin","nila",
      "ang","ng","sa","mga","ito","iyan","yun","yon","po","ba","na","pa","din","rin","lang","lamang",
      "may","meron","wala","kasi","pero","para","paano","ano","saan","kailan","bakit",
      "hello","hi","pls","please"
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

  app.get("/admin", requireAdmin, (req, res) => {
const allSessions = readJson(SESSIONS_FILE, []);
const includeTest = String(req.query.include_test || "0") === "1";
const sessions = includeTest
  ? allSessions
  : allSessions.filter((s) => !s.is_test);

    const messages = readMessages();
    const today = new Date().toISOString().slice(0, 10);

    const sessionsToday = sessions.filter((s) =>
      String(s.created_at || "").startsWith(today) ||
      String(s.last_active_at || "").startsWith(today)
    );

    const totals = sessions.reduce(
      (acc, s) => {
        acc.sessions += 1;
        acc.messages += Number(s.message_count || 0);
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
    first_user_preview: shortenText(firstUserMessage, 100)
  };
});

    const recentSessions = [...sessionsWithCategory]
      .sort((a, b) => String(b.last_active_at || "").localeCompare(String(a.last_active_at || "")))
      .slice(0, 20);

    const expensiveSessions = [...sessionsWithCategory]
      .sort((a, b) => Number(b.estimated_cost_usd || 0) - Number(a.estimated_cost_usd || 0))
      .slice(0, 10);

    const longestSessions = [...sessionsWithCategory]
      .sort((a, b) => Number(b.message_count || 0) - Number(a.message_count || 0))
      .slice(0, 10);


    const topCategories = countByCategory(sessionsWithCategory, (s) => s.category).slice(0, 10);

    const engagedCategories = countByCategory(
      sessionsWithCategory.filter((s) => Number(s.message_count || 0) >= 5),
      (s) => s.category
    ).slice(0, 10);

    const expensiveCategories = countByCategory(
      [...sessionsWithCategory]
        .sort((a, b) => Number(b.estimated_cost_usd || 0) - Number(a.estimated_cost_usd || 0))
        .slice(0, 20),
      (s) => s.category
    ).slice(0, 10);

    const body = `
      <h1>Xfrend Admin Dashboard</h1>

      <div class="cards">
        <div class="card"><div>Sessions today</div><div class="big">${sessionsToday.length}</div></div>
        <div class="card"><div>Total sessions</div><div class="big">${totals.sessions}</div></div>
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
  <th>First question</th>
  <th>Category</th>
<th class="col-small">Test</th>
  <th>Last active</th>
  <th>Messages</th>
  <th>Tokens</th>
  <th>Cost USD</th>
  <th>Device</th>
</tr>
        </thead>
        <tbody>
${recentSessions.map((s) => `
  <tr>
    <td class="preview">
      <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(s.first_user_preview || "(no user message)")}</a>
    </td>
    <td>${escapeHtml(s.category || "other")}</td>
    <td>${s.is_test ? "Yes" : ""}</td>
    <td>${escapeHtml(s.last_active_at || "")}</td>
    <td>${Number(s.message_count || 0)}</td>
    <td>${Number(s.total_tokens || 0)}</td>
    <td>${Number(s.estimated_cost_usd || 0).toFixed(6)}</td>
    <td>${escapeHtml(s.device_type || "")}</td>
  </tr>
`).join("")}
        </tbody>
      </table>

      <div class="section">
        <h2>Longest sessions</h2>
        <table>
          <thead>
<tr>
  <th>First question</th>
  <th>Category</th>
  <th>Messages</th>
  <th>Tokens</th>
  <th>Cost USD</th>
</tr>
          </thead>
          <tbody>
${longestSessions.map((s) => `
  <tr>
    <td class="preview">
      <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(s.first_user_preview || "(no user message)")}</a>
    </td>
    <td>${escapeHtml(s.category || "other")}</td>
    <td>${Number(s.message_count || 0)}</td>
    <td>${Number(s.total_tokens || 0)}</td>
    <td>${Number(s.estimated_cost_usd || 0).toFixed(6)}</td>
  </tr>
`).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Most expensive sessions</h2>
        <table>
          <thead>
<tr>
  <th>First question</th>
  <th>Category</th>
  <th>Cost USD</th>
  <th>Tokens</th>
  <th>Messages</th>
</tr>
          </thead>
          <tbody>
${expensiveSessions.map((s) => `
  <tr>
    <td class="preview">
      <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(s.first_user_preview || "(no user message)")}</a>
    </td>
    <td>${escapeHtml(s.category || "other")}</td>
    <td>${Number(s.estimated_cost_usd || 0).toFixed(6)}</td>
    <td>${Number(s.total_tokens || 0)}</td>
    <td>${Number(s.message_count || 0)}</td>
  </tr>
`).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Top repeated user prompts</h2>
        <table>
          <thead>
            <tr>
              <th>Count</th>
              <th>Prompt</th>
            </tr>
          </thead>
          <tbody>
            ${topPrompts.map((p) => `
              <tr>
                <td>${p.count}</td>
                <td>${escapeHtml(p.sample)}</td>
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

      <div class="section">
        <h2>Top categories among engaged sessions (5+ msgs)</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            ${engagedCategories.map((c) => `
              <tr>
                <td>${escapeHtml(c.category)}</td>
                <td>${c.count}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Top categories among expensive sessions</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            ${expensiveCategories.map((c) => `
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

      return {
        ...s,
        searchable_text: searchableText,
        category: getSessionCategory(convo),
        first_user_message: getFirstUserMessage(convo),
        first_user_preview: shortenText(getFirstUserMessage(convo), 110)
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

    if (sort === "cost") {
      rows.sort((a, b) => Number(b.estimated_cost_usd || 0) - Number(a.estimated_cost_usd || 0));
    } else if (sort === "messages") {
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
            <option value="cost" ${sort === "cost" ? "selected" : ""}>Highest cost</option>
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
            <th>First question</th>
            <th class="col-small">Category</th>
	    <th class="col-small">Test</th>
            <th class="col-small">Msgs</th>
            <th class="col-small">Tokens</th>
            <th class="col-small">Cost USD</th>
            <th class="col-medium">Last active</th>
            <th class="col-device">Device</th>
            <th class="col-session">Session ID</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((s) => `
            <tr>
              <td class="preview">
                <a href="/admin/sessions/${encodeURIComponent(s.session_id)}">${escapeHtml(s.first_user_preview || "(no user message)")}</a>
              </td>
              <td>${escapeHtml(s.category || "other")}</td>
	      <td>${s.is_test ? "Yes" : ""}</td>
              <td>${Number(s.message_count || 0)}</td>
              <td>${Number(s.total_tokens || 0)}</td>
              <td>${Number(s.estimated_cost_usd || 0).toFixed(6)}</td>
              <td>${escapeHtml(s.last_active_at || "")}</td>
              <td>${escapeHtml(s.device_type || "")}</td>
              <td class="mono col-session">${escapeHtml(s.session_id)}</td>
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
    const convo = messages.filter((m) => m.session_id === sessionId);

    if (!session) {
      return res.status(404).send(pageTemplate("Not found", `<h1>Session not found</h1>`));
    }

    const body = `
      <h1>Session detail</h1>

      <div class="card" style="margin-bottom:20px;">
        <div><strong>Session ID:</strong> <span class="mono">${escapeHtml(session.session_id)}</span></div>
        <div><strong>Test session:</strong> ${session.is_test ? "Yes" : "No"}</div>
        <div>
          ${session.is_test
            ? `<a href="/admin/sessions/${encodeURIComponent(session.session_id)}/toggle-test?value=0">Unmark as test</a>`
            : `<a href="/admin/sessions/${encodeURIComponent(session.session_id)}/toggle-test?value=1">Mark as test</a>`}
        </div>
        <div><strong>Detected category:</strong> ${escapeHtml(getSessionCategory(convo))}</div>
        <div><strong>First user message:</strong> ${escapeHtml(getFirstUserMessage(convo) || "(none)")}</div>
        <div><strong>Created:</strong> ${escapeHtml(session.created_at || "")}</div>
        <div><strong>Last active:</strong> ${escapeHtml(session.last_active_at || "")}</div>
        <div><strong>Messages:</strong> ${Number(session.message_count || 0)}</div>
        <div><strong>Input tokens:</strong> ${Number(session.input_tokens || 0)}</div>
        <div><strong>Output tokens:</strong> ${Number(session.output_tokens || 0)}</div>
        <div><strong>Total tokens:</strong> ${Number(session.total_tokens || 0)}</div>
        <div><strong>Estimated cost USD:</strong> ${Number(session.estimated_cost_usd || 0).toFixed(6)}</div>
        <div><strong>Device:</strong> ${escapeHtml(session.device_type || "")}</div>
        <div><strong>User agent:</strong> ${escapeHtml(session.user_agent || "")}</div>
        <div><strong>IP hash:</strong> <span class="mono">${escapeHtml(session.ip_hash || "")}</span></div>
      </div>

      <h2>Conversation</h2>
      <div class="chat">
        ${convo.map((m) => `
          <div class="msg ${escapeHtml(m.role || "")}">
            <div class="meta">
              <strong>${escapeHtml(m.role || "")}</strong> ·
              ${escapeHtml(m.created_at || "")} ·
              tokens: ${Number(m.total_tokens || 0)} ·
              cost: ${Number(m.estimated_cost_usd || 0).toFixed(6)}
            </div>
            <div class="content">${escapeHtml(m.content || "")}</div>
          </div>
        `).join("")}
      </div>
    `;

    res.send(pageTemplate(`Session ${sessionId}`, body));
  });
};

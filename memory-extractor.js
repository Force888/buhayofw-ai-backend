function normalizeText(value = "") {
  return String(value || "").trim();
}

function pickPreferredLanguage(text = "") {
  const t = text.toLowerCase();

  if (
    t.includes("taglish") ||
    t.includes("tagalog and english") ||
    t.includes("mixed tagalog") ||
    t.includes("mixed filipino")
  ) {
    return "taglish";
  }

  if (
    t.includes("tagalog only") ||
    t.includes("filipino only") ||
    t.includes("pure tagalog")
  ) {
    return "tagalog";
  }

  if (
    t.includes("english only") ||
    t.includes("pure english") ||
    t.includes("in english")
  ) {
    return "english";
  }

  return "";
}

function pickTonePreference(text = "") {
  const t = text.toLowerCase();

  if (t.includes("be direct") || t.includes("be blunt") || t.includes("straight to the point")) {
    return "direct";
  }

  if (t.includes("be gentle") || t.includes("be soft") || t.includes("be kind")) {
    return "gentle";
  }

  if (t.includes("practical advice") || t.includes("practical")) {
    return "supportive but practical";
  }

  if (t.includes("short answers") || t.includes("keep it short")) {
    return "brief";
  }

  return "";
}

function pickMood(text = "") {
  const t = text.toLowerCase();

  const moods = [
    "stressed",
    "anxious",
    "worried",
    "sad",
    "lonely",
    "frustrated",
    "tired",
    "angry",
    "confused",
    "happy",
    "excited"
  ];

  return moods.find((m) => t.includes(m)) || "";
}

function extractName(text = "") {
  const exactPatterns = [
    /call me\s+([a-zA-Z][a-zA-Z .'-]{1,40})/i,
    /my name is\s+([a-zA-Z][a-zA-Z .'-]{1,40})/i,
    /i'm\s+([A-Z][a-zA-Z .'-]{1,40})$/,
    /im\s+([A-Z][a-zA-Z .'-]{1,40})$/
  ];

  for (const pattern of exactPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return normalizeText(match[1]).replace(/[.,!?]+$/, "");
    }
  }

  return "";
}

function extractInterests(text = "") {
  const t = text.toLowerCase();
  const found = [];

  const interestMap = [
    "business",
    "ai",
    "technology",
    "science",
    "family",
    "relationships",
    "fitness",
    "basketball",
    "crypto",
    "history",
    "philosophy",
    "economics"
  ];

  for (const item of interestMap) {
    if (t.includes(item)) found.push(item);
  }

  return [...new Set(found)];
}

function inferLastTopic(userText = "") {
  const clean = normalizeText(userText);
  if (!clean) return "";
  return clean.length > 80 ? `${clean.slice(0, 80).trim()}…` : clean;
}

function extractOpenLoops(userText = "", assistantText = "") {
  const text = `${userText} ${assistantText}`.toLowerCase();
  const loops = [];

  if (text.includes("tomorrow") || text.includes("later")) {
    loops.push("pending follow-up");
  }

  if (text.includes("waiting for")) {
    loops.push("waiting for update");
  }

  if (text.includes("i'll update you")) {
    loops.push("user plans to update later");
  }

  return [...new Set(loops)].slice(0, 5);
}

function extractMemoryUpdates({
  currentMemory,
  userText,
  assistantText,
  selectedCharacter
}) {
  const updates = {
    profile: {},
    short_term: {}
  };

  const explicitName = extractName(userText);
  if (explicitName) {
    updates.profile.name = explicitName;
  } else if (!currentMemory?.profile?.name && userText.trim().length > 0) {
    // no-op
  }

  const lang = pickPreferredLanguage(userText);
  if (lang) {
    updates.profile.preferred_language = lang;
  }

  const tone = pickTonePreference(userText);
  if (tone) {
    updates.profile.tone_preference = tone;
  }

  const interestUpdates = extractInterests(userText);
  if (interestUpdates.length) {
    updates.profile.interests = [
      ...new Set([
        ...((currentMemory?.profile?.interests) || []),
        ...interestUpdates
      ])
    ];
  }

  const mood = pickMood(userText);
  if (mood) {
    updates.short_term.recent_mood = mood;
  }

  const lastTopic = inferLastTopic(userText);
  if (lastTopic) {
    updates.short_term.last_topic = lastTopic;
  }

  const openLoops = extractOpenLoops(userText, assistantText);
  if (openLoops.length) {
    updates.short_term.open_loops = [
      ...new Set([
        ...((currentMemory?.short_term?.open_loops) || []),
        ...openLoops
      ])
    ].slice(0, 5);
  }

  // helpful fallback: if no explicit tone preference yet, character choice can act as weak signal
  if (!updates.profile.tone_preference && !currentMemory?.profile?.tone_preference) {
    if (selectedCharacter === "ate-care") {
      updates.profile.tone_preference = "gentle and supportive";
    } else if (selectedCharacter === "kuya-wise") {
      updates.profile.tone_preference = "supportive but practical";
    } else if (selectedCharacter === "coach-real") {
      updates.profile.tone_preference = "direct";
    } else if (selectedCharacter === "tropa-chill") {
      updates.profile.tone_preference = "casual";
    }
  }

  return updates;
}

module.exports = {
  extractMemoryUpdates
};

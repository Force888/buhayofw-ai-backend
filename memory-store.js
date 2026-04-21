const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const USER_MEMORY_FILE = path.join(DATA_DIR, "user_memory.json");

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

ensureJsonFile(USER_MEMORY_FILE, {});

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

function nowIso() {
  return new Date().toISOString();
}

function getMemoryKey({ userId, deviceId }) {
  if (userId) return `user_${userId}`;
  return `guest_${deviceId || "no_device"}`;
}

function getDefaultMemory() {
  return {
    profile: {
      name: "",
      preferred_language: "",
      tone_preference: "",
      interests: []
    },
    short_term: {
      recent_mood: "",
      last_topic: "",
      open_loops: []
    },
    meta: {
      updated_at: ""
    }
  };
}

function loadMemory({ userId, deviceId }) {
  const store = readJson(USER_MEMORY_FILE, {});
  const key = getMemoryKey({ userId, deviceId });
  return store[key] || getDefaultMemory();
}

function saveMemory({ userId, deviceId }, nextMemory) {
  const store = readJson(USER_MEMORY_FILE, {});
  const key = getMemoryKey({ userId, deviceId });

  const finalMemory = {
    profile: {
      ...getDefaultMemory().profile,
      ...(nextMemory.profile || {})
    },
    short_term: {
      ...getDefaultMemory().short_term,
      ...(nextMemory.short_term || {})
    },
    meta: {
      updated_at: nowIso()
    }
  };

  store[key] = finalMemory;
  writeJson(USER_MEMORY_FILE, store);
  return finalMemory;
}

function mergeMemory(currentMemory, updates = {}) {
  const merged = {
    profile: {
      ...(currentMemory.profile || {}),
      ...(updates.profile || {})
    },
    short_term: {
      ...(currentMemory.short_term || {}),
      ...(updates.short_term || {})
    },
    meta: {
      updated_at: nowIso()
    }
  };

  if (!Array.isArray(merged.profile.interests)) {
    merged.profile.interests = [];
  }

  if (!Array.isArray(merged.short_term.open_loops)) {
    merged.short_term.open_loops = [];
  }

  merged.profile.interests = [...new Set(
    merged.profile.interests
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  )].slice(0, 12);

  merged.short_term.open_loops = [...new Set(
    merged.short_term.open_loops
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  )].slice(0, 5);

  return merged;
}

module.exports = {
  USER_MEMORY_FILE,
  getMemoryKey,
  getDefaultMemory,
  loadMemory,
  saveMemory,
  mergeMemory
};

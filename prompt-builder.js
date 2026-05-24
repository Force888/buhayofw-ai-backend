const { BASE_SYSTEM_PROMPT, getCharacterConfig } = require("./character-config");

function toDisplay(value, fallback = "unknown") {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function buildMemoryBlock(memory = {}) {
  const profile = memory.profile || {};
  const shortTerm = memory.short_term || {};

  const interests = Array.isArray(profile.interests) && profile.interests.length
    ? profile.interests.join(", ")
    : "none noted";

  const openLoops = Array.isArray(shortTerm.open_loops) && shortTerm.open_loops.length
    ? shortTerm.open_loops.join(", ")
    : "none";

  return `
Relevant user memory:
- Name: ${toDisplay(profile.name)}
- Preferred language: ${toDisplay(profile.preferred_language)}
- Tone preference: ${toDisplay(profile.tone_preference)}
- Interests: ${interests}
- Recent mood: ${toDisplay(shortTerm.recent_mood)}
- Last topic: ${toDisplay(shortTerm.last_topic)}
- Open loops: ${openLoops}
`;
}

function buildSystemInstruction({ selectedCharacter, memory }) {
  const character = getCharacterConfig(selectedCharacter);
  const memoryBlock = buildMemoryBlock(memory);

  return `
${BASE_SYSTEM_PROMPT}


CRITICAL RESPONSE STYLE:
- Keep replies concise by default, but do not sacrifice useful explanation.
- Prefer 1 to 4 short paragraphs or bullets, depending on the question.
- Prioritize clarity, mechanisms, concepts, tradeoffs, and first principles.
- Remove fluff, filler empathy, motivational language, fake profundity, and vague life-coach statements.
- Do not sound like an AI influencer, corporate assistant, therapist manual, or motivational speaker.
- Do not over-explain.
- Do not end with a question unless it genuinely helps.


${character.prompt}

${memoryBlock}
`.trim();
}

function normalizeHistory(history, latestQuestion) {
  let safeHistory = Array.isArray(history) ? history : [];

  safeHistory = safeHistory
    .slice(-6)
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  const last = safeHistory[safeHistory.length - 1];
  const shouldAppendQuestion =
    !(last && last.role === "user" && last.content === latestQuestion);

  return {
    safeHistory,
    shouldAppendQuestion
  };
}

function buildInputMessages({
  selectedCharacter,
  memory,
  history,
  trimmedQuestion
}) {
  const instructions = buildSystemInstruction({
    selectedCharacter,
    memory
  });

  const { safeHistory, shouldAppendQuestion } = normalizeHistory(history, trimmedQuestion);

  const inputMessages = [
    {
      role: "system",
      content: instructions
    },
    ...safeHistory,
    ...(shouldAppendQuestion ? [{ role: "user", content: trimmedQuestion }] : [])
  ];

  return {
    inputMessages,
    safeHistory,
    instructions
  };
}

module.exports = {
  buildMemoryBlock,
  buildSystemInstruction,
  normalizeHistory,
  buildInputMessages
};

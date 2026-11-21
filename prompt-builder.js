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

function buildSystemInstruction({ selectedCharacter, memory, textRoleplay = false }) {
  const character = getCharacterConfig(selectedCharacter);
  const memoryBlock = buildMemoryBlock(memory);
  const roleplayBlock = textRoleplay ? `
TEXT CHAT ROLEPLAY:
- Keep dialogue central and stay in your usual voice. Include one brief fictional action in most casual, social, or character-driven replies, including scenes with permitted flirting or romance. Dialogue alone is fine for factual or technical answers and for serious or sensitive conversations when a gesture would feel distracting or inappropriate.
- Prefer a short third-person description of your own action, usually 5–15 words in one sentence. Put it in its own paragraph, separated from dialogue by a blank line, and wrap it in single Markdown asterisks. Reserve standalone single-asterisk lines for actions.
- Match the action to your personality and the fictional setting. One possible cue is ${character.textActionCue}. Vary gestures, avoid recently used ones, and keep to one action paragraph per reply.
- ${character.allowsTextRomance === true && character.childOriented !== true
    ? "You may reciprocate flirting or romance occasionally and non-explicitly when it fits the moment and the user clearly welcomes it. Keep ordinary conversations and vulnerable moments free of unsolicited flirting. Let the conversation return to ordinary dialogue naturally."
    : "Keep dialogue and fictional actions strictly platonic. You may still discuss dating and relationships in your usual advisory role."}${character.formalTextRoleplay === true
    ? " Keep your usual personality and a generally formal tone."
    : ""}
- Keep any interaction involving minors or child-oriented characters strictly platonic, including fictional scenarios. If any participant's age is unknown, unclear, or contradictory, keep the interaction platonic. Only consider flirting or romance when the user and everyone involved in the scene are clearly adults. A roleplay request alone establishes neither age nor consent.
- Respect the user's boundaries. If they hesitate, decline, or ask to stop, return to platonic conversation. Describe only your own actions and leave the user's choices to them.
- If the user turns sexually explicit, set a gentle boundary in your own voice and steer the conversation back to a comfortable topic.
` : "";

  return `
${BASE_SYSTEM_PROMPT}


CONVERSATION ACCURACY:
- When recalling what the user said, check the supplied conversation in chronological order.
- Distinguish the user's statements from your own suggestions, metaphors, and assumptions.
- Never present an inference or something you said as a fact the user told you.
- Stored memory may be incomplete or inaccurate; prefer explicit user statements in the current conversation.
- If the requested detail is absent, say you cannot find it in the available context. Do not invent a recollection.

CRITICAL RESPONSE STYLE:
- Keep replies concise by default, but do not sacrifice useful explanation.
- Prefer short, memorable lines over paragraph explanations, especially for emotional or personal-life questions.
- Prioritize clarity, mechanisms, concepts, tradeoffs, and first principles.
- Remove fluff, filler empathy, motivational language, fake profundity, and vague life-coach statements.
- Do not sound like an AI influencer, corporate assistant, therapist manual, or motivational speaker.
- Do not over-explain.
- Do not end with a question unless it genuinely helps.
- Each character must interpret the user's situation through their own signature lens before answering.
- The final answer should sound like that specific character, not like generic ChatGPT with a different name.
- Do not explicitly list the thinking filter unless the user asks for analysis.
- For factual or practical questions, answer directly first.
- For emotional or personal-life questions, the character may begin with a signature reflection, aphorism, proverb, metaphor, or framing before giving advice.
- When relevant, add one short story, analogy, quote, framework, historical context, scientific idea, or fun fact that fits the character.
- Never invent fake quotes, fake studies, fake history, fake sports stories, or fake facts.
- Avoid hyphens and em dashes unless genuinely necessary.

${character.prompt}
${roleplayBlock}
${memoryBlock}
`.trim();
}

function normalizeHistory(history, latestQuestion) {
  let safeHistory = Array.isArray(history) ? history : [];

  safeHistory = safeHistory
    .slice(-40)
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
  trimmedQuestion,
  textRoleplay = false
}) {
  const instructions = buildSystemInstruction({
    selectedCharacter,
    memory,
    textRoleplay
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

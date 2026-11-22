const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const context = require("../user-context");
const { buildInputMessages } = require("../prompt-builder");

const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const timeFunctions = server.slice(server.indexOf("function getLocalDayPart("), server.indexOf("function sha256("));

function timeHelpers(now, previousMessages = []) {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  return vm.runInNewContext(timeFunctions + "\n({ buildTimeContext, isFirstGuestReply });", {
    ...context,
    Date: FixedDate,
    listConversationMessages: () => previousMessages
  });
}

function italianContext(preferences = {}) {
  return context.buildUserContext({
    device: { time_zone: "Europe/Rome", device_languages: ["en-GB"] },
    location: { current_country: "IT" },
    preferences
  });
}

test("the prompt prioritizes the latest substantive turn over Italian history and a saved default", () => {
  const history = [{ role: "user", content: "Com'è andata la giornata?" }];
  const question = "How do you usually spend your evenings?";
  const { inputMessages } = buildInputMessages({
    selectedCharacter: "general", memory: {}, history, trimmedQuestion: question
  });
  assert.equal(inputMessages.at(-2).content, history[0].content);
  assert.equal(inputMessages.at(-1).content, question);

  const userContext = italianContext({ preferred_language: "it" });
  const prompt = timeHelpers("2026-11-22T08:00:00Z").buildTimeContext({ userContext });
  assert.match(prompt, /"preferred_language":"Italian"/);
  assert.match(prompt, /reply entirely in the language of the current substantive message/);
  assert.match(prompt, /including clear switches/);
  assert.match(prompt, /Follow the latest applicable explicit language request/);
  assert.match(prompt, /For greeting-only or otherwise ambiguous turns, use the saved preference, then the recent conversation language/);
  assert.doesNotMatch(prompt, /a short local greeting/);
});

test("greeting-only messages use saved Korean or Italian ahead of English history", () => {
  const { buildTimeContext } = timeHelpers("2026-11-22T08:00:00Z");
  const history = [{ role: "user", content: "How do you usually spend your evenings?" }];
  for (const [tag, label] of [["ko", "Korean"], ["it", "Italian"]]) {
    const userContext = italianContext({ preferred_language: tag });
    for (const greeting of ["Hi", "Hello", "Hey"]) {
      const { inputMessages } = buildInputMessages({
        selectedCharacter: "general", memory: {}, history, trimmedQuestion: greeting
      });
      assert.equal(inputMessages.at(-2).content, history[0].content);
      assert.equal(inputMessages.at(-1).content, greeting);
      assert.match(buildTimeContext({ userContext }), new RegExp(
        '"preferred_language":"' + label + '".*' +
        'For greeting-only or otherwise ambiguous turns, use the saved preference, then the recent conversation language.',
        "s"
      ));
    }
  }
});

test("explicit language instructions take priority over a substantive turn or saved preference", () => {
  const request = "Please reply in Japanese for this conversation.";
  const question = "How do you usually spend your evenings?";
  const { inputMessages } = buildInputMessages({
    selectedCharacter: "general", memory: {}, history: [{ role: "user", content: request }],
    trimmedQuestion: question
  });
  assert.equal(inputMessages.at(-2).content, request);
  assert.equal(inputMessages.at(-1).content, question);
  const guidance = context.buildLanguageGuidance(italianContext({ preferred_language: "ko" }));
  assert.match(guidance, /^Follow the latest applicable explicit language request\. Otherwise, reply entirely in the language of the current substantive message/);
});

test("first guest greetings can use the country and Rome morning in winter and summer", () => {
  for (const now of ["2026-01-15T08:00:00Z", "2026-07-15T07:00:00Z"]) {
    const { buildTimeContext, isFirstGuestReply } = timeHelpers(now);
    const input = {
      isLoggedIn: false, session: { message_count: 0 },
      safeHistory: [{ role: "user", content: "Hi" }], trimmedQuestion: "Hi"
    };
    assert.equal(isFirstGuestReply(input), true);
    assert.equal(isFirstGuestReply({ ...input, session: { message_count: 2 } }), false);
    assert.equal(isFirstGuestReply({ ...input, session: { voice_session_count: 1 } }), false);
    assert.equal(isFirstGuestReply({ ...input, requestedConversationId: "existing" }), false);
    assert.equal(isFirstGuestReply({
      ...input, safeHistory: [{ role: "assistant", content: "Welcome!" }, ...input.safeHistory]
    }), false);
    const prompt = buildTimeContext({ userContext: italianContext(), opening: "first-reply" });
    assert.match(prompt, /"approximate_current_country":"Italy"/);
    assert.match(prompt, /Europe\/Rome.*9:00.*morning/);
    assert.match(prompt, /If no reply language is established, a short local greeting may precede English/);
    assert.match(prompt, /A brief opening greeting is optional/);
    assert.match(prompt, /Let local time inform the greeting when natural/);
  }
});

test("saved language controls a greeting and missing local time stays time-neutral", () => {
  const { buildTimeContext } = timeHelpers("2026-11-22T08:00:00Z");
  const preferred = buildTimeContext({ userContext: italianContext({ preferred_language: "de" }), opening: "greeting" });
  assert.match(preferred, /"preferred_language":"German"/);
  assert.match(preferred, /use the saved preference, then the recent conversation language/);
  assert.doesNotMatch(preferred, /a short local greeting/);

  const unknownTime = context.buildUserContext({ location: { current_country: "IT" } });
  const prompt = buildTimeContext({ userContext: unknownTime, opening: "greeting" });
  assert.match(prompt, /UTC reference only/);
  assert.doesNotMatch(prompt, /Let local time inform the greeting/);
  assert.doesNotMatch(prompt, /Local time of day:/);
});

test("an existing welcome suppresses the first-reply greeting instructions", () => {
  const { buildTimeContext } = timeHelpers("2026-11-22T08:00:00Z", [
    { role: "assistant", content: "Welcome!", created_at: "2026-11-22T07:59:59Z" }
  ]);
  const prompt = buildTimeContext({
    activeConversationId: "known", userContext: italianContext(), opening: "first-reply"
  });
  assert.doesNotMatch(prompt, /A brief opening greeting|a short local greeting|Let local time inform/);
});

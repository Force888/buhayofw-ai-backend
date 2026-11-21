const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const cleanChatAnswer = vm.runInNewContext(
  server.slice(server.indexOf("function cleanChatAnswer("), server.indexOf("function dialogueForMemory(")) +
  "\ncleanChatAnswer;"
);

test("chat cleanup preserves the not-equal command and multiline equation delimiters", () => {
  const equation = String.raw`\[
ax^2+bx+c=0,\qquad a\ne0
\]

\[
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
\]`;
  const cleaned = cleanChatAnswer("\n" + equation + "\n");
  assert.equal(cleaned, equation);
  const wire = JSON.stringify({ text: cleaned });
  assert.equal(JSON.parse(wire).text, equation);
  assert.equal(JSON.parse(JSON.stringify({ content: cleaned })).content, equation);
});

test("chat cleanup preserves roleplay, Markdown spacing, and literal code escapes", () => {
  const reply = "*She turns to the board.*\n\n**Example:**\n\n```js\n  const text = '\\n';\n```";
  assert.equal(cleanChatAnswer(reply), reply);
});

const Anthropic = require("@anthropic-ai/sdk");
const { hybridSearch } = require("../search/hybridSearch");
const { makeChunkId } = require("../index/keywordIndex");
const { recordClaudeUsage } = require("../../balance sheet/track");

const MODEL = "claude-haiku-4-5";
const TOP_N = 5;

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildPrompt(question, sources) {
  const context = sources
    .map((s) => `--- ${s.filePath}:${s.startLine}-${s.endLine} (${s.kind} ${s.name}) ---\n${s.code}`)
    .join("\n\n");

  return `Code excerpts retrieved from the repository, each labeled with its file path and line range:\n\n${context}\n\nQuestion: ${question}`;
}

async function answerQuestion(chunks, question) {
  const hits = await hybridSearch(chunks, question, TOP_N);
  const chunkById = new Map(chunks.map((c) => [makeChunkId(c), c]));
  const sources = hits.map((hit) => ({ ...chunkById.get(hit.id), score: hit.score }));

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system:
      "You answer questions about a codebase using only the provided code excerpts. " +
      "Cite the exact file and line range (e.g. `src/foo.js:12-20`) for every claim you make. " +
      "If the excerpts don't contain enough information to answer, say so instead of guessing.",
    messages: [{ role: "user", content: buildPrompt(question, sources) }],
  });

  if (response.usage) {
    recordClaudeUsage(response.usage.input_tokens, response.usage.output_tokens, MODEL);
  }

  const answer = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    answer,
    sources: sources.map((s) => ({
      filePath: s.filePath,
      startLine: s.startLine,
      endLine: s.endLine,
      name: s.name,
      kind: s.kind,
    })),
  };
}

module.exports = { answerQuestion };

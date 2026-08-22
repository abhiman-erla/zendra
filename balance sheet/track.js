const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "usage.json");

const OPENAI_DEFAULT_STARTING_BALANCE_USD = 5;
const ANTHROPIC_DEFAULT_STARTING_BALANCE_USD = 15;

// text-embedding-3-small pricing, per OpenAI's published rate.
const OPENAI_PRICE_PER_1M_TOKENS_USD = 0.02;

// claude-haiku-4-5 pricing, per Anthropic's published rate.
const ANTHROPIC_PRICE_PER_1M_INPUT_TOKENS_USD = 1.0;
const ANTHROPIC_PRICE_PER_1M_OUTPUT_TOKENS_USD = 5.0;

function emptyOpenAiLog() {
  return { startingBalanceUsd: OPENAI_DEFAULT_STARTING_BALANCE_USD, totalTokens: 0, totalCostUsd: 0, calls: [] };
}

function emptyAnthropicLog() {
  return {
    startingBalanceUsd: ANTHROPIC_DEFAULT_STARTING_BALANCE_USD,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    calls: [],
  };
}

function loadLog() {
  if (!fs.existsSync(LOG_FILE)) {
    return { openai: emptyOpenAiLog(), anthropic: emptyAnthropicLog() };
  }

  const raw = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));

  // Migrate the old flat (OpenAI-only) shape into the per-provider shape.
  if (!raw.openai && !raw.anthropic) {
    return {
      openai: {
        startingBalanceUsd: raw.startingBalanceUsd ?? OPENAI_DEFAULT_STARTING_BALANCE_USD,
        totalTokens: raw.totalTokens ?? 0,
        totalCostUsd: raw.totalCostUsd ?? 0,
        calls: raw.calls ?? [],
      },
      anthropic: emptyAnthropicLog(),
    };
  }

  return { openai: raw.openai ?? emptyOpenAiLog(), anthropic: raw.anthropic ?? emptyAnthropicLog() };
}

function saveLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function recordEmbeddingUsage(totalTokens) {
  const log = loadLog();
  const costUsd = (totalTokens / 1_000_000) * OPENAI_PRICE_PER_1M_TOKENS_USD;

  log.openai.totalTokens += totalTokens;
  log.openai.totalCostUsd += costUsd;
  log.openai.calls.push({ timestamp: new Date().toISOString(), tokens: totalTokens, costUsd });

  saveLog(log);
  return log;
}

function recordClaudeUsage(inputTokens, outputTokens, model) {
  const log = loadLog();
  const costUsd =
    (inputTokens / 1_000_000) * ANTHROPIC_PRICE_PER_1M_INPUT_TOKENS_USD +
    (outputTokens / 1_000_000) * ANTHROPIC_PRICE_PER_1M_OUTPUT_TOKENS_USD;

  log.anthropic.totalInputTokens += inputTokens;
  log.anthropic.totalOutputTokens += outputTokens;
  log.anthropic.totalCostUsd += costUsd;
  log.anthropic.calls.push({ timestamp: new Date().toISOString(), model, inputTokens, outputTokens, costUsd });

  saveLog(log);
  return log;
}

module.exports = {
  recordEmbeddingUsage,
  recordClaudeUsage,
  loadLog,
  LOG_FILE,
  OPENAI_PRICE_PER_1M_TOKENS_USD,
  ANTHROPIC_PRICE_PER_1M_INPUT_TOKENS_USD,
  ANTHROPIC_PRICE_PER_1M_OUTPUT_TOKENS_USD,
};

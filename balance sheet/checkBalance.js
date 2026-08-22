#!/usr/bin/env node
const { loadLog } = require("./track");

const log = loadLog();

const openaiRemaining = log.openai.startingBalanceUsd - log.openai.totalCostUsd;
const anthropicRemaining = log.anthropic.startingBalanceUsd - log.anthropic.totalCostUsd;

console.log("=== OpenAI (embeddings) — estimated ===\n");
console.log(`  Assumed starting balance: $${log.openai.startingBalanceUsd.toFixed(2)}`);
console.log(`  Total tokens embedded:    ${log.openai.totalTokens}`);
console.log(`  Estimated spend so far:   $${log.openai.totalCostUsd.toFixed(6)}`);
console.log(`  Estimated remaining:      $${openaiRemaining.toFixed(6)}`);
console.log(`  API calls logged:         ${log.openai.calls.length}`);

console.log("\n=== Anthropic (Claude answer generation) — estimated ===\n");
console.log(`  Assumed starting balance: $${log.anthropic.startingBalanceUsd.toFixed(2)}`);
console.log(`  Total input tokens:       ${log.anthropic.totalInputTokens}`);
console.log(`  Total output tokens:      ${log.anthropic.totalOutputTokens}`);
console.log(`  Estimated spend so far:   $${log.anthropic.totalCostUsd.toFixed(6)}`);
console.log(`  Estimated remaining:      $${anthropicRemaining.toFixed(6)}`);
console.log(`  API calls logged:         ${log.anthropic.calls.length}`);

console.log(
  "\nNote: both figures above are LOCAL ESTIMATES based only on API calls this tool has made " +
    "(OpenAI text-embedding-3-small at $0.02/1M tokens; Anthropic claude-haiku-4-5 at $1/$5 " +
    "per 1M input/output tokens). Neither provider exposes a real-time dollar balance to a " +
    "plain API key — check the authoritative numbers at:\n" +
    "  OpenAI:    https://platform.openai.com/settings/organization/billing/overview\n" +
    "  Anthropic: https://console.anthropic.com/settings/billing"
);

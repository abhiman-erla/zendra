#!/usr/bin/env node
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { walkRepo } = require("./ingest/walkRepo");
const { chunkFiles } = require("./ingest/astChunker");
const { buildKeywordIndex, searchKeyword } = require("./index/keywordIndex");
const { upsertChunks, searchVector } = require("./index/vectorIndex");

const INDEX_DIR = path.resolve(__dirname, "..", ".index");
const CHUNKS_FILE = path.join(INDEX_DIR, "chunks.json");

async function ingest(repoPath) {
  const absPath = path.resolve(repoPath);
  const files = walkRepo(absPath);
  const chunks = chunkFiles(files);

  console.log(`Found ${files.length} source file(s), extracted ${chunks.length} chunk(s):\n`);
  for (const chunk of chunks) {
    const relPath = path.relative(absPath, chunk.filePath);
    console.log(`[${chunk.kind}] ${chunk.name}  (${relPath}:${chunk.startLine}-${chunk.endLine})`);
  }

  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(CHUNKS_FILE, JSON.stringify({ repoPath: absPath, chunks }, null, 2));
  console.log(`\nSaved ${chunks.length} chunk(s) to ${path.relative(process.cwd(), CHUNKS_FILE)}`);

  if (!process.env.OPENAI_API_KEY) {
    console.log("\nOPENAI_API_KEY not set — skipping embeddings/Qdrant upsert (keyword search still works).");
  } else {
    try {
      console.log("\nEmbedding chunks and upserting into Qdrant...");
      await upsertChunks(chunks);
      console.log(`Upserted ${chunks.length} chunk(s) into Qdrant.`);
    } catch (err) {
      console.warn(`\nSkipped embeddings/Qdrant upsert: ${err.message}`);
    }
  }

  return chunks;
}

function loadChunks() {
  if (!fs.existsSync(CHUNKS_FILE)) {
    console.error(`No index found at ${CHUNKS_FILE}. Run "node src/cli.js ingest <repoPath>" first.`);
    process.exit(1);
  }
  const { repoPath, chunks } = JSON.parse(fs.readFileSync(CHUNKS_FILE, "utf8"));
  return { repoPath, chunks };
}

function search(query) {
  const { repoPath, chunks } = loadChunks();
  const miniSearch = buildKeywordIndex(chunks);
  const results = searchKeyword(miniSearch, query, 5);

  if (results.length === 0) {
    console.log("No matches found.");
    return results;
  }

  console.log(`Top ${results.length} match(es) for "${query}":\n`);
  for (const result of results) {
    const relPath = path.relative(repoPath, result.filePath);
    console.log(
      `[${result.kind}] ${result.name}  (${relPath}:${result.startLine}-${result.endLine})  score=${result.score.toFixed(2)}`
    );
  }

  return results;
}

async function vsearch(query) {
  const { repoPath } = loadChunks();
  const results = await searchVector(query, 5);

  if (results.length === 0) {
    console.log("No matches found.");
    return results;
  }

  console.log(`Top ${results.length} semantic match(es) for "${query}":\n`);
  for (const result of results) {
    const relPath = path.relative(repoPath, result.filePath);
    console.log(
      `[${result.kind}] ${result.name}  (${relPath}:${result.startLine}-${result.endLine})  score=${result.score.toFixed(3)}`
    );
  }

  return results;
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "ingest": {
      const repoPath = args[0];
      if (!repoPath) {
        console.error("Usage: node src/cli.js ingest <repoPath>");
        process.exit(1);
      }
      await ingest(repoPath);
      break;
    }
    case "search": {
      const query = args.join(" ");
      if (!query) {
        console.error('Usage: node src/cli.js search "<query>"');
        process.exit(1);
      }
      search(query);
      break;
    }
    case "vsearch": {
      const query = args.join(" ");
      if (!query) {
        console.error('Usage: node src/cli.js vsearch "<query>"');
        process.exit(1);
      }
      await vsearch(query);
      break;
    }
    default:
      console.error(
        `Unknown command: ${command || "(none)"}\nUsage:\n  node src/cli.js ingest <repoPath>\n  node src/cli.js search "<query>"\n  node src/cli.js vsearch "<query>"`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

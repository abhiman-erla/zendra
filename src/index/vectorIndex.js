const crypto = require("crypto");
const OpenAI = require("openai");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { makeChunkId } = require("./keywordIndex");
const { recordEmbeddingUsage } = require("../../balance sheet/track");

const COLLECTION_NAME = "codebase_chunks";
const EMBEDDING_MODEL = "text-embedding-3-small";
const VECTOR_SIZE = 1536;
const EMBED_BATCH_SIZE = 100;

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env (see .env.example).");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getQdrantClient() {
  return new QdrantClient({ url: process.env.QDRANT_URL || "http://localhost:6333" });
}

// Qdrant point IDs must be an unsigned int or a UUID. We derive a deterministic
// UUID from the chunk's identity so re-ingesting the same chunk upserts in place
// instead of creating a duplicate point.
function chunkPointId(chunk) {
  const hash = crypto.createHash("md5").update(makeChunkId(chunk)).digest("hex");
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

function chunkEmbeddingText(chunk) {
  return `${chunk.kind} ${chunk.name}\n${chunk.code}`;
}

async function embedTexts(openai, texts) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    vectors.push(...response.data.map((d) => d.embedding));
    if (response.usage?.total_tokens) {
      recordEmbeddingUsage(response.usage.total_tokens);
    }
  }
  return vectors;
}

// Recreates the collection from scratch on every ingest. `ingest` already
// rebuilds .index/chunks.json wholesale each run (not incremental), so doing
// the same here keeps the two indexes consistent — otherwise a chunk whose
// line numbers shift (any edit above it) gets a new point ID and the old,
// now-stale point lingers in Qdrant forever instead of being replaced.
async function ensureCollection(client) {
  const { collections } = await client.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION_NAME);
  if (exists) {
    await client.deleteCollection(COLLECTION_NAME);
  }
  await client.createCollection(COLLECTION_NAME, {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });
}

async function upsertChunks(chunks) {
  if (chunks.length === 0) return;

  const openai = getOpenAiClient();
  const client = getQdrantClient();
  await ensureCollection(client);

  const vectors = await embedTexts(openai, chunks.map(chunkEmbeddingText));

  const points = chunks.map((chunk, i) => ({
    id: chunkPointId(chunk),
    vector: vectors[i],
    payload: {
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      name: chunk.name,
      kind: chunk.kind,
      code: chunk.code,
    },
  }));

  await client.upsert(COLLECTION_NAME, { points });
}

async function searchVector(query, limit = 5) {
  const openai = getOpenAiClient();
  const client = getQdrantClient();

  const [vector] = await embedTexts(openai, [query]);
  const { points } = await client.query(COLLECTION_NAME, { query: vector, limit, with_payload: true });

  return points.map((r) => ({ ...r.payload, score: r.score }));
}

module.exports = { upsertChunks, searchVector, chunkPointId, COLLECTION_NAME };

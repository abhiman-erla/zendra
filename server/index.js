require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { walkRepo } = require("../src/ingest/walkRepo");
const { chunkFiles } = require("../src/ingest/astChunker");
const { upsertChunks } = require("../src/index/vectorIndex");
const { answerQuestion } = require("../src/generate/answerQuestion");

const INDEX_DIR = path.resolve(__dirname, "..", ".index");
const CHUNKS_FILE = path.join(INDEX_DIR, "chunks.json");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function loadChunks() {
  if (!fs.existsSync(CHUNKS_FILE)) {
    const err = new Error(`No index found. Run POST /ingest (or "node src/cli.js ingest <repoPath>") first.`);
    err.status = 400;
    throw err;
  }
  return JSON.parse(fs.readFileSync(CHUNKS_FILE, "utf8"));
}

app.post("/ingest", async (req, res) => {
  try {
    const { repoPath } = req.body;
    if (!repoPath) return res.status(400).json({ error: "repoPath is required" });

    const absPath = path.resolve(repoPath);
    const files = walkRepo(absPath);
    const chunks = await chunkFiles(files);

    fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify({ repoPath: absPath, chunks }, null, 2));

    if (process.env.OPENAI_API_KEY) {
      await upsertChunks(chunks);
    }

    res.json({ chunkCount: chunks.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "question is required" });

    const { repoPath, chunks } = loadChunks();
    const { answer, sources } = await answerQuestion(chunks, question);

    const relSources = sources.map((s) => ({ ...s, filePath: path.relative(repoPath, s.filePath) }));
    res.json({ answer, sources: relSources });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Zendra API listening on http://localhost:${PORT}`);
});

module.exports = app;

# Codebase Q&A Assistant — Build Spec

## What this project is

A tool that lets you point at a code repository and ask natural-language questions about it — "where is auth handled," "what does `processPayment` do," "which files import `UserService`" — and get back an answer **with citations** (exact file + line numbers it pulled from).

This is a Retrieval-Augmented Generation (RAG) system, purpose-built for code instead of plain text. The two things that make it different from a generic "chat with your docs" RAG app:

1. **AST-aware chunking** — code is split into chunks along real boundaries (functions, classes, methods) instead of arbitrary character counts, so no chunk is ever a fragment cut mid-function.
2. **Hybrid search** — combines keyword search (catches exact function/variable names) with semantic/embedding search (catches conceptual questions), merged via Reciprocal Rank Fusion.

---

## Status (as of 2026-08-21)

| Phase | Status | Notes |
|---|---|---|
| 1 — Ingest + AST chunking | ✅ Done | `walkRepo.js`, `astChunker.js` implemented and working |
| 2 — Keyword search | ✅ Done | `keywordIndex.js` + `ingest`/`search` CLI commands |
| 3 — Embeddings + vector search | ✅ Done (partial deviation) | `vectorIndex.js` + `vsearch` CLI command, using **OpenAI** embeddings (`text-embedding-3-small`) rather than Voyage AI; env var is `OPENAI_API_KEY`, not `EMBEDDINGS_API_KEY` as spec'd below |
| 4 — Hybrid search (RRF merge) | ⬜ Not started | No `src/search/hybridSearch.js` yet — `search` and `vsearch` are still separate CLI commands, not merged |
| 5 — Answer generation with citations | ⬜ Not started | No `src/generate/answerQuestion.js`, no Claude API call, no `ask` CLI command |
| 6 — Express API | ⬜ Not started | No `server/` directory, no Express dependency yet |
| 7 — Web UI | ⬜ Not started | Optional, last |

**Other gaps not tied to a specific phase:**
- No automated test suite runs yet (only `test/fixtures/sample.js` exists as chunker input, no test runner/assertions or `test` script in `package.json`).
- No `.env` committed (correct — only `.env.example` is), but real keys are needed locally to exercise Phase 3.

**Next up:** Phase 4 (hybrid search / RRF merge), then Phase 5 (answer generation).

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Runtime | Node.js | Requested stack |
| Code parsing | `@babel/parser` + `@babel/traverse` | Parses JS/TS into an AST we can walk |
| Keyword search | `minisearch` | Pure JS, no external server, good exact-match search |
| Embeddings | Voyage AI or OpenAI embeddings API | Turns code chunks + queries into vectors for semantic search |
| Vector storage + search | Qdrant (free tier / local Docker) | Stores embeddings, does similarity search, supports metadata filters |
| LLM (answer generation) | Claude API (`claude-sonnet-4-6` or similar) | Generates the final answer from retrieved chunks |
| Backend | Express.js | Simple REST API: ingest repo, ask question |
| CLI (first pass) | Node script | Fastest way to test the pipeline before building a UI |
| Web UI (later) | Simple React/Vite frontend | Only build this after the pipeline works via CLI |

---

## Architecture / pipeline

```
[Repo folder]
     │
     ▼
[1. Ingest] ─── walk files, skip node_modules/.git/etc, read source
     │
     ▼
[2. AST Chunk] ─── parse each file, extract functions/classes/methods as chunks
     │              each chunk keeps: code, name, kind, filePath, startLine, endLine
     ▼
[3. Index]
     ├── Keyword index (MiniSearch) — built from chunk text + names
     └── Embeddings (Qdrant) — each chunk embedded once, stored with metadata
     │
     ▼
[4. Query] ─── user asks a question
     │
     ├── Keyword search  ──┐
     └── Semantic search  ──┼── [5. Hybrid merge — Reciprocal Rank Fusion]
     │                     │
     ▼                     ▼
[6. Generate] ─── top N merged chunks + question → Claude API → answer
     │
     ▼
[7. Respond] ─── answer text + citations (file:line for each chunk used)
```

---

## Project structure to build

```
codebase-qa/
├── .env                      # API keys (gitignored)
├── .env.example               # template, committed
├── .gitignore
├── package.json
├── src/
│   ├── ingest/
│   │   ├── walkRepo.js        # find all source files in a repo folder      ✅ done
│   │   └── astChunker.js      # parse + chunk each file (function/class/method level)  ✅ done
│   ├── index/
│   │   ├── keywordIndex.js    # MiniSearch setup, add/search                ✅ done
│   │   └── vectorIndex.js     # Qdrant client, embed + store + search       ✅ done
│   ├── search/
│   │   └── hybridSearch.js    # keyword + vector search, RRF merge          ⬜ not started
│   ├── generate/
│   │   └── answerQuestion.js  # build prompt from chunks, call Claude, return answer + citations  ⬜ not started
│   └── cli.js                 # CLI entrypoint: `node src/cli.js ingest <repo>` / `ask "<question>"`  ⬜ ask command not implemented; ingest/search/vsearch are
├── server/
│   └── index.js                # Express API wrapping the same pipeline (build after CLI works)  ⬜ not started
└── README.md
```

---

## Build order (do NOT skip ahead — each phase should fully work before starting the next)

### Phase 1 — Ingest + AST chunking (no APIs yet, no external services) ✅ Done

**Goal:** given a local repo path, produce a list of chunk objects and print them.

- `src/ingest/walkRepo.js`: recursively list all `.js`/`.ts`/`.jsx`/`.tsx` files in a given folder, skipping `node_modules`, `.git`, `dist`, `build`.
- `src/ingest/astChunker.js`: for each file, parse with `@babel/parser` (`sourceType: "module"`, plugins: `["jsx", "typescript"]`), traverse the AST, and extract chunks for:
  - top-level `FunctionDeclaration`
  - top-level `ClassDeclaration` — then descend into `ClassMethod` for each method (don't chunk the whole class as one blob — see reference example below)
  - top-level `ArrowFunctionExpression` assigned to a `const` (common pattern: `const foo = () => {}`)
  - Each chunk object shape:
    ```js
    { kind, name, filePath, startLine, endLine, code }
    ```
- **Test it:** run against a small sample file first (2-3 functions + 1 class), confirm no chunk is cut mid-function, confirm class methods are separate chunks.
- **Reference implementation to build from:** a working version of exactly this (naive vs AST chunking comparison, plus per-method chunking) was already built and tested in this conversation — ask Claude Code to reproduce that approach: parse with Babel, `traverse()` with visitors for `FunctionDeclaration` and `ClassMethod`, extract `path.node.loc.start.line` / `end.line` and `sourceCode.slice(path.node.start, path.node.end)` for the code text.

### Phase 2 — Keyword search only (still no external APIs) ✅ Done

**Goal:** be able to run a query and get ranked chunk results back, using only MiniSearch.

- `src/index/keywordIndex.js`: build a MiniSearch index over all chunks (fields: `name`, `code`; store `filePath`, `startLine`, `endLine`, `kind`).
- CLI command: `node src/cli.js ingest ./some-repo` — chunks + builds keyword index (can hold in memory / dump to a local JSON file for now, no DB yet).
- CLI command: `node src/cli.js search "some query"` — prints top 5 keyword matches with file:line.
- **Test it:** confirm exact-name queries (e.g. a real function name from the repo) return that function at the top.

### Phase 3 — Embeddings + vector search ✅ Done (using OpenAI, not Voyage)

**Goal:** add semantic search alongside keyword search.

- Sign up for an embeddings API (Voyage AI has a free tier and is good for code; OpenAI's `text-embedding-3-small` also works). Store the API key in `.env`.
- Set up Qdrant — easiest path is `docker run -p 6333:6333 qdrant/qdrant` locally, or use Qdrant Cloud's free tier if you don't want Docker running locally.
- `src/index/vectorIndex.js`:
  - function to embed a batch of chunk texts (call the embeddings API)
  - function to upsert chunks (vector + metadata payload: filePath, startLine, endLine, name, kind) into a Qdrant collection
  - function to embed a query and do a similarity search against that collection
- Update the ingest CLI command to also embed + store every chunk in Qdrant after keyword-indexing it.
- **Test it:** run a conceptual/paraphrased query (not an exact function name) and confirm it finds semantically related code even without exact word matches.

### Phase 4 — Hybrid search (merge keyword + vector results) ⬜ Not started

**Goal:** one search function that combines both result lists.

- `src/search/hybridSearch.js`: implement Reciprocal Rank Fusion —
  ```js
  score += 1 / (k + rank + 1)   // k = 60 is a standard default
  ```
  merge results from keyword search and vector search by this scoring, dedupe by chunk id, return top N.
- **Test it:** re-run the same two test queries from Phase 2 and Phase 3 through hybrid search, confirm results make sense for both exact-name and conceptual queries.

### Phase 5 — Answer generation with citations ⬜ Not started

**Goal:** given a question, return a natural-language answer plus the exact sources used.

- `src/generate/answerQuestion.js`:
  - run hybrid search, take top ~5 chunks
  - build a prompt: system instruction ("answer using only the provided code, cite file:line for any claim") + the chunks (formatted with their file/line headers) + the user's question
  - call the Claude API, return `{ answer, sources: [{filePath, startLine, endLine, name}] }`
- CLI command: `node src/cli.js ask "where is authentication handled?"` — prints answer + source list.
- **Test it:** ask several realistic questions about the ingested repo, verify citations point to the actually-relevant code, not hallucinated locations.

### Phase 6 — Wrap it in an Express API ⬜ Not started

**Goal:** expose the same pipeline over HTTP so a UI (or anyone) can call it.

- `POST /ingest` — body: `{ repoPath }` — runs ingest pipeline
- `POST /ask` — body: `{ question }` — returns `{ answer, sources }`
- Keep this thin — it should just call the same functions from `src/`, no new logic here.

### Phase 7 (optional, do last) — Minimal web UI ⬜ Not started

- A single page: text input for a question, submit button, answer + clickable source citations displayed below.
- Not required for the project to be "done" — the CLI + API alone are a complete, demoable project.

---

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=
EMBEDDINGS_API_KEY=
QDRANT_URL=http://localhost:6333
```

> Note: the committed `.env.example` currently uses `OPENAI_API_KEY` in place of `EMBEDDINGS_API_KEY` (Phase 3 was built against OpenAI embeddings, not Voyage AI). `ANTHROPIC_API_KEY` is present but unused until Phase 5.

---

## Definition of done for each phase

Do not move to the next phase until:
- The current phase runs via CLI without errors on a real repo (use this project's own folder as a test repo once it exists — that's a nice demo: "ask the tool questions about its own code").
- Output has been manually eyeballed for correctness (chunks aren't cut off, search results make sense, citations point to real code).

## What to explicitly avoid

- Don't build the web UI before the CLI pipeline fully works end to end — UI work is wasted if retrieval quality is bad.
- Don't skip testing hybrid search against BOTH an exact-name query and a paraphrased query — this is the whole point of the hybrid approach and easy to accidentally not verify.
- Don't chunk by fixed character count anywhere — if Claude Code suggests this as a shortcut, reject it; the entire value of this project is structure-aware chunking.

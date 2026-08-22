# Codebase Q&A Assistant — Build Spec

## What this project is

A tool that lets you point at a code repository and ask natural-language questions about it — "where is auth handled," "what does `processPayment` do," "which files import `UserService`" — and get back an answer **with citations** (exact file + line numbers it pulled from).

This is a Retrieval-Augmented Generation (RAG) system, purpose-built for code instead of plain text. The two things that make it different from a generic "chat with your docs" RAG app:

1. **AST-aware chunking** — code is split into chunks along real boundaries (functions, classes, methods) instead of arbitrary character counts, so no chunk is ever a fragment cut mid-function.
2. **Hybrid search** — combines keyword search (catches exact function/variable names) with semantic/embedding search (catches conceptual questions), merged via Reciprocal Rank Fusion.

---

## Status (as of 2026-08-22)

| Phase | Status | Notes |
|---|---|---|
| 1 — Ingest + AST chunking | ✅ Done | `walkRepo.js`, `astChunker.js` implemented and working |
| 2 — Keyword search | ✅ Done | `keywordIndex.js` + `ingest`/`search` CLI commands |
| 3 — Embeddings + vector search | ✅ Done & verified end-to-end | `vectorIndex.js` + `vsearch` CLI command, using **OpenAI** embeddings (`text-embedding-3-small`) rather than Voyage AI; env var is `OPENAI_API_KEY`, not `EMBEDDINGS_API_KEY` as spec'd below. Ran live against a real `OPENAI_API_KEY` + local Qdrant (Docker): `ingest .` embedded and upserted 26 chunks, `vsearch` returned correct results for a paraphrased query with no keyword overlap (found `walkRepo` for "how does the tool find source files in a folder"). Fixed a real bug found during this run: `client.search()` doesn't exist in the installed `@qdrant/js-client-rest@1.19` — replaced with `client.query()`, which returns `{ points: [...] }` instead of a bare array |
| 4 — Hybrid search (RRF merge) | ✅ Done & verified | `src/search/hybridSearch.js` implements RRF (`k=60`), merges keyword + vector candidate lists (4x limit each), dedupes by chunk id; new `hsearch` CLI command |
| 5 — Answer generation with citations | ✅ Done & verified | `src/generate/answerQuestion.js` + `ask` CLI command implemented (`@anthropic-ai/sdk`). Uses `claude-haiku-4-5` (chosen over the spec'd Sonnet for lower cost on this hobby project — user's explicit call). Runs `hybridSearch`, builds a prompt from the top 5 chunks with file:line headers, asks Claude to answer using only those excerpts and cite file:line for every claim. **Verified 2026-08-22:** ran `node src/cli.js ask "how does this tool find source files in a repo?"` against this repo with a real `ANTHROPIC_API_KEY` — answer correctly named `walkRepo` (`src/ingest/walkRepo.js:7-26`) with accurate implementation details, not hallucinated |
| 6 — Express API | ✅ Done & verified | `server/index.js` — `POST /ingest` and `POST /ask` wrapping the same `src/` pipeline functions, no new logic. Verified live: `curl -X POST /ask` returned a correctly-cited JSON answer |
| 7 — Web UI | ✅ Done & verified | `server/public/index.html` — single page, question input, answer + source citations rendered below. Serves already-ingested data (`.index/chunks.json` + Qdrant) rather than accepting file/repo uploads — deliberate scope choice, user confirmed. Verified: opened in a real browser via `npm run server`, page loads and renders |

**Other gaps not tied to a specific phase:**
- No automated test suite runs yet (only `test/fixtures/sample.js` exists as chunker input, no test runner/assertions or `test` script in `package.json`).
- `.env` has working `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (gitignored, not committed). Local Qdrant is running via `docker run -d -p 6333:6333 --name zendra-qdrant qdrant/qdrant`.
- Added `balance sheet/` (gitignored `usage.json`, tracked `track.js` + `checkBalance.js`): every OpenAI embedding call and every Claude `ask` call logs its token count, and `node "balance sheet/checkBalance.js"` prints estimated cumulative spend for **both** providers against assumed starting balances ($5 OpenAI, $15 Anthropic — both user-specified). This is a **local estimate only**, not a live account balance — neither provider exposes real-time dollar balance to a plain API key (confirmed by testing OpenAI's billing endpoints directly and getting 403s). Check the authoritative numbers at OpenAI's and Anthropic's own billing dashboards (linked in the script's output).
- **Bug fixed 2026-08-22:** `vsearch`/`hsearch` were returning stale duplicate chunks — Qdrant point IDs are derived from `filePath:startLine-endLine:name`, so any code edit that shifted a chunk's line numbers left the old, now-inaccurate point sitting in Qdrant forever instead of being replaced (found via `vsearch` returning `searchVector` at two different, one outdated, line ranges). Fixed by having `ensureCollection` in `vectorIndex.js` delete and recreate the Qdrant collection on every `ingest`, matching how `.index/chunks.json` is already fully rebuilt (not incrementally updated) on every run. Verified: re-ran the same query, only the current, correct line range comes back.

**Next up:** all 7 phases are done. Optional polish: automated tests, incremental re-ingest (only re-embed changed chunks instead of a full rebuild), auth/rate-limiting on the Express API before deploying it anywhere public.

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
│   │   └── hybridSearch.js    # keyword + vector search, RRF merge          ✅ done
│   ├── generate/
│   │   └── answerQuestion.js  # build prompt from chunks, call Claude, return answer + citations  ✅ done
│   └── cli.js                 # CLI entrypoint: ingest/search/vsearch/hsearch/ask all implemented
├── server/
│   ├── index.js                # Express API wrapping the same pipeline  ✅ done
│   └── public/
│       └── index.html          # single-page UI: ask a question, see answer + citations  ✅ done
├── balance sheet/
│   ├── track.js                # logs OpenAI + Anthropic token usage to usage.json (gitignored)
│   └── checkBalance.js         # prints estimated cumulative spend for both providers vs. assumed starting balances
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

### Phase 3 — Embeddings + vector search ✅ Done & verified (using OpenAI, not Voyage)

**Goal:** add semantic search alongside keyword search.

- Sign up for an embeddings API (Voyage AI has a free tier and is good for code; OpenAI's `text-embedding-3-small` also works). Store the API key in `.env`.
- Set up Qdrant — easiest path is `docker run -p 6333:6333 qdrant/qdrant` locally, or use Qdrant Cloud's free tier if you don't want Docker running locally.
- `src/index/vectorIndex.js`:
  - function to embed a batch of chunk texts (call the embeddings API)
  - function to upsert chunks (vector + metadata payload: filePath, startLine, endLine, name, kind) into a Qdrant collection
  - function to embed a query and do a similarity search against that collection
- Update the ingest CLI command to also embed + store every chunk in Qdrant after keyword-indexing it.
- **Test it:** run a conceptual/paraphrased query (not an exact function name) and confirm it finds semantically related code even without exact word matches.
- **Verified 2026-08-21:** ran live with a real `OPENAI_API_KEY` and local Qdrant (Docker container `zendra-qdrant`). `node src/cli.js ingest .` embedded 26 chunks from this repo and upserted them into Qdrant. `node src/cli.js vsearch "how does the tool find source files in a folder"` (no keyword overlap with the code) correctly returned `walkRepo` as the top match. Keyword search (`search "walkRepo"`) still works as expected.
- **Bug fixed during verification:** `searchVector` in `vectorIndex.js` called `client.search(...)`, which doesn't exist on the installed `@qdrant/js-client-rest@1.19` client — that method was replaced with `client.query(collection, { query: vector, limit, with_payload: true })`, which returns `{ points: [...] }` instead of a bare array. Updated the code to match.

### Phase 4 — Hybrid search (merge keyword + vector results) ✅ Done & verified

**Goal:** one search function that combines both result lists.

- `src/search/hybridSearch.js`: implements Reciprocal Rank Fusion —
  ```js
  score += 1 / (k + rank + 1)   // k = 60
  ```
  Pulls `limit * 4` candidates from each of keyword search and vector search, merges by RRF score, dedupes by chunk id (`makeChunkId`), returns top N.
- New CLI command: `node src/cli.js hsearch "<query>"` — prints top 5 hybrid matches with file:line and RRF score.
- **Verified 2026-08-21:** re-ran both test queries from Phase 2/3 through `hsearch` — `"walkRepo"` (exact name) and `"how does the tool find source files in a folder"` (paraphrased, no keyword overlap) — both correctly return `walkRepo` as the top result.

### Phase 5 — Answer generation with citations ✅ Done & verified

**Goal:** given a question, return a natural-language answer plus the exact sources used.

- `src/generate/answerQuestion.js`:
  - run hybrid search, take top 5 chunks
  - build a prompt: system instruction ("answer using only the provided code, cite file:line for any claim") + the chunks (formatted with their file/line headers) + the user's question
  - call the Claude API (`claude-haiku-4-5`, `@anthropic-ai/sdk`), return `{ answer, sources: [{filePath, startLine, endLine, name, kind}] }`
- CLI command: `node src/cli.js ask "where is authentication handled?"` — prints answer + source list.
- **Model choice:** the spec suggested `claude-sonnet-4-6`; built against `claude-haiku-4-5` instead — cheapest current tier, explicitly chosen over pricier models for this project. Swap `MODEL` in `answerQuestion.js` to `claude-opus-5` or another model if answer quality isn't good enough.
- **Test it:** ask several realistic questions about the ingested repo, verify citations point to the actually-relevant code, not hallucinated locations.
- **Verified 2026-08-22:** `node src/cli.js ask "how does this tool find source files in a repo?"` against this repo — answer correctly identified `walkRepo` (`src/ingest/walkRepo.js:7-26`), described its actual implementation (recursive walk, `SKIP_DIRS`, `SOURCE_EXTENSIONS` filter), and the top source citation matched. No hallucinated file/line.

### Phase 6 — Wrap it in an Express API ✅ Done & verified

**Goal:** expose the same pipeline over HTTP so a UI (or anyone) can call it.

- `POST /ingest` — body: `{ repoPath }` — runs ingest pipeline
- `POST /ask` — body: `{ question }` — returns `{ answer, sources }`
- Keep this thin — it should just call the same functions from `src/`, no new logic here.
- `server/index.js` — thin wrapper as specified: reuses `walkRepo`, `chunkFiles`, `upsertChunks`, `answerQuestion` directly, no duplicated logic. Serves the Phase 7 static UI from `server/public/`.
- **Verified 2026-08-22:** started with `npm run server`, hit both routes with `curl` — `POST /ask` on this repo returned a correctly-cited JSON answer identical in quality to the CLI's `ask` command.

### Phase 7 — Minimal web UI ✅ Done & verified

- A single page (`server/public/index.html`): text input for a question, submit button, answer + source citations displayed below (as styled chips — kept as plain text/chips rather than clickable links, since there's no meaningful local target to link to without a file-serving layer).
- **Scope decision (user-confirmed):** the site queries whatever repo has already been `ingest`-ed locally (`.index/chunks.json` + Qdrant) — it does not accept a document/repo upload through the browser. Simpler, and matches how the CLI already works.
- **Verified 2026-08-22:** opened `http://localhost:3000` in a real browser after `npm run server`; page renders, question box works end-to-end against the live API.
- **Polish pass (user-requested):** restyled with a gold-on-black theme (serif gradient wordmark, gold-glow input focus, gradient gold button, gold-accented answer card and source chips). Also fixed answers rendering raw markdown (`**bold**`, `` `code` ``) as literal asterisks/backticks — `renderAnswer()` now escapes the text first, then converts just those two patterns to styled `<strong>`/`<code>` so nothing else in the answer can inject HTML.

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

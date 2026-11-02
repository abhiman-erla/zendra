# Zendra

[![CI](https://github.com/abhiman-erla/zendra/actions/workflows/ci.yml/badge.svg)](https://github.com/abhiman-erla/zendra/actions/workflows/ci.yml)

Zendra answers natural-language questions about a code repository and cites the exact file and lines behind each answer.

It is a retrieval-augmented generation (RAG) system built for source code. It differs from a generic "chat with your docs" app in two ways:

- **AST-aware chunking:** code is split along real function, method, and arrow-function boundaries, so a chunk never stops mid-function.
- **Hybrid search:** keyword search finds exact names, and vector search finds related concepts. Reciprocal Rank Fusion merges the two result lists.

## How it works

```text
Repository
    |
    v
Walk source files (skips node_modules, build output, and similar)
    |
    v
Parse into chunks (Babel for JS/TS, tree-sitter for Java)
    |
    +--> Keyword index (MiniSearch, saved to .index/)
    +--> Embeddings (OpenAI text-embedding-3-small, stored in Qdrant)
    |
    v
Question --> keyword + vector search --> Reciprocal Rank Fusion
    |
    v
Top 5 chunks --> Claude (claude-haiku-4-5) --> answer with file:line citations
```

## Tech stack

| Area | Tools |
| --- | --- |
| Runtime and API | Node.js, Express |
| Parsing | `@babel/parser`, `@babel/traverse`, `web-tree-sitter` |
| Keyword search | MiniSearch |
| Vector search | Qdrant, OpenAI embeddings |
| Answers | Anthropic Claude API |
| Tests and CI | Node test runner, GitHub Actions |

## Run it locally

You need Node.js 22 or later and Docker. Vector search and `ask` also need OpenAI and Anthropic API keys, which cost money to use.

```bash
npm install
cp .env.example .env
docker run -d -p 6333:6333 --name zendra-qdrant qdrant/qdrant
```

Add your keys to `.env`, then index a repository and ask a question:

```bash
node src/cli.js ingest /path/to/repo
node src/cli.js ask "How is the JWT token validated?"
```

Keyword search needs no keys or Docker:

```bash
node src/cli.js ingest test/fixtures
node src/cli.js search "calculator add"
```

### Commands

| Command | What it does |
| --- | --- |
| `ingest <repoPath>` | Chunks a repository and rebuilds both indexes |
| `search "<query>"` | Keyword search |
| `vsearch "<query>"` | Vector search |
| `hsearch "<query>"` | Hybrid search |
| `ask "<question>"` | Generates an answer with citations |

### Web UI and API

`npm run server` starts a page and an API at `http://localhost:3000`.

| Endpoint | Body |
| --- | --- |
| `POST /ingest` | `{ "repoPath": "/path/to/repo" }` |
| `POST /ask` | `{ "question": "..." }` |

The server has no authentication and can read any local path sent to `/ingest`, so run it only on your own machine.

## Tests

```bash
npm test
```

The tests need no API keys or network access. They cover chunking for JavaScript, TypeScript syntax, and Java, repository walking, and rank fusion. API calls and answer quality are not covered by automated tests.

## Bugs fixed while testing on real code

- **Exported code was skipped:** the chunker missed every `export function` and `export const`, because it only recognized declarations directly under the program root. It now looks through export wrappers, and a test guards against a repeat.
- **Stale search results:** Qdrant IDs include line numbers, so editing a file left outdated points behind. Each ingest now rebuilds the collection.
- **Build output was indexed:** `.next`, `.turbo`, `coverage`, `.cache`, and `target` are now skipped.

## Limitations

- Each ingest re-embeds the whole repository.
- Only JavaScript, TypeScript, and Java are supported.
- Retrieval quality has been checked by hand on sample questions, not measured against a benchmark.
- `balance sheet/` estimates API spending from a local token log. It does not read real account balances.

## License

[MIT](LICENSE)

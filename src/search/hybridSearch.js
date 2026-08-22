const { buildKeywordIndex, searchKeyword, makeChunkId } = require("../index/keywordIndex");
const { searchVector } = require("../index/vectorIndex");

const RRF_K = 60;
const CANDIDATE_MULTIPLIER = 4;

function rrfMerge(rankedLists, limit) {
  const merged = new Map();

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const entry = merged.get(item.id) || { score: 0, item };
      entry.score += 1 / (RRF_K + rank + 1);
      merged.set(item.id, entry);
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, item }) => ({ ...item, score }));
}

async function hybridSearch(chunks, query, limit = 5) {
  const candidateLimit = limit * CANDIDATE_MULTIPLIER;

  const miniSearch = buildKeywordIndex(chunks);
  const keywordResults = searchKeyword(miniSearch, query, candidateLimit).map((r) => ({
    id: r.id,
    filePath: r.filePath,
    startLine: r.startLine,
    endLine: r.endLine,
    name: r.name,
    kind: r.kind,
  }));

  const vectorResults = (await searchVector(query, candidateLimit)).map((r) => ({
    id: makeChunkId(r),
    filePath: r.filePath,
    startLine: r.startLine,
    endLine: r.endLine,
    name: r.name,
    kind: r.kind,
  }));

  return rrfMerge([keywordResults, vectorResults], limit);
}

module.exports = { hybridSearch, rrfMerge };

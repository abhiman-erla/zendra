const MiniSearch = require("minisearch");

function makeChunkId(chunk) {
  return `${chunk.filePath}:${chunk.startLine}-${chunk.endLine}:${chunk.name}`;
}

function buildKeywordIndex(chunks) {
  const miniSearch = new MiniSearch({
    idField: "id",
    fields: ["name", "code"],
    storeFields: ["filePath", "startLine", "endLine", "kind", "name"],
  });

  miniSearch.addAll(chunks.map((chunk) => ({ id: makeChunkId(chunk), ...chunk })));

  return miniSearch;
}

function searchKeyword(miniSearch, query, limit = 5) {
  return miniSearch
    .search(query, { prefix: true, fuzzy: 0.2, boost: { name: 3 } })
    .slice(0, limit);
}

module.exports = { buildKeywordIndex, searchKeyword, makeChunkId };

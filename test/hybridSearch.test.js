const test = require("node:test");
const assert = require("node:assert/strict");
const { rrfMerge } = require("../src/search/hybridSearch");

test("ranks an item found by both searches above items found by one", () => {
  const keyword = [{ id: "a" }, { id: "shared" }];
  const vector = [{ id: "b" }, { id: "shared" }];

  assert.equal(rrfMerge([keyword, vector], 3)[0].id, "shared");
});

test("removes duplicates and honors the limit", () => {
  const keyword = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const vector = [{ id: "a" }, { id: "d" }];
  const merged = rrfMerge([keyword, vector], 2);

  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((item) => item.id)).size, 2);
});

test("scores with reciprocal rank fusion", () => {
  const [item] = rrfMerge([[{ id: "a" }]], 1);

  assert.equal(item.score, 1 / 61);
});

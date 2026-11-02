const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { chunkFiles } = require("../src/ingest/astChunker");

const fixture = (name) => path.join(__dirname, "fixtures", name);

test("chunks exported and plain top-level functions", async () => {
  const chunks = await chunkFiles([fixture("exports.js")]);
  const names = chunks.map((c) => c.name);

  for (const name of ["alpha", "beta", "gamma", "plain", "outer"]) {
    assert.ok(names.includes(name), `missing chunk for ${name}`);
  }
});

test("does not chunk functions nested inside another function", async () => {
  const chunks = await chunkFiles([fixture("exports.js")]);

  assert.ok(!chunks.some((c) => c.name === "nestedHelper"));
});

test("splits classes into method chunks with accurate line numbers", async () => {
  const chunks = await chunkFiles([fixture("sample.js")]);
  const add = chunks.find((c) => c.name === "Calculator.add");

  assert.ok(chunks.some((c) => c.name === "Calculator.subtract"));
  assert.equal(add.kind, "method");
  assert.equal(add.startLine, 18);
  assert.equal(add.endLine, 21);
  assert.match(add.code, /^add\(n\)/);
});

test("chunks Java constructors and methods", async () => {
  const chunks = await chunkFiles([fixture("Sample.java")]);
  const add = chunks.find((c) => c.name.endsWith("add"));

  assert.equal(chunks.length, 2);
  assert.equal(add.startLine, 4);
  assert.equal(add.endLine, 6);
});

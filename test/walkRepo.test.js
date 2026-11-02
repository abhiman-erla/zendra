const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { walkRepo } = require("../src/ingest/walkRepo");

test("finds source files and skips dependency and build folders", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zendra-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = ["src/app.ts", "src/Main.java", "src/notes.md", "node_modules/lib/index.js", ".next/page.js", "target/App.java"];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "");
  }

  const found = walkRepo(root).map((file) => path.relative(root, file).split(path.sep).join("/")).sort();

  assert.deepEqual(found, ["src/Main.java", "src/app.ts"]);
});

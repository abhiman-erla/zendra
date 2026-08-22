const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { chunkJavaFile } = require("./javaChunker");

// A declaration counts as top-level whether it's bare (`function Foo() {}`) or
// wrapped in an export (`export function Foo() {}` / `export default function Foo() {}`)
// — both are still direct children of Program, just one level deeper via the export node.
function isTopLevelStatement(path) {
  let parent = path.parent;
  if (parent.type === "ExportNamedDeclaration" || parent.type === "ExportDefaultDeclaration") {
    parent = path.parentPath.parent;
  }
  return parent.type === "Program";
}

function nodeToChunk(sourceCode, filePath, kind, name, node) {
  return {
    kind,
    name,
    filePath,
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    code: sourceCode.slice(node.start, node.end),
  };
}

function chunkFile(filePath) {
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const chunks = [];

  let ast;
  try {
    ast = parser.parse(sourceCode, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (err) {
    console.warn(`Skipping ${filePath}: parse error (${err.message})`);
    return chunks;
  }

  traverse(ast, {
    FunctionDeclaration(path) {
      if (!isTopLevelStatement(path)) return;
      const name = path.node.id ? path.node.id.name : "(anonymous)";
      chunks.push(nodeToChunk(sourceCode, filePath, "function", name, path.node));
    },

    ClassDeclaration(path) {
      if (!isTopLevelStatement(path)) return;
      const className = path.node.id ? path.node.id.name : "(anonymous)";

      for (const member of path.node.body.body) {
        if (member.type !== "ClassMethod") continue;
        const methodName =
          member.key.name || member.key.value || "(computed)";
        chunks.push(
          nodeToChunk(sourceCode, filePath, "method", `${className}.${methodName}`, member)
        );
      }
    },

    VariableDeclarator(path) {
      const isArrowConst =
        path.node.init &&
        path.node.init.type === "ArrowFunctionExpression" &&
        path.node.id.type === "Identifier";

      if (!isArrowConst || !isTopLevelStatement(path.parentPath)) return;

      chunks.push(
        nodeToChunk(sourceCode, filePath, "arrow", path.node.id.name, path.parentPath.node)
      );
    },
  });

  return chunks;
}

async function chunkFiles(filePaths) {
  const chunks = [];
  for (const filePath of filePaths) {
    if (path.extname(filePath) === ".java") {
      chunks.push(...(await chunkJavaFile(filePath)));
    } else {
      chunks.push(...chunkFile(filePath));
    }
  }
  return chunks;
}

module.exports = { chunkFile, chunkFiles };

const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

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
      if (path.parent.type !== "Program") return;
      const name = path.node.id ? path.node.id.name : "(anonymous)";
      chunks.push(nodeToChunk(sourceCode, filePath, "function", name, path.node));
    },

    ClassDeclaration(path) {
      if (path.parent.type !== "Program") return;
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
      const isTopLevelConstArrow =
        path.node.init &&
        path.node.init.type === "ArrowFunctionExpression" &&
        path.node.id.type === "Identifier" &&
        path.parentPath.parent.type === "Program";

      if (!isTopLevelConstArrow) return;

      chunks.push(
        nodeToChunk(sourceCode, filePath, "arrow", path.node.id.name, path.parentPath.node)
      );
    },
  });

  return chunks;
}

function chunkFiles(filePaths) {
  return filePaths.flatMap(chunkFile);
}

module.exports = { chunkFile, chunkFiles };

const fs = require("fs");
const path = require("path");
const { Parser, Language } = require("web-tree-sitter");

const WASM_PATH = path.join(__dirname, "..", "..", "node_modules", "tree-sitter-wasms", "out", "tree-sitter-java.wasm");

// Top-level type declarations we descend into looking for methods (mirrors
// the JS/TS chunker: don't chunk the whole class as one blob, chunk its methods).
const TYPE_DECLARATION_KINDS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
]);

const METHOD_LIKE_KINDS = new Set(["method_declaration", "constructor_declaration"]);

let javaLanguagePromise = null;

function getJavaLanguage() {
  if (!javaLanguagePromise) {
    javaLanguagePromise = Parser.init().then(() => Language.load(WASM_PATH));
  }
  return javaLanguagePromise;
}

function nodeToChunk(filePath, kind, name, node) {
  return {
    kind,
    name,
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    code: node.text,
  };
}

function chunkTypeDeclaration(filePath, chunks, node) {
  const nameNode = node.childForFieldName("name");
  const typeName = nameNode ? nameNode.text : "(anonymous)";

  const body = node.childForFieldName("body");
  if (!body) return;

  for (const member of body.namedChildren) {
    if (!METHOD_LIKE_KINDS.has(member.type)) continue;
    const methodNameNode = member.childForFieldName("name");
    const methodName = methodNameNode ? methodNameNode.text : "(anonymous)";
    chunks.push(nodeToChunk(filePath, "method", `${typeName}.${methodName}`, member));
  }
}

async function chunkJavaFile(filePath) {
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const chunks = [];

  const Java = await getJavaLanguage();
  const parser = new Parser();
  parser.setLanguage(Java);

  let tree;
  try {
    tree = parser.parse(sourceCode);
  } catch (err) {
    console.warn(`Skipping ${filePath}: parse error (${err.message})`);
    return chunks;
  }

  for (const node of tree.rootNode.namedChildren) {
    if (TYPE_DECLARATION_KINDS.has(node.type)) {
      chunkTypeDeclaration(filePath, chunks, node);
    }
  }

  return chunks;
}

async function chunkJavaFiles(filePaths) {
  const chunks = [];
  for (const filePath of filePaths) {
    chunks.push(...(await chunkJavaFile(filePath)));
  }
  return chunks;
}

module.exports = { chunkJavaFile, chunkJavaFiles };

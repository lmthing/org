// ../repl/dist/path-K3VLZVTH.js
import nodePath from "path";
var pathModule = {
  id: "path",
  description: "Path manipulation utilities",
  functions: [
    {
      name: "joinPath",
      description: "Join path segments",
      signature: "(...segments: string[]) => string",
      fn: (...segments) => nodePath.join(...segments)
    },
    {
      name: "resolvePath",
      description: "Resolve to absolute path",
      signature: "(...segments: string[]) => string",
      fn: (...segments) => nodePath.resolve(...segments)
    },
    {
      name: "relativePath",
      description: "Relative path between two paths",
      signature: "(from: string, to: string) => string",
      fn: (from, to) => nodePath.relative(from, to)
    },
    {
      name: "parsePath",
      description: "Parse path components",
      signature: "(p: string) => { dir: string, base: string, ext: string, name: string }",
      fn: (p) => nodePath.parse(p)
    },
    {
      name: "dirname",
      description: "Directory name",
      signature: "(p: string) => string",
      fn: (p) => nodePath.dirname(p)
    },
    {
      name: "basename",
      description: "Base name",
      signature: "(p: string, ext?: string) => string",
      fn: (p, ext) => nodePath.basename(p, ext)
    },
    {
      name: "extname",
      description: "Extension",
      signature: "(p: string) => string",
      fn: (p) => nodePath.extname(p)
    }
  ]
};
var path_default = pathModule;
export {
  path_default as default
};

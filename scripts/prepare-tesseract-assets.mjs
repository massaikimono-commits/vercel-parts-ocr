import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const outRoot = join(root, "public", "tesseract");
const coreOut = join(outRoot, "core");
const langOut = join(outRoot, "lang");

mkdirSync(coreOut, { recursive: true });
mkdirSync(langOut, { recursive: true });

function copyRequired(from, to) {
  if (!existsSync(from)) throw new Error(`Missing Tesseract asset: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function findNamed(dir, filename) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isFile() && entry === filename) return full;
    if (stat.isDirectory()) {
      const hit = findNamed(full, filename);
      if (hit) return hit;
    }
  }
  return null;
}

copyRequired(
  join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  join(outRoot, "worker.min.js")
);

const coreDir = join(root, "node_modules", "tesseract.js-core");
const coreAssets = readdirSync(coreDir).filter(
  (name) => /^tesseract-core.*\.(?:js|wasm)$/.test(name)
);
if (!coreAssets.length) throw new Error("No Tesseract core assets found");
for (const name of coreAssets) {
  copyRequired(join(coreDir, name), join(coreOut, name));
}

for (const lang of ["jpn", "eng"]) {
  const packageDir = join(root, "node_modules", "@tesseract.js-data", lang);
  const filename = `${lang}.traineddata.gz`;
  const source = findNamed(packageDir, filename);
  if (!source) throw new Error(`Missing Tesseract language data: ${filename}`);
  copyRequired(source, join(langOut, filename));
}

console.log(
  `Prepared local Tesseract assets: worker + ${coreAssets.length} core files + jpn/eng language data`
);

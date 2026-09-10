import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('standalone/parts-a22/dist', { recursive: true });
execFileSync('npx', ['--yes','esbuild@0.25.9','standalone/parts-a22/entry.tsx','--bundle','--platform=browser','--format=iife','--target=safari16','--minify','--outfile=standalone/parts-a22/dist/bundle.js','--define:process.env.NODE_ENV="production"'], { stdio: 'inherit' });
const html = readFileSync('standalone/parts-a22/index.html','utf8');
if (!html.includes('./dist/bundle.js')) throw new Error('standalone index missing bundle reference');
const js = readFileSync('standalone/parts-a22/dist/bundle.js','utf8');
if (!js.includes('Stage A22') && js.length < 100000) throw new Error('standalone bundle unexpectedly small');
console.log(JSON.stringify({stage:'A22',standaloneBuild:'PASS',bytes:js.length,target:'Safari 16+'}));

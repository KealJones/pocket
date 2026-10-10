import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/vendor', { recursive: true });
for (const file of ['index.html', 'style.css', 'mobile.css']) copyFileSync('web/' + file, 'dist/' + file);
cpSync('packs', 'dist/packs', { recursive: true });
mkdirSync('dist/examples'); copyFileSync('examples/world.ncon', 'dist/examples/world.ncon');
copyFileSync('node_modules/sql.js/dist/sql-wasm.js', 'dist/vendor/sql-wasm.js');
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/vendor/sql-wasm.wasm');
copyFileSync('node_modules/sql.js/LICENSE', 'dist/vendor/sql.js-LICENSE');
copyFileSync('node_modules/@noble/hashes/LICENSE', 'dist/vendor/noble-hashes-LICENSE');
await build({ entryPoints: ['web/app.mjs'], outfile: 'dist/app.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, alias: { 'node:crypto': resolve('web/crypto.mjs') } });
// A source download is built from the same checkout as the deployed interface.
execFileSync('python', ['-c', `from pathlib import Path
import zipfile
root=Path('.')
with zipfile.ZipFile('dist/napkin-next-source.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file() and not any(x in {'.git','.openai','.sites-runtime','.env','.env.local','node_modules','dist','data'} for x in p.parts): z.write(p,Path('napkin-next')/p)
`]);
// The supported Worker ESM deployment embeds the client assets in its module.
const assets = {}, types = { html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json',wasm:'application/wasm',zip:'application/zip',ncon:'text/plain; charset=utf-8' };
function collect(directory) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=directory+'/'+entry.name;
    if(entry.isDirectory()) collect(path);
    else assets[path.slice(4)]={data:readFileSync(path).toString('base64'),type:types[entry.name.split('.').at(-1)]||'text/plain'};
  }
}
collect('dist');
rmSync('dist',{recursive:true,force:true}); mkdirSync('dist/server',{recursive:true}); mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+readFileSync('worker/index.mjs','utf8')+'\nexport default createWorker(assets);\n');
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built chat interface, shared learning engine, source archive, and retrieval Worker.');

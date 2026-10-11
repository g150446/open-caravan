import {build} from 'esbuild';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {join,extname} from 'node:path';
const files={};
function collect(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())collect(path);else if(entry.name!=='_headers'){files['/'+path.slice(5)]={type:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(path)]??'text/plain; charset=utf-8',body:readFileSync(path,'utf8')};}}}
collect('dist');mkdirSync('build',{recursive:true});
await build({entryPoints:['worker/index.ts'],outfile:'build/worker.js',bundle:true,format:'esm',target:'es2022',platform:'browser',minify:true,banner:{js:'// @ts-nocheck — generated bundle; validate TypeScript sources and bundle integration tests.'},define:{__STATIC_FILES__:JSON.stringify(files)}});

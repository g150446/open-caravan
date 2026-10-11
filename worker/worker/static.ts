// Embedded build output allows deployment through Cloudflare's browser code editor.
declare const __STATIC_FILES__: Record<string,{type:string;body:string}>;
export function serveStatic(req:Request){
 if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
 if(typeof __STATIC_FILES__==='undefined')return new Response('Run npm run build',{status:503});
 const path=new URL(req.url).pathname;
 const file=__STATIC_FILES__[path]??(!path.split('/').at(-1)?.includes('.')?__STATIC_FILES__['/index.html']:undefined);
 if(!file)return new Response('Not found',{status:404});
 return new Response(req.method==='HEAD'?null:file.body,{headers:{'Content-Type':file.type,'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'}});
}

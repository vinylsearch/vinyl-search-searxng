// Rillenradar's single, authenticated Discogs transport. No third-party proxy,
// URL selection, credential storage, redirects, request logging or IP rotation.
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';

const marker={'X-Rillenradar-Relay':'discogs-v1','Cache-Control':'no-store'};
const json=(status,error,headers={})=>Response.json({error},{status,headers:{...marker,...headers}});
const wait=(seconds,kind)=>json(429,'Discogs request is queued',{'Retry-After':String(Math.max(1,Math.ceil(seconds))),'X-Rillenradar-Relay-Wait':kind});
const publicPath=/^\/(?:artists\/\d+(?:\/releases)?|masters\/\d+(?:\/versions)?|releases\/\d+|database\/search|marketplace\/stats\/\d+|oauth\/identity)$/;
const privatePath=/^\/(?:users\/[^/]+\/(?:collection\/folders\/0\/releases|collection\/value|collection\/fields|wants)|marketplace\/price_suggestions\/\d+)$/;

export function target(path){
 if(typeof path!=='string'||path.length>2048||!path.startsWith('/')||path.startsWith('//')||/[\x00-\x20\\]/.test(path))throw new Error('Invalid path');
 const url=new URL(path,'https://api.discogs.com');
 const decoded=decodeURIComponent(url.pathname);
 if(url.origin!=='https://api.discogs.com'||url.username||url.password||url.hash||!publicPath.test(decoded)&&!privatePath.test(decoded))throw new Error('Invalid path');
 for(const key of url.searchParams.keys())if(/token|secret|authorization|api.?key/i.test(key))throw new Error('Credentials cannot be placed in URLs');
 return url;
}
async function bytes(stream,limit){
 if(!stream)return new Uint8Array();
 const reader=stream.getReader(),chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw new Error('Response too large');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}
function seconds(value,now){
 const n=value&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):Math.ceil((Date.parse(value||'')-now)/1000);
 return Number.isFinite(n)&&n>0?Math.ceil(n):60;
}
export function createDiscogsRelay({key,fetchImpl=fetch,now=Date.now}){
 if(typeof key!=='string'||key.length<32)throw new Error('DISCOGS_RELAY_KEY must be configured');
 const expected=Buffer.from('Bearer '+key);
 let inFlight=false,nextAt=0,pauseUntil=0,failures=0,failureAt=0;
 return async function handle(request){
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/health')return Response.json({ok:true},{headers:marker});
  if(request.method!=='POST'||path!=='/v1/discogs')return json(404,'Not found');
  const authorization=Buffer.from(request.headers.get('authorization')||'');
  if(authorization.length!==expected.length||!timingSafeEqual(authorization,expected))return json(401,'Not authorized');
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json(415,'JSON required');
  let input,url;
  try{
   input=JSON.parse(new TextDecoder().decode(await bytes(request.body,4096)));
   if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['path','token'].includes(k)))throw new Error();
   if(input.token!==undefined&&(typeof input.token!=='string'||!/^\S{1,512}$/.test(input.token)||/[\x00-\x20\x7f]/.test(input.token)))throw new Error();
   url=target(input.path);
   if((privatePath.test(decodeURIComponent(url.pathname))||url.pathname==='/oauth/identity'||url.pathname==='/database/search')&&!input.token)return json(400,'Credential required');
  }catch{return json(400,'Invalid request');}
  const started=now();
  if(pauseUntil>started)return wait((pauseUntil-started)/1000,'provider');
  if(inFlight||nextAt>started)return wait(Math.max(1,(nextAt-started)/1000),'queue');
  // At most 30 authenticated / 20 anonymous requests per minute. The Site's
  // durable shared queue additionally handles multiple callers and restarts.
  inFlight=true;nextAt=started+(input.token?2000:3000);
  try{
   const upstream=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/vnd.discogs.v2.plaintext+json','User-Agent':'Rillenradar/3.4 (+https://rillenradar.de)',...(input.token?{Authorization:'Discogs token='+input.token}:{})},redirect:'manual',signal:AbortSignal.timeout(12000)});
   if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return json(502,'Unexpected upstream redirect');}
   const headers=new Headers({...marker,'X-Rillenradar-Relay-Upstream':'discogs'});
   for(const name of ['content-type','retry-after','x-discogs-ratelimit','x-discogs-ratelimit-used','x-discogs-ratelimit-remaining','date']){
    const value=upstream.headers.get(name);if(value)headers.set(name,value);
   }
   if(upstream.headers.get('x-discogs-ratelimit-remaining')==='0')pauseUntil=Math.max(pauseUntil,now()+60000);
   if(upstream.status===429){
    failures=failureAt>now()-600000?Math.min(failures+1,4):1;failureAt=now();
    const delay=Math.max(seconds(upstream.headers.get('retry-after'),now()),Math.min(300,60*2**(failures-1)));
    pauseUntil=Math.max(pauseUntil,now()+delay*1000);headers.set('Retry-After',String(Math.ceil((pauseUntil-now())/1000)));
   }else if(upstream.ok){failures=0;failureAt=0;}
   const body=await bytes(upstream.body,2000000);
   return new Response([204,205,304].includes(upstream.status)?null:body,{status:upstream.status,headers});
  }catch{return json(502,'Discogs transport unavailable');}
  finally{inFlight=false;}
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const handle=createDiscogsRelay({key:process.env.DISCOGS_RELAY_KEY});
 const server=createServer(async(req,res)=>{
  try{
   const request=new Request(new URL(req.url||'/','http://relay.local'),{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method||'GET')?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const response=await handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'Cache-Control':'no-store'});res.end('Request failed');}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;server.maxHeadersCount=30;
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Rillenradar Discogs transport ready'));
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}

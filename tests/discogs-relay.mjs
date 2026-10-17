import assert from 'node:assert/strict';
import {createDiscogsRelay,target} from '../ops/discogs-relay/server.mjs';
let now=10000000,calls=0,mode='ok';
const key='synthetic-relay-key-'.repeat(3);
const run=createDiscogsRelay({key,now:()=>now,fetchImpl:async(url,init)=>{
 calls++;assert.equal(new URL(url).origin,'https://api.discogs.com');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Discogs token=synthetic-shared');
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://example.invalid'}});
 if(mode==='error')throw new Error('private transport information');
 if(mode==='large')return new Response('x'.repeat(2000001));
 return Response.json({id:621923},{status:mode==='limited'?429:200,headers:{'X-Discogs-Ratelimit':'60','X-Discogs-Ratelimit-Remaining':mode==='limited'?'0':'59',...(mode==='limited'?{'Retry-After':'400'}:{}),'Set-Cookie':'must-not-forward=1'}});
}});
const call=(body={path:'/releases/621923',token:'synthetic-shared'},secret=key)=>run(new Request('http://fixture/v1/discogs',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await run(new Request('http://fixture/health'))).status,200);assert.equal(calls,0);
const unauthorized=await call(undefined,'wrong');assert.equal(unauthorized.status,401);assert.equal(unauthorized.headers.get('x-rillenradar-relay-upstream'),null);assert.equal(calls,0);
for(const path of ['https://evil.invalid','//evil.invalid/release/1','/users/a/collection/folders/0/releases/../../secret','/releases/1#fragment','/releases/1?token=secret','/users/a%2Fb/wants','/oauth/access_token'])assert.throws(()=>target(path));
assert.equal((await call({path:'/users/example/collection/value'})).status,400);
assert.equal((await call({path:'/releases/621923',token:'line\nbreak'})).status,400);
assert.equal((await call({path:'/releases/621923',token:'synthetic-shared',url:'https://evil.invalid'})).status,400);assert.equal(calls,0);
let response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('x-rillenradar-relay'),'discogs-v1');assert.equal(response.headers.get('x-rillenradar-relay-upstream'),'discogs');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(calls,1);
response=await call();assert.equal(response.status,429);assert.equal(response.headers.get('x-rillenradar-relay-wait'),'queue');assert.equal(calls,1);
now+=2000;mode='limited';response=await call();assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'400');assert.equal(calls,2);
now+=61000;response=await call();assert.equal(response.status,429);assert.equal(response.headers.get('x-rillenradar-relay-wait'),'provider');assert.equal(calls,2,'No call during provider Retry-After');
now+=340000;mode='ok';assert.equal((await call()).status,200);
for(const failure of ['redirect','error','large']){now+=3000;mode=failure;response=await call();assert.equal(response.status,502);assert.ok(!(await response.text()).includes('private'));}
assert.equal(calls,6);
console.log('PASS: fixed Discogs origin, relay authorization, private endpoint credential requirement, no secret URLs, paced calls, full Retry-After, no redirects/fallback, bounded responses, safe errors and no cookies. Synthetic requests only.');

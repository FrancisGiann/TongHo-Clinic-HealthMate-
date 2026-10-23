import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexingHeaders, landingHtml, serveApplicationHtml } from './seo.js';
import { createApp } from './app.js';
const template = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const request = (url='/', headers={}) => ({ method:'GET', originalUrl:url, path:url.split('?')[0], headers:{host:'healthmateplus.com',...headers} });
function response() {
  return {headers:{}, setHeader(k,v){this.headers[k]=v;}, vary(){}, type(){return this;}, send(body){this.body=body;return this;} };
}
test('only bare anonymous canonical-host root is indexable', () => {
  const cases = [request(), request('/', {host:'temporary.hostingersite.com'}),request('/', {host:'temporary.hostingersite.com','x-forwarded-host':'healthmateplus.com'}),request('/',{cookie:'healthmate_session=synthetic'}),request('/',{authorization:'Bearer synthetic'}),...['/login','/?activate=synthetic','/?preview=draft','/landing-preview','/students/fictional','/api/health','/api/auth/me','/index.html'].map(p=>request(p))];
  for(const [i,req] of cases.entries()) {
    const res=response();let called=false;indexingHeaders(req,res,()=>{called=true;});
    assert.equal(called,true);assert.equal(res.headers['X-Robots-Tag'],i===0?'index, follow':'noindex, nofollow');
    const html=landingHtml(template,req);
    assert.equal(html.includes('rel="canonical"'),i===0);
    assert.equal(html.includes('content="index, follow"'),i===0);
    if(req.path.startsWith('/api')) assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
});
test('application HTML is never shared-cacheable and preserves the safe default',()=>{
  for(const req of [request(),request('/login'),request('/',{cookie:'synthetic=1'})]){
    const res=response();serveApplicationHtml(template)(req,res);
    assert.equal(res.headers['Cache-Control'],'private, no-store');
    assert.match(res.body,/School Clinic System Demo/);
  }
});
test('indexing middleware precedes API handlers and static serving',()=>{
  const app=createApp({queryFn:()=>{throw Error('No database access permitted');}});
  const layers=app.router.stack;
  const policy=layers.findIndex(l=>l.handle===indexingHeaders);
  assert.ok(policy>=0);
  assert.ok(layers.findIndex(l=>l.route?.path==='/api/auth/me')>policy);
  assert.ok(layers.findIndex(l=>l.name==='serveStatic')>policy);
});
test('sitemap contains exactly the public canonical root and robots permits rendering',()=>{
  const sitemap=readFileSync(new URL('../public/sitemap.xml',import.meta.url),'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]),['https://healthmateplus.com/']);
  const robots=readFileSync(new URL('../public/robots.txt',import.meta.url),'utf8');
  assert.match(robots,/Allow: \//);assert.doesNotMatch(robots,/Disallow:/);
});

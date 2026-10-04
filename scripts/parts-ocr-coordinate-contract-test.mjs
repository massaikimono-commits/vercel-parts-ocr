import assert from 'node:assert/strict';
import {projectiveMap,toSourceRegion} from '../app/ocr/architecture-vnext/coordinate-contract.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7);
const quad=[{x:20,y:10},{x:120,y:20},{x:100,y:100},{x:10,y:90}],map=projectiveMap(101,81,quad);
for(const [index,[x,y]]of [[0,[0,0]],[1,[100,0]],[2,[100,80]],[3,[0,80]]]){const p=map(x,y);close(p.x,quad[index].x);close(p.y,quad[index].y);}
const p=toSourceRegion({x1:0,y1:0,x2:100,y2:80},{type:'PROJECTIVE_LOCAL',quad,localWidth:101,localHeight:81,scale:.5});close(p.x1,20);close(p.x2,240);close(p.y1,20);close(p.y2,200);
const original={x1:10,y1:20,x2:40,y2:30};const r=toSourceRegion({x1:25,y1:5,x2:30,y2:20},{angle:90,scale:.5,sourceWidth:100,sourceHeight:80});for(const k of Object.keys(original))close(r[k],original[k]);
assert.throws(()=>projectiveMap(100,80,Array(4).fill({x:0,y:0})));
assert.throws(()=>toSourceRegion(original,{scale:0}));
console.log('Source coordinate contract: projective corners, inverse scale/cardinal, invalid geometry PASS');

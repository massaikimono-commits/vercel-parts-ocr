import assert from 'node:assert/strict';import {detectDocumentRegions,convexHull,polygonArea,warpDocument} from '../app/ocr/bakeoff/document-regions.mjs';
const w=200,h=140,data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,inside=x>=30&&x<170&&y>=30&&y<110;data[i]=inside?230:30;data[i+1]=inside?210:50;data[i+2]=inside?130:30;data[i+3]=255;}
const result=detectDocumentRegions({data,width:w,height:h});assert.equal(result.regions.length,1);assert.equal(result.regions[0].family,'TINTED_PAPER');assert.ok(result.regions[0].coverage>.35);
const warped=warpDocument({data,width:w,height:h},result.regions[0].quad);assert.ok(warped.width>warped.height);assert.equal(warped.data.length,warped.width*warped.height*4);
assert.equal(polygonArea(convexHull([{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5},{x:4,y:2}])),50);
assert.throws(()=>detectDocumentRegions({data,width:1,height:1}));assert.throws(()=>warpDocument({data,width:w,height:h},[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}]));
console.log('Document components / quad / projective input validation: 8 assertions PASS');

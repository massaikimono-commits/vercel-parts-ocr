import {inverseCardinalBox} from './orientation-contract.mjs';
function solve(matrix,right){
 const m=matrix.map((row,i)=>[...row,right[i]]),n=right.length;
 for(let column=0;column<n;column++){let pivot=column;for(let row=column+1;row<n;row++)if(Math.abs(m[row][column])>Math.abs(m[pivot][column]))pivot=row;if(Math.abs(m[pivot][column])<1e-10)throw Error('Degenerate projective geometry');[m[pivot],m[column]]=[m[column],m[pivot]];const divisor=m[column][column];for(let j=column;j<=n;j++)m[column][j]/=divisor;for(let row=0;row<n;row++)if(row!==column){const multiplier=m[row][column];for(let j=column;j<=n;j++)m[row][j]-=multiplier*m[column][j];}}
 return m.map(row=>row[n]);
}
export function projectiveMap(width,height,quad){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=1||height<=1||quad?.length!==4||quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Invalid projective frame');
 const points=[[0,0],[width-1,0],[width-1,height-1],[0,height-1]],matrix=[],right=[];
 points.forEach(([x,y],i)=>{const{x:u,y:v}=quad[i];matrix.push([x,y,1,0,0,0,-u*x,-u*y]);right.push(u);matrix.push([0,0,0,x,y,1,-v*x,-v*y]);right.push(v);});
 const h=solve(matrix,right);return(x,y)=>{const denominator=h[6]*x+h[7]*y+1;if(Math.abs(denominator)<1e-10)throw Error('Projective point at infinity');return{x:(h[0]*x+h[1]*y+h[2])/denominator,y:(h[3]*x+h[4]*y+h[5])/denominator};};
}
export function toSourceRegion(region,frame){
 if(!region)return null;const box='x1'in region?region:{x1:region.x,y1:region.y,x2:region.x+region.width,y2:region.y+region.height};
 const corners=[[box.x1,box.y1],[box.x2,box.y1],[box.x2,box.y2],[box.x1,box.y2]],scale=frame.scale??1;
 if(!Number.isFinite(scale)||scale<=0)throw Error('Invalid source scale');
 let polygon;
 if(frame.type==='PROJECTIVE_LOCAL'){const map=projectiveMap(frame.localWidth,frame.localHeight,frame.quad);polygon=corners.map(([x,y])=>{const p=map(x,y);return{x:p.x/scale,y:p.y/scale};});}
 else polygon=corners.map(([x,y])=>{const mapped=inverseCardinalBox({x1:x/scale,y1:y/scale,x2:x/scale,y2:y/scale},frame.angle??0,frame.sourceWidth,frame.sourceHeight);return{x:mapped.x1,y:mapped.y1};});
 if(polygon.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Invalid inverse coordinate');
 return {x1:Math.min(...polygon.map(p=>p.x)),y1:Math.min(...polygon.map(p=>p.y)),x2:Math.max(...polygon.map(p=>p.x)),y2:Math.max(...polygon.map(p=>p.y)),polygon,frame:'ORIGINAL_TOP_LEFT_PIXELS'};
}

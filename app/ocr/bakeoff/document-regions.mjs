/** Scene -> paper components -> convex quads. No text, GT, filename, or template coordinates. */
const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
export function convexHull(points){
 const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<=2)return p;
 const lo=[],hi=[];for(const v of p){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),v)<=0)lo.pop();lo.push(v);}for(const v of p.reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),v)<=0)hi.pop();hi.push(v);}return lo.slice(0,-1).concat(hi.slice(0,-1));
}
export function polygonArea(points){return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0))/2;}
function quadOf(hull){
 const points=[...hull];while(points.length>4){let best=0,loss=Infinity;for(let i=0;i<points.length;i++){const a=Math.abs(cross(points[(i+points.length-1)%points.length],points[i],points[(i+1)%points.length]));if(a<loss){loss=a;best=i;}}points.splice(best,1);}
 if(points.length!==4)return null;let first=0;for(let i=1;i<4;i++)if(points[i].x+points[i].y<points[first].x+points[first].y)first=i;
 let q=points.slice(first).concat(points.slice(0,first));const edges=q.map((p,i)=>Math.hypot(p.x-q[(i+1)%4].x,p.y-q[(i+1)%4].y));
 // A long-edge-first local frame; text orientation remains a separate measurable stage.
 if(edges[0]+edges[2]<edges[1]+edges[3])q=[q[1],q[2],q[3],q[0]];
 return q;
}
function close(mask,w,h){
 const dil=new Uint8Array(w*h),out=new Uint8Array(w*h);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let yes=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(mask[(y+dy)*w+x+dx])yes=true;dil[y*w+x]=yes?1:0;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let yes=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!dil[(y+dy)*w+x+dx])yes=false;out[y*w+x]=yes?1:0;}
 return out;
}
export function detectDocumentRegions({data,width,height}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||data?.length!==width*height*4)throw Error('Invalid image plane');
 const scale=Math.max(1,Math.ceil(Math.max(width,height)/400)),w=Math.ceil(width/scale),h=Math.ceil(height/scale),lumas=[],sample=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(Math.min(height-1,y*scale)*width+Math.min(width-1,x*scale))*4,r=data[i],g=data[i+1],b=data[i+2],l=.2126*r+.7152*g+.0722*b;sample.push([r,g,b,l]);lumas.push(l);}
 const sorted=[...lumas].sort((a,b)=>a-b),bright=sorted[Math.floor(sorted.length*.55)],sets=[];
 for(const family of ['TINTED_PAPER','NEUTRAL_PAPER']){
 const mask=close(Uint8Array.from(sample.map(([r,g,b,l])=>family==='TINTED_PAPER'?(r>110&&g>100&&b<Math.min(r,g)*.82?1:0):(l>=bright&&Math.max(r,g,b)-Math.min(r,g,b)<40?1:0))),w,h),seen=new Uint8Array(w*h);
 for(let start=0;start<mask.length;start++){
 if(!mask[start]||seen[start])continue;const queue=[start],points=[];seen[start]=1;
 for(let k=0;k<queue.length;k++){const index=queue[k],x=index%w,y=Math.floor(index/w);points.push({x:x*scale,y:y*scale});for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,next=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&!seen[next]&&mask[next]){seen[next]=1;queue.push(next);}}}
 if(queue.length<mask.length*.025)continue;const hull=convexHull(points),quad=quadOf(hull);if(!quad)continue;
 const area=polygonArea(quad),coverage=area/(width*height),solidity=queue.length*scale*scale/Math.max(1,polygonArea(hull)),quadFit=area/Math.max(1,polygonArea(hull));
 if(coverage<.03||quadFit<.80||solidity<.40)continue;
 sets.push({family,quad,coverage,solidity,quadFit,score:coverage*solidity*quadFit});
 }
 }
 // Prefer independently visible tinted components; neutral mask must not reinterpret the same paper/background.
 const tinted=sets.filter(x=>x.family==='TINTED_PAPER').sort((a,b)=>b.score-a.score);
 const picked=(tinted.length?tinted:sets.filter(x=>x.family==='NEUTRAL_PAPER').sort((a,b)=>b.score-a.score)).slice(0,4);
 return{regions:picked.sort((a,b)=>Math.min(...a.quad.map(p=>p.y))-Math.min(...b.quad.map(p=>p.y))),diagnostics:{sampleWidth:w,sampleHeight:h,candidateCount:sets.length,regionCount:picked.length,localization:'COLOR_COMPONENT_CONVEX_QUAD',textOrGtUsed:false}};
}
function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-9)return null;[M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let k=c;k<=n;k++)M[c][k]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return M.map(r=>r[n]);}
export function warpDocument(image,quad,maxSide=2200){
 if(!Array.isArray(quad)||quad.length!==4||quad.some(p=>![p.x,p.y].every(Number.isFinite)))throw Error('Invalid quad');
 const edge=i=>Math.hypot(quad[i].x-quad[(i+1)%4].x,quad[i].y-quad[(i+1)%4].y),W=(edge(0)+edge(2))/2,H=(edge(1)+edge(3))/2,s=Math.min(1,maxSide/Math.max(W,H));
 const width=Math.max(32,Math.round(W*s)),height=Math.max(32,Math.round(H*s)),A=[],b=[];
 for(const[i,[x,y]]of [[0,[0,0]],[1,[width-1,0]],[2,[width-1,height-1]],[3,[0,height-1]]]){const{ x:u,y:v }=quad[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}
 const hh=solve(A,b);if(!hh)throw Error('Degenerate quad');const out=new Uint8ClampedArray(width*height*4),src=image.data,w=image.width,h=image.height;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const den=hh[6]*x+hh[7]*y+1,sx=(hh[0]*x+hh[1]*y+hh[2])/den,sy=(hh[3]*x+hh[4]*y+hh[5])/den,o=(y*width+x)*4;
 if(sx<0||sy<0||sx>w-1||sy>h-1){out[o]=out[o+1]=out[o+2]=255;out[o+3]=255;continue;}
 const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=sx-x0,fy=sy-y0;
 for(let c=0;c<3;c++){const a=src[(y0*w+x0)*4+c]*(1-fx)+src[(y0*w+x1)*4+c]*fx,bb=src[(y1*w+x0)*4+c]*(1-fx)+src[(y1*w+x1)*4+c]*fx;out[o+c]=Math.round(a*(1-fy)+bb*fy);}out[o+3]=255;
 }
 return{data:out,width,height};
}

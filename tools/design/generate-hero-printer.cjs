/* Original FMRC hero artwork. Every solid, rail and print layer shares this
 * orthographic projection. Run: node tools/design/generate-hero-printer.cjs */
const fs = require('node:fs');
const path = require('node:path');
// A stronger left-facing view: the front opens toward the headline while the
// machine's depth recedes to the right. Keep every face in this same projection.
const origin = [514, 452];
const axes = { xAxis: [.86, .40], yAxis: [-1.08, .28] };
const P = (x, y, z) => [origin[0] + x * axes.xAxis[0] + y * axes.yAxis[0], origin[1] + x * axes.xAxis[1] + y * axes.yAxis[1] - z];
const n = v => +v.toFixed(2);
const pt = a => a.map(n).join(',');
const project = a => P(...a);
const poly = (a, fill, extra = '') => `<polygon points="${a.map(v => pt(project(v))).join(' ')}" fill="${fill}" ${extra}/>`;
const line = (a, b, color, width=1, extra='') => `<path d="M${pt(project(a))}L${pt(project(b))}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;
const dot = (a, r, fill, extra='') => `<circle cx="${n(project(a)[0])}" cy="${n(project(a)[1])}" r="${r}" fill="${fill}" ${extra}/>`;
const mats = {
  body:['url(#hp-top)','url(#hp-front)','url(#hp-side)'],
  dark:['#42303b','#211924','#30212d'],
  steel:['#f0e9df','#b5a4a3','#817882'],
  gold:['#f4d998','#c18b4c','#9e623b'],
  part:['url(#hp-print-top)','#f6eee2','#c6a98c'],
  glass:['#cfbac0','#ddc8c7','#bb9ca7']
};
function box(x,y,z,w,d,h,material='body',extra='') {
  const [top,front,side] = mats[material] || material;
  const a=[x,y,z],b=[x+w,y,z],c=[x+w,y+d,z],e=[x,y+d,z];
  const A=[x,y,z+h],B=[x+w,y,z+h],C=[x+w,y+d,z+h],E=[x,y+d,z+h];
  return `<g ${extra}>${poly([b,c,C,B],side)}${poly([e,c,C,E],front)}${poly([A,B,C,E],top)}${line(A,B,'#fff0d3',.7,'opacity=".38"')}${line(E,C,'#ffe6bf',.85,'opacity=".52"')}</g>`;
}
function steelRod(a,b,width=6){ return line(a,b,'#4b3e46',width+3)+line(a,b,'url(#hp-steel)',width)+line(a,b,'#fff7e9',1.2,'opacity=".9"'); }
function screw(x,y,z0,z1){
 let s=steelRod([x,y,z0],[x,y,z1],5);
 for(let z=z0+5;z<z1-4;z+=7)s+=line([x-2,y,z],[x+2,y,z+2],'#6f6470',1.4);
 return s;
}
function bolt(x,y,z,r=2){ return dot([x,y,z],r+1,'#271821')+dot([x,y,z],r,'#d1c1b5')+line([x-1,y,z],[x+1,y,z],'#6b5360',.9); }
function extrusion(x,y,z,w,d,h){
 let s=box(x,y,z,w,d,h);
 s+=line([x+w*.28,y+d,z+8],[x+w*.28,y+d,z+h-8],'#2e1421',2.3);
 s+=line([x+w*.4,y+d,z+8],[x+w*.4,y+d,z+h-8],'#b97880',.8);
 s+=line([x+w,y+d*.6,z+8],[x+w,y+d*.6,z+h-8],'#2e1421',1.6);
 return s;
}
const parts=[];
parts.push(`<defs>
 <linearGradient id="hp-top" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b7757f"/><stop offset=".45" stop-color="#8a3d51"/><stop offset="1" stop-color="#672638"/></linearGradient>
 <linearGradient id="hp-front" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#863347"/><stop offset=".6" stop-color="#632237"/><stop offset="1" stop-color="#401527"/></linearGradient>
 <linearGradient id="hp-side" x1="0" y1="0" x2="1" y2=".5"><stop stop-color="#582235"/><stop offset="1" stop-color="#2b1726"/></linearGradient>
 <linearGradient id="hp-steel"><stop stop-color="#a69da5"/><stop offset=".35" stop-color="#fff6e8"/><stop offset=".6" stop-color="#d5c9c5"/><stop offset="1" stop-color="#8c7b89"/></linearGradient>
 <linearGradient id="hp-print-top" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4d7"/><stop offset="1" stop-color="#dec191"/></linearGradient>
 <radialGradient id="hp-sphere" cx=".3" cy=".25" r=".8"><stop stop-color="#fff5d9"/><stop offset=".4" stop-color="#d9b781"/><stop offset="1" stop-color="#805a4f"/></radialGradient>
 <radialGradient id="hp-softlight"><stop stop-color="#f0c984" stop-opacity=".16"/><stop offset="1" stop-color="#f0c984" stop-opacity="0"/></radialGradient>
 <filter id="hp-ground-shadow" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
 <filter id="hp-foot-shadow" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="2.5"/></filter>
 <filter id="hp-small-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
 </defs>`);
// The shadow is the projected ground footprint, with contact beneath each
// actual foot. No screen-space oval or second shadow around the whole artwork.
parts.push(`<ellipse cx="520" cy="380" rx="340" ry="285" fill="url(#hp-softlight)"/>`);
parts.push(poly([[2,2,-3],[348,2,-3],[348,258,-3],[2,258,-3]],'#250d1b','opacity=".23" filter="url(#hp-ground-shadow)" transform="translate(9 6)"'));
parts.push(poly([[8,8,-1],[342,8,-1],[342,252,-1],[8,252,-1]],'#220b17','opacity=".13" filter="url(#hp-small-shadow)"'));
for(const [x,y] of [[7,7],[321,7],[7,231],[321,231]])parts.push(poly([[x-2,y-2,-2],[x+25,y-2,-2],[x+25,y+25,-2],[x-2,y+25,-2]],'#210b17','opacity=".38" filter="url(#hp-foot-shadow)"'));
parts.push(poly([[-25,-18,44],[372,-18,44],[372,282,44],[-25,282,44]],'none','stroke="#e5c28e" stroke-opacity=".13" stroke-width="1.1" stroke-linejoin="round"'));

// Discrete 3D fabrication satellites: a CAD solid and material layer sample.
function satellite(x,y,kind,scale=1){
 const saved=[...origin]; origin[0]=0;origin[1]=0;
 let s=poly([[2,2,-9],[84,2,-9],[84,61,-9],[2,61,-9]],'#260d1d','opacity=".20" filter="url(#hp-small-shadow)"');
 s+=box(0,0,0,86,63,8,'dark');
 s+=poly([[5,5,8.5],[81,5,8.5],[81,58,8.5],[5,58,8.5]],'#773448','stroke="#bb7882" stroke-width=".8"');
 if(kind==='cad'){
   s+=box(26,18,9,32,28,34,'gold');
   s+=poly([[26,18,43],[58,18,43],[58,46,43],[26,46,43]],'#f4ddab');
   s+=line([26,18,43],[58,46,43],'#a97651',1)+line([58,18,43],[26,46,43],'#a97651',1);
   s+=line([19,18,12],[19,46,12],'#edc783',1,'stroke-dasharray="2 3"');
 }else if(kind==='layers'){
   for(const z of [14,26,38])s+=box(19,15,z,48,34,4,'gold');
   s+=line([14,48,12],[14,48,44],'#f3d59b',1,'stroke-dasharray="1 4" opacity=".65"');
 }else{
   // A completed toolpath tile, raised from its tray in the same 3D axes.
   s+=box(15,10,12,56,42,8,'body');
   s+=poly([[20,15,20.5],[66,15,20.5],[66,47,20.5],[20,47,20.5]],'#3a2534');
   s+=line([24,39,21],[33,29,21],'#f4dca7',3.4);
   s+=line([33,29,21],[42,36,21],'#f4dca7',3.4);
   s+=line([42,36,21],[60,19,21],'#f4dca7',3.4);
   s+=line([20,57,9],[45,57,9],'#d6b478',2,'opacity=".7"');
 }
 origin[0]=saved[0];origin[1]=saved[1]; return `<g class="hp-satellite" transform="translate(${x} ${y}) scale(${scale})">${s}</g>`;
}
parts.push(satellite(126,185,'cad',.82));
parts.push(satellite(132,512,'layers',.92));
parts.push(satellite(787,655,'toolpath',.95));
parts.push(`<path d="M90 412l38 18 47-12M846 539l44 20 35-9M114 598l27 12" stroke="#e9c489" stroke-opacity=".23" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="152" cy="234" r="10" fill="url(#hp-sphere)"/><circle cx="911" cy="554" r="7" fill="url(#hp-sphere)"/><circle cx="196" cy="624" r="5" fill="url(#hp-sphere)"/>`);

// Four real feet, a solid chassis and front control hardware.
for(const [x,y] of [[7,7],[321,7],[7,231],[321,231]])parts.push(box(x,y,-1,23,23,17,'dark'));
parts.push(box(0,0,16,350,260,28));
parts.push(box(4,4,44,342,252,7,'dark'));
parts.push(line([4,260,40],[346,260,40],'#e7c78d',1.1,'opacity=".7"'));
// Chassis vents, each lying on the same front plane.
for(let x=217;x<315;x+=10)parts.push(line([x,260,25],[x+5,260,33],'#211420',2.5));
parts.push(dot([34,260,30],3,'#9dd4b5')+dot([45,260,30],2,'#e6c587'));

// Back vertical structure and Z drive: rods meet actual lead-screw nuts and a bed bracket.
parts.push(extrusion(0,0,51,15,15,304));
parts.push(extrusion(335,0,51,15,15,304));
for(const x of [39,311]){
 parts.push(box(x-10,19,55,20,19,23,'dark'));
 parts.push(screw(x,28,77,325));
}
// Far enclosure panes sit behind the mechanism. The glass uses the same world
// planes as the extrusions, with only a light tint and static reflected light.
parts.push('<g class="hp-enclosure hp-enclosure-rear">');
parts.push(poly([[19,15.8,58],[331,15.8,58],[331,15.8,337],[19,15.8,337]],'#926579','fill-opacity=".04" stroke="#dbc6cd" stroke-opacity=".14" stroke-width=".8"'));
parts.push(poly([[15.8,18,58],[15.8,241,58],[15.8,241,337],[15.8,18,337]],'#886679','fill-opacity=".025" stroke="#dbc6cd" stroke-opacity=".1" stroke-width=".8"'));
parts.push(poly([[35,15.7,122],[65,15.7,138],[153,15.7,328],[124,15.7,328]],'#fff1e1','opacity=".035"'));
parts.push(line([25,15.6,332],[324,15.6,332],'#fff0e3',1,'opacity=".07"'));
parts.push('</g>');
parts.push(line([320,17,62],[320,17,322],'#a77382',2,'opacity=".25"'));

// Rear and side top beams support the Y linear guide rails.
parts.push(box(0,0,341,350,15,14));
parts.push(box(0,15,341,15,230,14));
parts.push(box(335,15,341,15,230,14));
for(const x of [24,326]){
 for(const y of [8,228])parts.push(box(x===24?0:317,y,287,33,32,14,'body'));
 parts.push(box(x-7,19,292,14,222,12,'dark'));
 parts.push(steelRod([x,22,305],[x,239,305],4));
 for(const y of [31,224])parts.push(box(x-9,y,282,18,13,12));
}
// The build surface is a bonded flexible plate on a substantial heated platform.
parts.push('<g class="hp-build-platform">');
for(const x of [39,311]){
 parts.push(box(x-8,20,100,16,16,17,'steel'));
 parts.push(box(x-10,22,88,20,47,13,'dark'));
}
parts.push(box(30,42,91,290,23,15,'dark'));
parts.push(box(42,57,84,15,150,14,'dark'));
parts.push(box(293,57,84,15,150,14,'dark'));
parts.push(box(28,30,98,294,203,13,'dark'));
parts.push(box(28,30,111,294,203,3,'gold'));
parts.push(poly([[34,36,114.6],[316,36,114.6],[316,227,114.6],[34,227,114.6]],'#382533'));
for(let x=55;x<310;x+=35)parts.push(line([x,37,115],[x,226,115],'#b98779',.8,'opacity=".13"'));
for(let y=50;y<225;y+=30)parts.push(line([35,y,115],[315,y,115],'#b98779',.8,'opacity=".13"'));
for(const [x,y]of [[39,43],[309,43],[39,221],[309,221]])parts.push(bolt(x,y,115,1.8));
parts.push(box(119,229,104,32,7,5,'steel'));

// A low branded build fixture, leaving room for functional products above it.
const block={x:105,y:95,z:116,w:100,d:90,h:43};
parts.push(poly([[104,94,115.5],[208,94,115.5],[225,196,115.5],[120,200,115.5],[100,183,115.5]],'#1d1120','opacity=".24"'));
parts.push(box(block.x-4,block.y-4,115,block.w+8,block.d+8,1.8,'gold'));
parts.push(box(block.x,block.y,block.z,block.w,block.d,block.h,'part'));
for(let z=120;z<157;z+=4){
 parts.push(line([205,95,z],[205,185,z],'#937452',.8,'opacity=".42"'));
 parts.push(line([105,185,z],[205,185,z],'#c9b7a5',.65,'opacity=".45"'));
}
// Shallow recessed front face leaves an uninterrupted, physically aligned logo surface.
parts.push(poly([[111,185.2,120],[199,185.2,120],[199,185.2,155],[111,185.2,155]],'#fffaf0'));
parts.push(poly([[113,185.3,122],[197,185.3,122],[197,185.3,153],[113,185.3,153]],'none','stroke="#d9bd98" stroke-width=".85"'));
parts.push(poly([[109,99,159],[201,99,159],[201,181,159],[109,181,159]],'#543645','stroke="#e8c99a" stroke-width="1.5"'));
for(let x=115;x<199;x+=10)parts.push(line([x,103,159],[x,177,159],'#b69476',.7,'opacity=".22"'));
for(let y=106;y<176;y+=10)parts.push(line([113,y,159],[197,y,159],'#b69476',.7,'opacity=".22"'));
parts.push('<g class="hp-product-slot"></g></g>');

// Material reel on a bracket mechanically attached to the back-right extrusion.
parts.push(box(335,-10,326,12,14,87,'dark'));
parts.push(steelRod([341,-3,407],[341,-39,407],7));
// Reel faces lie in the X/Z plane and inherit its oblique projection.
const spoolCenter=P(341,-30,407);
parts.push(`<g transform="matrix(${axes.xAxis[0]} ${axes.xAxis[1]} 0 -1 ${pt(spoolCenter).replace(',',' ')})">
 <ellipse cx="-5" cy="0" rx="45" ry="45" fill="#321a29" stroke="#af7881" stroke-width="2"/>
 <circle r="41" fill="#803448" stroke="#dcaf76" stroke-width="3"/>
 ${[18,23,28,33,37].map(r=>`<circle r="${r}" stroke="#d4a16c" stroke-width="1.4" fill="none" opacity=".8"/>`).join('')}
 <circle r="44" fill="none" stroke="#fae3ae" stroke-width="7"/>
 ${[0,120,240].map(a=>`<path d="M11 0L35 0" transform="rotate(${a})" stroke="#ead5b2" stroke-width="8" stroke-linecap="round"/>`).join('')}
 <circle r="11" fill="#392030" stroke="#f3d494" stroke-width="5"/><circle r="3" fill="#1b1320"/>
 </g>`);
const feeder=P(316,2,334), spoolExit=P(302,-30,407);
parts.push(`<path d="M${pt(spoolExit)}C${pt([spoolExit[0]-15,spoolExit[1]+58])} ${pt([feeder[0]-17,feeder[1]-28])} ${pt(feeder)}" stroke="#281725" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M${pt(spoolExit)}C${pt([spoolExit[0]-15,spoolExit[1]+58])} ${pt([feeder[0]-17,feeder[1]-28])} ${pt(feeder)}" stroke="#e8d5ba" stroke-width="3" fill="none" stroke-linecap="round"/>`);
parts.push(box(302,-1,328,27,21,21,'dark'));
parts.push(dot([310,20,339],3,'#e4be7b'));

// X gantry is a distinct Y-translating assembly. Both ends sit on side guides.
const head={x:146,y:170,z:225};
parts.push('<g id="hp-gantry" class="hp-gantry">');
for(const x of [24,326]){
 parts.push(box(x-10,head.y-18,282,20,36,20,'body'));
 parts.push(box(x-7,head.y-14,302,14,28,5,'steel'));
 parts.push(bolt(x,head.y+7,307,2));
}
parts.push(box(24,head.y-7,282,302,14,14,'dark'));
parts.push(steelRod([26,head.y,299],[324,head.y,299],5));
parts.push(steelRod([26,head.y+8,284],[324,head.y+8,284],4));
parts.push(line([29,head.y+15,288],[321,head.y+15,288],'#1d1420',4));
parts.push(line([29,head.y+15,288],[321,head.y+15,288],'#b48b73',.7,'stroke-dasharray="1 4"'));
for(const x of[29,321])parts.push(dot([x,head.y+15,288],5.5,'#70616a')+dot([x,head.y+15,288],2.2,'#d5c1ac'));
parts.push('</g>');

// Fresh filament path stays on the top surface. Controller reveals it cumulatively.
const contour=[[0,0],[78,0],[78,-63],[0,-63],[0,0],[8,0],[8,-58],[16,-58],[16,-4],[24,-4],[24,-58],[32,-58],[32,-4],[40,-4],[40,-58],[48,-58],[48,-4],[56,-4],[56,-58],[64,-58],[64,-4],[72,-4],[72,-58],[78,-58],[78,0],[0,0]];
const printPath=contour.map(([dx,dy],i)=>(i?'L':'M')+pt(P(head.x+dx,head.y+dy,head.z+.8))).join('');
parts.push(`<path id="hp-deposition-path" class="hp-deposition-path" pathLength="100" d="${printPath}" stroke="#f6d891" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".95"/>`);

// Feed hose joins a fixed guide and the actual inlet on the moving toolhead.
const inlet=P(head.x,head.y,311);
const feed={start:feeder,end:inlet,control1:[feeder[0]-50,feeder[1]-116],control2:[inlet[0]+8,inlet[1]-90]};
const feedD=`M${pt(feed.start)}C${pt(feed.control1)} ${pt(feed.control2)} ${pt(feed.end)}`;
parts.push(`<g><path class="hp-filament-flex" d="${feedD}" stroke="#271824" stroke-width="9" fill="none" stroke-linecap="round"/><path class="hp-filament-flex" d="${feedD}" stroke="#e1d4bd" stroke-width="5.5" fill="none" stroke-linecap="round"/><path class="hp-filament-flex" d="${feedD}" stroke="#fff2d6" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>`);

// The carriage clamps to the X guides; heatsink and brass nozzle reach the print.
parts.push('<g id="hp-printhead" class="hp-printhead">');
parts.push(box(head.x-17,head.y-10,287,34,20,17,'steel'));
parts.push(box(head.x-22,head.y-16,254,44,36,43));
parts.push(box(head.x-13,head.y-2,241,26,19,13,'dark'));
for(const z of[244,248,252])parts.push(box(head.x-10,head.y-3,z,20,17,2,'steel'));
parts.push(box(head.x-7,head.y-5,233,14,12,8,'gold'));
parts.push(poly([[head.x-5,head.y-5,233],[head.x+5,head.y-5,233],[head.x,head.y,225]],'#f3d58e'));
parts.push(poly([[head.x+5,head.y-5,233],[head.x+5,head.y+5,233],[head.x,head.y,225]],'#a76d3d'));
parts.push(poly([[head.x-5,head.y+5,233],[head.x+5,head.y+5,233],[head.x,head.y,225]],'#d6aa63'));
parts.push(box(head.x-5,head.y-5,297,10,10,14,'dark'));
parts.push(steelRod([head.x,head.y,307],[head.x,head.y,313],4));
// Front fan is rotated locally, before the face's projection is applied.
const fan=P(head.x,head.y+20.25,277);
parts.push(`<g transform="matrix(${axes.xAxis[0]} ${axes.xAxis[1]} 0 1 ${pt(fan).replace(',',' ')})"><circle r="14.5" fill="#201824" stroke="#b87b82" stroke-width="1.5"/><circle r="11.5" fill="#54414b"/><g class="hp-fan">${[0,90,180,270].map(a=>`<path d="M-2-2C-13-14 4-15 5-4L1 2Z" transform="rotate(${a})" fill="#d1b9a5"/>`).join('')}</g><circle r="3.3" fill="#e9d6b7"/><path d="M-15-15L15 15M15-15L-15 15" stroke="#31202e" stroke-width="1.7" opacity=".55"/></g>`);
parts.push(bolt(head.x-17,head.y+20.3,291,1.3)+bolt(head.x+17,head.y+20.3,258,1.3));
const nozzle=P(head.x,head.y,225);
parts.push(`<ellipse class="hp-contact" cx="${n(nozzle[0])}" cy="${n(nozzle[1])}" rx="2.7" ry="1.25" fill="#e8bc71"/>`);
parts.push('</g>');

// Clear side pane and front access door. These paint ahead of the mechanism,
// behind the frame; low-opacity bands suggest glass without veiling the print.
// No glass filters, blur or animation: reflections are lightweight polygons.
parts.push('<g class="hp-enclosure hp-enclosure-near">');
parts.push(poly([[349.5,18,54],[349.5,242,54],[349.5,242,337],[349.5,18,337]],'#704455','fill-opacity=".045" stroke="#d9c3c7" stroke-opacity=".2" stroke-width=".85"'));
parts.push(poly([[349.6,27,91],[349.6,49,105],[349.6,121,329],[349.6,100,329]],'#fff0dc','opacity=".05"'));
parts.push(poly([[349.6,204,67],[349.6,213,67],[349.6,234,168],[349.6,225,171]],'#fff0dc','opacity=".035"'));
parts.push(line([349.7,23,332],[349.7,236,332],'#fff1e4',1.1,'opacity=".07"'));
parts.push(poly([[18,259.5,54],[332,259.5,54],[332,259.5,337],[18,259.5,337]],'#976476','fill-opacity=".028" stroke="#dbc6c7" stroke-opacity=".2" stroke-width=".9"'));
parts.push(poly([[26,259.6,157],[53,259.6,177],[103,259.6,329],[77,259.6,329]],'#fff0df','opacity=".048"'));
parts.push(poly([[257,259.6,63],[267,259.6,63],[327,259.6,227],[327,259.6,256]],'#fff0df','opacity=".035"'));
parts.push(line([24,259.7,332],[326,259.7,332],'#fff4e6',1.1,'opacity=".07"'));
parts.push(line([22,259.7,61],[328,259.7,61],'#e6c8c5',.7,'opacity=".2"'));
for(const y of [27,233])for(const z of [68,323])parts.push(bolt(349.9,y,z,1.35));
for(const x of [25,325])for(const z of [64,329])parts.push(bolt(x,259.9,z,1.2));
parts.push('</g>');

// Front posts and top crossmember complete the exact same four-corner frame.
parts.push(extrusion(0,245,51,15,15,290));
parts.push(extrusion(335,245,51,15,15,290));
parts.push(box(0,245,341,350,15,14));
for(const x of[8,342])for(const z of[63,329,348])parts.push(bolt(x,260,z,2));
parts.push(line([19,260,348],[331,260,348],'#edd6b6',1,'opacity=".6"'));
// Interior corner gussets visibly fasten the open frame into a rigid square.
parts.push(poly([[15,246,339],[43,246,339],[15,246,310]],'#582335','stroke="#af7880" stroke-width=".7"'));
parts.push(poly([[335,246,339],[307,246,339],[335,246,310]],'#582335','stroke="#af7880" stroke-width=".7"'));
parts.push(bolt(23,246.2,332,1.5)+bolt(327,246.2,332,1.5));

// Hinges bridge the left extrusion and door; the handle stands off the glass.
parts.push('<g class="hp-enclosure-hardware">');
for(const z of [99,282]){
 parts.push(box(7,260.3,z,20,4.5,24,'dark'));
 parts.push(box(13,264.8,z+1,5,3.5,22,'steel'));
 parts.push(bolt(10,265,z+5,1.2)+bolt(24,265,z+19,1.2));
}
for(const z of [174,215])parts.push(box(302,259.8,z,11,11,6,'dark'));
parts.push(box(305,269,174,6,5,47,'dark'));
parts.push(line([311,274.2,180],[311,274.2,216],'#c7af97',1.15,'opacity=".75"'));
parts.push('</g>');

// A mounted control panel uses the front plane and attaches to the chassis.
parts.push(box(266,255,58,52,17,57,'dark'));
parts.push(poly([[271,272.3,68],[312,272.3,68],[312,272.3,108],[271,272.3,108]],'#233a3b','stroke="#b49680" stroke-width="1"'));
parts.push(line([276,272.5,100],[301,272.5,100],'#f4e4c7',2.2));
parts.push(line([276,272.5,93],[287,272.5,93],'#a8cec2',1.5));
parts.push(line([276,272.5,82],[305,272.5,82],'#162a2b',3.4));
parts.push(line([276,272.6,82],[296,272.6,82],'#d7b776',3.4));
parts.push(dot([306,272.5,96],2,'#bddacb'));
parts.push(dot([301,273,72],2.2,'#ccb291'));

// Two supported process monitors. Their casings, bracket arms and UI all use
// the front-face projection; their readings describe the illustrative layer.
function monitor(x,y,z,w,h,kind){
 let s=box(x,y,z,w,12,h,'dark');
 s+=line([x+3,y+12,z+h-3],[x+w-3,y+12,z+h-3],'#c5918b',1.3);
 const corner=P(x+7,y+12.2,z+h-7);
 const innerW=w-14,innerH=h-14;
 s+=`<g class="hp-process-monitor hp-monitor-${kind}" transform="matrix(${axes.xAxis[0]} ${axes.xAxis[1]} 0 1 ${pt(corner).replace(',',' ')})" font-family="Montserrat,Arial,sans-serif">
 <rect class="hp-screen-background" width="${innerW}" height="${innerH}" rx="3" fill="#241b29" stroke="#98786f" stroke-width="1"/>
 <path class="hp-screen-header" d="M3 3H${innerW-3}V18H3Z" fill="#442637"/>
 <circle cx="9" cy="10" r="2.2" fill="#bdd8c4"/>
 <text x="16" y="13" fill="#f5e6cd" font-size="8" font-weight="700">${kind==='progress'?'FMRC / PRINT':'XY TOOLPATH'}</text>`;
 if(kind==='progress'){
   s+=`<text class="hp-screen-product-name" x="10" y="32" fill="#d8c8bf" font-size="7" letter-spacing=".3">BUILD QUEUE</text>
    <text class="hp-screen-progress" x="10" y="58" fill="#f1d59e" font-size="23" font-weight="700">0%</text>
    <g class="hp-screen-product"></g>
    <rect x="10" y="71" width="104" height="6" rx="3" fill="#57404c"/>
    <rect class="hp-screen-fill" x="10" y="71" width="0" height="6" rx="3" fill="#e1be7d"/>
    <text class="hp-screen-phase" x="10" y="91" fill="#c4d4ca" font-size="7">PRINTING</text>
    <text class="hp-screen-queue" x="113" y="91" text-anchor="end" fill="#f1d59e" font-size="7">1/5</text>`;
 }else{
   s+=`<path d="M10 28H75M10 40H75M10 52H75M22 24V58M42 24V58M62 24V58" stroke="#54424f" stroke-width=".6"/>
    <path class="hp-screen-toolpath" d="M13 55H72V27H13Z" fill="none" stroke="#b49369" stroke-width="1.25" stroke-linejoin="round"/>
    <circle class="hp-screen-cursor" cx="13" cy="55" r="3" fill="#f7db9d" stroke="#fff1d9" stroke-width=".8"/>
    <text x="10" y="65" fill="#bfaeb5" font-size="6.5" letter-spacing=".3">LAYER TRACE</text>`;
 }
 s+='</g>';
 s+=bolt(x+3,y+12.4,z+3,1.1)+bolt(x+w-3,y+12.4,z+3,1.1);
 return `<g class="hp-mounted-monitor">${s}</g>`;
}
// Main status monitor attaches outside the rear-right post, clear of the bed.
parts.push(box(337,7,236,40,15,13,'body'));
parts.push(box(360,11,223,12,15,38,'steel'));
parts.push(bolt(347,22.3,242,2.5));
parts.push(line([347,12,236],[347,12,68],'#2a1a28',3));
parts.push(monitor(366,16,190,142,115,'progress'));
// The smaller tracing monitor is clamped to the outside of the front-left post.
parts.push(box(-25,247,145,38,13,12,'body'));
parts.push(box(-27,246,133,10,15,36,'steel'));
parts.push(bolt(7,260.4,151,2.5));
parts.push(line([4,259,143],[4,259,66],'#2a1a28',2.4));
parts.push(monitor(-118,250,110,100,83,'trace'));

const logoCenter=P(155,185.5,137.5);
const metadata={
 projection:{...axes,origin},
 build:{center:[155,140],baseZ:159,layerCount:24,nozzleZ:225,head:[146,170],park:[80,105]},
 nozzle:nozzle.map(n),
 feed:Object.fromEntries(Object.entries(feed).map(([k,v])=>[k,v.map(n)])),
 toolpath:contour,
 logo:{x:n(logoCenter[0]),y:n(logoCenter[1]),width:29,height:29,skewY:n(Math.atan2(axes.xAxis[1],axes.xAxis[0])*180/Math.PI),matrix:[...axes.xAxis,0,1,0,0]},
 logoFace:[[111,185.2,120],[199,185.2,120],[199,185.2,155],[111,185.2,155]].map(v=>project(v).map(n)),
 partTop:[[105,95,225],[205,95,225],[205,185,225],[105,185,225]].map(v=>project(v).map(n)),
 frameClearance:{topZ:341,headTopZ:313,partTopZ:225,headTravelX:[120,190],headTravelY:[105,175]},
 machine:{width:350,depth:260,top:355,bed:115,partTop:159},
};
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 760" fill="none" aria-hidden="true">\n<metadata id="hp-mechanics">${JSON.stringify(metadata)}</metadata>\n${parts.join('\n')}\n</svg>\n`;
fs.writeFileSync(path.resolve(__dirname,'../../home-page/assets/hero-printer-scene.svg'),svg);
console.log(JSON.stringify({output:'home-page/assets/hero-printer-scene.svg',bytes:Buffer.byteLength(svg),metadata},null,2));

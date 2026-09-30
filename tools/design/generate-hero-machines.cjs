/* Original FMRC laser/CNC artwork. Same projection and material palette as
 * generate-hero-printer.cjs. Run: node tools/design/generate-hero-machines.cjs */
const fs = require('node:fs');
const path = require('node:path');
const origin = [514, 452], xAxis = [.86, .4], yAxis = [-1.08, .28];
const P = (x, y, z = 0) => [origin[0] + x*xAxis[0] + y*yAxis[0], origin[1] + x*xAxis[1] + y*yAxis[1] - z];
const n = v => +v.toFixed(2), pt = p => p.map(n).join(',');
const poly = (points, fill, extra='') => `<polygon points="${points.map(p=>pt(P(...p))).join(' ')}" fill="${fill}" ${extra}/>`;
const line = (a,b,color,width=1,extra='') => `<path d="M${pt(P(...a))}L${pt(P(...b))}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" ${extra}/>`;
const dot = (p,r,fill,extra='') => `<circle cx="${n(P(...p)[0])}" cy="${n(P(...p)[1])}" r="${r}" fill="${fill}" ${extra}/>`;
const materials = {
  body:['url(#hm-top)','url(#hm-front)','url(#hm-side)'],
  dark:['#42303b','#211924','#30212d'], steel:['#f0e9df','#b5a4a3','#817882'],
  gold:['#f4d998','#c18b4c','#9e623b'], wood:['#e6c59c','#ba8b60','#946341']
};
function box(x,y,z,w,d,h,material='body',extra='') {
  const [top,front,side]=materials[material];
  return `<g ${extra}>`+poly([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]],side)
    +poly([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]],front)
    +poly([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],top)
    +line([x,y,z+h],[x+w,y,z+h],'#fff0d3',.7,'opacity=".38"')
    +line([x,y+d,z+h],[x+w,y+d,z+h],'#ffe6bf',.85,'opacity=".52"')+'</g>';
}
const rod=(a,b)=>line(a,b,'#44323f',9)+line(a,b,'url(#hm-steel)',5)+line(a,b,'#fff6e8',1);
function bolt(x,y,z) { return dot([x,y,z],3,'#201723')+dot([x,y,z],1.9,'#d1c1b5'); }
function cylinder(x,y,z,r,h,fill='url(#hm-steel)') {
  const ring=Array.from({length:32},(_,i)=>{const a=i/32*Math.PI*2;return [x+Math.cos(a)*r,y+Math.sin(a)*r];});
  let s='';
  ring.forEach((p,i)=>{
    const b=ring[(i+1)%ring.length];
    if((b[1]-p[1])*.4-(b[0]-p[0])*.28<=0)return;
    const light=.5+.5*Math.cos(i/32*Math.PI*2-1.7);
    const channel=Math.round(137+103*light);
    const chrome=`rgb(${channel},${channel-7},${channel-9})`;
    s+=poly([[...p,z],[...b,z],[...b,z+h],[...p,z+h]],fill==='url(#hm-steel)'?chrome:fill);
  });
  return s+poly(ring.map(p=>[...p,z+h]),'#e6dcd1','stroke="#8e828b" stroke-width=".7"');
}
function rounded(points, radius=3) {
  const vertices=points.slice(0,-1),out=[];
  vertices.forEach((b,i)=>{
    const a=vertices[(i+vertices.length-1)%vertices.length],c=vertices[(i+1)%vertices.length];
    const dab=Math.hypot(b[0]-a[0],b[1]-a[1]),dbc=Math.hypot(c[0]-b[0],c[1]-b[1]);
    const r=Math.min(radius,dab*.3,dbc*.3);
    const start=b.map((v,j)=>v+(a[j]-v)*r/dab),end=b.map((v,j)=>v+(c[j]-v)*r/dbc);
    for(let k=0;k<=6;k++){const t=k/6;out.push(b.map((v,j)=>(1-t)**2*start[j]+2*(1-t)*t*v+t*t*end[j]));}
  });
  return [...out,out[0]];
}
const circle=(x,y,r)=>Array.from({length:65},(_,i)=>[x+Math.cos((i%64)/64*Math.PI*2)*r,y+Math.sin((i%64)/64*Math.PI*2)*r]);
const rectangle=(x0,y0,x1,y1,r=5)=>rounded([[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]],r);
function productsFor(laser) {
  const gear=rounded(Array.from({length:49},(_,i)=>{const a=(i%48)/48*Math.PI*2,r=[62,62,51,51][i%4];return [175+Math.cos(a)*r,147+Math.sin(a)*r];}),2);
  const star=rounded(Array.from({length:11},(_,i)=>{const a=i/10*Math.PI*2-Math.PI/2,r=i%2?29:61;return [175+Math.cos(a)*r,147+Math.sin(a)*r];}),2);
  const hex=rounded(Array.from({length:7},(_,i)=>[175+Math.cos(i/6*Math.PI*2)*64,147+Math.sin(i/6*Math.PI*2)*64]),4);
  const make=(id,name,outer,holes=[])=>({id,name,outer,holes});
  const hole=(loop,depth)=>({loop,depth});
  return laser ? [
    make('key-tag','KEY TAG',rectangle(112,112,241,183,16),[hole(circle(129,147,7),4)]),
    make('coaster','COASTER',circle(175,147,59)),
    make('star-ornament','STAR ORNAMENT',star,[hole(circle(175,108,5),4)]),
    make('nameplate','NAMEPLATE',rectangle(99,118,251,176,6),[hole(circle(111,147,4),4),hole(circle(239,147,4),4)]),
    make('geometric-stencil','GEO STENCIL',hex,[hole(circle(153,135,12),4),hole(circle(197,135,12),4),hole(rectangle(156,160,194,178,4),4)])
  ] : [
    make('gear','WOOD GEAR',gear,[hole(circle(175,147,14),14)]),
    make('catchall-tray','CATCHALL TRAY',rectangle(109,91,241,203,14),[hole(rectangle(121,103,229,191,12),8)]),
    make('phone-dock','PHONE DOCK',rectangle(106,109,244,187,8),[hole(rectangle(122,137,228,151,6),9),hole(circle(175,171,6),14)]),
    make('desk-organizer','DESK ORGANIZER',hex,[hole(circle(152,135,16),10),hole(circle(198,135,16),10),hole(circle(175,174,16),10)]),
    make('wave-sign','WAVE SIGN',rectangle(106,103,244,191,9),[hole(rounded([[121,150],[141,124],[169,160],[194,127],[229,151],[224,161],[196,142],[170,175],[141,139],[128,158],[121,150]],3),3)])
  ];
}
function finishedProduct(product,z,thickness) {
  const outer=product.outer,top=loop=>loop.map((p,i)=>(i?'L':'M')+pt(P(...p,z))).join(' ')+'Z';
  let sides='';
  for(let i=0;i<outer.length-1;i++) {
    const a=outer[i],b=outer[i+1];
    if((b[1]-a[1])*.4-(b[0]-a[0])*.28>0)sides+=poly([[...a,z-thickness],[...b,z-thickness],[...b,z],[...a,z]],b[1]>a[1]?'#946341':'#ba8b60');
  }
  let s=sides+`<path d="${[outer,...product.holes.map(h=>h.loop)].map(top).join(' ')}" fill="#e6c59c" fill-rule="evenodd" stroke="#c79869" stroke-width=".6"/>`;
  for(const h of product.holes) {
    if(h.depth<thickness)s+=poly(h.loop.map(p=>[...p,z-h.depth]),'#ba9065');
    for(let i=0;i<h.loop.length-1;i++) {
      const a=h.loop[i],b=h.loop[i+1];
      if((b[1]-a[1])*.4-(b[0]-a[0])*.28<0)s+=poly([[...a,z],[...b,z],[...b,z-h.depth],[...a,z-h.depth]],'#8a603e');
    }
  }
  return s;
}
const defs=`<defs>
  <linearGradient id="hm-top" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b7757f"/><stop offset=".45" stop-color="#8a3d51"/><stop offset="1" stop-color="#672638"/></linearGradient>
  <linearGradient id="hm-front" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#863347"/><stop offset=".6" stop-color="#632237"/><stop offset="1" stop-color="#401527"/></linearGradient>
  <linearGradient id="hm-side" x1="0" y1="0" x2="1" y2=".5"><stop stop-color="#582235"/><stop offset="1" stop-color="#2b1726"/></linearGradient>
  <linearGradient id="hm-steel"><stop stop-color="#a69da5"/><stop offset=".35" stop-color="#fff6e8"/><stop offset=".6" stop-color="#d5c9c5"/><stop offset="1" stop-color="#8c7b89"/></linearGradient>
  <filter id="hm-shadow" x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <radialGradient id="hm-glow"><stop class="hm-worklight-stop" stop-color="#80d8f4" stop-opacity=".22"/><stop class="hm-worklight-stop" offset="1" stop-color="#80d8f4" stop-opacity="0"/></radialGradient>
</defs>`;
function build(type) {
  const laser=type==='laser', parts=[defs];
  const thickness=laser?4:14,stockBase=laser?98:104,cutZ=stockBase+thickness, head=[175,150], park=[68,62];
  const products=productsFor(laser);
  // Closed world-space toolpaths drive both the visible cut and the head.
  const contour=products[0].outer;
  const toolpath=contour.map(p=>P(...p,cutZ));
  parts.push(poly([[0,0,0],[380,0,0],[380,290,0],[0,290,0]],'#250d1b','opacity=".25" filter="url(#hm-shadow)" transform="translate(8 8)"'));
  for(const [x,y] of [[10,10],[343,10],[10,252],[343,252]]) parts.push(box(x,y,0,27,27,25,'dark'));
  parts.push(box(0,0,24,380,290,53));
  parts.push(box(14,14,77,352,260,14,'dark'));
  // A recessed machine bed with a real slat grid, retaining the printer's trim.
  for(let y=22;y<270;y+=14) parts.push(box(22,y,91,336,3,7,'steel'));
  if(!laser)parts.push(box(60,63,98,230,174,6,'wood')); // Sacrificial spoilboard protects the metal bed.
  parts.push('<g class="hm-stock">');
  parts.push(box(72,73,stockBase,206,154,thickness,'wood'));
  if(!laser) for(let y=82;y<221;y+=10) parts.push(line([76,y,cutZ+.1],[274,y+2,cutZ+.1],'#a8764b',.7,'opacity=".35"'));
  parts.push('</g>');
  parts.push('<g class="hm-products">');
  products.forEach((product,i)=>parts.push(`<g class="hm-finished-product" data-product-index="${i}" opacity="0">${finishedProduct(product,cutZ,thickness)}</g>`));
  parts.push('</g>');
  // Four stock clamps and their fasteners.
  for(const [x,y] of [[65,85],[266,85],[65,201],[266,201]]) {
    parts.push(cylinder(x+6,y+5,98,2,cutZ-98+8,'#817882'));
    parts.push(box(x,y,cutZ,22,12,6,'steel'));parts.push(bolt(x+6,y+5,cutZ+7));
  }
  const d=toolpath.map((p,i)=>(i?'L':'M')+pt(p)).join(' ');
  parts.push(`<g class="hm-cut" stroke="${laser?'#4e2d25':'#795030'}" stroke-width="${laser?2:5}" stroke-linejoin="round" stroke-linecap="round">${Array.from({length:12},(_,i)=>`<path class="hm-cut-operation" d="${i?'':d}"/>`).join('')}</g>`);
  // Longitudinal guideways, rear enclosure and carriage beam.
  parts.push(box(10,10,92,25,270,24),box(343,10,92,25,270,24));
  parts.push(rod([23,25,120],[23,260,120]),rod([355,25,120],[355,260,120]));
  if(laser) {
    parts.push(box(0,0,80,380,30,189));
    for(let x=35;x<330;x+=16) parts.push(line([x,30.3,234],[x,30.3,252],'#321727',4));
    parts.push(line([25,32,249],[351,32,249],'#80d8f4',3,'class="hm-worklight-lens"'));
    parts.push(poly([[25,35,246],[351,35,246],[300,230,113],[65,230,113]],'url(#hm-glow)','class="hm-worklight-beams"'));
  } else {
    parts.push(box(9,2,116,28,28,29,'dark'),box(341,2,116,28,28,29,'dark'));
    parts.push(rod([24,31,128],[24,262,128]),rod([355,31,128],[355,262,128]));
    for(let y=36;y<260;y+=6) {
      parts.push(line([21,y,129],[27,y+2,129],'#72616e',1));
      parts.push(line([352,y,129],[358,y+2,129],'#72616e',1));
    }
  }
  parts.push('<g class="hm-gantry">');
  parts.push(box(13,head[1]-12,119,24,24,95),box(342,head[1]-12,119,24,24,95));
  parts.push(box(9,head[1]-19,115,32,38,17,'steel'),box(338,head[1]-19,115,32,38,17,'steel'));
  parts.push(box(13,head[1]-12,214,353,24,23));
  parts.push(rod([36,head[1]+13,226],[343,head[1]+13,226]));
  parts.push(box(341,head[1]-7,233,31,24,25,'dark'));
  parts.push(line([38,head[1]+13,232],[338,head[1]+13,232],'#30232d',2));
  for(let x=42;x<338;x+=8)parts.push(line([x,head[1]+13,231],[x+2,head[1]+13,233],'#aa9199',.8));
  parts.push(line([39,head[1]+13,217],[340,head[1]+13,217],'var(--hero-scene-accent, #e6c46c)',2));
  for(const x of [21,356]) parts.push(bolt(x,head[1]+12.4,226));
  if(!laser) {
    // Task lighting follows the crossrail, independently of the cutting bit.
    parts.push(line([39,head[1]+14,213],[340,head[1]+14,213],'#80d8f4',3,'class="hm-worklight-lens"'));
    parts.push(poly([[39,head[1]+15,211],[340,head[1]+15,211],[300,head[1]+45,cutZ+1],[65,head[1]+45,cutZ+1]],'url(#hm-glow)','class="hm-worklight-beams"'));
  }
  parts.push('</g>');
  parts.push('<g class="hm-head">');
  parts.push(box(head[0]-22,head[1]-8,187,44,28,55));
  parts.push(bolt(head[0]-15,head[1]+20.2,232),bolt(head[0]+15,head[1]+20.2,232));
  if(!laser) {
    parts.push(box(head[0]-19,head[1]-8,155,38,13,89,'dark'));
    parts.push(rod([head[0]-15,head[1]+7,161],[head[0]-15,head[1]+7,233]),rod([head[0]+15,head[1]+7,161],[head[0]+15,head[1]+7,233]));
    parts.push(box(head[0]-14,head[1]-7,242,28,22,27,'dark'));
    parts.push(rod([head[0],head[1]+8,168],[head[0],head[1]+8,242]));
    for(let z=170;z<239;z+=5)parts.push(line([head[0]-2,head[1]+8,z],[head[0]+2,head[1]+8,z+2],'#685968',1));
  }
  // The XY carriage stays on the crossrail; only the CNC's Z-slide plunges.
  parts.push('<g class="hm-tool">');
  if(laser) {
    parts.push(cylinder(head[0],head[1],154,11,38));
    parts.push(poly([[head[0]-9,head[1]-6,154],[head[0]+9,head[1]-6,154],[head[0],head[1],141]],'#ab7c49'));
    parts.push(poly([[head[0]-9,head[1]+6,154],[head[0]+9,head[1]+6,154],[head[0],head[1],141]],'#d0a467'));
    parts.push(line([head[0],head[1],141],[head[0],head[1],cutZ],'#f7bd77',1.5,'class="hm-tool-light"'));
    parts.push(dot([...head,cutZ],5,'#ffc781','class="hm-tool-light" opacity=".22"'),dot([...head,cutZ],1.8,'#fff4d7','class="hm-tool-light"'));
  } else {
    parts.push(cylinder(head[0],head[1],cutZ+38,15,52));
    parts.push(box(head[0]-18,head[1]-15,172,36,30,9,'steel'));
    parts.push(bolt(head[0]-12,head[1]+15.2,177),bolt(head[0]+12,head[1]+15.2,177));
    parts.push(cylinder(head[0],head[1],cutZ+20,8,18,'#403540'));
    parts.push(rod([head[0],head[1],cutZ+20],[head[0],head[1],cutZ]));
    parts.push(line([head[0]-2,head[1],cutZ+1],[head[0]+2,head[1],cutZ+12],'#efd7aa',1.5,'class="hm-spindle-glint"'));
    parts.push(dot([head[0],head[1],cutZ],6,'#f1d497','class="hm-tool-light" opacity=".12"'));
  }
  parts.push('</g></g>');
  // Flexible cable from the back panel to the carriage, updated with the head.
  const cableStart=P(350,20,laser?255:149),cableEnd=P(head[0],head[1],laser?242:269);
  parts.push(`<path class="hm-cable" d="M${pt(cableStart)}Q${pt(P(220,60,laser?260:300))} ${pt(cableEnd)}" stroke="#352433" stroke-width="6" stroke-linecap="round"/>`);
  // Laser shown working through its closed, lightly tinted inspection window.
  if(laser) {
    // 270 mm lid height clears the 242 mm tool carriage throughout XY travel.
    parts.push(poly([[6,30,270],[374,30,270],[374,283,270],[6,283,270]],'#d7b981','fill-opacity=".04" stroke="#dcbf9c" stroke-opacity=".55" stroke-width="2"'));
    parts.push(poly([[6,283,140],[374,283,140],[374,283,270],[6,283,270]],'#b7a28b','fill-opacity=".05" stroke="#dcbf9c" stroke-opacity=".35"'));
    parts.push(poly([[374,30,82],[374,283,140],[374,283,270],[374,30,270]],'#b7a28b','fill-opacity=".045" stroke="#dcbf9c" stroke-opacity=".3"'));
    parts.push(line([6,30,270],[6,283,270],'#8e5360',7),line([374,30,270],[374,283,270],'#8e5360',7));
    parts.push(line([6,283,140],[6,283,270],'#8e5360',7),line([374,283,140],[374,283,270],'#8e5360',7));
    parts.push(line([6,283,270],[374,283,270],'#ad7580',5));
    parts.push(box(0,279,78,380,11,62));
    parts.push(line([150,291,126],[229,291,126],'url(#hm-steel)',6));
    parts.push(line([45,48,270.2],[95,100,270.2],'#fff3dc',1,'opacity=".3"'));
  }
  // Front badge, corner hardware and an accent indicator use existing colors.
  for(const x of [12,368]) parts.push(bolt(x,290.2,49));
  for(let x=42;x<116;x+=8)parts.push(line([x,290.2,40],[x,290.2,57],'#301422',3));
  parts.push(dot([342,290.4,52],6,'#2a1923'),dot([342,290.5,52],4,'#b94341'),dot([354,290.5,52],2,'#9ed1ae'));
  const logo=P(180,290.5,52);
  parts.push(`<g transform="matrix(.86 .4 0 1 ${pt(logo)})"><rect x="-26" y="-17" width="52" height="34" rx="3" fill="#f8edda"/><image class="hm-logo" href="/images/FMRC%20Logo.png" x="-14" y="-14" width="28" height="28"/></g>`);
  parts.push(line([255,290.4,58],[327,290.4,58],'var(--hero-scene-accent, #e6c46c)',2));
  // Touchscreen mounted beside the work area, never over the cutting path.
  parts.push(box(377,20,78,14,22,98,'steel'),box(375,15,159,111,17,100));
  const screen=P(381,32.2,248);
  parts.push(`<g transform="matrix(.86 .4 0 1 ${pt(screen)})">
    <rect class="hm-screen-background" width="98" height="83" rx="3" fill="#211b2b" stroke="#bd8a86"/>
    <rect class="hm-screen-header" x="4" y="4" width="90" height="14" rx="2" fill="#643345"/>
    <text x="9" y="14" fill="#fff0d9" font-family="Arial,sans-serif" font-size="7" letter-spacing=".5">${laser?'LASER / ENGRAVE':'CNC / ROUTER'}</text>
    <text class="hm-product-name" x="10" y="26" fill="#efd9b7" font-family="Arial,sans-serif" font-size="5.5">${products[0].name}</text>
    <path class="hm-screen-outline" d="${contour.map((p,i)=>(i?'L':'M')+pt([10+(p[0]-95)*.23,29+(p[1]-90)*.22])).join(' ')}" stroke="#715061"/>
    <g class="hm-screen-trace" stroke="#e6c46c" stroke-width="1.4">${Array.from({length:12},()=>'<path class="hm-screen-operation" d=""/>').join('')}</g>
    <text class="hm-progress" x="58" y="43" fill="#f5d8a5" font-family="Arial,sans-serif" font-size="14">100%</text>
    <text class="hm-phase" x="10" y="66" fill="#a9d7c3" font-family="Arial,sans-serif" font-size="6">COMPLETE</text>
    <text class="hm-queue" x="88" y="66" text-anchor="end" fill="#efd9b7" font-family="Arial,sans-serif" font-size="6">1/5</text>
    <rect x="10" y="73" width="78" height="3" rx="1.5" fill="#473347"/>
    <rect class="hm-progress-fill" x="10" y="73" width="78" height="3" rx="1.5" fill="var(--hero-scene-accent, #e6c46c)"/>
  </g>`);
  // Distinct surrounding objects use the same projection and genuine thickness.
  // Their fixed trays keep the workspace grounded while the machine operates.
  function sample(at,content) {
    const anchor=P(...at),base=P(175,147,0),scale=.52;
    const tx=anchor[0]-base[0]*scale,ty=anchor[1]-base[1]*scale;
    return `<g transform="translate(${n(tx)} ${n(ty)}) scale(${scale})">`+
      poly([[94,70,0],[256,70,0],[256,225,0],[94,225,0]],'#200d1c','opacity=".3" filter="url(#hm-shadow)"')+
      box(94,70,3,162,155,8,'dark')+content+'</g>';
  }
  if(laser) {
    // Leave clear projected space between the star tray and the glass frame.
    parts.push(sample([-220,204,100],finishedProduct(products[2],19,4)));
    parts.push(sample([-100,296,5],box(104,83,14,139,122,4,'wood')+box(111,90,27,139,122,4,'gold')+box(118,97,40,139,122,4)));
    parts.push(sample([356,-60,50],finishedProduct(products[0],18,4)));
    // Cut-sheet registration crosshairs on a compact maroon work tile.
    parts.push(line([-126,272,47],[-106,272,47],'#e6c46c',1),line([-116,262,47],[-116,282,47],'#e6c46c',1));
  } else {
    parts.push(sample([-142,204,100],finishedProduct(products[0],29,14)));
    parts.push(sample([-100,296,5],finishedProduct(products[1],28,14)));
    let bits=box(114,91,13,122,105,17,'wood');
    for(const x of [138,175,212]) {
      bits+=cylinder(x,143,30,5,28);
      bits+=cylinder(x,143,58,x===175?10:7,19,'#b89868');
      bits+=line([x-4,143,59],[x+4,143,74],'#fff0d3',1.5);
    }
    parts.push(sample([356,-60,50],bits));
  }
  const metadata={type,projection:{origin,xAxis,yAxis},head,park,cutZ,thickness,products,contour,cableStart,cableEnd};
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 760" fill="none" aria-hidden="true"><metadata class="hm-mechanics">${JSON.stringify(metadata)}</metadata>${parts.join('\n')}</svg>\n`;
}
for(const type of ['laser','cnc']) {
  const file=path.resolve(__dirname,`../../home-page/assets/hero-${type}-scene.svg`);
  fs.writeFileSync(file,build(type));console.log(file);
}

// Small, original VP8/WebM fixtures. No external video or FFmpeg is required.
const fs=require('node:fs');
const path=require('node:path');
const {browserSession}=require('../backend/tests/Frontend/browser-helper.cjs');
function vint(buffer,offset,identifier=false) {
  let length=1,mask=128;
  while(!(buffer[offset]&mask)) {length++;mask>>=1;}
  let value=identifier?buffer[offset]:buffer[offset]&(mask-1);
  for(let i=1;i<length;i++) value=value*256+buffer[offset+i];
  return {length,value};
}
function duration(source,seconds) {
  // MediaRecorder omits duration for live recording. Add the standard EBML
  // Duration element to Segment Info so both PHP and browsers can inspect it.
  function find(start,end) {
    for(let offset=start;offset<end;) {
      const id=vint(source,offset,true),size=vint(source,offset+id.length),data=offset+id.length+size.length;
      if(id.value===0x1549a966) return {offset,size};
      if(id.value===0x18538067) return find(data,Math.min(end,data+size.value));
      offset=data+size.value;
    }
  }
  const found=find(0,source.length);
  if(!found) throw Error('Missing WebM Info');
  const {offset,size}=found;
  const encoded=Buffer.alloc(size.length);let length=BigInt(size.value+11);
  for(let i=size.length-1;i>=0;i--){encoded[i]=Number(length&255n);length>>=8n;}
  encoded[0]|=1<<(8-size.length);
  const field=Buffer.alloc(11); field.set([0x44,0x89,0x88]); field.writeDoubleBE(seconds*1000,3);
  const start=offset+4+size.length,end=start+size.value;
  return Buffer.concat([source.subarray(0,offset+4),encoded,source.subarray(start,end),field,source.subarray(end)]);
}
browserSession(async({run})=>{
  const base64=await run(`new Promise(resolve=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;
    const context=canvas.getContext('2d'),stream=canvas.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:50000});
    const chunks=[];recorder.ondataavailable=event=>chunks.push(event.data);
    let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#6b202b':'#f3e5cf';context.fillRect(0,0,160,100);context.fillStyle='#b88549';context.fillRect(50+frame%5,15,50,70);},100);
    recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(track=>track.stop());const data=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const byte of data)binary+=String.fromCharCode(byte);resolve(btoa(binary));};
    recorder.start();setTimeout(()=>recorder.stop(),1200);
  })`);
  const directory=path.resolve(__dirname,'../backend/tests/Fixtures/product-media');fs.mkdirSync(directory,{recursive:true});
  const source=Buffer.from(base64,'base64');
  for(const [name,seconds] of [['short',1.2],['boundary-30',30],['over-30',30.001]]) fs.writeFileSync(path.join(directory,name+'.webm'),duration(source,seconds));
  console.log('Generated three original WebM duration fixtures.');
}).catch(error=>{console.error(error);process.exitCode=1;});

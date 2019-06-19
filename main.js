const queryParams=new URLSearchParams(window.location.search);const debugging=queryParams.has("debug");const perf=queryParams.has("perf");const debug=debugging?console.log:()=>{};function fatal(msg){alert(msg);throw new Error(msg)}function checkCompat(prop){if(prop in window){return}fatal(`window.${prop} is not supported by this browser. If you're on Firefox or Safari, please enable browser's feature flag`)}checkCompat("Atomics");checkCompat("SharedArrayBuffer");const STATUS_EVENT_KEY=1;const STATUS_EVENT_RESIZE=2;const STATUS_EVENT_OPEN_FILE_REQUEST=3;const STATUS_EVENT_OPEN_FILE_WRITE_COMPLETE=4;class VimWorker{constructor(scriptPath,onMessage){this.worker=new Worker(scriptPath);this.worker.onmessage=this.recvMessage.bind(this);this.sharedBuffer=new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT*128));this.onMessage=onMessage;this.onOneshotMessage=new Map}sendMessage(msg){debug("main: send to worker:",msg);switch(msg.kind){case"start":this.worker.postMessage(msg);break;case"key":this.writeKeyEvent(msg);break;case"resize":this.writeResizeEvent(msg);break;default:throw new Error(`Unknown message from main to worker: ${msg}`)}}writeOpenFileRequestEvent(name,size){let idx=1;this.sharedBuffer[idx++]=size;idx=this.encodeStringToBuffer(name,idx);debug("main: Encoded open file size event with",idx*4,"bytes");this.awakeWorkerThread(STATUS_EVENT_OPEN_FILE_REQUEST)}writeOpenFileWriteComplete(){this.awakeWorkerThread(STATUS_EVENT_OPEN_FILE_WRITE_COMPLETE)}async waitForOneshotMessage(kind){return new Promise(resolve=>{this.onOneshotMessage.set(kind,resolve)})}writeKeyEvent(msg){let idx=1;this.sharedBuffer[idx++]=msg.keyCode;this.sharedBuffer[idx++]=+msg.ctrl;this.sharedBuffer[idx++]=+msg.shift;this.sharedBuffer[idx++]=+msg.alt;this.sharedBuffer[idx++]=+msg.meta;idx=this.encodeStringToBuffer(msg.key,idx);debug("main: Encoded key event with",idx*4,"bytes");this.awakeWorkerThread(STATUS_EVENT_KEY)}writeResizeEvent(msg){let idx=1;this.sharedBuffer[idx++]=msg.width;this.sharedBuffer[idx++]=msg.height;debug("main: Encoded resize event with",idx*4,"bytes");this.awakeWorkerThread(STATUS_EVENT_RESIZE)}encodeStringToBuffer(s,startIdx){let idx=startIdx;const len=s.length;this.sharedBuffer[idx++]=len;for(let i=0;i<len;++i){this.sharedBuffer[idx++]=s.charCodeAt(i)}return idx}awakeWorkerThread(event){Atomics.store(this.sharedBuffer,0,event);Atomics.notify(this.sharedBuffer,0,1)}recvMessage(e){const msg=e.data;const handler=this.onOneshotMessage.get(msg.kind);if(handler!==undefined){this.onOneshotMessage.delete(msg.kind);handler(msg);return}this.onMessage(msg)}}class ResizeHandler{constructor(canvas,worker){this.canvas=canvas;this.worker=worker;const rect=this.canvas.getBoundingClientRect();this.elemHeight=rect.height;this.elemWidth=rect.width;const dpr=window.devicePixelRatio||1;this.canvas.width=rect.width*dpr;this.canvas.height=rect.height*dpr;this.bounceTimerToken=null;this.onResize=this.onResize.bind(this)}onVimInit(){window.addEventListener("resize",this.onResize,{passive:true})}onVimExit(){window.removeEventListener("resize",this.onResize)}doResize(){const rect=this.canvas.getBoundingClientRect();debug("main: Resize Vim:",rect);this.elemWidth=rect.width;this.elemHeight=rect.height;const res=window.devicePixelRatio||1;this.canvas.width=rect.width*res;this.canvas.height=rect.height*res;this.worker.sendMessage({kind:"resize",height:rect.height,width:rect.width})}onResize(){if(this.bounceTimerToken!==null){window.clearTimeout(this.bounceTimerToken)}this.bounceTimerToken=window.setTimeout(()=>{this.bounceTimerToken=null;this.doResize()},1e3)}}class InputHandler{constructor(worker,input){this.worker=worker;this.elem=input;this.onKeydown=this.onKeydown.bind(this);this.onBlur=this.onBlur.bind(this);this.onFocus=this.onFocus.bind(this);this.focus()}setFont(name,size){this.elem.style.fontFamily=name;this.elem.style.fontSize=size+"px"}focus(){this.elem.focus()}onVimInit(){this.elem.addEventListener("keydown",this.onKeydown,{capture:true});this.elem.addEventListener("blur",this.onBlur);this.elem.addEventListener("focus",this.onFocus)}onVimExit(){this.elem.removeEventListener("keydown",this.onKeydown);this.elem.removeEventListener("blur",this.onBlur);this.elem.removeEventListener("focus",this.onFocus)}onKeydown(event){event.preventDefault();event.stopPropagation();debug("main: onKeydown():",event,event.key,event.keyCode);let key=event.key;const ctrl=event.ctrlKey;const shift=event.shiftKey;const alt=event.altKey;const meta=event.metaKey;if(key.length>1){if(key==="Unidentified"||ctrl&&key==="Control"||shift&&key==="Shift"||alt&&key==="Alt"||meta&&key==="Meta"){debug("main: Ignore key input",key);return}}if(key==="¥"||event.code==="IntlYen"){key="\\"}this.worker.sendMessage({kind:"key",keyCode:event.keyCode,key:key,ctrl:ctrl,shift:shift,alt:alt,meta:meta})}onFocus(){debug("main: onFocus()")}onBlur(event){debug("main: onBlur():",event);event.preventDefault()}}class ScreenCanvas{constructor(worker,canvas,input){this.worker=worker;this.canvas=canvas;const ctx=this.canvas.getContext("2d",{alpha:false});if(ctx===null){throw new Error("Cannot get 2D context for <canvas>")}this.ctx=ctx;const rect=this.canvas.getBoundingClientRect();const res=window.devicePixelRatio||1;this.canvas.width=rect.width*res;this.canvas.height=rect.height*res;this.canvas.addEventListener("click",this.onClick.bind(this),{capture:true,passive:true});this.input=new InputHandler(this.worker,input);this.onAnimationFrame=this.onAnimationFrame.bind(this);this.queue=[];this.rafScheduled=false;this.perf=false}onVimInit(){this.input.onVimInit()}onVimExit(){this.input.onVimExit()}enqueue(msg){if(!this.rafScheduled){window.requestAnimationFrame(this.onAnimationFrame);this.rafScheduled=true}this.queue.push(msg)}setColorFG(name){this.fgColor=name}setColorBG(_name){}setColorSP(name){this.spColor=name}setFont(name,size){this.fontName=name;this.input.setFont(name,size)}drawRect(x,y,w,h,color,filled){const dpr=window.devicePixelRatio||1;x=Math.floor(x*dpr);y=Math.floor(y*dpr);w=Math.floor(w*dpr);h=Math.floor(h*dpr);this.ctx.fillStyle=color;if(filled){this.ctx.fillRect(x,y,w,h)}else{this.ctx.rect(x,y,w,h)}}drawText(text,ch,lh,cw,x,y,bold,underline,undercurl,strike){const dpr=window.devicePixelRatio||1;ch=ch*dpr;lh=lh*dpr;cw=cw*dpr;x=x*dpr;y=y*dpr;let font=Math.floor(ch)+"px "+this.fontName;if(bold){font="bold "+font}this.ctx.font=font;this.ctx.textBaseline="bottom";this.ctx.fillStyle=this.fgColor;const descent=(lh-ch)/2;const yi=Math.floor(y+lh-descent);for(let i=0;i<text.length;++i){this.ctx.fillText(text[i],Math.floor(x+cw*i),yi)}if(underline){this.ctx.strokeStyle=this.fgColor;this.ctx.lineWidth=1*dpr;this.ctx.setLineDash([]);this.ctx.beginPath();const underlineY=Math.floor(y+lh-descent-3*dpr);this.ctx.moveTo(Math.floor(x),underlineY);this.ctx.lineTo(Math.floor(x+cw*text.length),underlineY);this.ctx.stroke()}else if(undercurl){this.ctx.strokeStyle=this.spColor;this.ctx.lineWidth=1*dpr;const curlWidth=Math.floor(cw/3);this.ctx.setLineDash([curlWidth,curlWidth]);this.ctx.beginPath();const undercurlY=Math.floor(y+lh-descent-3*dpr);this.ctx.moveTo(Math.floor(x),undercurlY);this.ctx.lineTo(Math.floor(x+cw*text.length),undercurlY);this.ctx.stroke()}else if(strike){this.ctx.strokeStyle=this.fgColor;this.ctx.lineWidth=1*dpr;this.ctx.beginPath();const strikeY=Math.floor(y+lh/2);this.ctx.moveTo(Math.floor(x),strikeY);this.ctx.lineTo(Math.floor(x+cw*text.length),strikeY);this.ctx.stroke()}}invertRect(x,y,w,h){const dpr=window.devicePixelRatio||1;x=Math.floor(x*dpr);y=Math.floor(y*dpr);w=Math.floor(w*dpr);h=Math.floor(h*dpr);const img=this.ctx.getImageData(x,y,w,h);const data=img.data;const len=data.length;for(let i=0;i<len;++i){data[i]=255-data[i];++i;data[i]=255-data[i];++i;data[i]=255-data[i];++i}this.ctx.putImageData(img,x,y)}imageScroll(x,sy,dy,w,h){const dpr=window.devicePixelRatio||1;x=Math.floor(x*dpr);sy=Math.floor(sy*dpr);dy=Math.floor(dy*dpr);w=Math.floor(w*dpr);h=Math.floor(h*dpr);this.ctx.drawImage(this.canvas,x,sy,w,h,x,dy,w,h)}onClick(){this.input.focus()}onAnimationFrame(){debug("main: Rendering",this.queue.length,"events on animation frame");this.perfMark("raf");for(const[method,args]of this.queue){this.perfMark("draw");this[method].apply(this,args);this.perfMeasure("draw",`draw:${method}`)}this.queue.length=0;this.rafScheduled=false;this.perfMeasure("raf")}perfMark(m){if(this.perf){performance.mark(m)}}perfMeasure(m,n){if(this.perf){performance.measure(n||m,m);performance.clearMarks(m)}}}class VimWasm{constructor(workerScript,canvas,input){this.worker=new VimWorker(workerScript,this.onMessage.bind(this));this.screen=new ScreenCanvas(this.worker,canvas,input);this.resizer=new ResizeHandler(canvas,this.worker);this.perf=false;this.running=false}start(opts){if(this.running){throw new Error("Cannot start Vim since it is already running")}const o=opts||{};this.perf=!!o.perf;this.screen.perf=this.perf;this.running=true;this.perfMark("init");this.worker.sendMessage({kind:"start",buffer:this.worker.sharedBuffer,canvasDomHeight:this.resizer.elemHeight,canvasDomWidth:this.resizer.elemWidth,debug:!!o.debug})}async dropFile(name,contents){if(!this.running){throw new Error("Cannot open file since Vim is not running")}debug("main: Handling to open file",name,contents);this.worker.writeOpenFileRequestEvent(name,contents.byteLength);const msg=await this.worker.waitForOneshotMessage("file-buffer");if(name!==msg.name){throw new Error(`File name mismatch from worker: '${name}' v.s. '${msg.name}'`)}if(contents.byteLength!==msg.buffer.byteLength){throw new Error(`Size of shared buffer from worker ${msg.buffer.byteLength} bytes mismatches to file contents size ${contents.byteLength} bytes`)}new Uint8Array(msg.buffer).set(new Uint8Array(contents));this.worker.writeOpenFileWriteComplete();debug("main: Wrote file",name,"to",contents.byteLength,"bytes buffer on file-buffer event",msg)}async dropFiles(files){const reader=new FileReader;for(const file of files){const[name,contents]=await this.readFile(reader,file);this.dropFile(name,contents)}}async readFile(reader,file){return new Promise(resolve=>{reader.onload=(f=>{debug("Read file",file.name,"from D&D:",f);resolve([file.name,reader.result])});reader.readAsArrayBuffer(file)})}onMessage(msg){switch(msg.kind){case"draw":this.screen.enqueue(msg.event);debug("main: draw event",msg.event);break;case"started":this.screen.onVimInit();this.resizer.onVimInit();if(this.onVimInit){this.onVimInit()}this.perfMeasure("init");debug("main: Vim started");break;case"exit":this.screen.onVimExit();this.resizer.onVimExit();if(this.onVimExit){this.onVimExit(msg.status)}this.printPerfs();this.perf=false;this.screen.perf=false;this.running=false;debug("main: Vim exited with status",msg.status);break;default:throw new Error(`FATAL: Unexpected message from worker: ${msg}`)}}printPerfs(){if(!this.perf){return}const measurements=new Map;for(const e of performance.getEntries()){const ms=measurements.get(e.name);if(ms===undefined){measurements.set(e.name,[e])}else{ms.push(e)}}const averages={};const amounts={};for(const[name,ms]of measurements){console.log(`%c${name}`,"color: green; font-size: large");console.table(ms,["duration","startTime"]);const total=ms.reduce((a,m)=>a+m.duration,0);averages[name]=total/ms.length;amounts[name]=total}console.log("%cAmounts","color: green; font-size: large");console.table(amounts);console.log("%cAverages","color: green; font-size: large");console.table(averages);performance.clearMarks();performance.clearMeasures()}perfMark(m){if(this.perf){performance.mark(m)}}perfMeasure(m){if(this.perf){performance.measure(m,m);performance.clearMarks(m)}}}const screenCanvasElement=document.getElementById("vim-screen");const vim=new VimWasm("vim.js",screenCanvasElement,document.getElementById("vim-input"));screenCanvasElement.addEventListener("dragover",e=>{e.stopPropagation();e.preventDefault();if(e.dataTransfer){e.dataTransfer.dropEffect="copy"}},false);screenCanvasElement.addEventListener("drop",e=>{e.stopPropagation();e.preventDefault();if(e.dataTransfer===null){return}vim.dropFiles(e.dataTransfer.files).catch(err=>{alert(err.message);throw err})},false);if(!perf){vim.onVimExit=(status=>{alert(`Vim exited with status ${status}`)})}vim.start({debug:debugging,perf:perf});
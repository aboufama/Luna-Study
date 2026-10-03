import { createCaptionTimeline } from './caption-timing.mjs';
import { createVoiceActivityGuard } from './voice-activity.mjs';
import {resolvedZones} from '../shared/board-parts.mjs';
import {receiveHintState as normalizeHintState} from './hint-state.mjs';

export function rebaseClientSelection(previous,board,selection){
  if(!board||!selection||selection.boardRevision!==previous?.revision)return null;
  const unchanged=target=>{
    const before=previous.blocks?.find(block=>block.id===target.blockId),after=board.blocks?.find(block=>block.id===target.blockId);
    if(!before||!after)return false;
    if(before.type==='scene'&&after.type==='scene'&&target.zoneId){
      if(before.width!==after.width||before.height!==after.height)return false;
      const oldZone=resolvedZones(before).find(zone=>zone.id===target.zoneId),newZone=resolvedZones(after).find(zone=>zone.id===target.zoneId);
      return Boolean(oldZone&&newZone&&JSON.stringify(oldZone)===JSON.stringify(newZone));
    }
    return JSON.stringify(before)===JSON.stringify(after);
  };
  if(Array.isArray(selection.targets)){
    const targets=selection.targets.filter(unchanged);
    return targets.length?{boardRevision:board.revision,targets}:null;
  }
  if(!unchanged(selection))return null;
  const {type,...identifier}=selection;return {...identifier,boardRevision:board.revision};
}

export class LiveVoiceSession {
  constructor({onState,onTranscript,onCaption,onError,onClose,onPause,onSetupDate,onLevel,onMastery,onCanvas,onHintState,onPresence,onPracticeState,captionMaxChars=76,socketPath='/api/live-voice',providerLabel='ElevenLabs',localBargeIn=true}){
    Object.assign(this,{onTranscript,onCaption,onError,onClose,onPause,onSetupDate,onLevel,onMastery,onCanvas,onHintState,onPresence,onPracticeState});
    this.hintState=null;this.paused=false;this.resuming=false;this.microphoneGeneration=0;
    this.captionMaxChars=captionMaxChars;this.voiceState='connecting';
    this.socketPath=socketPath;this.providerLabel=providerLabel;this.localBargeIn=localBargeIn;
    // Continuous real-time PCM needs a small jitter reserve. Burst TTS keeps
    // its existing onset latency and scheduling behavior.
    this.continuousPlayback=socketPath==='/api/gpt-live';
    this.onState=state=>{this.voiceState=state;this.updateActivityState();onState?.(state);};
    this.sources=new Set();this.levelTimers=new Set();this.ignoredTurns=new Set();this.closed=false;this.nextTime=0;this.speaking=false;this.loudFrames=0;this.ready=false;this.turnId=null;this.startSent=false;this.test=null;
  }
  async start(test){
    this.activity=createVoiceActivityGuard({onPause:reason=>this.pause(reason)});
    this.activity.setBusy(true);
    this.visibilityListener=()=>this.activity?.setHidden(document.hidden);
    this.pageHideListener=()=>this.close('page-hidden');
    document.addEventListener('visibilitychange',this.visibilityListener);
    window.addEventListener('pagehide',this.pageHideListener);
    this.visibilityListener();
    const today=new Date();
    const localToday=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const materials=this.materialSnapshot(test.materials);
    this.test={whiteboard:test.whiteboard||null,whiteboardSelection:null,whiteboardVisible:test.whiteboardVisible===true,testId:test.id,topics:test.guide?.topics||[],title:test.title||'',date:test.date||'',difficulty:test.difficulty||'test',localToday,materials,indexStatus:materials.length?(test.indexStatus||'ready'):'empty'};
    this.awaitingBoardRestore=!!this.test.whiteboard;this.pendingCanvasSelection=null;this.pendingCanvasVisibility=null;
    try{
      if(!await this.openMicrophone())return;
      const protocol=location.protocol==='https:'?'wss:':'ws:';
      this.socket=new WebSocket(`${protocol}//${location.host}${this.socketPath}`);
      this.connectTimeout=setTimeout(()=>this.fail('Live voice could not connect. Please try again.'),20000);
      this.socket.onopen=()=>{
        if(this.closed)return;
        this.send({type:'start',...this.test});this.startSent=true;
      };
      this.socket.onmessage=event=>{
        if(this.closed)return;
        let message;try{message=JSON.parse(event.data);}catch{return;}
        if(message.type==='ready'){if(!this.paused){clearTimeout(this.connectTimeout);this.ready=true;this.onState('listening');}}
        else if(message.type==='state'){
          if(this.paused)return;
          if(message.state==='listening'){clearTimeout(this.connectTimeout);this.ready=true;}
          if(!this.sources.size||message.state!=='listening')this.onState(message.state);
        }
        else if(message.type==='transcript')this.receiveTranscript(message);
        else if(message.type==='paused')this.receivePause(message);
        else if(message.type==='resumed')this.receiveResumed();
        else if(message.type==='hint-state')this.receiveHintState(message);
        else if(message.type==='practice-state')this.onPracticeState?.(message);
        else if(message.type==='canvas')this.receiveCanvas(message);
        else if(message.type==='mastery'&&message.mastery){this.onMastery?.(message.mastery);}
        else if(message.type==='setup-date'){
          if(typeof message.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(message.date)){
            this.test.date=message.date;this.onSetupDate?.(message.date);
          }
        }
        else if(message.type==='audio')this.playChunk(message);
        else if(message.type==='audio-end')this.receiveAudioEnd(message.turnId);
        else if(message.type==='interrupt'){if(this.turnId)this.ignoredTurns.add(this.turnId);this.clearAudio();this.onState('listening');}
        else if(message.type==='error'){
          const detail=message.message||message.error||'Live voice could not continue.';
          if(message.recoverable)this.onError(detail);else this.fail(detail);
        }
      };
      this.socket.onerror=()=>this.fail(`The live voice connection failed. Check the local server and your ${this.providerLabel} access.`);
      this.socket.onclose=()=>{if(!this.closed)this.close();};
    }catch(error){
      const message=error.name==='NotAllowedError'?'Microphone permission was declined. Allow it when you want to start a live session.':error.name==='NotFoundError'?'No microphone was found. Connect one and try again.':error.message;
      this.fail(message);throw error;
    }
  }
  async openMicrophone(){
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access requires a supported browser on localhost.');
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext)throw Error('This browser does not support live audio.');
    const generation=++this.microphoneGeneration,context=new AudioContext({latencyHint:'interactive'});this.context=context;
    context.onstatechange=()=>{this.updateActivityState();this.updateCaption();};
    await context.resume();
    if(this.closed||generation!==this.microphoneGeneration){void context.close();return false;}
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false});
    if(this.closed||generation!==this.microphoneGeneration){stream.getTracks().forEach(track=>track.stop());void context.close();return false;}
    this.stream=stream;await context.audioWorklet.addModule('/live-mic-worklet.js');
    if(this.closed||generation!==this.microphoneGeneration){stream.getTracks().forEach(track=>track.stop());void context.close();return false;}
    this.input=context.createMediaStreamSource(stream);this.processor=new AudioWorkletNode(context,'luna-mic',{processorOptions:{chunkSamples:this.continuousPlayback?320:1600}});this.mute=context.createGain();this.mute.gain.value=0;
    this.input.connect(this.processor);this.processor.connect(this.mute);this.mute.connect(context.destination);
    this.processor.port.onmessage=({data})=>this.streamMicrophone(data);return true;
  }
  streamMicrophone(data){
    if(this.closed||this.paused||!this.ready||this.socket?.readyState!==WebSocket.OPEN)return;
    if(!this.speaking)this.level(data.rms);
    if(this.socket.bufferedAmount>256000){this.fail('The microphone connection is falling behind. Please reconnect.');return;}
    if(this.speaking&&this.localBargeIn){
      this.loudFrames=data.rms>0.045?this.loudFrames+1:0;
      if(this.loudFrames>=2){if(this.turnId)this.ignoredTurns.add(this.turnId);this.clearAudio();this.send({type:'interrupt'});this.onState('listening');this.loudFrames=0;}
    }
    const bytes=new Uint8Array(data.audio);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    this.send({type:'audio',audio:btoa(binary)});
  }
  stopMicrophone(){
    this.microphoneGeneration++;
    this.stream?.getTracks().forEach(track=>track.stop());if(this.processor)this.processor.port.onmessage=null;
    this.input?.disconnect();this.processor?.disconnect();this.mute?.disconnect();
    if(this.context)this.context.onstatechange=null;void Promise.resolve(this.context?.close()).catch(()=>{});
    this.stream=null;this.input=null;this.processor=null;this.mute=null;this.context=null;
  }
  receiveHintState(message){
    if(this.closed)return;
    this.hintState=normalizeHintState(message);this.onHintState?.(this.hintState);
  }
  requestHint(){
    if(this.closed||this.paused||!this.ready||this.voiceState!=='listening'||!this.hintState?.available||this.hintState.pending||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.hintState={...this.hintState,pending:true};this.onHintState?.(this.hintState);this.noteActivity();this.send({type:'hint'});return true;
  }
  receivePause(message){
    if(this.closed)return;
    if(message.reason!=='student-idle'||message.resumable!==true){this.pause(message.reason);return;}
    clearTimeout(this.connectTimeout);this.paused=true;this.resuming=false;this.ready=false;
    if(this.turnId)this.ignoredTurns.add(this.turnId);this.clearAudio();this.stopMicrophone();this.onState('paused');
    this.onPause?.(message.reason);this.onPresence?.({paused:true,resuming:false,error:''});
  }
  async resume(){
    if(this.closed||!this.paused||this.resuming||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.resuming=true;this.onPresence?.({paused:true,resuming:true,error:''});
    try{
      if(!await this.openMicrophone())return false;
      if(this.closed||!this.paused)return false;
      this.connectTimeout=setTimeout(()=>this.fail('The paused session could not reconnect. Start the microphone to try again.'),20000);
      this.send({type:'resume'});return true;
    }catch(error){
      this.stopMicrophone();this.resuming=false;
      if(this.closed)return false;
      this.onPresence?.({paused:true,resuming:false,error:error.name==='NotAllowedError'?'Allow microphone access, then resume when you’re ready.':error.message||'The microphone could not reconnect. Try again.'});return false;
    }
  }
  receiveResumed(){
    if(this.closed||!this.paused||!this.resuming)return;
    clearTimeout(this.connectTimeout);this.paused=false;this.resuming=false;this.ready=true;this.noteActivity();this.onState('listening');this.onPresence?.({paused:false,resuming:false,error:''});
  }
  materialSnapshot(materials){return Array.isArray(materials)?materials.map(({id,name,text})=>({id,name,text})):[];}
  noteActivity({foreground=false}={}){
    this.activity?.touch();
    if(!foreground||this.closed||this.paused||!this.ready||globalThis.document?.visibilityState!=='visible'||this.socket?.readyState!==WebSocket.OPEN)return;
    const now=performance.now();if(now-(this.lastForegroundActivity??-Infinity)<1000)return;
    this.lastForegroundActivity=now;this.send({type:'activity'});
  }
  updateActivityState(){
    const playbackBlocked=['suspended','interrupted','closed'].includes(this.context?.state);
    this.activity?.setBusy(this.paused||!playbackBlocked&&['connecting','thinking','speaking'].includes(this.voiceState));
  }
  pause(reason){if(this.closed)return;this.onPause?.(reason);this.close(reason);}
  updateMaterials(materials){
    if(this.closed)return;
    const snapshot=this.materialSnapshot(materials);
    const indexStatus=snapshot.length?'indexing':'empty';
    const changed=JSON.stringify(snapshot)!==JSON.stringify(this.test?.materials||[]);
    this.test={...(this.test||{}),materials:snapshot,indexStatus,...(changed?{topics:[],whiteboard:null,whiteboardSelection:null,whiteboardVisible:false}:{})};
    if(changed){this.awaitingBoardRestore=false;this.pendingCanvasSelection=null;this.pendingCanvasVisibility=null;this.hintState=null;this.onHintState?.(null);this.onPracticeState?.(null);}
    if(this.startSent)this.send({type:'materials',materials:snapshot,indexStatus});
  }
  updateIndexStatus(status,revision){
    if(this.closed||!['empty','indexing','ready','error'].includes(status))return;
    if(revision!==this.test?.materials.map(item=>item.id).join('|'))return;
    this.test={...this.test,indexStatus:status};
    if(this.startSent)this.send({type:'index-status',status,revision});
  }
  selectCanvas({boardRevision,targets,blockId,zoneId,elementIndex,cell,label,part,clear}){
    if(this.closed||typeof boardRevision!=='string')return;
    const selection={type:'canvas-select',boardRevision};
    if(clear===true)selection.clear=true;
    else if(Array.isArray(targets)){
      if(targets.length>32||targets.some(target=>typeof target.blockId!=='string'||typeof target.zoneId!=='string'))return;
      selection.targets=targets.map(({blockId,zoneId})=>({blockId,zoneId}));
    }
    else{
      if(typeof blockId!=='string')return;selection.blockId=blockId;
      if(typeof zoneId==='string')selection.zoneId=zoneId;
      if(Number.isInteger(elementIndex))selection.elementIndex=elementIndex;
      if(cell&&Number.isInteger(cell.row)&&Number.isInteger(cell.col))selection.cell={row:cell.row,col:cell.col};
      if(label&&['row','column'].includes(label.axis)&&Number.isInteger(label.index))selection.label={axis:label.axis,index:label.index};
      if(Number.isInteger(part))selection.part=part;
    }
    this.test={...(this.test||{}),whiteboardSelection:clear||selection.targets?.length===0?null:selection};
    if(this.startSent){
      if(this.awaitingBoardRestore)this.pendingCanvasSelection=selection;
      else this.send(selection);
    }
  }
  setCanvasVisible(visible){
    if(this.closed||!this.test?.whiteboard?.revision)return;
    this.test={...this.test,whiteboardVisible:Boolean(visible)};
    if(this.startSent){
      if(this.awaitingBoardRestore)this.pendingCanvasVisibility=Boolean(visible);
      else this.send({type:'canvas-visibility',boardRevision:this.test.whiteboard.revision,visible:Boolean(visible)});
    }
  }
  receiveCanvas(message){
    // Late visual decisions from interrupted speech must not overwrite the
    // current scene or a newer manual visibility action.
    if(this.closed||this.ignoredTurns.has(message.id))return;
    if(typeof message.visible==='boolean')this.test={...this.test,whiteboardVisible:message.visible};
    if(!Object.hasOwn(message,'board')){this.onCanvas?.(message);return;}
    const previous=this.test.whiteboard,board=message.board;
    const rebase=selection=>rebaseClientSelection(previous,board,selection);
    let selection=Object.hasOwn(message,'selection')?message.selection:rebase(this.test.whiteboardSelection);
    const pending=this.pendingCanvasSelection;
    if(this.awaitingBoardRestore&&pending&&board){
      const chosen=pending.clear||pending.targets?.length===0?{boardRevision:board.revision,clear:true}:rebase(pending);
      if(chosen){selection=chosen.clear?null:chosen;this.send({type:'canvas-select',...chosen});}
    }
    if(this.awaitingBoardRestore&&typeof this.pendingCanvasVisibility==='boolean'&&board){
      message={...message,visible:this.pendingCanvasVisibility};
      this.send({type:'canvas-visibility',boardRevision:board.revision,visible:message.visible});
    }
    this.awaitingBoardRestore=false;this.pendingCanvasSelection=null;this.pendingCanvasVisibility=null;
    this.test={...this.test,whiteboard:board,whiteboardSelection:selection,...(typeof message.visible==='boolean'?{whiteboardVisible:message.visible}:{})};
    this.onCanvas?.({...message,selection});
  }
  updateSetup(fields){
    if(this.closed)return;
    const setup=Object.fromEntries(['title','date','difficulty'].filter(key=>Object.hasOwn(fields,key)).map(key=>[key,fields[key]]));
    this.test={...(this.test||{}),...setup};
    if(this.startSent&&Object.keys(setup).length)this.send({type:'setup',...setup});
  }
  level(value){this.onLevel?.(Number.isFinite(value)?Math.max(0,Math.min(1,value)):0);}
  send(message){if(!this.closed&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  playChunk({audio,sampleRate=24000,turnId,alignment}){
    if(this.closed||this.paused||!audio||this.ignoredTurns.has(turnId))return;
    this.activateTurn(turnId);
    let bytes;try{bytes=Uint8Array.from(atob(audio),char=>char.charCodeAt(0));}catch{this.fail('Received an invalid live audio chunk.');return;}
    if(bytes.length<2)return;
    const view=new DataView(bytes.buffer);const length=Math.floor(bytes.length/2);
    const buffer=this.context.createBuffer(1,length,sampleRate);const samples=buffer.getChannelData(0);
    let squareSum=0;
    for(let i=0;i<length;i++){samples[i]=view.getInt16(i*2,true)/32768;squareSum+=samples[i]*samples[i];}
    const rms=Math.sqrt(squareSum/length);
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);
    this.sources.add(source);this.speaking=true;this.onState('speaking');
    if(this.continuousPlayback){
      // Once started, preserve adjacent sample boundaries while the next
      // buffer still has a small amount of scheduling headroom. Adding a
      // fresh 25 ms margin to every packet creates avoidable audible gaps.
      if(this.nextTime<this.context.currentTime+0.005)this.nextTime=this.context.currentTime+0.080;
    }else this.nextTime=Math.max(this.context.currentTime+0.025,this.nextTime);
    const levelTimer=setTimeout(()=>{this.levelTimers.delete(levelTimer);if(!this.closed&&this.sources.has(source))this.level(rms);},Math.max(0,(this.nextTime-this.context.currentTime)*1000));
    this.levelTimers.add(levelTimer);
    this.captionTimeline?.addAudio({start:this.nextTime,duration:buffer.duration,alignment});
    source.start(this.nextTime);this.nextTime+=buffer.duration;this.scheduleCaptions();
    source.onended=()=>{this.sources.delete(source);source.disconnect();if(!this.sources.size)this.level(0);if(!this.closed&&!this.sources.size&&this.audioEnded){this.speaking=false;this.onState('listening');}};
  }
  receiveAudioEnd(turnId){
    if(this.closed||turnId!==this.turnId||this.ignoredTurns.has(turnId))return;
    this.audioEnded=true;this.captionTimeline?.finish();this.scheduleCaptions();
    if(!this.sources.size){this.speaking=false;this.level(0);this.onState('listening');}
  }
  activateTurn(turnId){
    if(turnId===undefined||turnId===null||this.turnId===turnId)return;
    if(this.turnId!==null)this.ignoredTurns.add(this.turnId);
    this.clearAudio();this.turnId=turnId;this.audioEnded=false;this.captionTimeline=createCaptionTimeline({maxChars:this.captionMaxChars});
    this.onCaption?.({text:'',phrase:'',cue:null,turnId,timing:'estimated',final:false});
  }
  receiveTranscript(message){
    if(message.role==='assistant'){
      if(this.ignoredTurns.has(message.turnId))return;
      this.activateTurn(message.turnId);this.captionTimeline?.setText(message.text);
    }else if(message.role==='user'&&message.text?.trim())this.noteActivity();
    this.onTranscript?.(message);
  }
  setCaptionMaxChars(value){
    this.captionMaxChars=Math.max(32,Math.min(120,Number(value)||76));
    this.captionTimeline?.setMaxChars(this.captionMaxChars);this.updateCaption();
  }
  captionPlayhead(){
    // getOutputTimestamp refers to audio reaching the output device. Falling
    // back to currentTime minus reported output latency is less exact.
    const stamp=this.context?.getOutputTimestamp?.();
    if(Number.isFinite(stamp?.contextTime)&&stamp.contextTime>=0)return Math.min(this.context.currentTime,stamp.contextTime);
    return Math.max(0,(this.context?.currentTime||0)-(this.context?.outputLatency||0));
  }
  updateCaption(){
    if(this.closed||!this.captionTimeline||['suspended','interrupted','closed'].includes(this.context?.state))return;
    const value=this.captionTimeline.tick(this.captionPlayhead());
    if(value)this.onCaption?.({...value,turnId:this.turnId});
  }
  scheduleCaptions(){
    if(this.captionTimer||this.closed||!this.captionTimeline)return;
    const tick=()=>{
      this.captionTimer=null;this.updateCaption();
      if(!this.closed&&this.captionTimeline&&!this.captionTimeline.complete){this.captionTimer=setTimeout(tick,40);this.captionTimer.unref?.();}
    };
    this.captionTimer=setTimeout(tick,40);this.captionTimer.unref?.();
  }
  clearAudio(){
    clearTimeout(this.captionTimer);this.captionTimer=null;this.captionTimeline=null;
    this.onCaption?.({text:'',phrase:'',cue:null,turnId:this.turnId,timing:'estimated',final:false});
    for(const timer of this.levelTimers)clearTimeout(timer);this.levelTimers.clear();
    for(const source of this.sources){source.onended=null;try{source.stop();source.disconnect();}catch{}}
    this.sources.clear();this.nextTime=0;this.speaking=false;this.audioEnded=true;this.level(0);
  }
  fail(message){if(this.closed)return;this.onError(message);this.close();}
  close(reason='user-stopped'){
    if(this.closed)return;
    this.send({type:'stop',reason});this.closed=true;clearTimeout(this.connectTimeout);this.activity?.stop();this.clearAudio();
    if(this.visibilityListener)document.removeEventListener('visibilitychange',this.visibilityListener);
    if(this.pageHideListener)window.removeEventListener('pagehide',this.pageHideListener);
    this.socket?.close();this.stopMicrophone();this.hintState=null;this.onHintState?.(null);this.onPresence?.({paused:false,resuming:false,error:''});this.onClose?.();
  }
}

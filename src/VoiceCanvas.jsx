import React, { useEffect, useRef } from 'react';
import { createMosaicField } from './mosaic-field.mjs';
import { measureStageLayout, createMosaicStageTargets } from './mosaic-stage.mjs';
import { createMosaicTargetMotion } from './mosaic-target-motion.mjs';
import { createMosaicChoreography } from './mosaic-choreography.mjs';
import { createMosaicIntake, advanceMosaicIntake } from './mosaic-intake.mjs';
import { createMosaicTransition, mosaicCircleCenter } from './mosaic-transition.mjs';
import { createMosaicRest } from './mosaic-rest.mjs';

const clamp=value=>Math.max(0,Math.min(1,value));
const ease=value=>{const t=clamp(value);return t*t*(3-2*t);};

const stoneNoise=(seed,index)=>{const value=Math.sin(seed*197.17+index*89.71)*43758.5453;return value-Math.floor(value);};
const stoneColor=(base,change=0)=>`rgb(${base.map(channel=>Math.max(0,Math.min(255,Math.round(channel+change)))).join(',')})`;
export function stoneAtlas(tiles){
  const columns=32,size=20,resolution=2,cell=size*resolution;
  const canvas=document.createElement('canvas');canvas.width=columns*cell;canvas.height=Math.ceil(tiles.length/columns)*cell;
  const paint=canvas.getContext('2d');
  function path(points){paint.beginPath();points.forEach((point,index)=>index?paint.lineTo(point.x,point.y):paint.moveTo(point.x,point.y));paint.closePath();}
  const sprites=tiles.map((tile,index)=>{
    const sx=index%columns*cell,sy=Math.floor(index/columns)*cell;
    paint.setTransform(resolution,0,0,resolution,sx+cell/2,sy+cell/2);
    const seed=tile.seed,variant=stoneNoise(seed,18);
    // Warmth stays in near-neutral minerals, with no saturated accent stones.
    const base=variant<.14?[72,65,55]:variant>.84?[92,88,79]:[48,47,43];
    const tone=(stoneNoise(seed,21)-.5)*14;
    const outline=[];
    tile.vertices.forEach((vertex,i)=>{
      const previous=tile.vertices[(i+tile.vertices.length-1)%tile.vertices.length],next=tile.vertices[(i+1)%tile.vertices.length];
      const cut=.025+stoneNoise(seed,i+31)*.055;
      outline.push({x:vertex.x+(previous.x-vertex.x)*cut,y:vertex.y+(previous.y-vertex.y)*cut});
      outline.push({x:vertex.x+(next.x-vertex.x)*cut,y:vertex.y+(next.y-vertex.y)*cut});
    });
    const face=outline.map(point=>({x:point.x*.86-.12,y:point.y*.86-.16}));
    // A shallow, fixed side wall below the cut face, not a per-frame shadow.
    paint.fillStyle='rgba(36,30,23,.17)';path(outline.map(point=>({x:point.x+.55,y:point.y+1.05})));paint.fill();
    paint.fillStyle=stoneColor(base,tone-25);path(outline.map(point=>({x:point.x+.32,y:point.y+.55})));paint.fill();
    paint.fillStyle=stoneColor(base,tone-8);path(outline);paint.fill();
    for(let i=0;i<outline.length;i++){
      const j=(i+1)%outline.length,a=outline[i],b=outline[j],dx=b.x-a.x,dy=b.y-a.y,length=Math.max(.01,Math.hypot(dx,dy));
      const light=(dy*-.6+dx*.8)/length;
      paint.fillStyle=stoneColor(base,tone+(light>0?light*43:light*20));
      path([a,b,face[j],face[i]]);paint.fill();
    }
    const gradient=paint.createLinearGradient(-3,-4,3,4);
    gradient.addColorStop(0,stoneColor(base,tone+21));gradient.addColorStop(.58,stoneColor(base,tone+5));gradient.addColorStop(1,stoneColor(base,tone-10));
    paint.fillStyle=gradient;path(face);paint.fill();
    paint.save();path(face);paint.clip();
    for(let grain=0;grain<7;grain++){
      const x=(stoneNoise(seed,grain*3+60)-.5)*8,y=(stoneNoise(seed,grain*3+61)-.5)*8;
      const width=.16+stoneNoise(seed,grain*3+62)*.25;
      paint.fillStyle=grain%3?'rgba(18,16,12,.12)':'rgba(231,224,207,.15)';paint.fillRect(x,y,width,width*.7);
    }
    if(variant<.18){paint.strokeStyle='rgba(221,208,181,.13)';paint.lineWidth=.18;paint.beginPath();paint.moveTo(-2.8,.6);paint.lineTo(-.7,-.2);paint.lineTo(.7,-.35);paint.stroke();}
    paint.restore();
    return {sx,sy};
  });
  return {canvas,sprites,cell,size};
}

// Every stone is a rigid polygon. Only its position and rotation can change.
// The same set assembles the voice medallion and the whiteboard's quiet frame.
export default function VoiceCanvas({state,levelRef,dragging=false,dragPositionRef,boardOpen=false,boardMeasure,orbRef,intake,onIntakeDone}) {
  const canvasRef=useRef(null),live=useRef({}),redraw=useRef(null),relayout=useRef(null);
  live.current={state,dragging,boardOpen,boardMeasure,intake,onIntakeDone};
  useEffect(()=>{
    const canvas=canvasRef.current,context=canvas.getContext('2d');if(!context)return;
    const surface=canvas.parentElement.parentElement,motion=matchMedia('(prefers-reduced-motion: reduce)');
    const tiles=createMosaicField().tiles.map((tile,index)=>({...tile,id:`stone-${index}`,theta:Math.atan2(tile.y,tile.x),radius:Math.hypot(tile.x,tile.y),ink:Math.min(.9,.60+tile.strength*.18+tile.seed*.08+tile.motifStrength*.13)*tile.edge}));
    const atlas=stoneAtlas(tiles);
    const choreography=createMosaicChoreography(tiles),rest=createMosaicRest(tiles),positions=new Float32Array(tiles.length*3),joinedAt=new Float64Array(tiles.length).fill(-Infinity);
    const transition=createMosaicTransition(tiles.length,live.current.boardOpen);
    const targetMotion=createMosaicTargetMotion(tiles.length);
    const hoverX=new Float32Array(tiles.length),hoverY=new Float32Array(tiles.length);
    let width=440,height=700,unit=1,pixelRatio=1,layout,frame,last=0,receiving=0,burst=null,cx=220,cy=275,engagedUntil=0;
    const pointer={x:0,y:0,active:false,dx:1,dy:0,movedAt:-Infinity};
    function arrange(){
      const measured=live.current.boardMeasure;
      layout=measureStageLayout({width,height,unit,contentWidth:measured?.width,contentHeight:measured?.height});
      const scene=createMosaicStageTargets(tiles,layout);
      layout=scene.layout;
      targetMotion.setTargets(scene.targets);
      if(!live.current.boardOpen&&transition.progress.every(value=>value===0))transition.setTargets(scene.targets,layout.pitch);
      const {board,tutor,captions,content}=layout,inner=board.inner;
      const values={
        'stage-required-height':layout.requiredHeight,
        'stage-board-x':board.x,'stage-board-y':board.y,'stage-board-width':board.width,'stage-board-height':board.height,
        'stage-tutor-x':tutor.x,'stage-tutor-y':tutor.y,'stage-tutor-radius':tutor.radius,
        'stage-corner-band':layout.frameInset+8,
        'stage-content-x':content.x,'stage-content-y':content.y,
        'stage-content-width':Math.max(1,content.width),'stage-content-height':Math.max(1,content.height),
        'stage-content-max-width':Math.max(1,layout.maxContentWidth),
        'stage-close-x':inner.x+inner.width-52,'stage-close-y':inner.y+(height<460?4:12),
        'stage-captions-x':captions.x,'stage-captions-y':captions.y,'stage-captions-width':captions.width,'stage-captions-height':captions.height,
        'board-inner-top':inner.y,'board-inner-side':inner.x,'board-inner-bottom':height-inner.y-inner.height,
        'board-outer-bottom':height-board.y-board.height,
      };
      for(const [name,value] of Object.entries(values))surface.style.setProperty(`--${name}`,`${value}px`);
      surface.dataset.mosaicBoardTiles=String(scene.boardCount);
      surface.dataset.mosaicTutorTiles=String(scene.tutorCount);
      surface.dataset.mosaicFrameCourses=String(layout.courses);
      restart();
    }
    function resize(){
      const bounds=surface.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
      pixelRatio=ratio;
      width=bounds.width;height=bounds.height;
      // Tesserae are physical pieces: neither a formation nor a smaller screen
      // can change their dimensions. The layout allocates space around them.
      unit=1;
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);
      const center=mosaicCircleCenter(width,height,unit);cx=center.x;cy=center.y;
      surface.style.setProperty('--stage-orb-x',`${cx}px`);surface.style.setProperty('--stage-orb-y',`${cy}px`);surface.style.setProperty('--stage-orb-unit',String(unit));
      arrange();
    }
    function pointerMove(event){
      const bounds=canvas.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top;
      const dx=x-pointer.x,dy=y-pointer.y,distance=Math.hypot(dx,dy);
      if(pointer.active&&distance>.3){pointer.dx=dx/distance;pointer.dy=dy/distance;}
      pointer.x=x;pointer.y=y;pointer.active=true;pointer.movedAt=performance.now();
    }
    function pointerLeave(){pointer.active=false;}
    function engage(){engagedUntil=performance.now()+1100;}
    function drawStone(index,x,y,rotation,hoverMix=1){
      const cos=Math.cos(rotation),sin=Math.sin(rotation),factor=pixelRatio,sprite=atlas.sprites[index];
      const hx=hoverX[index]*hoverMix,hy=hoverY[index]*hoverMix,tilt=Math.hypot(hx,hy);
      // Orthographic projection of one rigid stone tipped by at most18 degrees.
      // Its bevel and grain move as a single face; polygon vertices never change.
      const compression=tilt>.0001?(Math.cos(tilt)-1)/(tilt*tilt):0;
      const xx=1+compression*hx*hx,xy=compression*hx*hy,yy=1+compression*hy*hy;
      const lift=tilt/.314*.7*unit;
      context.setTransform((xx*cos+xy*sin)*factor,(xy*cos+yy*sin)*factor,(-xx*sin+xy*cos)*factor,(-xy*sin+yy*cos)*factor,x*pixelRatio,(y-lift)*pixelRatio);
      context.drawImage(atlas.canvas,sprite.sx,sprite.sy,atlas.cell,atlas.cell,-atlas.size/2,-atlas.size/2,atlas.size,atlas.size);
    }
    function draw(time){
      if(document.hidden)return;
      if(time-last<30){frame=requestAnimationFrame(draw);return;}
      const dt=Math.min(80,last?time-last:16);last=time;
      const current=live.current,reduced=motion.matches;
      const formation=transition.step(current.boardOpen,dt,reduced);
      const targets=targetMotion.step(dt,reduced);
      receiving=reduced?0:receiving+(Number(current.dragging)-receiving)*(1-Math.exp(-dt/190));
      const level=levelRef.current||0;
      choreography.step(current.state,level,time,reduced);
      const pointerNear=pointer.active&&Math.hypot(pointer.x-cx,pointer.y-cy)<190*unit&&time-pointer.movedAt<650;
      rest.step({dt,reduced,allowFocus:!current.boardOpen&&!current.dragging&&!current.intake,resting:current.state==='idle'||current.state==='listening'&&level<.016,
        engaged:current.boardOpen||current.dragging||Boolean(current.intake)||pointerNear||time<engagedUntil||level>=.016});
      const hoverActivity=!reduced&&pointer.active&&!current.dragging?Math.exp(-Math.max(0,time-pointer.movedAt)/210):0;
      const hoverAttack=1-Math.exp(-dt/75),hoverRelease=1-Math.exp(-dt/290);
      context.setTransform(pixelRatio,0,0,pixelRatio,0,0);context.clearRect(0,0,width,height);
      for(let i=0;i<tiles.length;i++){
        const tile=tiles[i],theta=tile.theta,morph=formation[i];
        // An approaching document gently turns complete courses. Keep the
        // circle intact; no local seam, swelling or angular displacement field.
        const course=Math.max(0,Math.floor((tile.radius-2.9)/6.8)+1);
        const receivingTurn=receiving*(Math.floor(course/3)%2?-1:1)*.012;
        const turn=choreography.rotation[i]+receivingTurn+rest.focusRotation[i],a=theta+turn,radius=tile.radius*.97;
        const centerX=cx+Math.cos(a)*radius*unit,centerY=cy+Math.sin(a)*radius*unit;
        const target=targets[i];
        // Once the tutor becomes the frame, speech changes its light only.
        // The joined corner stays seated instead of rotating out of the wall.
        positions[i*3]=centerX+(target.x-centerX)*morph+rest.x[i]*unit*(1-morph);
        positions[i*3+1]=centerY+(target.y-centerY)*morph+rest.y[i]*unit*(1-morph);
        positions[i*3+2]=turn*(1-morph)+target.rotation*morph+rest.rotation[i]*(1-morph);
        // A cursor pass tips a small neighborhood together, then settles it.
        // The pointer changes no ink, spacing, or center position in the mosaic.
        const dx=positions[i*3]-pointer.x,dy=positions[i*3+1]-pointer.y,distance=Math.hypot(dx,dy);
        const amount=hoverActivity*ease(1-distance/(17*unit))*.314;
        const ux=pointer.dx*.8+(distance>.1?dx/distance*.2:0),uy=pointer.dy*.8+(distance>.1?dy/distance*.2:0);
        const length=Math.max(.01,Math.hypot(ux,uy)),tx=amount*ux/length,ty=amount*uy/length;
        const response=amount>Math.hypot(hoverX[i],hoverY[i])?hoverAttack:hoverRelease;
        hoverX[i]=reduced?0:hoverX[i]+(tx-hoverX[i])*response;
        hoverY[i]=reduced?0:hoverY[i]+(ty-hoverY[i])*response;
      }
      if(current.intake&&burst?.id!==current.intake.id)burst=createMosaicIntake(tiles,positions,current.intake,time,unit);
      else if(!current.intake)burst=null;
      let intakeDone=false;
      if(burst&&!burst.done){
        intakeDone=advanceMosaicIntake(burst,positions,time,unit,reduced);
        for(const fragment of burst.fragments)if(fragment.justArrived)joinedAt[fragment.index]=time;
      }
      for(let i=0;i<tiles.length;i++){
        const morph=formation[i];
        // Receiver fading happens before its incoming sprite becomes visible.
        const receiverAlpha=burst?.reserved[i]?burst.receiverAlpha[i]:1;
        if(!receiverAlpha)continue;
        // Only newly received material retains a brief joining highlight.
        const trace=reduced?0:ease(1-(time-joinedAt[i])/650);
        const sourceInk=tiles[i].ink+choreography.ink[i]*tiles[i].edge;
        const stageInk=.29+tiles[i].seed*.10+choreography.borderInk[i]*.6
          +targets[i].tutorMix*(.045+Math.max(0,choreography.ink[i])*.5);
        const base=Math.min(.94,Math.max(0,sourceInk+(stageInk-sourceInk)*morph));
        context.globalAlpha=(base+(.96-base)*trace)*receiverAlpha;
        drawStone(i,positions[i*3],positions[i*3+1],positions[i*3+2]);
      }
      if(burst&&!burst.done){
        for(const fragment of burst.fragments){
          if(fragment.arrived||!fragment.alpha)continue;
          context.globalAlpha=fragment.alpha;
          drawStone(fragment.index,fragment.x,fragment.y,fragment.rotation,fragment.hoverMix);
        }
      }
      if(intakeDone)current.onIntakeDone?.();
      context.globalAlpha=1;
      context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
      if(!reduced||current.intake&&!burst?.done)frame=requestAnimationFrame(draw);
    }
    function restart(){cancelAnimationFrame(frame);if(!document.hidden){last=0;frame=requestAnimationFrame(draw);}}
    redraw.current=restart;
    relayout.current=arrange;
    const observer=new ResizeObserver(resize);observer.observe(surface);resize();
    surface.addEventListener('pointermove',pointerMove,{passive:true});surface.addEventListener('pointerleave',pointerLeave);
    surface.addEventListener('pointerdown',engage,{passive:true});surface.addEventListener('keydown',engage);
    document.addEventListener('visibilitychange',restart);motion.addEventListener('change',restart);
    return()=>{redraw.current=null;relayout.current=null;cancelAnimationFrame(frame);observer.disconnect();surface.removeEventListener('pointermove',pointerMove);surface.removeEventListener('pointerleave',pointerLeave);surface.removeEventListener('pointerdown',engage);surface.removeEventListener('keydown',engage);document.removeEventListener('visibilitychange',restart);motion.removeEventListener('change',restart);};
  },[levelRef,dragPositionRef,orbRef]);
  useEffect(()=>{relayout.current?.();},[boardMeasure?.width,boardMeasure?.height,boardOpen]);
  // Reduced-motion changes also need one fresh static formation when state changes.
  useEffect(()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)redraw.current?.();},[boardOpen,intake,state]);
  return <div className={`voice-visual mosaic-surface ${dragging?'reaching':''}`} aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',maxWidth:'none',pointerEvents:'none',zIndex:3}}><canvas ref={canvasRef} className={`voice-canvas ${intake?'particle-intake':''}`} style={{width:'100%',height:'100%',maxWidth:'none',position:'absolute',inset:0}}/></div>;
}

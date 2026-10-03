import React, { useEffect, useRef } from 'react';
import { createMosaicField } from '../mosaic-field.mjs';
import { mosaicBorderTargets } from '../mosaic-motion.mjs';
import { createMosaicIntake, advanceMosaicIntake } from '../mosaic-intake.mjs';
import { stoneAtlas } from '../VoiceCanvas.jsx';
import { createMosaicRest } from '../mosaic-rest.mjs';

const WIDTH=560,HEIGHT=460;
const smooth=value=>value*value*(3-2*value);
export default function Preview({variant,seed,controls,clock}){
  const canvasRef=useRef(null),live=useRef(controls);live.current=controls;
  useEffect(()=>{
    const canvas=canvasRef.current,ctx=canvas.getContext('2d');if(!ctx)return;
    const tiles=createMosaicField().tiles.map((tile,index)=>({...tile,id:`stone-${index}`,ink:Math.min(.94,.64+tile.strength*.20+tile.motifStrength*.12)*tile.edge}));
    const border=mosaicBorderTargets(tiles,{width:WIDTH,height:HEIGHT,top:44,bottom:44,inset:30,pitch:7.3});
    const atlas=stoneAtlas(tiles),motion=variant.createVariant({tiles,seed,width:WIDTH,height:HEIGHT,border}),rest=createMosaicRest(tiles);
    const positions=new Float32Array(tiles.length*3),joinedAt=new Float64Array(tiles.length).fill(-Infinity);
    const pointer={x:0,y:0,active:false,dx:1,dy:0,movedAt:-Infinity};let raf,last=0,board=0,burst=null,lastDrop=controls.drop;
    const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=WIDTH*ratio;canvas.height=HEIGHT*ratio;
    const move=event=>{const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*WIDTH,y=(event.clientY-rect.top)/rect.height*HEIGHT,dx=x-pointer.x,dy=y-pointer.y,distance=Math.hypot(dx,dy);if(pointer.active&&distance>.3){pointer.dx=dx/distance;pointer.dy=dy/distance;}pointer.x=x;pointer.y=y;pointer.active=true;pointer.movedAt=clock.current.time;};
    const leave=()=>{pointer.active=false;};canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',move);canvas.addEventListener('pointerleave',leave);
    function stone(i,x,y,rotation,alpha,hoverMix=1){
      const sprite=atlas.sprites[i],cos=Math.cos(rotation),sin=Math.sin(rotation);
      const hx=(motion.tiltX?.[i]||0)*hoverMix,hy=(motion.tiltY?.[i]||0)*hoverMix,tilt=Math.hypot(hx,hy),compression=tilt>.0001?(Math.cos(tilt)-1)/(tilt*tilt):0;
      const xx=1+compression*hx*hx,xy=compression*hx*hy,yy=1+compression*hy*hy;
      ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.setTransform((xx*cos+xy*sin)*ratio,(xy*cos+yy*sin)*ratio,(-xx*sin+xy*cos)*ratio,(-xy*sin+yy*cos)*ratio,x*ratio,(y-tilt/.314*.7)*ratio);
      ctx.drawImage(atlas.canvas,sprite.sx,sprite.sy,atlas.cell,atlas.cell,-atlas.size/2,-atlas.size/2,atlas.size,atlas.size);
    }
    function draw(now){
      raf=requestAnimationFrame(draw);if(document.hidden)return;
      if(now-last<30)return;const dt=last?Math.min(80,now-last):16;last=now;
      const current=live.current,time=clock.current.time,step=current.playing?dt:0;
      board=current.reduced?Number(current.board):board+(Number(current.board)-board)*(1-Math.exp(-step/220));
      const syllable=(Math.sin(time*.0074)+Math.sin(time*.017+.8)*.45+Math.sin(time*.026)*.2+1.1)/2.8;
      const phrase=Math.max(0,Math.sin(time*.0009+.35));
      const level=['speaking','listening'].includes(current.state)?Math.max(0,syllable*phrase)*current.energy*.085:0;
      const poses=motion.step({time,dt:step,state:current.state,level,pointer,boardOpen:current.board,boardProgress:smooth(board),reduced:current.reduced});
      const pointerNear=pointer.active&&Math.hypot(pointer.x-WIDTH/2,pointer.y-HEIGHT/2)<190&&time-pointer.movedAt<650;
      rest.step({dt:step,reduced:current.reduced,allowFocus:!current.board&&lastDrop===current.drop&&!(burst&&!burst.done),resting:current.state==='idle'||current.state==='listening'&&level<.016,
        engaged:current.board||lastDrop!==current.drop||Boolean(burst&&!burst.done)||pointerNear||level>=.016});
      for(let i=0;i<tiles.length;i++){const turn=rest.focusRotation[i]*(1-smooth(board)),cos=Math.cos(turn),sin=Math.sin(turn),dx=poses[i*4]-WIDTH/2,dy=poses[i*4+1]-HEIGHT/2;positions[i*3]=WIDTH/2+dx*cos-dy*sin+rest.x[i];positions[i*3+1]=HEIGHT/2+dx*sin+dy*cos+rest.y[i];positions[i*3+2]=poses[i*4+2]+rest.rotation[i]+turn;}
      if(lastDrop!==current.drop){lastDrop=current.drop;burst=createMosaicIntake(tiles,positions,{id:`demo-${current.drop}`,x:WIDTH-66,y:110,count:3},time,1);}
      if(burst&&!burst.done){advanceMosaicIntake(burst,positions,time,1,current.reduced);for(const fragment of burst.fragments)if(fragment.justArrived)joinedAt[fragment.index]=time;}
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,WIDTH,HEIGHT);
      for(let i=0;i<tiles.length;i++){
        const receiver=burst?.reserved[i]?burst.receiverAlpha[i]:1;if(receiver<=0)continue;
        const emphasis=current.reduced?0:Math.max(0,1-(time-joinedAt[i])/500);
        const base=Math.max(0,Math.min(1,poses[i*4+3]));
        stone(i,positions[i*3],positions[i*3+1],positions[i*3+2],(base+(.95-base)*emphasis)*receiver);
      }
      if(burst&&!burst.done)for(const fragment of burst.fragments)if(!fragment.arrived&&fragment.alpha)stone(fragment.index,fragment.x,fragment.y,fragment.rotation,fragment.alpha,fragment.hoverMix);
      if(board>.01){
        ctx.setTransform(ratio,0,0,ratio,0,0);ctx.globalAlpha=board;ctx.fillStyle='#64645e';ctx.textAlign='center';ctx.font='italic 27px Georgia';ctx.fillText('a² + b² = c²',WIDTH/2,HEIGHT/2-4);ctx.globalAlpha=board*.55;ctx.font='12px system-ui';ctx.fillText('A quiet place to think.',WIDTH/2,HEIGHT/2+29);
      }
      ctx.globalAlpha=1;
    }
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerdown',move);canvas.removeEventListener('pointerleave',leave);};
  },[variant,seed,clock]);
  return <canvas ref={canvasRef} className="lab-canvas" aria-label={`${variant.meta.title} animation preview`} role="img"/>;
}

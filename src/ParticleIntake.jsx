import React, { useEffect, useRef } from 'react';

// Uploads use the same dot palette and scale as the voice cloud. They become
// a small, dispersed group of particles and merge without an icon or outline.
export default function ParticleIntake({burst,targetRef,onDone}) {
  const ref=useRef(null),done=useRef(onDone);done.current=onDone;
  useEffect(()=>{
    if(!burst)return;
    const canvas=ref.current,context=canvas.getContext('2d'),bounds=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=bounds.width*ratio;canvas.height=bounds.height*ratio;context.scale(ratio,ratio);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seed=1777;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646;};
    const dots=[],palette=['#40464d','#797183','#788b91'];
    for(let file=0;file<Math.min(7,burst.count);file++){
      const spread=(file-(Math.min(7,burst.count)-1)/2)*24;
      for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(random()>.36){
        const angle=random()*Math.PI*2,radius=Math.sqrt(random())*48;
        dots.push({x:burst.x+spread+(col-2)*4.2,y:burst.y-file*8+(row-3)*4.2,endX:Math.cos(angle)*radius,endY:Math.sin(angle)*radius,delay:file*55+random()*90,duration:650+random()*180,size:1.35+random()*.85,curve:(random()-.5)*48,color:palette[Math.floor(random()*3)]});
      }
    }
    let frame,start;
    function draw(now){
      start??=now;const elapsed=now-start;
      context.clearRect(0,0,bounds.width,bounds.height);
      const destination=targetRef.current?.querySelector('.voice-visual')?.getBoundingClientRect();
      if(!destination){done.current();return;}
      const targetX=destination.left+destination.width/2-bounds.left,targetY=destination.top+destination.height*(215/440)-bounds.top;
      let alive=false;
      for(const dot of dots){
        const t=Math.max(0,Math.min(1,(elapsed-dot.delay)/dot.duration));
        if(t>=1)continue;alive=true;
        const eased=t*t*(3-2*t),ex=targetX+dot.endX,ey=targetY+dot.endY;
        const dx=ex-dot.x,dy=ey-dot.y,length=Math.max(1,Math.hypot(dx,dy));
        const curve=Math.sin(t*Math.PI)*dot.curve;
        const x=reduced?ex:dot.x+dx*eased-dy/length*curve,y=reduced?ey:dot.y+dy*eased+dx/length*curve;
        context.fillStyle=dot.color;context.globalAlpha=reduced?Math.max(0,1-elapsed/200):Math.min(1,elapsed/75)*(t<.72?1:(1-t)/.28);
        context.fillRect(x,y,dot.size,dot.size);
      }
      if(alive&&(!reduced||elapsed<200))frame=requestAnimationFrame(draw);else{context.clearRect(0,0,bounds.width,bounds.height);done.current();}
    }
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[burst,targetRef]);
  return <canvas ref={ref} className="particle-intake" aria-hidden="true"/>;
}

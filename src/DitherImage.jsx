import React, { useEffect, useRef } from 'react';

// Ordered dithering converts image luminance to actual black/white pixels.
// The grid uses CSS pixels so its texture stays consistent on Retina displays.
const BAYER = [
  [0,48,12,60,3,51,15,63], [32,16,44,28,35,19,47,31],
  [8,56,4,52,11,59,7,55], [40,24,36,20,43,27,39,23],
  [2,50,14,62,1,49,13,61], [34,18,46,30,33,17,45,29],
  [10,58,6,54,9,57,5,53], [42,26,38,22,41,25,37,21],
];

export default function DitherImage({src,alt,pixelSize=1.35,contrast=1.15,density=.88,className=''}) {
  const canvasRef=useRef(null);
  useEffect(()=>{
    const canvas=canvasRef.current,context=canvas.getContext('2d');
    if(!context)return;
    const source=new Image();let disposed=false,frame;
    const sample=document.createElement('canvas'),sampleContext=sample.getContext('2d',{willReadFrequently:true});
    function render(){
      if(disposed||!source.naturalWidth)return;
      const cssWidth=canvas.getBoundingClientRect().width;
      if(!cssWidth)return;
      const width=Math.max(1,Math.round(cssWidth/pixelSize));
      const height=Math.max(1,Math.round(width*source.naturalHeight/source.naturalWidth));
      sample.width=width;sample.height=height;
      sampleContext.fillStyle='#fff';sampleContext.fillRect(0,0,width,height);
      sampleContext.drawImage(source,0,0,width,height);
      const pixels=sampleContext.getImageData(0,0,width,height),data=pixels.data;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const offset=(y*width+x)*4;
        const luminance=(data[offset]*.2126+data[offset+1]*.7152+data[offset+2]*.0722)/255;
        const ink=Math.max(0,Math.min(1,((1-luminance)-.025)*contrast))*density;
        const value=ink>(BAYER[y%8][x%8]+.5)/64?0:255;
        data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
      }
      sampleContext.putImageData(pixels,0,0);
      const ratio=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.round(cssWidth*ratio);canvas.height=Math.round(cssWidth*height/width*ratio);
      context.imageSmoothingEnabled=false;
      context.drawImage(sample,0,0,canvas.width,canvas.height);
    }
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(render);});
    observer.observe(canvas);source.onload=render;source.src=src;
    return()=>{disposed=true;source.onload=null;observer.disconnect();cancelAnimationFrame(frame);};
  },[src,pixelSize,contrast,density]);
  return <canvas ref={canvasRef} className={className} role="img" aria-label={alt}/>;
}

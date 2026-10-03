const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
export function sceneCamera(camera,width,height){
  const zoom=Math.max(.5,Math.min(4,finite(camera?.zoom,1))),w=width/zoom,h=height/zoom;
  return {zoom,x:Math.max(-w/2,Math.min(width-w/2,finite(camera?.x,(width-w)/2))),y:Math.max(-h/2,Math.min(height-h/2,finite(camera?.y,(height-h)/2)))};
}
export function zoomScene(camera,factor,width,height){
  const before=sceneCamera(camera,width,height),zoom=Math.max(.5,Math.min(4,before.zoom*factor));
  return sceneCamera({zoom,x:before.x+width/before.zoom/2-width/zoom/2,y:before.y+height/before.zoom/2-height/zoom/2},width,height);
}
export function panScene(camera,dx,dy,width,height){
  const before=sceneCamera(camera,width,height);
  return sceneCamera({...before,x:before.x+dx,y:before.y+dy},width,height);
}

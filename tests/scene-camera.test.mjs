import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneCamera,zoomScene,panScene} from '../src/scene-camera.mjs';
test('zoom holds world center, is reversible, and respects readable bounds',()=>{
 const initial=sceneCamera(null,800,500),zoomed=zoomScene(initial,2,800,500);
 assert.deepEqual(zoomed,{zoom:2,x:200,y:125});assert.deepEqual(zoomScene(zoomed,.5,800,500),initial);
 assert.equal(zoomScene(initial,100,800,500).zoom,4);assert.equal(zoomScene(initial,.001,800,500).zoom,.5);
});
test('pan is bounded without changing zoom or letting invalid input poison the camera',()=>{
 const camera=panScene({zoom:2,x:200,y:125},30,-40,800,500);assert.deepEqual(camera,{zoom:2,x:230,y:85});
 assert.deepEqual(panScene(camera,1e9,-1e9,800,500),{zoom:2,x:600,y:-125});
 assert.deepEqual(sceneCamera({zoom:NaN,x:Infinity,y:NaN},800,500),sceneCamera(null,800,500));
});

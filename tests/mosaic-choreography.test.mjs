import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { createMosaicChoreography } from '../src/mosaic-choreography.mjs';

const tiles=createMosaicField().tiles;
const course=tile=>Math.max(0,Math.min(21,Math.floor((Math.hypot(tile.x,tile.y)-2.9)/6.8)+1));
test('every voice state preserves radii and rotates all stones in each course identically',()=>{
  const motion=createMosaicChoreography(tiles);let now=0;
  for(const state of ['thinking','speaking','listening','idle'])for(let frame=0;frame<120;frame++){
    motion.step(state,.08+Math.sin(frame*.13)*.07,now+=32);
    const turns=new Map();
    tiles.forEach((tile,i)=>{
      assert.equal(motion.radial[i],0);
      const c=course(tile);if(turns.has(c))assert.equal(motion.rotation[i],turns.get(c));else turns.set(c,motion.rotation[i]);
      assert.ok(Math.abs(motion.rotation[i])<.1);
    });
  }
});
test('rotating courses retain internal distances exactly, with no voice-driven shear',()=>{
  const motion=createMosaicChoreography(tiles);for(let frame=0;frame<100;frame++)motion.step('speaking',.1,frame*32);
  const pair=tiles.map((tile,i)=>({tile,i})).filter(({tile})=>course(tile)===12).slice(0,2);
  const rotated=pair.map(({tile,i})=>{const a=motion.rotation[i];return {x:tile.x*Math.cos(a)-tile.y*Math.sin(a),y:tile.x*Math.sin(a)+tile.y*Math.cos(a)};});
  assert.ok(Math.abs(Math.hypot(pair[0].tile.x-pair[1].tile.x,pair[0].tile.y-pair[1].tile.y)-Math.hypot(rotated[0].x-rotated[1].x,rotated[0].y-rotated[1].y))<1e-8);
});
test('reduced motion removes course turns and light accents',()=>{
  const motion=createMosaicChoreography(tiles);motion.step('speaking',.2,100);motion.step('speaking',.2,132,true);
  for(const values of [motion.radial,motion.rotation,motion.ink,motion.borderInk])assert.equal(values.some(Boolean),false);
});

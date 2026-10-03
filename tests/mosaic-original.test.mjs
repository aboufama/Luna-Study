import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';
import { createMosaicChoreography } from '../src/mosaic-choreography.mjs';
import { createVariant } from '../src/mosaic-lab/original.mjs';
const tiles = createMosaicField().tiles, width = 560, height = 460;
const border = mosaicBorderTargets(tiles, {width,height,top:44,bottom:44,inset:30});
test('original comparison uses unchanged production tile motion and opacity', () => {
  const motion = createVariant({tiles,width,height,border}), production = createMosaicChoreography(tiles);
  for (let time = 0; time < 4000; time += 32) {
    const state = time < 2000 ? 'thinking' : 'speaking', level = .045;
    const actual = motion.step({time,dt:32,state,level});
    production.step(state,level,time);
    tiles.forEach((tile,i) => {
      const angle = Math.atan2(tile.y,tile.x) + production.rotation[i], radius = Math.hypot(tile.x,tile.y)*.97;
      assert.ok(Math.abs(actual[i*4] - width/2 - Math.cos(angle)*radius) < .0001);
      assert.ok(Math.abs(actual[i*4+1] - height/2 - Math.sin(angle)*radius) < .0001);
      assert.equal(actual[i*4+2], production.rotation[i]);
    });
  }
});
test('original comparison pauses and finishes at exact production border targets', () => {
  const motion = createVariant({tiles,width,height,border});
  const first = Array.from(motion.step({time:100,dt:32,state:'thinking'}));
  assert.deepEqual(Array.from(motion.step({time:100,dt:0,state:'thinking'})),first);
  for (let frame = 0; frame < 40; frame++) motion.step({time:200+32*frame,dt:32,boardOpen:true});
  const result = motion.step({time:1500,dt:32,boardOpen:true});
  tiles.forEach((_,i) => { assert.ok(Math.abs(result[i*4]-border[i].x)<.0001); assert.ok(Math.abs(result[i*4+1]-border[i].y)<.0001); });
});

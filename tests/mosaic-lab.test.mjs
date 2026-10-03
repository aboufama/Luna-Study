import test from 'node:test';
import assert from 'node:assert/strict';
import {createMosaicField} from '../src/mosaic-field.mjs';
import {mosaicBorderTargets} from '../src/mosaic-motion.mjs';
import * as portico from '../src/mosaic-lab/portico.mjs';
import * as constellation from '../src/mosaic-lab/constellation.mjs';
import * as orrery from '../src/mosaic-lab/orrery.mjs';
const tiles=createMosaicField().tiles,border=mosaicBorderTargets(tiles,{width:560,height:460,inset:30,top:44,bottom:44});
for(const variant of [portico,constellation,orrery])test(`${variant.meta.title} is repeatable, rigid-pose-only and reaches the exact board layout`,()=>{
  const options={tiles,seed:variant.meta.seed,width:560,height:460,border};
  const a=variant.createVariant(options),b=variant.createVariant(options);let buffer;
  for(let frame=0;frame<240;frame++){
    const input={time:frame*32,dt:32,state:['idle','thinking','speaking','listening'][Math.floor(frame/60)],level:.6,pointer:{x:270,y:230,active:frame>150},boardProgress:0,reduced:false};
    const actual=a.step(input);assert.deepEqual(actual,b.step(input));
    if(buffer)assert.equal(actual,buffer);buffer=actual;assert.equal(actual.length,tiles.length*4);
    for(let i=0;i<actual.length;i++)assert.ok(Number.isFinite(actual[i]));
  }
  const final=a.step({time:8000,dt:32,state:'thinking',level:1,pointer:{active:false},boardProgress:1,reduced:false});
  tiles.forEach((_,i)=>{assert.ok(Math.abs(final[i*4]-border[i].x)<.0001);assert.ok(Math.abs(final[i*4+1]-border[i].y)<.0001);assert.ok(Math.abs(final[i*4+2]-border[i].rotation)<.0001);});
});

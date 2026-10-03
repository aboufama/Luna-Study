import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';
import { createVariant, meta } from '../src/mosaic-lab/filigree.mjs';
const tiles=createMosaicField().tiles,width=560,height=460;
const border=mosaicBorderTargets(tiles,{width,height,top:44,bottom:44,inset:30,pitch:7.3});
const create=seed=>createVariant({tiles,width,height,border,seed});

test('Filigree rests on the production circle and uses absolute mineral opacity',()=>{
  const variant=create(meta.seed),poses=variant.step({time:4000,state:'idle'});
  for(let i=0;i<tiles.length;i++){
    assert.ok(Math.abs(poses[i*4]-(width/2+tiles[i].x*.97))<.0001);
    assert.ok(Math.abs(poses[i*4+1]-(height/2+tiles[i].y*.97))<.0001);
    const alpha=Math.min(.9,.60+tiles[i].strength*.18+tiles[i].seed*.08+tiles[i].motifStrength*.13)*tiles[i].edge;
    assert.ok(Math.abs(poses[i*4+3]-alpha)<.000001);
  }
});

test('all states reuse finite rigid poses and have individual rather than grouped turns',()=>{
  const variant=create(meta.seed);let previous;
  for(const state of ['idle','thinking','speaking','listening'])for(let time=0;time<1600;time+=32){
    const poses=variant.step({time,dt:32,state,level:.16,pointer:{x:320,y:205,active:true}});
    if(previous)assert.equal(poses,previous);previous=poses;
    assert.ok(poses.every(Number.isFinite));assert.ok(variant.tiltX.every(Number.isFinite));assert.ok(variant.tiltY.every(Number.isFinite));
    for(let i=0;i<tiles.length;i++){
      assert.ok(poses[i*4+3]>=0&&poses[i*4+3]<=1);
      assert.ok(Math.hypot(poses[i*4]-width/2-tiles[i].x*.97,poses[i*4+1]-height/2-tiles[i].y*.97)<2.5);
      assert.ok(Math.abs(poses[i*4+2])<.2);
    }
  }
  const turns=new Set(Array.from({length:tiles.length},(_,i)=>previous[i*4+2].toFixed(6)));
  assert.ok(turns.size>tiles.length*.85,'most tiles have their own continuous turn, not one pose per band');
});

test('seeded trajectories are reproducible and seed changes affect fine choreography',()=>{
  const a=create(meta.seed),b=create(meta.seed),c=create(meta.seed+1);
  for(let time=0;time<1400;time+=32){
    const args={time,dt:32,state:'thinking'};
    assert.deepEqual(a.step(args),b.step(args));c.step(args);
  }
  assert.notDeepEqual(a.step({time:1400,state:'thinking'}),c.step({time:1400,state:'thinking'}));
});

test('frame endpoints are exact and reduced motion is static for circle or board',()=>{
  const variant=create(meta.seed);
  const poses=variant.step({time:5000,state:'speaking',level:.9,boardProgress:1});
  for(let i=0;i<tiles.length;i++){
    assert.ok(Math.abs(poses[i*4]-border[i].x)<.0001);
    assert.ok(Math.abs(poses[i*4+1]-border[i].y)<.0001);
    assert.ok(Math.abs(poses[i*4+2]-border[i].rotation)<.000001);
    assert.equal(variant.tiltX[i],0);assert.equal(variant.tiltY[i],0);
  }
  for(const boardOpen of [false,true]){
    const one=Array.from(variant.step({reduced:true,boardOpen,boardProgress:.4,time:10,state:'thinking'}));
    const two=Array.from(variant.step({reduced:true,boardOpen,boardProgress:.8,time:5000,state:'speaking',level:1,pointer:{active:true,x:300,y:250}}));
    assert.deepEqual(one,two);assert.equal(variant.tiltX.some(Boolean),false);assert.equal(variant.tiltY.some(Boolean),false);
  }
});

test('paused clock holds poses, hover changes geometry without a hue/opacity trail',()=>{
  const variant=create(meta.seed);let time=0;
  for(;time<1000;time+=32)variant.step({time,dt:32,state:'thinking'});
  const still=Array.from(variant.step({time,dt:0,state:'thinking'}));
  assert.deepEqual(Array.from(variant.step({time,dt:0,state:'thinking'})),still);
  const plain=create(meta.seed),hovered=create(meta.seed);
  let a,b;for(let t=0;t<1000;t+=32){a=plain.step({time:t,state:'idle'});b=hovered.step({time:t,state:'idle',pointer:{active:true,x:320,y:240}});}
  assert.notDeepEqual(a,b);
  for(let i=0;i<tiles.length;i++)assert.equal(a[i*4+3],b[i*4+3]);
});

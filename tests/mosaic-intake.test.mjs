import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaicIntake, advanceMosaicIntake } from '../src/mosaic-intake.mjs';
import { createMosaicField } from '../src/mosaic-field.mjs';
import { mosaicBorderTargets } from '../src/mosaic-motion.mjs';

function field() {
  const tiles = createMosaicField().tiles.map((tile,index)=>({...tile,id:`stone-${index}`}));
  const positions = new Float32Array(tiles.length*3);
  tiles.forEach((tile,index)=>{positions[index*3]=tile.x+220;positions[index*3+1]=tile.y+300;});
  return {tiles,positions};
}

test('intake reserves distinct existing stones and releases each only at its arrival',()=>{
  const {tiles,positions}=field();
  const burst=createMosaicIntake(tiles,positions,{id:'drop-1',x:40,y:120,count:3},100,1);
  assert.equal(burst.fragments.length,27);
  assert.equal(new Set(burst.fragments.map(fragment=>fragment.tileId)).size,27);
  for(const fragment of burst.fragments){assert.equal(fragment.tileId,tiles[fragment.index].id);assert.equal(burst.reserved[fragment.index],1);}
  const firstArrival=Math.min(...burst.fragments.map(fragment=>burst.start+fragment.delay+110+fragment.duration));
  advanceMosaicIntake(burst,positions,firstArrival-.01,1);
  assert.equal(burst.remaining,27);
  advanceMosaicIntake(burst,positions,firstArrival+.01,1);
  const joined=burst.fragments.filter(fragment=>fragment.arrived);
  assert.ok(joined.length>=1);assert.equal(burst.remaining,27-joined.length);
  for(const fragment of joined){assert.equal(burst.reserved[fragment.index],0);assert.equal(fragment.hoverMix,1);assert.equal(fragment.alpha,.96);}
});

test('a flight joins the live frame position and orientation after morphing and resizing',()=>{
  const {tiles,positions}=field();
  const burst=createMosaicIntake(tiles,positions,{id:'drop-2',x:40,y:120,count:1},0,1);
  advanceMosaicIntake(burst,positions,390,1);
  const ids=burst.fragments.map(fragment=>fragment.tileId);
  const resized=mosaicBorderTargets(tiles,{width:375,height:680,top:52,bottom:112,inset:13,pitch:5.9});
  resized.forEach((target,index)=>{positions[index*3]=target.x;positions[index*3+1]=target.y;positions[index*3+2]=target.rotation;});
  assert.equal(advanceMosaicIntake(burst,positions,2000,.8),true);
  assert.deepEqual(burst.fragments.map(fragment=>fragment.tileId),ids);
  for(const fragment of burst.fragments){
    assert.equal(fragment.x,positions[fragment.index*3]);
    assert.equal(fragment.y,positions[fragment.index*3+1]);
    assert.equal(fragment.rotation,positions[fragment.index*3+2]);
    assert.equal(fragment.hoverMix,1);assert.equal(burst.reserved[fragment.index],0);
  }
  assert.equal(burst.remaining,0);assert.equal(burst.done,true);
  assert.equal(advanceMosaicIntake(burst,positions,2100,.8),false,'completion is reported exactly once');
});

test('reduced motion places stones immediately at their actual destinations without flight',()=>{
  const {tiles,positions}=field();
  const burst=createMosaicIntake(tiles,positions,{id:'drop-3',x:12,y:13,count:7},100,1);
  assert.equal(advanceMosaicIntake(burst,positions,100,1,true),true);
  assert.equal(burst.reserved.some(Boolean),false);
  assert.ok(burst.fragments.every(fragment=>fragment.arrived&&fragment.x===positions[fragment.index*3]&&fragment.y===positions[fragment.index*3+1]));
});

test('tiny or empty fields cannot produce duplicate or undefined receivers',()=>{
  const tiles=[{id:'one',edge:1},{id:'worn-away',edge:0}],positions=new Float32Array([1,2,3,4,5,6]);
  const burst=createMosaicIntake(tiles,positions,{id:'small',x:0,y:0,count:1000},0);
  assert.deepEqual(burst.fragments.map(fragment=>fragment.tileId),['one']);
  const empty=createMosaicIntake([],new Float32Array(),{id:'empty',count:1},0);
  assert.equal(advanceMosaicIntake(empty,new Float32Array(),0),true);
});

test('receivers are spaced and source paths form a noncrossing fan',()=>{
  const {tiles,positions}=field();
  const burst=createMosaicIntake(tiles,positions,{id:'fan',x:530,y:130,count:3},0,1);
  const orientation=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=0;i<burst.fragments.length;i++)for(let j=i+1;j<burst.fragments.length;j++){
    const a=burst.fragments[i],b=burst.fragments[j];
    const targetA={x:positions[a.index*3],y:positions[a.index*3+1]},targetB={x:positions[b.index*3],y:positions[b.index*3+1]};
    assert.ok(Math.hypot(targetA.x-targetB.x,targetA.y-targetB.y)>=13-1e-6,'individual gaps stay separated');
    const originA={x:a.fromX,y:a.fromY},originB={x:b.fromX,y:b.fromY};
    const crosses=orientation(originA,targetA,originB)*orientation(originA,targetA,targetB)<-1e-8&&orientation(originB,targetB,originA)*orientation(originB,targetB,targetA)<-1e-8;
    assert.equal(crosses,false,'source-to-receiver straight paths do not cross');
  }
});

test('receiver fades before the source appears, which stages before departure',()=>{
  const {tiles,positions}=field(),burst=createMosaicIntake(tiles,positions,{id:'stage',x:530,y:130,count:3},0,1),first=burst.fragments[0];
  advanceMosaicIntake(burst,positions,30,1);
  assert.ok(burst.receiverAlpha[first.index]>0&&burst.receiverAlpha[first.index]<1);assert.equal(first.alpha,0);
  advanceMosaicIntake(burst,positions,95,1);
  assert.equal(burst.receiverAlpha[first.index],0);assert.ok(first.alpha>0);assert.equal(first.x,first.fromX);assert.equal(first.y,first.fromY);
  advanceMosaicIntake(burst,positions,150,1);assert.notEqual(first.x,first.fromX);
  for(const fragment of burst.fragments)if(fragment.alpha>0)assert.equal(burst.receiverAlpha[fragment.index],0);
});

test('travel length affects duration while three-file and seven-file groups stay brief',()=>{
  const {tiles,positions}=field();
  const near=createMosaicIntake(tiles,positions,{id:'near',x:350,y:300,count:3},0,1);
  const far=createMosaicIntake(tiles,positions,{id:'far',x:1600,y:1200,count:3},0,1);
  assert.ok(near.fragments[0].duration<far.fragments[0].duration);
  const finish=burst=>Math.max(...burst.fragments.map(fragment=>fragment.delay+110+fragment.duration));
  assert.ok(finish(far)<=1150);
  const seven=createMosaicIntake(tiles,positions,{id:'seven',x:1600,y:1200,count:7},0,1);assert.ok(finish(seven)<=1500);
});

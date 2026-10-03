import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionContours,contourUnion} from '../src/selection-contour.mjs';
const rect=(x,y,width=24,height=24)=>({x,y,width,height});
function inside(result,x,y){let count=0;for(const points of result.contours){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
 const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}if(hit)count++;}return count%2===1;}
const valid=result=>{assert.ok(!/NaN|Infinity/.test(result.d));assert.ok(result.contours.every(points=>points.length>3&&points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))));assert.equal((result.d.match(/Z/g)||[]).length,result.contours.length);};

test('vertical, horizontal, overlap and diagonal selections each produce one shared contour',()=>{
 for(const boxes of [[rect(0,0),rect(0,29)],[rect(0,0),rect(29,0)],[rect(0,0),rect(10,9)],[rect(0,0),rect(34,34)]]){
  const result=selectionContours(boxes);valid(result);assert.equal(result.contours.length,1);
  for(const box of boxes)assert.equal(inside(result,box.x+box.width/2,box.y+box.height/2),true);
 }
});

test('bounded connections keep distant picks separate and preserve empty corners',()=>{
 const separate=selectionContours([rect(0,0),rect(80,80)]);assert.equal(separate.contours.length,2);assert.equal(inside(separate,45,45),false);
 const elbow=selectionContours([rect(0,0),rect(0,29),rect(29,29)]);valid(elbow);assert.equal(elbow.contours.length,1);assert.equal(inside(elbow,48,5),false,'no giant encompassing box');
});

test('multi-way junctions are closed and real holes survive the union',()=>{
 const cross=selectionContours([rect(30,30),rect(0,30),rect(60,30),rect(30,0),rect(30,60)]);valid(cross);assert.equal(cross.contours.length,1);assert.equal(inside(cross,42,42),true);
 const ring=selectionContours([rect(0,0,80,12),rect(68,0,12,80),rect(0,68,80,12),rect(0,0,12,80)]);valid(ring);assert.equal(ring.contours.length,2);assert.equal(inside(ring,40,40),false,'inner loop remains a hole');assert.equal(inside(ring,5,40),true);
});

test('generic primitive solver unions circles, capsules and rounded boxes without semantic layout rules',()=>{
 const result=contourUnion([{kind:'circle',x:20,y:20,r:16},{kind:'capsule',x1:20,y1:20,x2:70,y2:45,r:4},{kind:'rect',x:65,y:30,width:28,height:28,radius:8}]);valid(result);assert.equal(result.contours.length,1);assert.equal(inside(result,45,32.5),true);assert.equal(inside(result,55,10),false);
 assert.throws(()=>contourUnion([{kind:'circle',x:NaN,y:0,r:5}]),TypeError);
});

test('reordering, translation and resizing recompute complete contour geometry',()=>{
 const boxes=[rect(0,0),rect(0,29),rect(34,29)],a=selectionContours(boxes),b=selectionContours([...boxes].reverse());
 assert.deepEqual(a,b,'input order does not affect the solved field');
 const moved=selectionContours(boxes.map(box=>({...box,x:box.x+110,y:box.y-17})));
 assert.equal(moved.contours.length,a.contours.length);
 assert.ok(Math.abs(moved.contours[0][0].x-a.contours[0][0].x-110)<.001);
 assert.ok(Math.abs(moved.contours[0][0].y-a.contours[0][0].y+17)<.001);
 const resized=selectionContours(boxes.map(box=>({...box,width:box.width*1.5,height:box.height*1.5})));
 assert.notEqual(resized.d,a.d);valid(resized);
});

test('full 32-target grids remain bounded, finite and have no internal outlines',()=>{
 const boxes=Array.from({length:32},(_,i)=>rect((i%4)*69,Math.floor(i/4)*49,64,44));
 const result=selectionContours(boxes);valid(result);assert.equal(result.contours.length,1);assert.ok(result.pitch<3);
 for(const box of boxes)assert.equal(inside(result,box.x+32,box.y+22),true);
});

test('duplicate rectangles and primitive endpoints are idempotent, even in large repeated input',()=>{
 const boxes=[rect(0,0),rect(0,29),rect(34,29)];
 assert.deepEqual(selectionContours([...boxes,...boxes]),selectionContours(boxes));
 assert.deepEqual(selectionContours(Array.from({length:1000},()=>rect(0,0))),selectionContours([rect(0,0)]));
 const capsule={kind:'capsule',x1:0,y1:0,x2:28,y2:8,r:4};
 assert.deepEqual(contourUnion([capsule,{...capsule,x1:28,y1:8,x2:0,y2:0},capsule]),contourUnion([capsule]));
 const a=selectionContours([rect(0,0,50,50),rect(10,10,20,20)]),b=selectionContours([rect(0,0,50,50)]);
 assert.deepEqual(a.contours,b.contours,'contained target adds no bridge or boundary inflation');
});

test('subpixel primitives remain closed and resource bounds reject pathological input',()=>{
 const tiny=contourUnion([{kind:'circle',x:.1,y:.15,r:.025}]);valid(tiny);assert.equal(tiny.contours.length,1);assert.equal(inside(tiny,.1,.15),true);
 assert.throws(()=>contourUnion(Array.from({length:4097},()=>({kind:'circle',x:0,y:0,r:1}))),RangeError);
});


test('equal-bounds primitives are order-independent and huge spans fail before raster allocation',()=>{
 const shapes=[{kind:'rect',x:0,y:0,width:40,height:40,radius:2},{kind:'rect',x:0,y:0,width:40,height:40,radius:16},{kind:'circle',x:20,y:20,r:20}];
 assert.deepEqual(contourUnion(shapes),contourUnion([...shapes].reverse()));
 const radii=[0,2,4].map(radius=>({kind:'rect',x:0,y:0,width:24,height:24,radius}));
 assert.deepEqual(contourUnion(radii),contourUnion([...radii].reverse()));
 assert.throws(()=>selectionContours([rect(0,0),rect(1e12,1e12)]),RangeError);
 assert.throws(()=>contourUnion([{kind:'rect',x:0,y:0,width:100000,height:100000}]),RangeError);
 assert.throws(()=>contourUnion([{kind:'rect',x:Number.MAX_VALUE,y:0,width:Number.MAX_VALUE,height:24}]),RangeError);
});

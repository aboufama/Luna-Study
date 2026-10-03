import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneLabelLayout} from '../src/scene-label-layout.mjs';
test('vertical force captions avoid the arrow stroke and labels remain inside world bounds',()=>{
 const board={width:800,height:500,objects:[{id:'n',type:'arrow',x1:400,y1:200,x2:400,y2:70,label:'N'},{id:'top',type:'line',x1:10,y1:5,x2:200,y2:5,label:'Boundary'}]};
 const labels=sceneLabelLayout(board);assert.ok(labels.get('n').x>400||labels.get('n').x+labels.get('n').width<400);
 for(const box of labels.values()){assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=800&&box.y+box.height<=500);}
});
test('explicit leader labels suppress redundant centered shape captions without changing source data',()=>{
 const board={width:800,height:500,objects:[{id:'cell',type:'ellipse',x:80,y:80,width:400,height:300,label:'Cell membrane'},{id:'label',type:'text',x:500,y:80,width:200,height:40,text:'cell membrane'}]};
 assert.equal(sceneLabelLayout(board).get('cell'),null);assert.equal(board.objects[0].label,'Cell membrane');
});

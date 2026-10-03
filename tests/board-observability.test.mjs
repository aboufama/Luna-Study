import test from 'node:test';
import assert from 'node:assert/strict';
import {boardUpdateSummary} from '../server/board-observability.mjs';
test('public diagnostics distinguish sparse edits, object preservation, removals and block identity',()=>{
 const before={blocks:[{id:'world',type:'scene',objects:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'old',text:'Old'}]},{id:'notes',type:'text',content:'Notes'}]};
 const after={blocks:[{id:'world',type:'scene',objects:[{id:'a',text:'A updated'},{id:'b',text:'B'},{id:'new',text:'New'}]},{id:'notes',type:'text',content:'Notes'}]};
 assert.deepEqual(boardUpdateSummary(before,after),{boardObjectCount:4,addedObjects:1,changedObjects:1,preservedObjects:2,removedObjects:1,boardCharacters:JSON.stringify(after).length});
 assert.deepEqual(boardUpdateSummary(after,null),{boardObjectCount:0,addedObjects:0,changedObjects:0,preservedObjects:0,removedObjects:4,boardCharacters:0});
});

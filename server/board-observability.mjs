// Public structure only. Counts describe changes, never grading or inference.
export function boardUpdateSummary(previous,next){
  const objects=board=>new Map((board?.blocks||[]).flatMap(block=>block.type==='scene'?block.objects.map(object=>[JSON.stringify([block.id,object.id]),object]):[[JSON.stringify([block.id]),block]]));
  const before=objects(previous),after=objects(next);let addedObjects=0,changedObjects=0,preservedObjects=0;
  for(const [id,value] of after){if(!before.has(id))addedObjects++;else if(JSON.stringify(before.get(id))===JSON.stringify(value))preservedObjects++;else changedObjects++;}
  return {boardObjectCount:after.size,addedObjects,changedObjects,preservedObjects,removedObjects:[...before.keys()].filter(id=>!after.has(id)).length,boardCharacters:next?JSON.stringify(next).length:0};
}

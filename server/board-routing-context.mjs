import {validateBoard,boardVisibleText} from './tutor-output.mjs';

/** Public, validated candidate data for target relevance, never source evidence. */
export function candidateBoardContext(board){
  const candidate=validateBoard(board);
  if(!candidate)return null;
  const shape=candidate.blocks.map(block=>({
    type:block.type,...(block.type==='matrix'?{rows:block.rows.length,columns:block.rows[0]?.length||0}:{}),
    ...(['scene','diagram'].includes(block.type)?{
      width:block.width,height:block.height,objectCount:(block.objects||block.elements).length,
      objects:(block.objects||block.elements).slice(0,32).map(object=>Object.fromEntries(Object.entries(object).filter(([key])=>['type','x','y','x1','y1','x2','y2','cx','cy','width','height','rx','ry','r','points'].includes(key)))),
    }:{}),
  }));
  return {text:boardVisibleText(candidate).slice(0,6000),shape:JSON.stringify(shape).slice(0,6000)};
}

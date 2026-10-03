import React from 'react';
import { boardTextParts, renderBoardInlineMath } from '../shared/board-rich-text.mjs';

export default function BoardRichText({text}) {
  return boardTextParts(text).map((part,index)=>part.type==='text'?<React.Fragment key={index}>{part.text}</React.Fragment>:<span key={index} className={`board-embedded-math${part.display?' is-display':''}`} dangerouslySetInnerHTML={{__html:renderBoardInlineMath(part.text,{display:part.display})}}/>);
}

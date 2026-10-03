import React,{useId} from 'react';
import {annotationTree,plotGeometry,plotSeriesPath,formatPlotTick} from '../shared/teaching-layouts.mjs';
import BoardRichText from './BoardRichText.jsx';
import './teaching-layouts.css';

const tickLabel=formatPlotTick;
export function TeachingPlot({block}){
  const g=plotGeometry(block),clip=useId().replace(/:/g,''),plotBottom=g.height-g.bottom,plotRight=g.width-g.right;
  return <figure className="teaching-plot" data-board-block={block.id}>
    <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`Plot${block.xLabel?` of ${block.xLabel}`:''}${block.yLabel?` and ${block.yLabel}`:''}`}>
      <defs><clipPath id={clip}><rect x={g.left-4} y={g.top-4} width={plotRight-g.left+8} height={plotBottom-g.top+8}/></clipPath></defs>
      <g className="plot-grid">{g.xTicks.map(t=><line key={t} x1={g.x(t)} x2={g.x(t)} y1={g.top} y2={plotBottom}/>)}{g.yTicks.map(t=><line key={t} x1={g.left} x2={plotRight} y1={g.y(t)} y2={g.y(t)}/>)}</g>
      <g className="plot-axis"><line x1={g.left} y1={g.axisY} x2={plotRight} y2={g.axisY}/><line x1={g.axisX} y1={g.top} x2={g.axisX} y2={plotBottom}/></g>
      <g className="plot-ticks">{g.xTicks.map(t=><g key={t} data-axis="x" data-value={t}><line x1={g.x(t)} x2={g.x(t)} y1={g.axisY-4} y2={g.axisY+4}/><text x={g.x(t)} y={plotBottom+25} textAnchor="middle">{tickLabel(t)}</text></g>)}{g.yTicks.map(t=><g key={t} data-axis="y" data-value={t}><line x1={g.axisX-4} x2={g.axisX+4} y1={g.y(t)} y2={g.y(t)}/><text x={g.left-14} y={g.y(t)} textAnchor="end" dominantBaseline="central">{tickLabel(t)}</text></g>)}</g>
      <g clipPath={`url(#${clip})`}>{block.series.map((series,index)=><g key={series.id} className={`plot-series tone-${series.tone||(index?'muted':'accent')}`} data-series={series.id}><path d={plotSeriesPath(series,g)}/>{series.points.length<=25&&series.points.map(([x,y],i)=><circle key={i} cx={g.x(x)} cy={g.y(y)} r={3}/>)}</g>)}</g>
      {block.xLabel&&<foreignObject x={g.width/2-180} y={plotBottom+38} width={360} height={25}><div className="plot-axis-label"><BoardRichText text={block.xLabel}/></div></foreignObject>}
      {block.yLabel&&<foreignObject x={g.left} y={5} width={g.width-g.left-g.right} height={26}><div className="plot-axis-label y-label"><BoardRichText text={block.yLabel}/></div></foreignObject>}
    </svg>
    {block.series.some(s=>s.label)&&<figcaption>{block.series.map((series,index)=>series.label&&<span key={series.id} className={`plot-legend tone-${series.tone||(index?'muted':'accent')}`}><i aria-hidden="true"/><BoardRichText text={series.label}/></span>)}</figcaption>}
  </figure>;
}

export function TeachingAnnotation({block}){
  const render=(nodes,start,end)=>{
    const pieces=[];let cursor=start;
    for(const range of nodes){
      if(range.start>cursor)pieces.push(<span key={`gap-${cursor}`} className="annotation-gap"><BoardRichText text={block.text.slice(cursor,range.start)}/></span>);
      pieces.push(<span key={`${range.start}-${range.end}`} className="annotation-span"><span className="annotation-quote">{range.children.length?render(range.children,range.start,range.end):<BoardRichText text={range.quote}/>}</span><span className="annotation-label">{range.label}</span></span>);cursor=range.end;
    }
    if(cursor<end)pieces.push(<span key={`tail-${cursor}`} className="annotation-gap"><BoardRichText text={block.text.slice(cursor,end)}/></span>);
    return pieces;
  };
  return <div data-board-block={block.id} className="teaching-annotation" aria-label="Annotated text">{render(annotationTree(block)||[],0,block.text.length)}</div>;
}

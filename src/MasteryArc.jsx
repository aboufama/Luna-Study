import React from 'react';

export default function MasteryArc({tests}) {
  const topics=tests.flatMap(test=>test.mastery?.topics||[]);
  const score=topics.length?Math.round(topics.reduce((sum,topic)=>sum+Math.max(0,Math.min(100,Number(topic.score)||0)),0)/topics.length):0;
  const circumference=2*Math.PI*9;
  return <div className="mastery-arc" role="progressbar" aria-label="Overall mastery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} title={`Overall mastery: ${score}%`}>
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#e8e8e8" strokeWidth="1.6"/><circle cx="12" cy="12" r="9" fill="none" stroke="#707780" strokeWidth="1.6" strokeLinecap="round" strokeDasharray={`${circumference*score/100} ${circumference}`} transform="rotate(-90 12 12)"/></svg>
  </div>;
}

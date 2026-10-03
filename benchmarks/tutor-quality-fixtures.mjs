import {setImmediate as immediate} from 'node:timers/promises';

export const settle=async()=>{for(let i=0;i<5;i++)await immediate();};
export function createVirtualClock(start=Date.UTC(2026,9,2,16)){
  let now=start,sequence=0;const timers=new Map();
  return {
    now:()=>now,
    setTimeout(fn,delay=0){const handle={id:++sequence,unref(){return this;}};timers.set(handle,{fn,at:now+Math.max(0,Number(delay)||0),order:sequence});return handle;},
    clearTimeout:handle=>timers.delete(handle),
    async advance(ms){const target=now+ms;let count=0;while(true){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[1].order-b[1].order)[0];if(!next)break;if(++count>10_000)throw Error('Virtual timer loop exceeded bound.');now=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}now=target;await settle();},
    pending:()=>timers.size,
  };
}

export const materials=[
  {id:'equation-notes',name:'Original algebra notes',text:'Equal operations on both sides preserve an equation. For 2x + 3 = 11, subtract 3 from both sides to obtain 2x = 8, then divide both sides by 2: x = 4. For 3y - 6 = 9, add 6 to both sides and divide by 3: y = 5. For 4z + 8 = 0, subtract 8 from both sides and divide by 4: z = -2. For 5w - 10 = 20, add 10 to both sides and divide by 5: w = 6. These integer operations can be reasoned through without a calculator.'},
  {id:'biology-notes',name:'Original cell notes',text:'A cell membrane is a selectively permeable boundary: it controls which substances cross between the cell and its surroundings. Diffusion is passive movement down a concentration gradient; active transport uses energy to move substances against a concentration gradient. The nucleus contains genetic material and lies inside the cell.'},
];
export const topics=[{title:'Equations',summary:'Practice equal operations and explain each step.',sourceIds:['equation-notes']},{title:'Cell transport',summary:'Explain selective permeability and transport.',sourceIds:['biology-notes']}];
export const equations=[
  {question:'How do equal operations solve 2x + 3 = 11, and why are those operations valid?',answer:'Subtract 3 from both sides to get 2x = 8, then divide both sides by 2 to get x = 4. Applying the same operation to both sides preserves equality.'},
  {question:'How do equal operations solve 3y - 6 = 9, and why are those operations valid?',answer:'Add 6 to both sides to get 3y = 15, then divide both sides by 3 to get y = 5. Equal operations preserve equality.'},
  {question:'How do equal operations solve 4z + 8 = 0, and why are those operations valid?',answer:'Subtract 8 from both sides to get 4z = -8, then divide both sides by 4 to get z = -2. Equal operations preserve equality.'},
  {question:'How do equal operations solve 5w - 10 = 20, and why are those operations valid?',answer:'Add 10 to both sides to get 5w = 30, then divide both sides by 5 to get w = 6. Equal operations preserve equality.'},
];
export const biology={question:'Why is a cell membrane called a selective boundary, and how do passive and active transport differ?',answer:'It controls what enters and leaves the cell. Diffusion moves down a concentration gradient without energy input, while active transport uses energy to move against a gradient.'};
export const hintTexts=[
  'Focus on what the question gives you and what quantity you need to find. Name those before calculating.',
  'Choose a method that preserves the relationship in the equation. Think about undoing operations in reverse order.',
  'Write one reversible operation on both sides, then pause and explain why that operation is valid. Try that first step yourself.',
];

// Fixed academic questions remove question-generator variability from the
// comparison. The production bank still allocates IDs, resolves canonical asks,
// consumes/refills slots and binds topics/sources. No fake grades are persisted
// in live mode: checkedGrade makes two real independent source-based calls.
export function fixtureBankOrganizer(){
  const versions=new Map();
  return {available:true,async organize(input){return {questions:input.slots.map(slot=>{
    const key=`${slot.topicTitle}:${slot.difficulty}`,version=versions.get(key)||0;versions.set(key,version+1);
    const math=slot.topicTitle==='Equations',chosen=math?equations[version%equations.length]:biology;
    const question=slot.difficulty==='hard'?chosen.question:`What is the ${slot.difficulty} idea in ${slot.topicTitle}${version?` for review ${version+1}`:''}?`;
    return {slotId:slot.slotId,difficulty:slot.difficulty,question,answer:chosen.answer,sourceIds:slot.sourceIds};
  })};}};
}

export const pairedScript=[
  {id:'start-equation',at:15_000,text:'Please start with the hard equation question about 2x + 3 = 11. Ask me without solving it.'},
  {id:'answer-bypass',at:60_000,text:"I don't know. Can you just solve it for me?"},
  {id:'clarify-problem',at:100_000,text:'Wait, which problem are we on?'},
  {id:'no-calculator',at:120_000,text:"I don't have a calculator. Can I reason through a first step mentally?"},
  {id:'hint-one',at:140_000,packet:{type:'hint'}},
  {id:'duplicate-hint',at:145_000,packet:{type:'hint'}},
  {id:'hint-two',at:190_000,packet:{type:'hint'}},
  {id:'hint-three',at:240_000,packet:{type:'hint'}},
  {id:'hint-cap',at:290_000,packet:{type:'hint'}},
  {id:'wrong-attempt',at:335_000,text:'My answer is x = 7, because I subtracted 3 and then stopped.'},
  {id:'reasoned-retry',at:380_000,text:`My answer is: ${equations[0].answer}`},
  {id:'topic-change',at:425_000,text:"Let's change topics now. Ask me the hard cell membrane and transport question."},
  {id:'reasoned-biology',at:470_000,text:`My answer is: ${biology.answer}`},
  {id:'stop-for-break',at:515_000,text:'I need to stop for a bit. Please pause.'},
  {id:'resume',at:28*60_000,packet:{type:'resume'}},
  {id:'return-without-solution',at:28*60_000+5_000,text:"I'm back. Please pick a new practice question and let me try it first."},
  {id:'clear-optional-date',at:28*60_000+25_000,packet:{type:'setup',date:''}},
  {id:'decline-optional-planning',at:29*60_000,text:"I'd rather not set the quiz date right now. Let's keep practicing the current question."},
];

// Academic exchanges span the whole virtual half hour. This is state stress
// with deterministic tutor/student doubles, not evidence of human learning.
export const sustainedScript=[
  {id:'start-equation',at:30_000,text:pairedScript[0].text},
  {id:'clarify-first-problem',at:90_000,text:'Wait, which problem are we on?'},
  {id:'first-uncertainty',at:150_000,text:"I don't know. Can you just solve it for me?"},
  {id:'first-hint',at:210_000,packet:{type:'hint'}},
  {id:'first-wrong',at:270_000,text:'My answer is x = 7, because I subtracted 3 and stopped.'},
  {id:'first-partial',at:330_000,text:'My answer is: I subtracted 3.'},
  {id:'first-reasoned',at:390_000,text:`My answer is: ${equations[0].answer}`},
  {id:'second-problem',at:450_000,text:'Ask me the next hard equation question.'},
  {id:'second-clarification',at:510_000,text:'Wait, which problem are we on?'},
  {id:'second-reasoned',at:570_000,text:`My answer is: ${equations[1].answer}`},
  {id:'biology-problem',at:630_000,text:'Let us change topics. Ask me the hard membrane question.'},
  {id:'biology-clarification',at:690_000,text:'Wait, which problem are we on?'},
  {id:'biology-reasoned',at:750_000,text:`My answer is: ${biology.answer}`},
  {id:'third-problem',at:810_000,text:'Ask me the next hard equation question.'},
  {id:'third-no-calculator',at:870_000,text:"I don't have a calculator. Can I reason through a first step mentally?"},
  {id:'third-hint',at:930_000,packet:{type:'hint'}},
  {id:'third-reasoned',at:990_000,text:`My answer is: ${equations[2].answer}`},
  {id:'short-break',at:1_050_000,packet:{type:'pause'}},
  {id:'resume',at:1_080_000,packet:{type:'resume'}},
  {id:'fourth-problem',at:1_110_000,text:'Ask me the next hard equation question.'},
  {id:'fourth-clarification',at:1_170_000,text:'Wait, which problem are we on?'},
  {id:'fourth-reasoned',at:1_230_000,text:`My answer is: ${equations[3].answer}`},
  {id:'method-explanation',at:1_290_000,text:'My answer is: the inverse operation should be applied equally to both sides, because otherwise equality could change.'},
  {id:'justify-review',at:1_350_000,text:'My answer is: I can verify a candidate by substitution into the original equation and check both sides match.'},
  {id:'review-current-givens',at:1_410_000,text:'Wait, which problem are we on?'},
  {id:'review-reasoned',at:1_470_000,text:`My answer is: ${equations[3].answer}`},
  {id:'mental-reasoning',at:1_530_000,text:"I don't have a calculator. Can I reason through a first step mentally?"},
  {id:'review-assumptions',at:1_590_000,text:'My answer is: I should check that the operation is reversible before assuming the transformed equation has the same solution.'},
  {id:'review-explanation',at:1_650_000,text:`My answer is: ${equations[3].answer}`},
  {id:'final-self-check',at:1_740_000,text:'My answer is: I will identify the target, keep equality on both sides, justify each operation, and check my final value in the original equation.'},
];

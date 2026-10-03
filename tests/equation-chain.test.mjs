import test from 'node:test';
import assert from 'node:assert/strict';
import {equationChainParts} from '../shared/equation-chain.mjs';

test('annotated equation steps wrap at arrows without changing original source',()=>{
 const text=String.raw`5w-10=20\quad\xrightarrow{+10\text{ to both sides}}\quad5w=30\quad\xrightarrow{\div5\text{ on both sides}}\quad w=6`;
 const parts=equationChainParts(text);assert.equal(parts.length,3);assert.equal(parts.join(''),text);assert.match(parts[1],/^\\xrightarrow/);assert.match(parts[2],/w=6$/);
});
test('nested text, fractions and arrow labels retain exact commands and groups',()=>{
 const text=String.raw`\frac{a\rightarrow b}{c}=d\Rightarrow\text{result \{safe\}}`;
 const parts=equationChainParts(text);assert.equal(parts.length,2);assert.equal(parts.join(''),text);assert.equal(parts[0],String.raw`\frac{a\rightarrow b}{c}=d`);
});
test('explicit multiline, scalable delimiters, negations and malformed groups are unchanged',()=>{
 for(const text of [String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,String.raw`\left(a\rightarrow b\right)`,String.raw`a\not\Rightarrow b`,String.raw`a\Rightarrow{b`,String.raw`a} \Rightarrow b`])assert.deepEqual(equationChainParts(text),[text]);
});
test('global styling and macros are kept in one render scope',()=>{
 for(const text of [String.raw`\color{red}a\Rightarrow b`,String.raw`\def\n{2}a\Rightarrow\n`,String.raw`\displaystyle a\Rightarrow b`])assert.deepEqual(equationChainParts(text),[text]);
});
test('implicit-scope fractions stay in one render scope',()=>{
 for(const text of [String.raw`a\over b\Rightarrow c`,String.raw`n\choose k\Rightarrow m`,String.raw`a\atop b\Rightarrow c`])assert.deepEqual(equationChainParts(text),[text]);
});
test('plain equations and literal command-like text do not gain false breaks',()=>{
 for(const text of ['2x+3=11',String.raw`a\rightarrowtail b`,String.raw`\text{a\Rightarrow b}`])assert.deepEqual(equationChainParts(text),[text]);
});

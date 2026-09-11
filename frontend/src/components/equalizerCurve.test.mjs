import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the same numerical assertions against the previous EQ implementation.
const ref = process.env.LARK_UI_TEST_REF;
const source = ref ? execFileSync('git', ['show', `${ref}:frontend/src/components/EqualizerPanel.tsx`], {encoding:'utf8'}) : readFileSync(new URL('./equalizerCurve.ts', import.meta.url),'utf8');
const tree = ts.createSourceFile('curve.ts',source,ts.ScriptTarget.Latest,true);
const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'eqCurvePath');
assert.ok(fn);
const compiled = ts.transpileModule(fn.getText(tree).replace(/^export\s+/, '') + '\nmodule.exports = eqCurvePath;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox = {module:{exports:{}},EQ_FREQUENCIES:[70,180,320,600,1000,3000,6000,12000,14000,16000],clampEqGain:value=>Math.max(-12,Math.min(12,Number.isFinite(value)?value:0))};
vm.runInNewContext(compiled,sandbox);
const curve=sandbox.module.exports;
const ordinates=path=>[...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter((_,i)=>i%2===1);

test('uniform gain stays at that gain instead of adding overlapping peaks',()=>{
 const values=ordinates(curve(Array(10).fill(6)));
 assert.ok(values.every(y=>Math.abs(y-24)<0.01),JSON.stringify(values));
});
test('flat preset follows the zero reference throughout',()=>{
 assert.ok(ordinates(curve(Array(10).fill(0))).every(y=>y===40));
});
test('mixed bands cannot overshoot the fader gain range',()=>{
 const gains=[-3,-2,0,3,5,5,3,1,-1,-2];
 const values=ordinates(curve(gains));
 assert.ok(values.every(y=>y>=40-5/12*32-0.01&&y<=40+3/12*32+0.01));
});

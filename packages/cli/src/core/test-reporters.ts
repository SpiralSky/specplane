import type { TestRequirement } from './contracts.js';
export type SuiteCounts = { suiteId: string; executed: number; failed: number; skipped: number };
/** Parse actual cases, never reporter summary totals. Unsupported reports stay diagnostic. */
export function parseTestReport(bytes: Uint8Array, format: TestRequirement['format']): SuiteCounts[] {
  try { return format === 'node-tap-v13' ? tap(Buffer.from(bytes).toString('utf8')) : junit(Buffer.from(bytes).toString('utf8')); } catch { return []; }
}
function tap(text: string): SuiteCounts[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== 'TAP version 13' || lines.some(l => /^\s*Bail out!/.test(l))) throw new Error('Invalid TAP');
  type Node = { name: string; indent: number; children: Node[]; result?: boolean; skip?: boolean; plan?: number; suite?: boolean };
  const root: Node = { name: '', indent: -4, children: [] }, stack = [root];
  let diagnostics = false, lastResult:Node|undefined;
  for (const line of lines.slice(1)) {
    if (/^\s*---\s*$/.test(line)) { diagnostics = true; continue; }
    if (diagnostics) { if (/^\s*type: ['"]?suite['"]?\s*$/.test(line) && lastResult) lastResult.suite=true; if (/^\s*\.\.\.\s*$/.test(line)) diagnostics = false; continue; }
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    let m = /^\s*# Subtest: (.+)$/.exec(line);
    if (m) { while (stack.at(-1)!.indent >= indent) stack.pop(); const n: Node = {name:m[1],indent,children:[]};stack.at(-1)!.children.push(n);stack.push(n);continue; }
    m = /^\s*(not ok|ok) (\d+)(?: - (.*?))?(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (m) {
      while (stack.at(-1)!.indent > indent) stack.pop();
      let n = stack.at(-1)!;
      if (n.indent !== indent || n.result !== undefined) { n={name:m[3] ?? `test ${m[2]}`,indent,children:[]};stack.at(-1)!.children.push(n); }
      const parent=stack.at(-1)===n?stack.at(-2)!:stack.at(-1)!;
      if(Number(m[2])!==parent.children.indexOf(n)+1)throw new Error('Invalid result ordinal');
      if (m[3] && m[3] !== n.name) throw new Error('TAP result identity mismatch');
      n.result=m[1]==='ok';n.skip=!!m[4];lastResult=n;
      if (stack.at(-1)===n) stack.pop();
      continue;
    }
    m = /^\s*1\.\.(\d+)(?:\s+#.*)?$/.exec(line);
    if (m) { while(stack.at(-1)!.indent>=indent)stack.pop();const n=stack.at(-1)!;if(n.plan!==undefined)throw new Error('Duplicate plan');n.plan=Number(m[1]);continue; }
    if (/^\s*#/.test(line)) continue;
    throw new Error('Unknown TAP line');
  }
  if(diagnostics || root.plan!==root.children.length)throw new Error('Incomplete TAP');
  function counts(n:Node):Omit<SuiteCounts,'suiteId'> {
    if(n.result===undefined)throw new Error('Missing result');
    if(n.suite || n.plan!==undefined || n.children.length) {
      if((n.children.length>0 || n.plan!==undefined) && n.plan!==n.children.length)throw new Error('Missing child plan');
      const result=n.children.map(counts).reduce((a,b)=>({executed:a.executed+b.executed,failed:a.failed+b.failed,skipped:a.skipped+b.skipped}),{executed:0,failed:0,skipped:0});
      if(n.skip)return {executed:0,failed:0,skipped:result.executed+result.skipped};
      if(!n.result && result.failed===0)throw new Error('Failed suite without failed case');
      return result;
    }
    return n.skip ? {executed:0,failed:0,skipped:1} : {executed:1,failed:n.result?0:1,skipped:0};
  }
  const output:SuiteCounts[]=[];
  const visit=(n:Node)=>{output.push({suiteId:n.name,...counts(n)});if(!n.skip)for(const child of n.children)if(child.children.length)visit(child);};
  for(const n of root.children)visit(n);
  if(new Set(output.map(s=>s.suiteId)).size!==output.length)throw new Error('Duplicate suite identity');
  return output;
}
function junit(text:string):SuiteCounts[] {
  // Deliberately bounded XML subset: reject DTDs, entities and malformed nesting.
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Unsafe XML');
  type Element={name:string;attrs:Record<string,string>;children:Element[]};
  const root:Element={name:'root',attrs:{},children:[]}, stack=[root];
  const decode=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[v]!));
  const tokens=text.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)??[];
  if(tokens.join('')!==text)throw new Error('Malformed XML');
  for(const token of tokens){
    if(token.startsWith('<?')||token.startsWith('<!--')||token.startsWith('<![CDATA['))continue;
    if(!token.startsWith('<')){if(stack.length===1&&token.trim())throw new Error('Text outside root');continue;}
    const close=/^<\/([\w.-]+)\s*>$/.exec(token);if(close){if(stack.length===1||stack.pop()!.name!==close[1])throw new Error('Bad nesting');continue;}
    const open=/^<([\w.-]+)((?:\s+[\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(token);if(!open)throw new Error('Malformed element');
    const attrs:Record<string,string>={};for(const m of open[2].matchAll(/([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)){if(m[1] in attrs)throw new Error('Duplicate attribute');const v=m[2]??m[3];if(/&(?!(?:amp|lt|gt|quot|apos);)/.test(v))throw new Error('Unsupported entity');attrs[m[1]]=decode(v);}
    const el={name:open[1],attrs,children:[]};stack.at(-1)!.children.push(el);if(!open[3])stack.push(el);
  }
  if(stack.length!==1||root.children.length!==1||!['testsuites','testsuite'].includes(root.children[0].name))throw new Error('Invalid root');
  function validate(n:Element):void {
    const allowed:Record<string,string[]>={testsuites:['testsuite'],testsuite:['testsuite','testcase','properties','system-out','system-err'],testcase:['failure','error','skipped','properties','system-out','system-err'],properties:['property'],property:[],failure:[],error:[],skipped:[],'system-out':[],'system-err':[]};
    if(!allowed[n.name]||n.children.some(c=>!allowed[n.name].includes(c.name)))throw new Error('Unsupported JUnit structure');
    if(n.name==='testcase'&&n.children.some(c=>c.name==='skipped')&&n.children.some(c=>c.name==='failure'||c.name==='error'))throw new Error('Contradictory case outcome');
    for(const c of n.children)validate(c);
  }
  validate(root.children[0]);
  const suites:SuiteCounts[]=[];
  function visit(n:Element){
    if(n.name==='testsuite'){
      if(!n.attrs.name)throw new Error('Missing suite name');
      const s={suiteId:n.attrs.name,executed:0,failed:0,skipped:0};
      for(const c of n.children.filter(c=>c.name==='testcase')){if(c.children.some(x=>x.name==='skipped'))s.skipped++;else{s.executed++;if(c.children.some(x=>x.name==='failure'||x.name==='error'))s.failed++;}}
      suites.push(s);
    }
    for(const c of n.children)if(c.name==='testsuite'||c.name==='testsuites')visit(c);
  }
  visit(root.children[0]);if(new Set(suites.map(s=>s.suiteId)).size!==suites.length)throw new Error('Duplicate suite');return suites;
}

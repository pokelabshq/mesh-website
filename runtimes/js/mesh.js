/**
 * mesh: a flow-based programming language for agents.
 * javascript runtime v0.1.0
 *
 * usage:
 *   import { run, runFile, check } from './mesh.js';
 *   const result = await run('"hello" → print');
 *   const result = await runFile('hello.mesh');
 *   const errors = check(source);
 *
 * browser:
 *   <script type="module">
 *     import { run } from './mesh.js';
 *     const result = await run('http.get "https://example.com" → json.parse → .title → print');
 *   </script>
 */

// ── errors ───────────────────────────────────────────────────────────────────

class MeshError {
  constructor(message, step = '', pos = 0, retryable = false) {
    this.ok = false;
    this.error = message;
    this.step = step;
    this.pos = pos;
    this.retryable = retryable;
  }
}

class MeshOk {
  constructor(data) {
    this.ok = true;
    this.data = data;
  }
}

const ok = (d) => new MeshOk(d);
const err = (m, step = '', pos = 0, retryable = false) => new MeshError(m, step, pos, retryable);

// ── lexer ────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  'if', 'then', 'else', 'for', 'each', 'in', 'parallel', 'branch',
  'retry', 'backoff', 'on_error', 'import', 'tool', 'description',
  'input', 'output', 'steps', 'loop', 'every', 'otherwise', 'skip',
  'return', 'merge', 'as', 'by', 'with', 'true', 'false', 'null'
]);

function lex(source) {
  const tokens = [];
  const lines = source.split('\n');
  const indentStack = [0];
  let pos = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#') || stripped.startsWith('//')) {
      pos += line.length + 1;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent > indentStack[indentStack.length - 1]) {
      tokens.push({ type: 'INDENT', value: '', pos });
      indentStack.push(indent);
    }
    while (indent < indentStack[indentStack.length - 1]) {
      tokens.push({ type: 'DEDENT', value: '', pos });
      indentStack.pop();
    }

    let i = 0;
    while (i < stripped.length) {
      const c = stripped[i];
      if (c === ' ' || c === '\t') { i++; continue; }

      // pipe
      if (c === '→' || (c === '-' && i + 1 < stripped.length && stripped[i + 1] === '>')) {
        tokens.push({ type: 'PIPE', value: '→', pos: pos + i });
        i += c === '→' ? 1 : 2;
        continue;
      }

      // string
      if (c === '"' || c === "'") {
        const quote = c;
        let j = i + 1;
        while (j < stripped.length && stripped[j] !== quote) {
          if (stripped[j] === '\\') j++;
          j++;
        }
        tokens.push({ type: 'STRING', value: stripped.slice(i + 1, j), pos: pos + i });
        i = j + 1;
        continue;
      }

      // number
      if (/\d/.test(c) || (c === '-' && i + 1 < stripped.length && /\d/.test(stripped[i + 1]))) {
        let j = i + 1;
        while (j < stripped.length && (/\d/.test(stripped[j]) || stripped[j] === '.')) j++;
        tokens.push({ type: 'NUMBER', value: stripped.slice(i, j), pos: pos + i });
        i = j;
        continue;
      }

      // bracket access
      if (c === '[') {
        let j = i + 1, depth = 1;
        while (j < stripped.length && depth > 0) {
          if (stripped[j] === '[') depth++;
          if (stripped[j] === ']') depth--;
          j++;
        }
        tokens.push({ type: 'ACCESS', value: stripped.slice(i, j), pos: pos + i });
        i = j;
        continue;
      }

      // symbols
      if (c === '.') { tokens.push({ type: 'DOT', value: '.', pos: pos + i }); i++; continue; }
      if (c === ',') { tokens.push({ type: 'COMMA', value: ',', pos: pos + i }); i++; continue; }
      if (c === ':') { tokens.push({ type: 'COLON', value: ':', pos: pos + i }); i++; continue; }
      if (c === '=') {
        if (i + 1 < stripped.length && stripped[i + 1] === '=') {
          tokens.push({ type: 'EQUALS', value: '==', pos: pos + i }); i += 2;
        } else {
          tokens.push({ type: 'ASSIGN', value: '=', pos: pos + i }); i++;
        }
        continue;
      }
      if (c === '!' && i + 1 < stripped.length && stripped[i + 1] === '=') {
        tokens.push({ type: 'BANGEQ', value: '!=', pos: pos + i }); i += 2; continue;
      }
      if (c === '(') { tokens.push({ type: 'LPAREN', value: '(', pos: pos + i }); i++; continue; }
      if (c === ')') { tokens.push({ type: 'RPAREN', value: ')', pos: pos + i }); i++; continue; }
      if (c === '|') { tokens.push({ type: 'PIPE', value: '|', pos: pos + i }); i++; continue; }

      // word
      if (/[a-zA-Z_\-.]/.test(c)) {
        let j = i;
        while (j < stripped.length && /[a-zA-Z0-9_\-.]/.test(stripped[j])) j++;
        const word = stripped.slice(i, j);
        tokens.push({
          type: KEYWORDS.has(word) ? 'KEYWORD' : 'WORD',
          value: word,
          pos: pos + i
        });
        i = j;
        continue;
      }

      i++;
    }
    pos += line.length + 1;
  }

  while (indentStack.length > 1) {
    tokens.push({ type: 'DEDENT', value: '', pos });
    indentStack.pop();
  }
  tokens.push({ type: 'EOF', value: '', pos });
  return tokens;
}

// ── parser ───────────────────────────────────────────────────────────────────

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', pos: 0 };
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type) {
    const tok = this.advance();
    if (tok.type !== type) {
      throw new SyntaxError(`expected ${type}, got ${tok.type} ('${tok.value}') at pos ${tok.pos}`);
    }
    return tok;
  }

  match(...types) {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  parse() {
    const statements = [];
    while (this.peek().type !== 'EOF') {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }
    return statements;
  }

  parseStatement() {
    const tok = this.peek();
    if (tok.type === 'KEYWORD' && tok.value === 'import') return this.parseImport();
    if (tok.type === 'KEYWORD' && tok.value === 'tool') return this.parseToolDef();
    if (tok.type === 'KEYWORD' && tok.value === 'parallel') return this.parseParallel();
    if (tok.type === 'KEYWORD' && tok.value === 'for') return this.parseFor();
    if (tok.type === 'KEYWORD' && tok.value === 'retry') return this.parseRetry();
    if (tok.type === 'KEYWORD' && tok.value === 'loop') return this.parseLoop();
    if (tok.type === 'KEYWORD' && tok.value === 'if') return this.parseConditional();
    return this.parsePipeline();
  }

  parseImport() {
    this.advance();
    const path = this.expect('STRING');
    return { type: 'import', path: path.value };
  }

  parseToolDef() {
    this.advance();
    const name = this.expect('WORD').value;
    this.expect('COLON');
    this._skipBlock();
    return { type: 'tool_def', name };
  }

  parseParallel() {
    const tok = this.advance();
    this.expect('COLON');
    this.match('NEWLINE', 'INDENT');
    const branches = {};
    while (!['DEDENT', 'EOF'].includes(this.peek().type)) {
      if (this.peek().type === 'KEYWORD' && this.peek().value === 'branch') {
        this.advance();
        const name = this.expect('WORD').value;
        this.expect('COLON');
        this.match('NEWLINE', 'INDENT');
        branches[name] = this._parseBlock();
      } else {
        this.advance();
      }
    }
    this.match('DEDENT');
    return { type: 'parallel', branches, pos: tok.pos };
  }

  parseFor() {
    const tok = this.advance();
    this.expect('KEYWORD'); // 'each'
    const varName = this.expect('WORD').value;
    const collParts = [];
    while (!['COLON', 'NEWLINE', 'EOF'].includes(this.peek().type)) {
      collParts.push(this.advance().value);
    }
    this.match('COLON');
    this.match('NEWLINE', 'INDENT');
    const steps = this._parseBlock();
    return { type: 'foreach', var: varName, collection: collParts.join(' '), steps, pos: tok.pos };
  }

  parseRetry() {
    const tok = this.advance();
    const retries = parseInt(this.expect('NUMBER').value);
    let backoff = 0;
    if (this.match('COMMA')) {
      if (this.peek().type === 'KEYWORD' && this.peek().value === 'backoff') {
        this.advance();
        backoff = parseFloat(this.expect('NUMBER').value);
      }
    }
    this.expect('COLON');
    this.match('NEWLINE', 'INDENT');
    const steps = this._parseBlock();
    return { type: 'retry', retries, backoff, steps, pos: tok.pos };
  }

  parseLoop() {
    const tok = this.advance();
    this.expect('KEYWORD'); // 'every'
    const interval = this.expect('NUMBER').value;
    this.expect('COLON');
    this.match('NEWLINE', 'INDENT');
    const steps = this._parseBlock();
    return { type: 'loop', interval: parseInt(interval), steps, pos: tok.pos };
  }

  parseConditional() {
    const tok = this.advance();
    const condParts = [];
    while (!['COLON', 'NEWLINE', 'EOF'].includes(this.peek().type)) {
      condParts.push(this.advance().value);
    }
    this.match('COLON');
    this.match('NEWLINE', 'INDENT');
    const thenSteps = this._parseBlock();
    let elseSteps = [];
    if (this.peek().type === 'KEYWORD' && this.peek().value === 'else') {
      this.advance();
      this.expect('COLON');
      this.match('NEWLINE', 'INDENT');
      elseSteps = this._parseBlock();
    }
    return { type: 'conditional', condition: condParts.join(' '), thenSteps, elseSteps, pos: tok.pos };
  }

  parsePipeline() {
    let left = this.parseStep();
    while (this.match('PIPE')) {
      const right = this.parseStep();
      left = { type: 'pipe', left, right, pos: 0 };
    }
    return left;
  }

  parseStep() {
    const tok = this.peek();
    if (tok.type === 'DOT') return this.parseRef();
    if (tok.type === 'STRING') { this.advance(); return { type: 'value', value: tok.value }; }
    if (tok.type === 'NUMBER') {
      this.advance();
      return { type: 'value', value: tok.value.includes('.') ? parseFloat(tok.value) : parseInt(tok.value) };
    }
    if (tok.type === 'KEYWORD' && tok.value === 'true') { this.advance(); return { type: 'value', value: true }; }
    if (tok.type === 'KEYWORD' && tok.value === 'false') { this.advance(); return { type: 'value', value: false }; }
    if (tok.type === 'KEYWORD' && tok.value === 'null') { this.advance(); return { type: 'value', value: null }; }
    if (tok.type === 'WORD') return this.parseToolCall();
    this.advance();
    return null;
  }

  parseRef() {
    this.expect('DOT');
    let path = '.';
    if (this.peek().type === 'WORD') path += this.advance().value;
    if (this.peek().type === 'ACCESS') path += this.advance().value;
    return { type: 'ref', path };
  }

  parseToolCall() {
    const name = this.expect('WORD').value;
    const args = [], kwargs = {}, flags = [];
    while (['WORD', 'STRING', 'NUMBER', 'DOT'].includes(this.peek().type)) {
      const tok = this.peek();
      if (tok.type === 'WORD' && this.pos + 1 < this.tokens.length && this.tokens[this.pos + 1].type === 'ASSIGN') {
        const key = this.advance().value;
        this.advance();
        const val = this.advance();
        kwargs[key] = this._coerceValue(val);
      } else if (tok.type === 'WORD' && tok.value.startsWith('--')) {
        flags.push(this.advance().value);
      } else {
        args.push(this._coerceValue(this.advance()));
      }
    }
    return { type: 'toolcall', name, args, kwargs, flags };
  }

  _parseBlock() {
    const statements = [];
    while (!['DEDENT', 'EOF'].includes(this.peek().type)) {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }
    this.match('DEDENT');
    return statements;
  }

  _skipBlock() {
    this.match('NEWLINE', 'INDENT');
    let depth = 1;
    while (depth > 0 && this.peek().type !== 'EOF') {
      if (this.peek().type === 'INDENT') depth++;
      if (this.peek().type === 'DEDENT') depth--;
      this.advance();
    }
  }

  _coerceValue(tok) {
    if (tok.type === 'STRING') return tok.value;
    if (tok.type === 'NUMBER') return tok.value.includes('.') ? parseFloat(tok.value) : parseInt(tok.value);
    if (tok.type === 'KEYWORD') {
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') return null;
    }
    return tok.value;
  }
}

// ── runtime: built-in tools ──────────────────────────────────────────────────

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this._registerBuiltins();
  }

  register(name, fn) { this.tools.set(name, fn); }
  get(name) { return this.tools.get(name); }
  listTools() { return [...this.tools.keys()].sort(); }

  _registerBuiltins() {
    // data
    this.register('json.parse', (d) => { try { return typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return err(e.message, 'json.parse'); } });
    this.register('json.stringify', (d) => JSON.stringify(d, null, 2));
    this.register('format', (d, ...a) => {
      const t = a[0] || '{{.}}';
      if (typeof d === 'object') {
        let r = t;
        for (const [k, v] of Object.entries(d)) {
          r = r.split('{{.' + k + '}}').join(String(v));
        }
        return r;
      }
      return String(d);
    });
    this.register('type', (d) => d === null ? 'null' : Array.isArray(d) ? 'list' : typeof d);
    this.register('string', (d) => String(d));
    this.register('number', (d) => { const n = Number(d); return isNaN(n) ? 0 : n; });
    this.register('length', (d) => d?.length ?? 0);
    this.register('keys', (d) => typeof d === 'object' && d !== null ? Object.keys(d) : []);
    this.register('values', (d) => typeof d === 'object' && d !== null ? Object.values(d) : []);

    // http
    this.register('http.get', async (d, ...a) => {
      const url = a[0] || d;
      if (!url) return err('http.get requires a url');
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), (a.find(x => typeof x === 'number') || 30) * 1000);
        const resp = await fetch(String(url), { signal: ctrl.signal });
        clearTimeout(tid);
        const body = await resp.text();
        return { status: resp.status, headers: Object.fromEntries(resp.headers), body, json: () => JSON.parse(body) };
      } catch (e) { return err(`http error: ${e.message}`, 'http.get', 0, true); }
    });
    this.register('http.post', async (d, ...a) => {
      const url = a[0] || d;
      const body = a.find(x => typeof x === 'object') || {};
      try {
        const resp = await fetch(String(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: resp.status, body: await resp.text() };
      } catch (e) { return err(`http error: ${e.message}`, 'http.post'); }
    });

    // collections
    this.register('filter', (d) => Array.isArray(d) ? d.filter(Boolean) : d);
    this.register('map', (d) => d);
    this.register('sort', (d) => { if (!Array.isArray(d)) return d; return [...d].sort((a, b) => String(a).localeCompare(String(b))); });
    this.register('unique', (d) => { if (!Array.isArray(d)) return d; return [...new Set(d.map(x => JSON.stringify(x)))].map(x => JSON.parse(x)); });
    this.register('flatten', (d) => Array.isArray(d) ? d.flat() : d);
    this.register('take', (d, ...a) => { const n = a[0] || 10; return Array.isArray(d) ? d.slice(0, n) : d; });
    this.register('skip', (d, ...a) => { const n = a[0] || 0; return Array.isArray(d) ? d.slice(n) : d; });
    this.register('count', (d) => d?.length ?? 0);
    this.register('first', (d) => Array.isArray(d) && d.length ? d[0] : d);
    this.register('last', (d) => Array.isArray(d) && d.length ? d[d.length - 1] : d);
    this.register('merge', (d) => { if (typeof d === 'object' && d !== null) { const r = []; for (const v of Object.values(d)) { if (Array.isArray(v)) r.push(...v); else r.push(v); } return r; } return d; });

    // output
    this.register('print', (d) => { console.log(typeof d === 'object' ? JSON.stringify(d, null, 2) : d); return d; });
    this.register('log', (d, ...a) => { const level = a[0] || 'info'; const msg = a[1] || String(d); console.log(`[${level}] ${msg}`); return d; });
    this.register('return', (d) => d);
    this.register('save', (d, ...a) => { const path = a[0] || 'output.json'; if (typeof Deno !== 'undefined') Deno.writeTextFileSync(path, JSON.stringify(d, null, 2)); return d; });
    this.register('load', (d, ...a) => { const path = a[0] || d; if (typeof Deno !== 'undefined') return JSON.parse(Deno.readTextFileSync(path)); return err('load requires deno runtime'); });

    // system
    this.register('wait', (d, ...a) => { const s = a[0] || 1; return new Promise(r => setTimeout(() => r(d), s * 1000)); });
    this.register('now', () => new Date().toISOString());
    this.register('uuid', () => crypto.randomUUID());
    this.register('env', (d, ...a) => { const name = a[0] || d; return typeof process !== 'undefined' ? (process.env[name] || '') : ''; });
    this.register('shell', async (d, ...a) => {
      const cmd = a[0] || d;
      if (typeof Deno !== 'undefined') {
        const p = Deno.run({ cmd: ['sh', '-c', String(cmd)], stdout: 'piped', stderr: 'piped' });
        const output = await p.output();
        const error = await p.stderrOutput();
        return { stdout: new TextDecoder().decode(output), stderr: new TextDecoder().decode(error), code: (await p.status()).code };
      }
      return err('shell requires deno runtime');
    });
  }
}

// ── executor ─────────────────────────────────────────────────────────────────

class Executor {
  constructor(registry) {
    this.registry = registry || new ToolRegistry();
    this.log = [];
  }

  async execute(statements, inputData) {
    let data = inputData;
    for (const stmt of statements) {
      data = await this._execNode(stmt, data);
    }
    return data;
  }

  async _execNode(node, data) {
    if (!node) return data;
    if (node.type === 'value') return node.value;
    if (node.type === 'ref') return this._resolveRef(node, data);
    if (node.type === 'toolcall') return this._execTool(node, data);
    if (node.type === 'pipe') {
      const left = await this._execNode(node.left, data);
      return this._execNode(node.right, left);
    }
    if (node.type === 'parallel') return this._execParallel(node, data);
    if (node.type === 'conditional') return this._execConditional(node, data);
    if (node.type === 'foreach') return this._execForeach(node, data);
    if (node.type === 'retry') return this._execRetry(node, data);
    if (node.type === 'loop') { for (const step of node.steps) data = await this._execNode(step, data); return data; }
    if (node.type === 'import') { this._log('info', `import: ${node.path}`); return data; }
    if (node.type === 'tool_def') return data;
    return data;
  }

  _resolveRef(ref, data) {
    if (!ref.path || ref.path === '.') return data;
    let path = ref.path.slice(1);
    let current = data;
    if (path.includes('[')) {
      const [field, slicePart] = path.split('[');
      const slice = slicePart.replace(']', '');
      if (field && typeof current === 'object') current = current[field];
      if (slice.includes(':')) {
        const [s, e] = slice.split(':');
        return current.slice(parseInt(s) || 0, e ? parseInt(e) : undefined);
      }
      return current[parseInt(slice)];
    }
    if (typeof current === 'object' && current !== null) return current[path];
    return undefined;
  }

  async _execTool(call, data) {
    const fn = this.registry.get(call.name);
    if (!fn) {
      this._log('error', `unknown tool: ${call.name}`, call.pos);
      return err(`unknown tool: ${call.name}`, call.name, call.pos);
    }
    try {
      const result = await fn(data, ...call.args, ...Object.entries(call.kwargs).flat());
      this._log('ok', call.name, call.pos);
      return result;
    } catch (e) {
      this._log('error', `${call.name}: ${e.message}`, call.pos);
      return err(e.message, call.name, call.pos, true);
    }
  }

  async _execParallel(node, data) {
    const promises = [];
    for (const [name, steps] of Object.entries(node.branches)) {
      promises.push(this.execute(steps, data).then(r => [name, r]));
    }
    const results = await Promise.all(promises);
    return Object.fromEntries(results);
  }

  async _execConditional(node, data) {
    const result = this._evalCondition(node.condition, data);
    if (result) {
      for (const step of node.thenSteps) data = await this._execNode(step, data);
    } else if (node.elseSteps.length) {
      for (const step of node.elseSteps) data = await this._execNode(step, data);
    }
    return data;
  }

  _evalCondition(condition, data) {
    const c = condition.trim();
    if (c.includes('==')) {
      const [l, r] = c.split('==').map(s => s.trim());
      return this._evalExpr(l, data) === this._evalExpr(r, data);
    }
    if (c.includes('!=')) {
      const [l, r] = c.split('!=').map(s => s.trim());
      return this._evalExpr(l, data) !== this._evalExpr(r, data);
    }
    return Boolean(this._evalExpr(c, data));
  }

  _evalExpr(expr, data) {
    const e = expr.trim();
    if (e.startsWith('.')) return this._resolveRef({ path: e }, data);
    if (e.startsWith('"') && e.endsWith('"')) return e.slice(1, -1);
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    const n = Number(e);
    if (!isNaN(n)) return n;
    return e;
  }

  async _execForeach(node, data) {
    const coll = this._evalExpr(node.collection, data);
    if (!Array.isArray(coll)) return data;
    const results = [];
    for (const item of coll) {
      let itemData = item;
      for (const step of node.steps) itemData = await this._execNode(step, itemData);
      results.push(itemData);
    }
    return results;
  }

  async _execRetry(node, data) {
    let lastResult = data;
    for (let attempt = 0; attempt <= node.retries; attempt++) {
      try {
        for (const step of node.steps) lastResult = await this._execNode(step, lastResult);
        return lastResult;
      } catch (e) {
        if (node.backoff > 0 && attempt < node.retries) await new Promise(r => setTimeout(r, node.backoff * (attempt + 1) * 1000));
        if (attempt === node.retries) return err(e.message, '', 0, false);
      }
    }
    return lastResult;
  }

  _log(level, message, pos = 0) {
    this.log.push({ level, message, pos, time: Date.now() / 1000 });
  }
}

// ── public api ───────────────────────────────────────────────────────────────

async function run(source, inputData, registry) {
  const tokens = lex(source);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const executor = new Executor(registry);
  return executor.execute(ast, inputData);
}

function check(source) {
  try {
    const tokens = lex(source);
    const parser = new Parser(tokens);
    parser.parse();
    return [];
  } catch (e) {
    return [e.message];
  }
}

async function runFile(path, inputData, registry) {
  let source;
  if (typeof Deno !== 'undefined') {
    source = await Deno.readTextFile(path);
  } else if (typeof process !== 'undefined') {
    const fs = await import('fs');
    source = fs.readFileSync(path, 'utf-8');
  } else {
    throw new Error('runFile requires node or deno runtime');
  }
  return run(source, inputData, registry);
}

function repl(registry) {
  const executor = new Executor(registry);
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('mesh> ');
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { process.stdout.write('mesh> '); return; }
    if (input === 'exit') { rl.close(); return; }
    if (input === 'tools') { console.log(executor.registry.listTools().join('\n')); process.stdout.write('mesh> '); return; }
    try {
      const result = await run(input, null, registry);
      if (result !== undefined && result !== null) {
        console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
      }
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
    process.stdout.write('mesh> ');
  });
}

// ── exports ──────────────────────────────────────────────────────────────────

export { run, runFile, check, repl, lex, Parser, Executor, ToolRegistry, MeshError, MeshOk, ok, err };

// ── cli (deno/node) ──────────────────────────────────────────────────────────

if (typeof process !== 'undefined' && process.argv) {
  const args = process.argv.slice(2);
  if (args[0] === '--repl' || args[0] === 'repl') {
    repl();
  } else if (args[0] === '--tools' || args[0] === 'tools') {
    const reg = new ToolRegistry();
    console.log(reg.listTools().join('\n'));
  } else if (args[0] === 'check' && args[1]) {
    import('fs').then(fs => {
      const errs = check(fs.readFileSync(args[1], 'utf-8'));
      errs.forEach(e => console.error(`error: ${e}`));
      process.exit(errs.length ? 1 : 0);
    });
  } else if (args[0] === 'run' && args[1]) {
    import('fs').then(async fs => {
      const result = await run(fs.readFileSync(args[1], 'utf-8'));
      if (result !== undefined && result !== null) {
        console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
      }
    });
  }
}

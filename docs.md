# mesh documentation

> agent-readable reference for the mesh programming language.
> version 0.1.0. last updated: 2026-06-08.

---

## table of contents

1. [getting started](#1-getting-started)
2. [core concepts](#2-core-concepts)
3. [syntax reference](#3-syntax-reference)
4. [built-in tools](#4-built-in-tools) (30+ tools, full reference)
5. [patterns](#5-patterns) (copy-paste recipes)
6. [error handling](#6-error-handling)
7. [parallelism](#7-parallelism)
8. [composition](#8-composition)
9. [execution model](#9-execution-model)
10. [cli reference](#10-cli-reference)

---

## 1. getting started

### install

```bash
git clone https://github.com/pokelabshq/mesh.git
cd mesh
python3 mesh.py --repl
```

### your first program

create `hello.mesh`:

```
"hello, world!" → print
```

run it:

```bash
python3 mesh.py run hello.mesh
```

output: `hello, world!`

### interactive repl

```bash
python3 mesh.py --repl
mesh> "test" → print
test
mesh> 42 → json.stringify
"42"
mesh> exit
```

### list tools

```bash
python3 mesh.py --tools
```

---

## 2. core concepts

### c1: no state

mesh has no variables and no assignment. data flows through pipes from left to right.

```
# this is the entire model:
"http://example.com" → http.get → json.parse → .title → print
```

there is no:
```python
# don't do this — this is python, not mesh
url = "http://example.com"
response = http.get(url)
data = json.parse(response)
title = data.title
print(title)
```

### c2: everything is a tool

`http.get`, `json.parse`, `sentiment.analyze`, `telegram.send` — all tools. no distinction between "built-in" and "external".

define your own:
```
tool my_tool:
  input: text: string
  steps:
    http.post "http://localhost:8080/api"
      body: {text: input.text}
    → json.parse
    → return .result
```

### c3: errors are data

errors don't crash. they flow through as values.

```
http.get "https://broken.example.com"
  → on_error:
      log "request failed"
      return {ok: false}
  → json.parse   # skipped if error
  → print        # skipped if error
```

### c4: implicit input

within a pipeline, data is implicit. you don't reference it.

```
# the data flows silently between steps:
"http://example.com" → http.get → json.parse → .title → print

# each step receives the previous step's output as its input.
# http.get receives the url string.
# json.parse receives http.get's response.
# .title accesses the title field.
# print outputs it.
```

### c5: agent-readable

mesh reads like documentation. if you can read english, you can read mesh. agents can generate mesh without special prompting because the syntax maps directly to intent.

---

## 3. syntax reference

### s1: values

| type | syntax | example |
|------|--------|---------|
| string | `"text"` or `'text'` | `"hello"` |
| number | digits | `42`, `3.14` |
| boolean | `true` `false` | `true` |
| null | `null` | `null` |
| field access | `.field` | `.name`, `.items` |
| index | `[n]` | `[0]`, `[-1]` |
| slice | `[start:end]` | `[:5]`, `[1:3]` |

### s2: tool calls

```
tool_name positional_arg1 positional_arg2 key=value --flag
```

rules:
- tool name first, then positional args, then key=value pairs, then `--flags`
- strings with spaces must be quoted
- tool names can contain dots: `http.get`, `json.parse`

```
http.get "https://example.com" timeout=30
json.parse
format "hello {{.name}}"
```

### s3: pipes

```
step_a → step_b → step_c
```

left to right. output of left step is input to right step.

### s4: conditionals

```
if <condition>:
    <steps>
→ else:
    <steps>
```

conditions:
- equality: `.field == "value"`
- inequality: `.field != "value"`

```
check http.get "https://example.com/health"
  → if .status != 200:
      alert "service down"
  → else:
      log "healthy"
```

### s5: loops

```
for each <expression>:
    <steps>
```

```
.json.parse → .items → for each .items:
    format "{{.name}}"
  → print
```

### s6: error handling

```
retry <n>, backoff <seconds>:
    <steps>
→ on_error:
    <steps>
```

```
retry 3, backoff 2s:
    http.get "https://flaky.example.com"
  → on_error:
      log "failed after 3 retries"
      return {ok: false, error: "timeout"}
```

### s7: parallel

```
parallel:
  branch <name>: <steps>
  branch <name>: <steps>
→ <merge steps>
```

```
parallel:
  branch users: http.get "url/users" → json.parse
  branch posts: http.get "url/posts" → json.parse
→ merge
→ format "users: {{.users | count}}, posts: {{.posts | count}}"
→ print
```

### s8: imports

```
import "./relative/path.mesh"
```

### s9: tool definition

```
tool <name>:
  description: "<what it does>"
  input:
    <param>: <type>
  output:
    <field>: <type>
  steps:
    <pipeline>
```

### s10: indentation

mesh uses indentation (whitespace) to define blocks, like python.

```
if .status != 200:       # colon starts a block
    log "error"          # indented = inside the block
    alert "down"         # still inside
→ print                  # dedented = outside the block
```

---

## 4. built-in tools

### category: data

#### json.parse
parse a json string.
- input: json string
- output: parsed object
- errors: returns error if invalid json

```
'{"name": "alex"}' → json.parse → .name
# output: "alex"
```

#### json.stringify
serialize to json string.
- input: any value
- output: json string

```
{name: "alex", age: 13} → json.stringify
# output: '{"name": "alex", "age": 13}'
```

#### format
format data into a string template.
- input: data (usually dict)
- template: uses `{{.field}}` syntax
- output: formatted string

```
{name: "alex", age: 13} → format "{{.name}} is {{.age}}"
# output: "alex is 13"
```

#### type
return type name.
- input: any value
- output: "dict", "list", "str", "int", "float", "bool", "NoneType"

```
[1,2,3] → type
# output: "list"
```

#### string
convert to string.
```
42 → string
# output: "42"
```

#### number
convert to number.
```
"42.5" → number
# output: 42.5
```

#### length
length of collection or string.
```
[1,2,3] → length
# output: 3
```

#### keys
dict keys.
```
{a: 1, b: 2} → keys
# output: ["a", "b"]
```

#### values
dict values.
```
{a: 1, b: 2} → values
# output: [1, 2]
```

### category: http

#### http.get
http get request.
- input: url (string) or first positional arg
- kwargs: `timeout` (seconds, default 30)
- output: `{status: int, headers: dict, body: str, json: fn}`

```
"http://example.com" → http.get → .status
# output: 200

"http://example.com" → http.get → .json() → .title
```

#### http.post
http post request.
- input: url (string) or first positional arg
- kwargs: `body` (dict), `timeout`, `headers`
- output: `{status: int, body: str}`

```
"http://api.example.com/data" → http.post body: {name: "alex"} → .status
```

### category: collections

#### filter
filter collection, keeping truthy items.
- input: list
- output: filtered list

```
[0,1,null,"",42] → filter
# output: [1, 42]
```

#### map
identity pass-through (for chaining).
```
.items → map
```

#### sort
sort collection.
- kwargs: `by` (field name)
- input: list
- output: sorted list

```
[{name: "c"}, {name: "a"}, {name: "b"}] → sort by: .name
# output: [{name: "a"}, {name: "b"}, {name: "c"}]
```

#### unique
deduplicate.
- kwargs: `by` (field name)
- input: list
- output: deduplicated list

```
[{id:1}, {id:2}, {id:1}] → unique by: .id
# output: [{id:1}, {id:2}]
```

#### flatten
flatten nested lists.
```
[[1,2],[3,4],[5]] → flatten
# output: [1,2,3,4,5]
```

#### take
take first n items.
- args: n (default 10)
```
[1,2,3,4,5] → take 3
# output: [1,2,3]
```

#### skip
skip first n items.
- args: n (default 0)
```
[1,2,3,4,5] → skip 2
# output: [3,4,5]
```

#### count
count items (same as length for lists).
```
[1,2,3] → count
# output: 3
```

#### first
first item.
```
[10,20,30] → first
# output: 10
```

#### last
last item.
```
[10,20,30] → last
# output: 30
```

#### merge
combine parallel branch results.
```
# after a parallel: block
→ merge
```

### category: output

#### print
print to stdout. returns input unchanged (for chaining).
```
anything → print
```

#### log
log a message.
- args: level, message

```
→ log "info" "process started"
→ log "error" "something broke"
```

#### return
return a value (mostly used inside tool definitions).
```
→ return {ok: true, data: "result"}
```

#### save
save to json file.
- args: path

```
{data: "hello"} → save "output.json"
```

#### load
load from json file.
- input: file path
- output: parsed json

```
"input.json" → load
```

### category: system

#### wait
pause execution.
- args: seconds

```
wait 5
```

#### shell
run a shell command.
- input: command string
- output: `{stdout, stderr, code}`

```
shell "ls -la" → .stdout → print
```

#### env
read environment variable.
- input: var name

```
env "HOME" → print
```

#### now
current timestamp (iso format).
```
→ now
# output: "2024-01-15T10:30:00.000000"
```

#### uuid
generate a uuid4.
```
→ uuid
# output: "550e8400-e29b-41d4-a716-446655440000"
```

---

## 5. patterns

### pattern: fetch-transform-output

the most common pattern. get data from somewhere, transform it, send it somewhere.

```
http.get "https://api.example.com/data"
  → json.parse
  → .items
  → filter
  → sort by: .created_at
  → take 10
  → format "{{.title}} — {{.value}}"
  → telegram.send "@channel"
```

### pattern: health check

```
http.get "https://example.com/health"
  → if .status != 200:
      retry 3, backoff 5s:
        http.get "https://example.com/health"
      → on_error:
          telegram.send "@ops" "⚠️ example.com is down"
```

### pattern: parallel fetch + merge

```
parallel:
  branch users:   http.get "url/users" → json.parse
  branch posts:   http.get "url/posts" → json.parse
  branch stats:   http.get "url/stats" → json.parse
→ merge
→ format "📊 {{.users | count}} users, {{.posts | count}} posts, {{.stats.views}} views"
→ telegram.send "@channel"
```

### pattern: loop

```
loop every 3600:
  http.get "https://api.example.com/data"
    → json.parse
    → .items
    → filter
    → for each .items:
        format "{{.name}}: {{.status}}"
    → save "data_{{now}}.json"
```

### pattern: batch process

```
load "items.json"
  → for each .items:
      http.post "http://api.example.com/process"
        body: {id: .id, data: .data}
      → if .status != 200:
          log "error" "failed: {{.id}}"
  → count
  → format "processed {{.}} items"
  → print
```

---

## 6. error handling

### how errors work in mesh

every step produces either:
- a value (success)
- an error object: `{ok: false, error: "message", step: "tool_name", retryable: true}`

errors flow through the pipeline. they don't crash.

### on_error block

```
<steps that might fail>
→ on_error:
    <steps to handle the error>
→ <steps to continue>
```

### retry block

```
retry <count>, backoff <seconds>:
    <steps>
→ on_error:
    <fallback steps>
```

backoff is exponential: wait `backoff` seconds after first failure, `backoff * 2` after second, etc.

### example: resilient api call

```
retry 3, backoff 2s:
  http.get "https://api.example.com/flaky"
    → timeout 10s
→ on_error:
    log "api unavailable after 3 retries"
    → return {ok: false, cached: true}
→ json.parse
→ .data
→ print
```

---

## 7. parallelism

### parallel block

```
parallel:
  branch <name>: <steps>
  branch <name>: <steps>
```

each branch runs independently. the executor runs them concurrently.

### merge

after a parallel block, use `merge` to combine results:

```
→ merge
```

merge takes all branch results (a dict of `{name: result}`) and combines them into a single list.

### example: multi-source aggregation

```
parallel:
  branch github:
    http.get "https://api.github.com/repos/pokelabshq/council/commits"
      → json.parse → take 5 → count
  branch npm:
    http.get "https://registry.npmjs.org/council"
      → json.parse → .downloads
  branch docker:
    http.get "https://hub.docker.com/v2/repositories/pokelabs/council"
      → json.parse → .pull_count
→ merge
→ format "📊 {{.github}} commits, {{.npm}} downloads, {{.docker}} pulls"
→ telegram.send "@thealxlabs"
```

---

## 8. composition

### imports

import tool definitions from other files:

```
import "./tools/social.mesh"
import "./tools/github.mesh"
```

### tool definition

define reusable tools:

```
tool sentiment:
  description: "analyze text sentiment"
  input:
    text: string
  output:
    score: float
    label: string
  steps:
    http.post "http://localhost:8764/api/analyze"
      body: {text: input.text}
    → json.parse
    → format "{{.score}} ({{.label}})"
```

### mesh.yaml project config

create a `mesh.yaml` in your project root:

```yaml
name: my-project
version: 0.1.0

tools:
  - name: sentiment
    url: http://localhost:8764
  - name: telegram
    token: ${TELEGRAM_TOKEN}

defaults:
  retry: 3
  timeout: 30
```

---

## 9. execution model

### pipeline

```
source → step_1 → step_2 → ... → step_n
```

each step receives the output of the previous step. the first step receives the initial input (or null).

### tool resolution

1. check built-in tools (30+ built into mesh)
2. check imported tools (from `import` statements)
3. check configured tools (from `mesh.yaml`)
4. error: unknown tool

### error propagation

```
step_a → step_b(error) → step_c → on_error: → step_d
```

when a step produces an error:
- subsequent steps receive the error as input
- most steps pass errors through unchanged
- `on_error:` blocks catch and handle errors
- `retry:` blocks retry on error

### observability

every step execution is logged:
```json
{"level": "ok", "message": "http.get", "pos": 0, "time": 1717800000}
{"level": "error", "message": "http.get: timeout", "pos": 0, "time": 1717800005}
```

---

## 10. cli reference

### mesh run

run a .mesh file.

```bash
python3 mesh.py run file.mesh
python3 mesh.py run file.mesh --input '{"key": "value"}'
```

### mesh check

check syntax without executing.

```bash
python3 mesh.py check file.mesh
# exit 0: no errors
# exit 1: syntax errors found
```

### mesh repl

interactive mode.

```bash
python3 mesh.py --repl
mesh> "hello" → print
hello
mesh> exit
```

### mesh --tools

list all available tools.

```bash
python3 mesh.py --tools
```

---

## appendix: grammar

informal grammar (pseudo-ebnf):

```
program     ::= statement*
statement   ::= pipeline
              | import
              | tool_def
              | parallel
              | conditional
              | loop
              | retry_block
pipeline    ::= step ( "→" step )*
step        ::= tool_call | ref | value
tool_call   ::= NAME (arg | KEYWORD "=" value | "--" FLAG)*
ref         ::= "." FIELD ("[" (INT | slice) "]")?
value       ::= STRING | NUMBER | "true" | "false" | "null"
import      ::= "import" STRING
tool_def    ::= "tool" NAME ":" block
parallel    ::= "parallel:" ( "branch" NAME ":" block )+
conditional ::= "if" expr ":" block ( "→" "else:" block )?
loop        ::= "loop" "every" INT "s:" block
retry_block ::= "retry" INT ("," "backoff" INT "s")? ":" block ( "→" "on_error:" block )?
block       ::= INDENT statement+ DEDENT
```

---

*generated by poke for the mesh language. mit license — poke labs.*

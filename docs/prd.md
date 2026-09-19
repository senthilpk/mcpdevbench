# MCPDevBench — Product Requirements Document

**Version:** 1.0
**Product:** MCPDevBench
**Category:** MCP Developer Tooling
**Platform:** Desktop-first, local-first
**Target:** MCP developers, AI engineers, platform teams, MCP server vendors
**Business model:** Freemium → Pro → Team → Enterprise

---

# 1. Product Definition

### One-line

> **MCPDevBench is the developer workbench for building, testing, debugging, demonstrating and shipping MCP servers.**

### Core workflow

**Connect → Inspect → Run → Debug → Test → Evaluate → Verify Clients → Record → Document → Ship**

### Problem

Building an MCP server currently requires developers to stitch together multiple tools and manually figure out:

* Does my server connect?
* Is the MCP handshake correct?
* Are my tools correctly defined?
* Do the tools actually work?
* Are schemas valid?
* Does Claude use my tools correctly?
* Does Codex connect?
* What configuration does each client need?
* Why does OAuth/CIMD fail?
* How do I test localhost?
* How do I regression-test changes?
* How do I create a demo?
* How do I document the server?
* Can I confidently release this server?

**MCPDevBench puts this workflow into one developer application.**

---

# 2. Product Principles

### P1 — Local first

Your MCP server and test data should stay local unless the developer explicitly chooses cloud functionality.

### P2 — Deterministic before AI

Don't spend tokens when a protocol/schema/test can be validated deterministically.

### P3 — Observable

Every connection and tool execution should be explainable.

### P4 — Reproducible

A failure should be reproducible from a saved test/project.

### P5 — Client-aware

An MCP server isn't finished merely because it works with MCPDevBench.

### P6 — Ship-oriented

The end result isn't "test passed."

The end result is:

> **"I can confidently ship this MCP server."**

---

# 3. Target Users

## Primary — MCP Developer

Building an MCP server for an existing product.

Example:

> TVEyes engineer building a media-monitoring MCP server.

Needs:

* local testing
* tool inspection
* debugging
* client compatibility
* demos
* regression tests

---

## Secondary — AI Application Developer

Building an application that consumes multiple MCP servers.

Needs:

* inspect servers
* test tools
* compare behavior
* debug authentication
* evaluate tool selection

---

## Third — MCP Platform Team

Organization with dozens/hundreds of MCP servers.

Needs:

* standardized testing
* security
* CI/CD
* compatibility
* governance
* release reports

---

# 4. Jobs To Be Done

### JTBD 1

> When I've built an MCP server, I want to connect to it immediately and understand whether it's healthy.

### JTBD 2

> When a tool doesn't work, I want to see exactly where the failure occurred.

### JTBD 3

> When I change a tool, I want to know whether I've broken existing behavior.

### JTBD 4

> When I want to support Claude/Codex/etc., I want exact configuration and compatibility testing.

### JTBD 5

> When I need to demonstrate my MCP server, I want to create a professional demo without building another presentation.

### JTBD 6

> When I'm ready to ship, I want evidence that my MCP server is ready.

---

# 5. Product Information Architecture

```text
MCPDevBench
│
├── Dashboard
│
├── Servers
│   ├── Local
│   ├── Remote
│   └── Recent
│
├── Connect
│
├── Inspector
│   ├── Tools
│   ├── Resources
│   └── Prompts
│
├── Playground
│
├── Doctor
│
├── Tests
│   ├── Contract
│   ├── Integration
│   └── Regression
│
├── AI Evals
│
├── Client Lab
│
├── Auth Lab
│   ├── OAuth
│   └── CIMD
│
├── Recorder
│
├── Documentation
│
└── Release
```

---

# 6. P0 — Server Connection

## Goal

Connect to any MCP server with minimal configuration.

### Supported transports

* STDIO
* Streamable HTTP
* legacy SSE compatibility
* localhost HTTP
* remote HTTP
* HTTPS

### Authentication

* none
* bearer token
* custom headers
* OAuth
* environment variables

### Connection configuration

```text
Server name
Transport
URL / command
Arguments
Environment variables
Headers
Authentication
```

### Import

Support importing configurations from common MCP clients where practical.

### Acceptance criteria

User can connect to a valid MCP server in **<30 seconds**.

---

# 7. P0 — Connection Doctor

This should be a signature MCPDevBench feature.

### One-click

**Diagnose Connection**

### Pipeline

```text
DNS
 ↓
TCP
 ↓
TLS
 ↓
HTTP
 ↓
Authentication
 ↓
MCP initialization
 ↓
Protocol negotiation
 ↓
Capabilities
 ↓
Tool discovery
```

### Output

```text
CONNECTION HEALTH

Network                 ✓
TLS                     ✓
Authentication          ✓
MCP initialization      ✓
Protocol                ✓
Tools                   ✓

Potential issue:

⚠ OAuth client metadata
```

### Diagnostic details

Every check should expose:

* request
* response
* status
* latency
* error
* recommendation

---

# 8. P0 — MCP Inspector

## Server overview

Display:

* server name
* server version
* protocol version
* capabilities
* transport
* authentication

## Tools

Display:

* name
* description
* input schema
* output schema
* annotations
* metadata

## Resources

Display:

* resource URI
* MIME type
* description
* contents

## Prompts

Display:

* name
* description
* arguments

---

# 9. P0 — Tool Playground

The developer can select any tool and execute it.

### Input editor

* schema-aware form
* JSON editor
* autocomplete
* validation
* required-field indicators

### Execution

Show:

```text
REQUEST
↓
MCP SERVER
↓
TOOL
↓
RESPONSE
```

### Results

Display:

* structured content
* text
* JSON
* metadata
* errors
* latency
* timestamps

### Actions

* retry
* edit
* duplicate
* copy
* export
* save as test

---

# 10. P0 — Trace Viewer

Every request gets a trace.

```text
REQUEST
  │
  ├── initialize
  │
  ├── tools/list
  │
  └── tools/call
          │
          ├── arguments
          ├── server
          ├── tool
          └── result
```

Show:

* duration
* request payload
* response payload
* errors
* server logs
* network events

### Key requirement

**Never hide the raw protocol.**

Developers must be able to inspect the underlying JSON-RPC messages.

---

# 11. P0 — Local Development

## Server launcher

Allow:

```text
Command
Arguments
Working directory
Environment
```

Example:

```text
npm run dev
```

### Process management

* start
* stop
* restart
* PID
* stdout
* stderr
* exit code
* automatic restart

### Local server discovery

Detect likely MCP endpoints:

```text
localhost
127.0.0.1
common ports
```

---

# 12. P1 — Local Connectivity / Tunnel

Purpose:

> Make local MCP development work with clients that require remotely reachable HTTPS endpoints.

Features:

* secure tunnel
* temporary public URL
* HTTPS
* tunnel status
* port mapping
* connection verification

Example:

```text
localhost:3000
       ↓
MCPDevBench
       ↓
https://abc.mcpdevbench.dev
       ↓
Claude / Codex / Client
```

Security requirements:

* explicit user activation
* automatic expiration
* secrets never logged
* visible public URL
* kill switch

---

# 13. P1 — OAuth / CIMD Lab

## OAuth flow visualization

```text
Client
  ↓
Protected Resource Metadata
  ↓
Authorization Server
  ↓
Client Metadata
  ↓
Authorization
  ↓
Token
  ↓
MCP Server
```

Display every step.

### Diagnostics

Identify:

* invalid redirect URI
* metadata failure
* authorization failure
* token failure
* scope problems
* TLS problems
* CIMD problems

### Goal

Turn:

> "Codex can't connect."

into:

> **"CIMD metadata request returns 404."**

---

# 14. P0 — Saved Tests

Any successful tool interaction can become a test.

Example:

```text
Test:
Search OpenAI coverage

Input:
query = OpenAI

Expected:
result.count > 0
```

### Test types

#### Contract

* schema
* required arguments
* response structure

#### Functional

* expected output
* expected status
* business assertions

#### Negative

* invalid input
* missing input
* malformed input
* unauthorized request

#### Boundary

* large input
* empty input
* date boundaries
* pagination

---

# 15. P1 — Regression Engine

Run the entire test suite.

```text
MCP v1.4
        ↓
184 tests
        ↓
181 PASS
3 FAIL
```

Show:

```text
Previous       Current

181/184        178/184

Failures:
search_mentions
create_report
get_coverage
```

### Diff

Compare:

* response
* schema
* latency
* errors
* behavior

---

# 16. P1 — AI Playground

Allow developers to interact with their MCP using an LLM.

```text
┌─────────────────────────────┐
│ Ask your MCP                │
│                             │
│ Find OpenAI coverage        │
│ from the last 7 days.       │
└─────────────────────────────┘
```

Show observable trace:

```text
User
 ↓
Model
 ↓
Tool selection
 ↓
Arguments
 ↓
MCP
 ↓
Tool result
 ↓
Model
 ↓
Answer
```

---

# 17. P1 — AI Evaluation

Evaluate:

### Tool selection

Did the model choose the appropriate tool?

### Arguments

Were arguments correct?

### Tool sequence

Were tools called in the appropriate order?

### Goal completion

Was the user's requested outcome achieved?

### Error recovery

Did the agent recover from a tool failure?

### Irrelevant usage

Did the model call unnecessary tools?

---

# 18. P1 — Multi-Model Testing

Support customer-provided API keys initially.

Models could include:

* OpenAI
* Anthropic
* Google
* other supported providers

Compare:

```text
                GPT     Claude     Gemini

Tool choice     94%      97%        91%
Arguments       96%      98%        93%
Goal            90%      94%        88%
Tokens          4.1k     3.8k       4.7k
Latency         1.4s     1.7s       1.2s
```

---

# 19. P1 — Token Analyzer

This is a potentially strong differentiator.

Analyze:

* tool-definition tokens
* prompt tokens
* result tokens
* total tokens
* estimated cost
* per-tool contribution

Example:

```text
MCP CONTEXT

34 tools

Tool definitions:
18,420 tokens

Largest:

search_mentions     2,104
create_report       1,882
edit_video          1,631
```

Then recommendations:

> "These three descriptions account for 29% of tool-definition tokens."

---

# 20. P1 — Client Lab

Initial clients:

* Claude Desktop
* Claude Code
* Codex
* Cursor
* VS Code
* ChatGPT where MCP support permits the relevant configuration
* additional clients as their MCP support evolves

Don't promise universal compatibility.

Instead test specific supported client/version combinations.

---

# 21. Client Configuration Generator

Developer chooses:

```text
Client:
[ Codex ]

Server:
TVEyes MCP

Transport:
Streamable HTTP

Authentication:
OAuth
```

MCPDevBench produces:

> **Exact setup instructions + configuration + verification steps.**

Actions:

**Copy configuration**

**Open client documentation**

**Verify connection**

---

# 22. Client Compatibility Test

Generate:

```text
CLIENT COMPATIBILITY

Claude       PASS
Codex        PASS
Cursor       PASS
VS Code      WARNING
```

Test:

* configuration
* connection
* authentication
* initialization
* tool discovery
* tool execution
* basic task completion

---

# 23. Client Compatibility Database

Maintain a versioned internal database:

```text
Client
Version
Transport
Auth
Configuration
Known limitations
Last verified
```

This becomes strategically important.

---

# 24. P1 — Demo Recorder

One-click:

**Record MCP Demo**

Capture:

* MCPDevBench UI
* prompt
* tool call
* arguments
* result
* trace

### Privacy

Automatically mask:

* API keys
* OAuth tokens
* secrets
* sensitive headers

### Export

* MP4
* WebM
* GIF
* screenshots

---

# 25. P1 — Demo Mode

Create scripted demos.

```text
Demo:
TVEyes Media Search

Step 1
Ask question

Step 2
Tool selected

Step 3
Tool executes

Step 4
Results

Step 5
Final response
```

Then:

**Play Demo**

Useful for:

* GitHub README
* product demos
* sales
* documentation
* onboarding

---

# 26. P1 — Documentation Generator

Generate documentation based on actual server metadata and tested examples.

Generate:

### README

### Installation

### Client setup

### Tool reference

### Authentication

### Examples

### Troubleshooting

### Compatibility

### Demo

### Security

Critical principle:

> **Documentation should be generated from verified behavior wherever possible.**

---

# 27. P1 — Release Report

One click:

**Generate Release Report**

Example:

```text
MCP SERVER RELEASE REPORT

Server             TVEyes MCP
Version            1.4.0

Protocol           PASS
Tools              32/32
Contract tests     184/184
AI evaluations     94%
Claude             PASS
Codex              PASS
Cursor             PASS
OAuth              PASS
Security           28/30

Regression         PASS

Status:
READY FOR RELEASE
```

This becomes a valuable enterprise artifact.

---

# 28. P2 — Security Doctor

Automated checks:

* Origin validation
* authentication
* authorization
* token exposure
* insecure redirect
* TLS
* excessive permissions
* sensitive output
* suspicious tool descriptions
* localhost exposure

Don't make a meaningless single score.

Provide:

```text
Finding
Evidence
Severity
Recommendation
```

---

# 29. P2 — CLI

```bash
mcpbench connect
mcpbench doctor
mcpbench test
mcpbench eval
mcpbench report
mcpbench ci
```

CLI should consume the same project definition as desktop.

---

# 30. P2 — Project Configuration

Introduce:

```text
mcpdevbench.yaml
```

Conceptually:

```yaml
server:
  name: tveyes
  transport: streamable-http

clients:
  - claude
  - codex
  - cursor

tests:
  - contract
  - integration
  - security
  - eval

thresholds:
  goal_completion: 0.90
```

This becomes your bridge from desktop to CI.

---

# 31. P2 — GitHub Integration

PR:

```text
GitHub
   ↓
MCPDevBench
   ↓
Tests
   ↓
AI evals
   ↓
Compatibility
   ↓
Report
```

PR comment:

```text
MCPDevBench

✓ 184 contract tests
✓ 32 tools
✓ OAuth
✓ Claude
✓ Codex

⚠ Goal completion dropped
94% → 89%

Build failed
```

---

# 32. P2 — Team Cloud

Only after individual adoption.

Features:

* projects
* shared tests
* shared evaluations
* test history
* reports
* cloud sync
* team permissions
* audit logs

---

# 33. P2 — Enterprise

Eventually:

* SSO
* SCIM
* RBAC
* private runners
* audit
* data retention controls
* private deployment
* enterprise support

---

# 34. Explicit Non-Goals

MCPDevBench should **not** become:

* another MCP marketplace
* MCP hosting platform
* generic API testing platform
* generic LLM evaluation platform
* generic observability platform
* generic screen recorder
* generic tunneling company
* MCP server registry

Integrate rather than compete.

---

# 35. Moat

The moat should develop in this order.

### 1. Workflow

```text
Connect
→ Debug
→ Test
→ Evaluate
→ Client
→ Demo
→ Ship
```

### 2. Compatibility intelligence

Versioned knowledge about how MCP clients actually behave.

### 3. Test corpus

Anonymized/opt-in aggregate patterns around MCP failures.

### 4. Release infrastructure

Teams eventually make MCPDevBench part of their CI/release process.

### 5. Project format

```text
mcpdevbench.yaml
```

becomes the standard definition of an MCP server's testing requirements.

---

# 36. Pricing

I would start with:

## Free — $0

```text
Local servers
STDIO
HTTP
Inspector
Tool playground
Connection Doctor
Basic tests
Client config generator
Basic recording
```

Purpose:

**Maximum developer adoption.**

---

## Pro — $29/month

```text
Everything Free

Unlimited tests
Regression suites
AI Playground
AI evaluations
Multi-model testing
Token analysis
OAuth/CIMD debugging
Client compatibility
Demo recording
Documentation generation
Release reports
```

**BYOK for LLMs initially.**

---

## Team — $99/month

```text
Everything Pro

5 users
Shared projects
Shared tests
Cloud sync
GitHub integration
CI/CD
Team reports
Test history
Compatibility history
```

Additional users:

**$20–25/user/month**

---

## Business — $299/month

```text
Everything Team

20 users
SSO
RBAC
Audit
Private runners
Advanced security
Priority support
```

---

## Enterprise

Custom pricing based on:

* deployment
* users
* support
* security
* compliance

---

# 37. Unit Economics

This is why I'd use **BYOK initially**.

Deterministic tests:

**~zero LLM cost**

AI tests:

**customer API key**

Therefore:

```text
$29 subscription

        ↓

Mostly local computation

        ↓

Very high gross margin
```

Later, introduce managed AI credits.

---

# 38. MVP

Do **not** build the entire PRD.

Your first release should be:

### MCPDevBench 0.1

```text
1. Desktop application

2. Connect
   - STDIO
   - Streamable HTTP

3. Inspector
   - Tools
   - Resources
   - Prompts

4. Tool Playground

5. Raw MCP trace

6. Connection Doctor

7. Local server launcher

8. Save tool interaction as test

9. Test runner

10. Claude/Codex configuration generator

11. Basic recording
```

That's enough to put in developers' hands.

---

# 39. MVP Success Metric

Don't measure downloads.

Measure:

> **Time from "MCP server doesn't work" → "I know exactly what's wrong."**

Target:

**<5 minutes**

And:

> **Time from local MCP server → working AI client**

Target:

**<10 minutes**

Those are much better product metrics.

---

# 40. Product North Star

I'd use:

### **MCP Server Confidence Rate**

Percentage of MCP projects that reach:

```text
✓ Connection
✓ Protocol
✓ Tools
✓ Tests
✓ Client
✓ Demo
✓ Release
```

A secondary metric:

### **Time to Confidence**

```text
First connection
        ↓
        ↓
"Ready to ship"
```

---

# 41. The killer user journey

This is what I'd optimize the entire product around:

```text
Developer writes MCP server
          ↓
      Open Bench
          ↓
     Add localhost
          ↓
       CONNECT
          ↓
     ❌ Something fails
          ↓
       DOCTOR
          ↓
     Fix problem
          ↓
       INSPECT
          ↓
      Run tools
          ↓
     Save tests
          ↓
       EVALUATE
          ↓
   Test Claude/Codex
          ↓
       RECORD
          ↓
     Generate docs
          ↓
     RELEASE REPORT
          ↓
         SHIP
```

### The strategic insight

**Don't sell MCPDevBench as an "eval tool."**

Sell it as:

# **The place where an MCP server goes from localhost to production.**

That positioning gives you room to own **connection, debugging, client compatibility, testing, AI evals, demos, documentation and release engineering** without being trapped in a single feature.

And given that you're already building MCP servers yourself, your **TVEyes MCP should be the first reference implementation and dogfood project**: every friction point you hit should be evaluated against this PRD before you add another feature.

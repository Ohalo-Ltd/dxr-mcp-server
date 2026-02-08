# DXR MCP Server Benchmark Framework

A benchmark framework for demonstrating the performance delta between AI agents with vs without Data X-Ray (DXR) access.

## Overview

This benchmark measures how effectively AI agents can complete enterprise data tasks when equipped with:

1. **DXR Agent**: Claude with Data X-Ray MCP access (rich metadata, classifications, sensitivity detection)
2. **Baseline Agent**: Claude with only Google Drive MCP access (basic file operations, no sensitivity metadata)

## Metrics

| Metric | Description |
|--------|-------------|
| **Task Completion** | Binary - did the agent complete the task objective? |
| **Precision** | Of files returned, what % were relevant? |
| **Recall** | Of all relevant files, what % were found? |
| **F1 Score** | Harmonic mean of precision and recall |
| **Time to Answer** | Milliseconds from start to completion |
| **Compliance** | Did the agent respect data sensitivity? |

## Installation

```bash
cd benchmark
npm install
```

## Usage

### Run Full Benchmark (Mock Mode)

```bash
npm run benchmark
```

### Run Specific Category

```bash
npm run benchmark -- --category compliance
npm run benchmark -- --category search
npm run benchmark -- --category governance
```

### Run Single Task

```bash
npm run benchmark -- --task compliance-001
```

### Dry Run (List Tasks)

```bash
npm run benchmark -- --dry-run
```

### List Available Tasks

```bash
npx tsx src/index.ts list
```

### Validate Task Definitions

```bash
npx tsx src/index.ts validate
```

## Task Categories

### Compliance (5 tasks)

| ID | Name | Description |
|----|------|-------------|
| compliance-001 | HIPAA Document Discovery | Find PHI-containing files |
| compliance-002 | GDPR PII Identification | Identify EU personal data |
| compliance-003 | ITAR Controlled Content | Locate export-controlled docs |
| compliance-004 | PCI Credit Card Files | Find payment card data |
| compliance-005 | CCPA Consumer Data | Identify CA consumer data |

### Search (7 tasks)

| ID | Name | Description |
|----|------|-------------|
| search-001 | Find Contracts by Date | Contracts signed in specific period |
| search-002 | Invoice Discovery | Find all invoices |
| search-003 | Large PDF Search | PDFs over 10MB |
| search-004 | Cross-Folder Search | Find by name across locations |
| search-005 | Specific Author | Documents by person |
| search-006 | Recent Modifications | Files modified in last 7 days |
| search-007 | File Type Distribution | Analyze file type distribution |

### Governance (5 tasks)

| ID | Name | Description |
|----|------|-------------|
| governance-001 | Access Control Audit | Verify access to sensitive files |
| governance-002 | DLP Label Compliance | Check DLP labels |
| governance-003 | Classification Coverage | Verify sensitive files classified |
| governance-004 | Ownership Verification | Find files without owners |
| governance-005 | External Sharing Check | Files shared externally |

## Output

Results are saved to the `results/` directory:

- `benchmark-{timestamp}.json` - Raw results for programmatic analysis
- `benchmark-{timestamp}.md` - Human-readable Markdown report

## Mock vs Live Mode

### Mock Mode (Default)

Both agents run against curated mock data fixtures. No external credentials required.

```bash
npm run benchmark  # Uses mock mode by default
```

### Live Mode

Requires:
- DXR credentials (`DXR_API_URL`, `DXR_API_TOKEN`)
- Google Drive MCP configured in Claude Desktop
- Sample files in both DXR and Google Drive

```bash
npm run benchmark -- --live
```

## Directory Structure

```
benchmark/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── types.ts              # Type definitions
│   ├── harness/              # Benchmark orchestration
│   ├── mocks/                # Mock servers
│   ├── scoring/              # Metrics calculation
│   └── reporting/            # Report generation
├── tasks/                    # Task definitions (YAML)
│   ├── compliance/
│   ├── search/
│   └── governance/
├── fixtures/
│   └── mock-data/            # Mock file metadata
└── results/                  # Generated reports
```

## Adding New Tasks

1. Create a YAML file in the appropriate `tasks/{category}/` directory
2. Follow the schema:

```yaml
id: "category-NNN"
name: "Task Name"
description: "Task description"
category: "compliance|search|governance"
domain: "Domain name"
difficulty: "easy|medium|hard"

prompt: |
  The prompt given to the agent...

ground_truth:
  expected_files:
    - id: "file-XXX"
      relevance: 1.0
      reason: "Why this file is expected"
  forbidden_files:
    - id: "file-YYY"
      reason: "Why this file should not be accessed"
  minimum_precision: 0.7
  minimum_recall: 0.8

execution:
  timeout_seconds: 120
  max_tool_calls: 20

compliance:
  must_respect_access_controls: true
  must_not_expose_raw_pii: true

tags:
  - "tag1"
  - "tag2"
```

3. Run validation: `npx tsx src/index.ts validate`

## Sample Data Setup (Live Mode)

Before running live benchmarks:

- [ ] Create Google Drive sample folder with test documents
- [ ] Include documents for each task category
- [ ] Index the sample folder in DXR
- [ ] Apply DXR classifications to documents
- [ ] Update ground truth YAML files with actual file IDs

## License

Proprietary - Ohalo

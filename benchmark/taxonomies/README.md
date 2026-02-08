# Benchmark Taxonomies

This directory contains annotator taxonomies for the DXR MCP Server benchmark tasks. Taxonomies define the detection rules (dictionaries, regular expressions, and LLM prompts) used to identify sensitive data.

## Directory Structure

```
taxonomies/
├── compliance/           # Full taxonomy specifications (YAML)
│   ├── hipaa.yaml       # HIPAA/PHI detection
│   ├── gdpr.yaml        # GDPR/PII detection
│   ├── itar.yaml        # ITAR export control detection
│   ├── pci.yaml         # PCI-DSS payment card detection
│   ├── search.yaml      # Search task document types
│   └── governance.yaml  # Governance task detection
│
└── dxr-import/          # Data X-Ray importable JSON files
    ├── dictionaries/    # Dictionary annotators
    │   ├── hipaa-dictionaries.json
    │   ├── gdpr-dictionaries.json
    │   ├── itar-dictionaries.json
    │   ├── pci-dictionaries.json
    │   ├── document-types.json
    │   ├── search-dictionaries.json
    │   └── governance-dictionaries.json
    │
    └── regexes/         # Regular expression annotators
        ├── hipaa-regexes.json
        ├── gdpr-regexes.json
        ├── itar-regexes.json
        ├── pci-regexes.json
        ├── search-regexes.json
        └── governance-regexes.json
```

## Import into Data X-Ray

### Importing Dictionaries

1. Navigate to **Annotators** in Data X-Ray
2. Click **Import annotators**
3. Select a dictionary JSON file from `dxr-import/dictionaries/`
4. Review and confirm the import

### Importing Regular Expressions

1. Navigate to **Annotators** in Data X-Ray
2. Click **Import annotators**
3. Select a regex JSON file from `dxr-import/regexes/`
4. Review and confirm the import

## Taxonomy Coverage by Task

### Compliance Tasks

| Task | Taxonomy | Dictionaries | Regexes |
|------|----------|--------------|---------|
| compliance-001 (HIPAA) | `hipaa.yaml` | 3 | 9 |
| compliance-002 (GDPR) | `gdpr.yaml` | 4 | 11 |
| compliance-003 (ITAR) | `itar.yaml` | 4 | 11 |
| compliance-004 (PCI) | `pci.yaml` | 5 | 12 |

### Search Tasks

| Task | Taxonomy | Dictionaries | Regexes |
|------|----------|--------------|---------|
| search-001 (Contracts) | `search.yaml` | 4 | 12 |
| search-002 (Invoices) | `search.yaml` | 4 | 12 |
| search-003 (Large PDF) | - | - | - |
| search-004 (Cross-Folder) | - | - | - |
| search-005 (Author Search) | `search.yaml` | 4 | 12 |
| search-006 (Recent) | - | - | - |
| search-007 (File Types) | - | - | - |
| document types | `document-types.json` | 4 | - |

### Governance Tasks

| Task | Taxonomy | Dictionaries | Regexes |
|------|----------|--------------|---------|
| governance-001 (Access Control) | `governance.yaml` | 5 | 12 |
| governance-002 (DLP Labels) | `governance.yaml` | 5 | 12 |
| governance-003 (Classification) | `governance.yaml` | 5 | 12 |
| governance-004 (Ownership) | `governance.yaml` | 5 | 12 |
| governance-005 (External Sharing) | `governance.yaml` | 5 | 12 |

## Domains Required

Before importing, ensure these domains exist in Data X-Ray:

### Compliance Domains
- **PHI** - For HIPAA/healthcare data
- **PII** - For personal identifiable information
- **ITAR** - For export-controlled content
- **Financially Sensitive** - For payment and financial data

### Search/Document Domains
- **Legal** - For contracts and legal documents

### Governance Domains
- **Confidential** - For confidentiality markings
- **Governance** - For governance and policy documents
- **External** - For external party indicators
- **Sensitive** - For sensitive data indicators

## Detection Techniques

### Regular Expressions

Uses Python regex syntax. Key patterns include:
- `\d` - Digit [0-9]
- `\s` - Whitespace
- `\w` - Word character [a-zA-Z0-9_]
- `\b` - Word boundary (auto-applied in unstructured data)

See [DXR Regex Syntax Guide](../../../dxr/xray-docs/content/docs/usage/classification/annotators/regular-expressions/syntax-guide.mdx) for details.

### Dictionaries

Case-insensitive by default. Each dictionary is a list of terms/phrases that trigger matches.

### LLM Prompts (Full Taxonomy Only)

The YAML files in `compliance/` include LLM prompt definitions for advanced detection. These require manual configuration in Data X-Ray.

## Validation

Some regex patterns support validation:
- `LUHN` - Validates credit card numbers using Luhn algorithm

## Customization

### Adding New Terms to Dictionaries

Edit the JSON file and add terms to the `values` array:

```json
{
  "values": [
    "existing term",
    "new term to add"
  ]
}
```

### Adding New Regex Patterns

Add a new object to the regex JSON array:

```json
{
  "type": "REGEX",
  "name": "Pattern Name",
  "description": "What it detects",
  "disableCategory": false,
  "value": "regex-pattern-here",
  "dataCategoryDTO": {
    "name": "Domain Name"
  }
}
```

## Notes

- Regex patterns use Python syntax, not JavaScript
- Word boundaries (`\b`) are automatically added for unstructured documents
- Lookbehind/lookahead expressions are not supported
- The `validator` field (e.g., `"LUHN"`) is optional for additional validation

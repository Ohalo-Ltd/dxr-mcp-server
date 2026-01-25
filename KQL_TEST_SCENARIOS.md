# KQL Query Generation Test Scenarios

This document provides test scenarios for validating that AI assistants can generate properly formed KQL queries when using the DXR MCP server. Proper query formation is critical for performance in enterprise deployments with 100M+ files.

## Why This Matters

Without proper KQL filtering, a single `list_file_metadata` call could return millions or tens of millions of files, causing:
- Excessive memory usage
- Network saturation
- Timeouts
- Poor user experience

**Solution**: The AI must learn to generate specific KQL queries based on user intent.

## Test Scenarios

### Scenario 1: Find Files by Name Pattern

**User Request**: "Find all invoice files from 2024"

**Expected KQL Query**:
```kql
fileName:"*Invoice*" AND fileName:"*2024*"
```
OR
```kql
fileName:"*Invoice*2024*"
```

**Why This Works**: Combines name pattern matching to narrow results to relevant files only.

---

### Scenario 2: Find Large Files

**User Request**: "Show me files larger than 50MB"

**Expected KQL Query**:
```kql
size > 50000000
```

**Why This Works**: Numeric comparison filters to specific size range. Note: size is in bytes.

---

### Scenario 3: Find Recent Files

**User Request**: "List all files uploaded in the last month"

**Expected KQL Query** (assuming current date is 2025-01-25):
```kql
createdAt >= "2024-12-25"
```

**Why This Works**: Date range filtering using ISO 8601 format.

---

### Scenario 4: Find Sensitive/Classified Files

**User Request**: "Show me all files that have been classified as containing sensitive data"

**Expected KQL Query**:
```kql
_exists_:classifications
```

**Why This Works**: Existence check finds files that have any classifications applied.

---

### Scenario 5: Find PDF Files

**User Request**: "List all PDF documents"

**Expected KQL Query**:
```kql
mimeType:"application/pdf"
```

**Why This Works**: Direct MIME type filtering is most accurate for file type detection.

---

### Scenario 6: Complex Multi-Criteria Search

**User Request**: "Find all large PDF invoices from Q4 2024 that contain sensitive information"

**Expected KQL Query**:
```kql
fileName:"*Invoice*" AND mimeType:"application/pdf" AND size > 1000000 AND createdAt >= "2024-10-01" AND createdAt < "2025-01-01" AND _exists_:classifications
```

**Why This Works**: Combines multiple filters to create highly specific query that will return manageable result set.

---

### Scenario 7: Find Files by Path

**User Request**: "Show me files in the finance department folder"

**Expected KQL Query**:
```kql
filePath:"*/finance/*"
```
OR
```kql
filePath:*finance*
```

**Why This Works**: Path-based filtering to scope results to specific organizational area.

---

### Scenario 8: Exclude Files

**User Request**: "Find all files except text files"

**Expected KQL Query**:
```kql
NOT mimeType:"text/plain"
```

**Why This Works**: NOT operator excludes specific file types.

---

### Scenario 9: Find Empty or Small Files

**User Request**: "List files smaller than 1KB"

**Expected KQL Query**:
```kql
size < 1024
```

**Why This Works**: Finds potentially incomplete uploads or placeholder files.

---

### Scenario 10: Find Files by Data Source

**User Request**: "Show me files from the SharePoint datasource"

**Expected KQL Query**:
```kql
_exists_:datasourceId AND datasourceId:"sharepoint-*"
```
OR (if exact ID known):
```kql
datasourceId:"abc123"
```

**Why This Works**: Filters by integration source.

---

## Testing Framework

### Manual Testing Approach

1. **Start the MCP Inspector**:
   ```bash
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

2. **Open the Inspector** in your browser (use the URL from console output)

3. **Test Each Scenario**:
   - Paste the "User Request" into the chat
   - Observe what KQL query the AI generates
   - Compare against "Expected KQL Query"
   - Run the query and verify results are reasonable

4. **Record Results**:
   - ✅ Pass: AI generated a semantically equivalent query
   - ⚠️ Partial: AI generated a query that works but isn't optimal
   - ❌ Fail: AI didn't generate a KQL query or generated invalid syntax

### Automated Testing (Future)

Consider implementing:
- Jest/Vitest tests that use LLM API to generate queries
- Parse generated queries for syntax validity
- Compare against expected patterns
- Benchmark query performance on test dataset

---

## KQL Syntax Reference

### Field Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `:` | `fileName:"Invoice"` | Exact match (with quotes) or contains (without quotes) |
| `>` | `size > 1000000` | Greater than |
| `>=` | `createdAt >= "2024-01-01"` | Greater than or equal |
| `<` | `size < 1000000` | Less than |
| `<=` | `updatedAt <= "2024-12-31"` | Less than or equal |

### Logical Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `AND` | `fileName:"Invoice" AND size > 1000000` | Both conditions must be true |
| `OR` | `fileName:"Invoice" OR fileName:"Receipt"` | Either condition must be true |
| `NOT` | `NOT mimeType:"text/plain"` | Condition must be false |

### Special Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `_exists_` | `_exists_:classifications` | Field must exist (not null/empty) |
| `*` (wildcard) | `fileName:"Invoice*"` | Match any characters |

### Available Fields

- `id` (string) - Unique file identifier
- `fileName` (string) - File name
- `filePath` (string) - Full file path
- `size` (number) - File size in bytes
- `createdAt` (date) - ISO 8601 timestamp
- `updatedAt` (date) - ISO 8601 timestamp
- `mimeType` (string) - MIME type (e.g., "application/pdf")
- `datasourceId` (string) - Data source identifier
- `classifications.type` (string) - Classification type (e.g., "ANNOTATOR")
- `classifications.name` (string) - Classification name (e.g., "Credit Card")

---

## Performance Guidelines

### ✅ Good Queries (Specific)

```kql
fileName:"Invoice*" AND createdAt >= "2024-01-01"
```
- Includes specific filters that limit result set
- Targets user's actual need

### ⚠️ Acceptable Queries (Moderate)

```kql
size > 10000000
```
- Has some filtering but may still return many results
- Better than no filter

### ❌ Bad Queries (Too Broad)

```kql
_exists_:id
```
- Essentially returns all files
- Will cause performance issues

### 🚫 Worst Case (No Query)

Calling `list_file_metadata` with no `q` parameter:
- Returns ALL files (could be 100M+)
- Should be avoided in enterprise contexts
- AI should ALWAYS suggest a filter

---

## Expected AI Behavior

When a user asks to find or list files, the AI should:

1. **Always generate a KQL query** - Never call `list_file_metadata` without a filter
2. **Be specific** - Prefer multiple narrow filters over broad searches
3. **Use appropriate operators** - Match the right operator to the user's intent
4. **Consider performance** - Warn user if query might return too many results
5. **Iterate if needed** - If too many results, suggest refining the query

---

## Example Conversation Flow

**User**: "Show me all the files"

**Good AI Response**:
> "I'd like to help you list files, but without a filter this could return millions of files in an enterprise deployment. Could you specify what you're looking for? For example:
> - Files by name (e.g., 'invoices')
> - Files by date (e.g., 'from last month')
> - Files by size (e.g., 'larger than 10MB')
> - Files by type (e.g., 'PDF documents')
> - Files with classifications (e.g., 'sensitive data')"

**User**: "OK, show me PDF files from the last week"

**Good AI Response**:
> "I'll search for PDF files created since 2025-01-18."
>
> [Calls `list_file_metadata` with query: `mimeType:"application/pdf" AND createdAt >= "2025-01-18"`]

---

## Testing Checklist

Use this checklist when testing KQL query generation:

- [ ] AI generates KQL queries for file search requests
- [ ] AI uses correct syntax (colons, quotes, operators)
- [ ] AI includes specific filters rather than broad searches
- [ ] AI uses wildcards appropriately for pattern matching
- [ ] AI constructs proper date range queries
- [ ] AI combines multiple criteria with AND/OR correctly
- [ ] AI uses _exists_ for classification/metadata checks
- [ ] AI warns users when query might return too many results
- [ ] AI suggests query refinements when results are too broad
- [ ] AI handles edge cases (e.g., special characters in filenames)

---

## Next Steps

1. **Test systematically** - Go through each scenario with the MCP Inspector
2. **Document failures** - Note which scenarios fail and why
3. **Refine tool description** - Update based on what works/doesn't work
4. **Add validation** - Consider adding KQL syntax validation helper
5. **Create examples** - Add successful queries to tool description as examples


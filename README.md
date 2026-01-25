# Data X-Ray MCP Server

A Model Context Protocol (MCP) server that provides Claude with access to the Data X-Ray API. This enables Claude to search, retrieve, and analyze indexed files with sensitivity classifications and redaction capabilities.

## Overview

Data X-Ray is an enterprise data discovery and classification platform that indexes documents and identifies sensitive information like PII, PHI, financial data, and more. This MCP server exposes Data X-Ray's capabilities to Claude, enabling:

- **Intelligent file search** with KQL (Kibana Query Language) queries
- **Sensitivity-aware document retrieval** with classification metadata
- **Automatic redaction** of sensitive information
- **Classification catalog access** to understand what types of sensitive data DXR can detect
- **Context-aware responses** based on document metadata and classifications

## Why This Matters

Enterprise organizations have vast amounts of unstructured data scattered across multiple systems. Data X-Ray indexes this data and identifies sensitive content, but making this metadata actionable requires integration with AI systems. This MCP server bridges that gap, allowing Claude to:

1. **Find relevant documents** based on content, classifications, or metadata
2. **Understand data sensitivity** before processing or sharing information
3. **Safely access sensitive documents** through automatic redaction
4. **Provide context-aware answers** using document metadata and classifications

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- Access to a Data X-Ray instance
- Data X-Ray API credentials (Bearer token)

### Setup

1. **Clone or navigate to this directory:**
   ```bash
   cd dxr-mcp-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## Configuration

The server requires two environment variables:

- `DXR_API_URL`: Base URL of your Data X-Ray instance (e.g., `https://dxr.yourcompany.com`)
- `DXR_API_TOKEN`: Bearer token for API authentication

### Claude Desktop Configuration

Add the server to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dxr": {
      "command": "node",
      "args": [
        "/path/to/dxr-mcp-server/dist/index.js"
      ],
      "env": {
        "DXR_API_URL": "https://dxr.yourcompany.com",
        "DXR_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### Claude Code CLI Configuration

Add to your `~/.config/claude/config.json`:

```json
{
  "mcpServers": {
    "dxr": {
      "command": "node",
      "args": [
        "/path/to/dxr-mcp-server/dist/index.js"
      ],
      "env": {
        "DXR_API_URL": "https://dxr.yourcompany.com",
        "DXR_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Available Tools

The MCP server provides five tools that Claude can use:

### 1. list_file_metadata

List all file metadata from Data X-Ray with optional KQL filtering.

**Parameters:**
- `q` (optional): KQL query string to filter results

**Example queries:**
- `fileName:"Invoice"` - Find files with "Invoice" in the name
- `size > 100000` - Find files larger than 100KB
- `fileName:"Invoice" AND size > 100000` - Combine conditions
- `classifications.type:ANNOTATOR` - Find files with specific classification types

**Returns:** Array of file metadata objects including:
- File ID, name, path, size
- MIME type
- Created/updated timestamps
- Classifications and sensitivity labels
- Datasource information

### 2. get_file_content

Get the original content of a file by its ID.

**Parameters:**
- `id` (required): File identifier from list_file_metadata

**Returns:** Base64-encoded file content with MIME type and filename

**Use case:** Retrieve documents for analysis, but be aware of sensitivity!

### 3. get_file_redacted_text

Get text content of a file with sensitive information automatically redacted.

**Parameters:**
- `id` (required): File identifier
- `redactor_id` (required): Redactor ID from get_redactors

**Returns:** Text content with `[REDACTED]` placeholders replacing sensitive information

**Use case:** Safely view documents containing PII, PHI, or other sensitive data

### 4. get_classifications

Get the catalog of all available classifications in Data X-Ray.

**Returns:** Array of classification objects including:
- Classification ID, name, type, subtype
- Description
- Links to view in DXR UI
- Created/updated timestamps

**Use case:** Understand what types of sensitive information DXR can detect

### 5. get_redactors

Get the catalog of all available redactors.

**Returns:** Array of redactor objects with IDs, names, and timestamps

**Use case:** Find the appropriate redactor for get_file_redacted_text

## Usage Examples

Here are some example conversations you can have with Claude once the MCP server is configured:

### Example 1: Finding Sensitive Documents

```
User: "Show me all documents that contain credit card information"

Claude uses:
1. get_classifications() to find the credit card classification
2. list_file_metadata(q: "classifications.name:\"Credit Card\"") to find matching files
3. Returns a summary of documents with credit card data
```

### Example 2: Safely Viewing a Sensitive Document

```
User: "I need to review document ID abc123, but make sure any PII is redacted"

Claude uses:
1. get_redactors() to find available redactors
2. get_file_redacted_text(id: "abc123", redactor_id: 1) to get redacted content
3. Displays the document with [REDACTED] placeholders
```

### Example 3: Data Discovery

```
User: "What types of sensitive information does our DXR instance detect?"

Claude uses:
1. get_classifications() to retrieve the full catalog
2. Summarizes classification types: annotators, labels, extractors
3. Explains what each classification detects
```

### Example 4: Finding Large PDFs

```
User: "Find all PDF files larger than 10MB"

Claude uses:
1. list_file_metadata(q: "mimeType:\"application/pdf\" AND size > 10485760")
2. Returns a list of large PDF files with metadata
```

## API Endpoint Mapping

The MCP server wraps these Data X-Ray API v1 endpoints:

| MCP Tool | DXR API Endpoint | Method |
|----------|------------------|--------|
| list_file_metadata | `/api/v1/files` | GET |
| get_file_content | `/api/v1/files/{id}/content` | GET |
| get_file_redacted_text | `/api/v1/files/{id}/redacted-text` | GET |
| get_classifications | `/api/v1/classifications` | GET |
| get_redactors | `/api/v1/redactors` | GET |

All API calls use Bearer token authentication and return JSON responses (except file content, which returns binary).

## Development

### Build and Watch

```bash
npm run watch  # Rebuild on file changes
```

### Testing Locally

You can test the server using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Set environment variables before running:

```bash
export DXR_API_URL="https://dxr.yourcompany.com"
export DXR_API_TOKEN="your-api-token"
npx @modelcontextprotocol/inspector node dist/index.js
```

## Troubleshooting

### Server Not Starting

- Verify `DXR_API_URL` and `DXR_API_TOKEN` are set correctly
- Check that the Data X-Ray instance is accessible
- Ensure Node.js version is 18.0.0 or higher

### Authentication Errors

- Verify your API token is valid and not expired
- Ensure the token has appropriate permissions for the API endpoints
- Check that the Bearer token format is correct

### Connection Issues

- Verify the Data X-Ray instance URL is correct
- Check network connectivity and firewall rules
- Ensure the Data X-Ray API is accessible from your machine

## Contributing

When making changes:

1. Update TypeScript types in [src/types.ts](src/types.ts) if API changes
2. Add new tools following the existing pattern in [src/index.ts](src/index.ts)
3. Update this README with new tools and usage examples
4. Run `npm run build` to ensure TypeScript compiles
5. Test with MCP Inspector before deploying

## License

Proprietary - Ohalo

## Support

For issues or questions:
- Data X-Ray API: support@ohalo.co
- MCP Server: File an issue in the repository

## Related Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Data X-Ray API Documentation](../dxr/api-specs/)
- [Claude Desktop Documentation](https://claude.ai/docs)

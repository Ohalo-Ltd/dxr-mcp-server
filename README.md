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

- Access to a Data X-Ray instance
- Data X-Ray API credentials (Bearer token)

### Claude Desktop (Recommended)

Install the pre-built extension bundle (`.mcpb` file):

1. Download or build the `.mcpb` file (see [Building the Extension](#building-the-extension))
2. Double-click the `.mcpb` file to open the Claude Desktop install dialog
3. Enter your Data X-Ray configuration when prompted:
   - **Data X-Ray URL** - Base URL of your DXR instance (e.g., `https://dxr.yourcompany.com`)
   - **API Token** - Bearer token for API authentication (stored securely in your OS keychain)
   - **Skip SSL Verification** - Enable only for development environments with self-signed certificates

The extension will appear in your Claude Desktop connectors panel with the Data X-Ray icon.

### Claude Code CLI

Add a `.mcp.json` file to your project directory:

```json
{
  "mcpServers": {
    "dxr": {
      "command": "node",
      "args": ["/path/to/dxr-mcp-server/dist/index.js"],
      "env": {
        "DXR_API_URL": "https://dxr.yourcompany.com",
        "DXR_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

> **Note:** `.mcp.json` is gitignored by default since it contains credentials.

## Available Tools

The MCP server provides eight tools that Claude can use:

### 1. list_file_metadata

Search and list file metadata from Data X-Ray with KQL filtering. Returns lightweight summaries with aggregate statistics to minimize context usage.

**Parameters:**
- `q` (optional): KQL query string to filter results
- `limit` (optional): Number of files to return (default 50, max 500)
- `offset` (optional): Number of files to skip for pagination

**Example queries:**
- `fileName:"*.pdf" AND size > 1000000` - PDFs larger than 1MB
- `annotators.name:"Credit card"` - Files with credit card data detected
- `datasource.name:"Finance*" AND lastModifiedAt > now-30d` - Recent finance files
- `entitlements.whoCanAccess: { accountType:"GROUP" AND name:"Everyone" }` - Publicly accessible files

**Returns:** Aggregate statistics (count, size, file types, sensitive data counts) plus lightweight file summaries with pagination info.

### 2. get_file_metadata_details

Get complete metadata for a specific file by ID.

**Parameters:**
- `id` (required): File identifier from list_file_metadata

**Returns:** Full metadata including datasource info, entitlements, labels, DLP labels, annotators with matched phrases, owner/creator/modifier accounts, extracted metadata, and GPS coordinates if available.

### 3. get_file_content

Get the original content of a file in its native format.

**Parameters:**
- `id` (required): File identifier from list_file_metadata

**Returns:** Text files are decoded and returned as readable text. Images are returned as viewable images. PDFs have text extracted automatically. Other binary files are saved to `/tmp/dxr-files/` for further processing.

**Use case:** Default tool for viewing file contents. Prefer this over `get_file_text` when you need the original file, images, or higher-fidelity parsing.

### 4. get_file_text

Get the plain text extracted by Data X-Ray from a file. Simpler and faster than `get_file_content` when you only need text.

**Parameters:**
- `id` (required): File identifier from list_file_metadata

**Returns:** Plain text content as extracted by Data X-Ray.

**Note:** This is a beta endpoint. Returns empty text if DXR has not extracted text for the file (e.g. discovery-only scan, unsupported format, scanned image PDF).

### 5. get_file_redacted_text

Get plain text content of a file with sensitive information replaced by `[REDACTED]`.

**Parameters:**
- `id` (required): File identifier
- `redactor_id` (required): Redactor ID from get_redactors

**Returns:** Plain text with `[REDACTED]` placeholders replacing sensitive information.

**Use case:** Use only when explicitly requested or when there is a specific privacy requirement. For normal file viewing, use `get_file_content`.

### 6. get_classifications

Get the catalog of all available classifications in Data X-Ray.

**Returns:** Array of annotators, labels, and extractors with IDs, names, types, subtypes, descriptions, and links to the DXR UI.

**Use case:** Call this first before searching for files with sensitive data — you need the exact annotator names to use in KQL queries.

### 7. get_redactors

Get the catalog of all available redactors.

**Returns:** Array of redactor objects with IDs, names, and timestamps.

**Use case:** Get a `redactor_id` to pass to `get_file_redacted_text`.

### 8. render_pdf_pages

Render specific pages of a PDF as high-resolution images for visual analysis.

**Parameters:**
- `id` (required): File identifier (must be a PDF)
- `pages` (required): Array of 1-indexed page numbers to render
- `scale` (optional): Render scale factor (default 2)

**Returns:** One image content block per rendered page.

**Use case:** When text extraction misses structure — tables, charts, scanned pages, forms, handwritten content.

**Note:** Requires `@napi-rs/canvas`. Works in Claude Code; may not be available in Claude Desktop MCPB sandbox.

## Usage Examples

Here are some example conversations you can have with Claude once the MCP server is configured:

### Example 1: Finding Sensitive Documents

```
User: "Show me all documents that contain credit card information"

Claude uses:
1. get_classifications() to get the catalog and find the exact annotator name
2. list_file_metadata(q: 'annotators.name:"Credit card"') to find matching files
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
1. list_file_metadata(q: 'mimeType:"application/pdf" AND size > 10485760')
2. Returns a list of large PDF files with metadata
```

### Example 5: Reading a Document

```
User: "What's in the file with ID xyz789?"

Claude uses:
1. get_file_text(id: "xyz789") for a quick text read (beta, simpler)
   OR get_file_content(id: "xyz789") for the original file (handles images, PDFs)
2. Returns the document content
```

## API Endpoint Mapping

The MCP server wraps these Data X-Ray API v1 endpoints:

| MCP Tool | DXR API Endpoint | Method |
|----------|------------------|--------|
| list_file_metadata | `/api/v1/files` | GET (JSONL stream) |
| get_file_metadata_details | `/api/v1/files?q=fileId:"..."` | GET (JSONL stream) |
| get_file_content | `/api/v1/files/{id}/content` | GET (binary) |
| get_file_text | `/api/v1/files/{id}/text` | GET (JSON, beta) |
| get_file_redacted_text | `/api/v1/files/{id}/redacted-text` | GET |
| get_classifications | `/api/v1/classifications` | GET |
| get_redactors | `/api/v1/redactors` | GET |

All API calls use Bearer token authentication. The `/api/v1/files` endpoint returns newline-delimited JSON (JSONL); all other endpoints return JSON or binary.

## Development

### Prerequisites

- Node.js 18.0.0 or higher
- npm

### Setup

```bash
npm install
npm run build
```

### Build and Watch

```bash
npm run watch  # Rebuild on file changes
```

### Testing Locally

You can test the server using the MCP Inspector:

```bash
export DXR_API_URL="https://dxr.yourcompany.com"
export DXR_API_TOKEN="your-api-token"
npx @modelcontextprotocol/inspector node dist/index.js
```

### Building the Extension

To build the `.mcpb` extension bundle for Claude Desktop:

1. Build the project and prune dev dependencies:
   ```bash
   npm run build
   npm prune --production
   ```

2. Pack the extension:
   ```bash
   npx @anthropic-ai/mcpb pack .
   ```

3. Restore dev dependencies:
   ```bash
   npm install
   ```

This produces a `dxr-mcp-server-<version>.mcpb` file that can be distributed and installed by double-clicking.

The `.mcpbignore` file controls which files are excluded from the bundle (similar to `.gitignore`).

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
3. Update this README and `manifest.json` tools array with new tools
4. Run `npm run build` to ensure TypeScript compiles
5. Test with MCP Inspector before deploying
6. Rebuild the `.mcpb` extension (see [Building the Extension](#building-the-extension))

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

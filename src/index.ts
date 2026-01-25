#!/usr/bin/env node

/**
 * Data X-Ray MCP Server
 *
 * This MCP server provides tools to interact with the Data X-Ray API,
 * enabling Claude to search, retrieve, and analyze indexed files with
 * sensitivity classifications and redaction capabilities.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  FileMetadataListResponse,
  FileContentResponse,
  RedactionResponse,
  ClassificationCatalog,
  RedactorCatalog,
} from "./types.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);
const VERSION = packageJson.version;

// Configuration from environment variables
const DXR_API_URL = process.env.DXR_API_URL;
const DXR_API_TOKEN = process.env.DXR_API_TOKEN;

if (!DXR_API_URL || !DXR_API_TOKEN) {
  console.error("Error: DXR_API_URL and DXR_API_TOKEN environment variables are required");
  process.exit(1);
}

// Security constants
const REQUEST_TIMEOUT_MS = 30_000; // 30 second timeout
const MAX_RESPONSE_SIZE_BYTES = 50_000_000; // 50MB max response size
const MAX_ERROR_LENGTH = 500; // Truncate error messages to prevent info leakage

// Parse and validate the configured API URL at startup
const ALLOWED_API_HOST = new URL(DXR_API_URL).host;

// Response type enum for better type safety
enum ResponseType {
  JSONL = "JSONL",
  BINARY = "BINARY",
  JSON = "JSON",
}

// Determine response type based on endpoint
function getResponseType(endpoint: string): ResponseType {
  if (endpoint.match(/^\/api\/v1\/files\/[^/]+\/content$/)) {
    return ResponseType.BINARY;
  }
  if (endpoint.match(/^\/api\/v1\/files(\?.*)?$/)) {
    return ResponseType.JSONL;
  }
  return ResponseType.JSON;
}

// Helper function to make authenticated API requests with proper typing
async function makeApiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DXR_API_URL}${endpoint}`;

  // SSRF prevention: validate the constructed URL points to the allowed host
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== ALLOWED_API_HOST) {
    throw new Error("Invalid API endpoint: request blocked for security");
  }

  // Set up request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${DXR_API_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Sanitize error response to prevent leaking sensitive info
      const sanitizedError = errorText.substring(0, MAX_ERROR_LENGTH);
      // Log full error to stderr for debugging (not returned to client)
      console.error(`API error [${response.status}]:`, errorText.substring(0, 1000));
      throw new Error(`API request failed: ${response.status} ${response.statusText}: ${sanitizedError}`);
    }

    // Check Content-Length header if available for early rejection
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES) {
      throw new Error("Response too large: exceeds maximum allowed size");
    }

    const responseType = getResponseType(endpoint);

    switch (responseType) {
      case ResponseType.JSONL: {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        const lines = text.trim().split("\n").filter(line => line.trim());
        const data = lines.map(line => JSON.parse(line));
        return { status: "ok", data } as T;
      }

      case ResponseType.BINARY: {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        const contentType = response.headers.get("Content-Type") || "application/octet-stream";
        const contentDisposition = response.headers.get("Content-Disposition") || "";
        return {
          content: Buffer.from(buffer).toString("base64"),
          contentType,
          contentDisposition,
        } as T;
      }

      case ResponseType.JSON:
      default: {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        return JSON.parse(text) as T;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// Validation helpers
function validateString(value: unknown, paramName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${paramName}: must be a non-empty string`);
  }
  return value;
}

function validateNumber(value: unknown, paramName: string): number {
  if (typeof value !== "number" || isNaN(value)) {
    throw new Error(`Invalid ${paramName}: must be a valid number`);
  }
  return value;
}

// KQL query validation helper
function validateKQLQuery(query: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Valid field names based on DXR API
  const validFields = [
    "id", "fileName", "filePath", "size", "createdAt", "updatedAt",
    "mimeType", "datasourceId", "classifications.type", "classifications.name"
  ];

  // Check for common syntax issues

  // 1. Unmatched quotes
  const quoteCount = (query.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    errors.push("Unmatched quotes in query");
  }

  // 2. Unmatched parentheses
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push("Unmatched parentheses in query");
  }

  // 3. Invalid operators (common mistakes)
  if (query.match(/[^><=!]\s*={1}\s*[^=]/)) {
    errors.push("Use ':' for field matching or '>=' for comparisons, not '='");
  }

  // 4. Check for field names (extract field:value patterns)
  const fieldMatches = query.matchAll(/(\w+(?:\.\w+)?)\s*([:<>]=?)/g);
  for (const match of fieldMatches) {
    const fieldName = match[1];
    const operator = match[2];

    // Validate field name
    if (!validFields.includes(fieldName)) {
      errors.push(`Unknown field: '${fieldName}'. Valid fields: ${validFields.join(", ")}`);
    }

    // Validate operator usage
    const numericFields = ["size"];
    const dateFields = ["createdAt", "updatedAt"];

    if (["<", ">", "<=", ">="].includes(operator)) {
      if (!numericFields.includes(fieldName) && !dateFields.includes(fieldName)) {
        errors.push(`Comparison operators (<, >, <=, >=) should only be used with numeric fields (size) or date fields (createdAt, updatedAt), not '${fieldName}'`);
      }
    }
  }

  // 5. Check for logical operators (case-insensitive)
  const hasInvalidLogical = query.match(/\b(and|or|not)\b/);
  if (hasInvalidLogical) {
    errors.push("Logical operators must be uppercase: AND, OR, NOT");
  }

  // 6. Warn if query is too broad
  const isTooBoard =
    query.trim() === "*" ||
    query.includes("_exists_:id") ||
    query.includes("_exists_:fileName") ||
    (query.length < 5 && !query.includes(":"));

  if (isTooBoard) {
    errors.push("Query is too broad and may return millions of files. Add specific filters.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Define MCP tools
const tools: Tool[] = [
  {
    name: "list_file_metadata",
    description: `List file metadata from Data X-Ray with KQL filtering. IMPORTANT: Always use specific KQL queries to limit results - enterprise deployments may contain 100M+ files.

KQL SYNTAX GUIDE:
- Field matching: fileName:"Invoice" OR fileName:Invoice* (wildcard)
- Numeric ranges: size > 100000 OR size >= 1000 AND size < 1000000
- Date ranges: createdAt >= "2024-01-01" AND createdAt < "2024-02-01"
- Logical operators: AND, OR, NOT
- Existence: _exists_:classifications OR NOT _exists_:datasourceId
- Nested fields: classifications.type:ANNOTATOR

COMMON QUERY PATTERNS:
- Find by name: fileName:"Invoice*"
- Large files: size > 10000000
- Recent files: createdAt >= "2024-01-01"
- Sensitive files: _exists_:classifications
- By file type: mimeType:"application/pdf"
- Combined: fileName:"*2024*" AND size > 1000000 AND _exists_:classifications

AVAILABLE FIELDS: id, fileName, filePath, size, createdAt, updatedAt, mimeType, datasourceId, classifications.type, classifications.name

PERFORMANCE TIP: Always include at least one filter to avoid streaming millions of files.`,
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "KQL query string to filter file metadata. REQUIRED for large deployments. Example: 'fileName:\"Invoice\" AND size > 100000'",
        },
      },
    },
  },
  {
    name: "get_file_content",
    description: "Get the original content of a file from Data X-Ray by its ID. Returns the file in its original format (PDF, text, image, etc.) as base64-encoded content.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The unique identifier of the file (obtained from list_file_metadata)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_file_redacted_text",
    description: "Get redacted text content of a file from Data X-Ray. Uses a specified redactor to replace sensitive information with [REDACTED] placeholders. Useful for safely viewing documents that contain PII, PHI, or other sensitive data.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The unique identifier of the file",
        },
        redactor_id: {
          type: "number",
          description: "The ID of the redactor to use (obtain from get_redactors)",
        },
      },
      required: ["id", "redactor_id"],
    },
  },
  {
    name: "get_classifications",
    description: "Get the catalog of all available classifications in Data X-Ray. Classifications include annotators (regex, dictionary, named entity), labels (smart tags), and extractors used to identify sensitive information in documents.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_redactors",
    description: "Get the catalog of all available redactors in Data X-Ray. Redactors are used to remove or mask sensitive information from documents based on classification rules.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "dxr-mcp-server",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_file_metadata": {
        // Validate query parameter if provided
        const queryParam = args?.q;
        if (queryParam !== undefined) {
          validateString(queryParam, "q");

          // Validate KQL syntax
          const kqlValidation = validateKQLQuery(queryParam as string);
          if (!kqlValidation.valid) {
            throw new Error(
              `Invalid KQL query:\n${kqlValidation.errors.map(e => `  - ${e}`).join("\n")}\n\n` +
              `Please refer to the tool description for KQL syntax examples.`
            );
          }
        } else {
          // Warn if no query provided (could return millions of files)
          console.error("WARNING: list_file_metadata called without a KQL query. This may return a large number of files in enterprise deployments.");
        }
        const query = queryParam ? `?q=${encodeURIComponent(queryParam as string)}` : "";
        const result = await makeApiRequest<FileMetadataListResponse>(
          `/api/v1/files${query}`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_file_content": {
        if (!args?.id) {
          throw new Error("Missing required parameter: id");
        }
        const fileId = validateString(args.id, "id");
        const result = await makeApiRequest<FileContentResponse>(
          `/api/v1/files/${encodeURIComponent(fileId)}/content`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "File content retrieved successfully",
                contentType: result.contentType,
                contentDisposition: result.contentDisposition,
                contentBase64: result.content,
              }, null, 2),
            },
          ],
        };
      }

      case "get_file_redacted_text": {
        if (!args?.id || args?.redactor_id === undefined) {
          throw new Error("Missing required parameters: id and redactor_id");
        }
        const fileId = validateString(args.id, "id");
        const redactorId = validateNumber(args.redactor_id, "redactor_id");
        const result = await makeApiRequest<RedactionResponse>(
          `/api/v1/files/${encodeURIComponent(fileId)}/redacted-text?redactor_id=${redactorId}`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_classifications": {
        const result = await makeApiRequest<ClassificationCatalog>(
          "/api/v1/classifications"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_redactors": {
        const result = await makeApiRequest<RedactorCatalog>(
          "/api/v1/redactors"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: errorMessage,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP communication
  console.error(`Data X-Ray MCP Server v${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Data X-Ray MCP Server
 *
 * This MCP server provides tools to interact with the Data X-Ray API,
 * enabling Claude to search, retrieve, and analyze indexed files with
 * sensitivity classifications and redaction capabilities.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Polyfill DOMMatrix for pdfjs-dist in Node.js/MCPB environments where browser APIs are missing.
// pdfjs-dist uses DOMMatrix internally for text coordinate transforms in getTextContent().
if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number;
    m11: number; m12: number; m21: number; m22: number; m41: number; m42: number;
    m13 = 0; m14 = 0; m23 = 0; m24 = 0; m31 = 0; m32 = 0; m33 = 1; m34 = 0; m43 = 0; m44 = 1;
    is2D = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(init?: any) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = this.m11 = init[0]; this.b = this.m12 = init[1];
        this.c = this.m21 = init[2]; this.d = this.m22 = init[3];
        this.e = this.m41 = init[4]; this.f = this.m42 = init[5];
      } else {
        this.a = this.m11 = 1; this.b = this.m12 = 0;
        this.c = this.m21 = 0; this.d = this.m22 = 1;
        this.e = this.m41 = 0; this.f = this.m42 = 0;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    multiply(o: any): DOMMatrix {
      const r = new DOMMatrix();
      r.a = r.m11 = this.a * o.a + this.c * o.b;
      r.b = r.m12 = this.b * o.a + this.d * o.b;
      r.c = r.m21 = this.a * o.c + this.c * o.d;
      r.d = r.m22 = this.b * o.c + this.d * o.d;
      r.e = r.m41 = this.a * o.e + this.c * o.f + this.e;
      r.f = r.m42 = this.b * o.e + this.d * o.f + this.f;
      return r;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    multiplySelf(o: any): DOMMatrix {
      const r = this.multiply(o);
      this.a = this.m11 = r.a; this.b = this.m12 = r.b;
      this.c = this.m21 = r.c; this.d = this.m22 = r.d;
      this.e = this.m41 = r.e; this.f = this.m42 = r.f;
      return this;
    }

    inverse(): DOMMatrix {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) return new DOMMatrix();
      return new DOMMatrix([
        this.d / det, -this.b / det,
        -this.c / det, this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ]);
    }

    invertSelf(): DOMMatrix {
      const r = this.inverse();
      this.a = this.m11 = r.a; this.b = this.m12 = r.b;
      this.c = this.m21 = r.c; this.d = this.m22 = r.d;
      this.e = this.m41 = r.e; this.f = this.m42 = r.f;
      return this;
    }

    translate(tx: number, ty: number): DOMMatrix {
      return this.multiply(new DOMMatrix([1, 0, 0, 1, tx, ty]));
    }

    scale(sx: number, sy?: number): DOMMatrix {
      return this.multiply(new DOMMatrix([sx, 0, 0, sy ?? sx, 0, 0]));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transformPoint(point?: any): { x: number; y: number; z: number; w: number } {
      const x = point?.x ?? 0, y = point?.y ?? 0;
      return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
    }

    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }

    toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }

    toFloat32Array() {
      return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
    }

    toFloat64Array() {
      return new Float64Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromMatrix(o: any): DOMMatrix { return new DOMMatrix([o.a, o.b, o.c, o.d, o.e, o.f]); }
    static fromFloat32Array(a: Float32Array): DOMMatrix { return new DOMMatrix([a[0], a[1], a[4], a[5], a[12], a[13]]); }
    static fromFloat64Array(a: Float64Array): DOMMatrix { return new DOMMatrix([a[0], a[1], a[4], a[5], a[12], a[13]]); }
  };
}

// Extract text from PDFs using pdfjs-dist directly (pure JS, no native modules needed)
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number; error?: string } | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const numPages = doc.numPages;
    const pageTexts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const strings = (content.items as any[])
        .filter((item) => "str" in item)
        .map((item) => item.str as string);
      pageTexts.push(strings.join(" "));
    }

    await doc.destroy();
    const text = pageTexts.join("\n\n").trim();
    if (text.length > 0) {
      return { text, pages: numPages };
    }
    return null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("PDF text extraction failed:", errMsg);
    // Return the error so it can be surfaced in the response
    return { text: "", pages: 0, error: errMsg };
  }
}

// Render specific PDF pages to PNG images using pdfjs-dist + @napi-rs/canvas
// Returns null if native canvas is not available (e.g. MCPB sandbox)
async function renderPdfPages(
  buffer: Buffer,
  pages: number[],
  scale: number = 2
): Promise<{ page: number; png: Buffer }[] | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");

    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const results: { page: number; png: Buffer }[] = [];

    for (const pageNum of pages) {
      if (pageNum < 1 || pageNum > doc.numPages) {
        continue;
      }
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page as any).render({ canvasContext: context as any, viewport }).promise;

      results.push({ page: pageNum, png: canvas.toBuffer("image/png") });
    }

    await doc.destroy();
    return results.length > 0 ? results : null;
  } catch (err) {
    console.error("PDF page rendering failed:", err);
    return null;
  }
}
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
  FullFileMetadata,
  FullFileMetadataResponse,
} from "./types.js";
import type {
  FileMetadataSummaryResponse,
  FileSummary,
  FileListStats,
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
const DXR_SKIP_SSL_VERIFY = process.env.DXR_SKIP_SSL_VERIFY === "true";

if (!DXR_API_URL || !DXR_API_TOKEN) {
  console.error("Error: DXR_API_URL and DXR_API_TOKEN environment variables are required");
  process.exit(1);
}

// Warn if SSL verification is disabled (dev/test environments only)
if (DXR_SKIP_SSL_VERIFY) {
  console.error("WARNING: SSL certificate verification is disabled. This should only be used in development environments with self-signed certificates.");
  // Set Node.js environment variable to skip SSL verification
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Security constants
const REQUEST_TIMEOUT_MS = 30_000; // 30 second timeout for metadata/list endpoints
const CONTENT_TIMEOUT_MS = 120_000; // 2 minute timeout for content/text extraction (OCR can be slow)
const MAX_RESPONSE_SIZE_BYTES = 50_000_000; // 50MB max response size
const MAX_ERROR_LENGTH = 500; // Truncate error messages to prevent info leakage

// Pagination constants
const DEFAULT_LIMIT = 20; // Default number of files to return (keep small — enriched stats provide the overview)
const MAX_LIMIT = 500; // Maximum files per request
const DEFAULT_OFFSET = 0; // Default starting position

// JSONL streaming constants
const JSONL_CHUNK_TIMEOUT_MS = 30_000; // 30s between chunks — resets on each received chunk
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache for query results

// Session cache for file listing queries (avoids re-fetching for pagination)
const fileListCache = new Map<string, { data: FullFileMetadata[], timestamp: number, partial: boolean }>();

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
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  // Normalize URL to avoid double slashes - remove trailing slash from base URL
  const baseUrl = DXR_API_URL?.endsWith('/') ? DXR_API_URL.slice(0, -1) : DXR_API_URL;
  const url = `${baseUrl}${endpoint}`;

  // SSRF prevention: validate the constructed URL points to the allowed host
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== ALLOWED_API_HOST) {
    throw new Error("Invalid API endpoint: request blocked for security");
  }

  // Set up request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build headers - don't send Content-Type on GET requests
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${DXR_API_TOKEN}`,
      ...options.headers as Record<string, string>,
    };

    // Only add Content-Type for requests with a body (POST, PUT, PATCH)
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Sanitize error response to prevent leaking sensitive info
      const sanitizedError = errorText.substring(0, MAX_ERROR_LENGTH);
      // Log full error to stderr for debugging (not returned to client)
      console.error(`API error [${response.status}]:`, errorText.substring(0, 1000));
      // Provide helpful messages for common status codes with empty bodies
      if (response.status === 403 && !errorText.trim()) {
        throw new Error(
          `Access denied (403): Your API token may lack permissions for this resource, or the token may have expired. ` +
          `Check that DXR_API_TOKEN is valid and has the required permissions for this endpoint.`
        );
      }
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

// Race a promise against a timeout
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Stream JSONL file listing from DXR API with per-chunk timeout and session caching.
 *
 * Unlike makeApiRequest (which buffers the entire response body before processing),
 * this function:
 * - Processes JSONL lines incrementally as they arrive
 * - Uses activity-based timeout (resets on each chunk) instead of a fixed total timeout
 * - Caches results for fast pagination within the same session
 * - Returns partial results if the stream is interrupted mid-flight
 */
async function streamFileList(kqlQuery: string): Promise<{ data: FullFileMetadata[], partial: boolean }> {
  // Check cache first
  const cached = fileListCache.get(kqlQuery);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.error(`[DXR] Cache hit for query (${cached.data.length} files): ${kqlQuery.substring(0, 100)}`);
    return { data: cached.data, partial: cached.partial };
  }

  const baseUrl = DXR_API_URL?.endsWith('/') ? DXR_API_URL.slice(0, -1) : DXR_API_URL;
  const url = `${baseUrl}/api/v1/files?q=${encodeURIComponent(kqlQuery)}`;

  // SSRF prevention
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== ALLOWED_API_HOST) {
    throw new Error("Invalid API endpoint: request blocked for security");
  }

  // Connection timeout — 30s to establish connection and get response headers
  const connectController = new AbortController();
  const connectTimeout = setTimeout(() => connectController.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Authorization": `Bearer ${DXR_API_TOKEN}` },
      signal: connectController.signal,
    });
  } finally {
    clearTimeout(connectTimeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const sanitizedError = errorText.substring(0, MAX_ERROR_LENGTH);
    console.error(`API error [${response.status}]:`, errorText.substring(0, 1000));
    if (response.status === 504) {
      throw new Error(
        `DXR API timed out (504). The query may be too broad for this instance. ` +
        `Try a more specific query using annotator names or domains from the classification catalog, ` +
        `or narrow with additional filters (date range, datasource, file type).`
      );
    }
    if (response.status === 403 && !errorText.trim()) {
      throw new Error(
        `Access denied (403): Your API token may lack permissions for this resource, or the token may have expired. ` +
        `Check that DXR_API_TOKEN is valid and has the required permissions for this endpoint.`
      );
    }
    throw new Error(`API request failed: ${response.status} ${response.statusText}: ${sanitizedError}`);
  }

  if (!response.body) {
    throw new Error("No response body for JSONL stream");
  }

  // Stream JSONL with per-chunk timeout (resets on each received chunk)
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const results: FullFileMetadata[] = [];
  let buffer = '';
  let totalBytes = 0;
  let partial = false;

  try {
    while (true) {
      let readResult: { done: boolean; value?: Uint8Array };
      try {
        readResult = await withTimeout(
          reader.read(),
          JSONL_CHUNK_TIMEOUT_MS,
          `JSONL stream stalled: no data received for ${JSONL_CHUNK_TIMEOUT_MS / 1000}s`
        );
      } catch (err) {
        // Timeout or read error — cancel the underlying stream
        try { reader.cancel(); } catch { /* ignore cancel errors */ }
        throw err;
      }

      const { done, value } = readResult;
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      totalBytes += chunk.length;

      if (totalBytes > MAX_RESPONSE_SIZE_BYTES) {
        try { reader.cancel(); } catch { /* ignore */ }
        throw new Error("Response too large: exceeds maximum allowed size");
      }

      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          results.push(JSON.parse(trimmed));
        }
      }
    }

    // Process remaining buffer
    const remaining = buffer.trim();
    if (remaining) {
      results.push(JSON.parse(remaining));
    }
  } catch (err) {
    // If we got partial results before the interruption, use them
    if (results.length > 0) {
      console.error(`[DXR] JSONL stream interrupted after ${results.length} files (${(totalBytes / 1024).toFixed(1)}KB): ${err}`);
      partial = true;
    } else {
      throw err;
    }
  }

  // Cache results for fast pagination
  fileListCache.set(kqlQuery, { data: results, timestamp: Date.now(), partial });

  console.error(`[DXR] Streamed ${results.length} files (${(totalBytes / 1024).toFixed(1)}KB)${partial ? ' [partial — stream interrupted]' : ''}`);
  return { data: results, partial };
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

// Helper to convert full file metadata to lightweight summary
function convertToFileSummary(file: FullFileMetadata): FileSummary {
  const hasSensitiveData = (file.annotators?.length ?? 0) > 0;
  const sensitiveDataCount = file.annotators?.length ?? 0;
  const hasLabels = file.labels.length > 0 || (file.dlpLabels?.length ?? 0) > 0;

  // Generate DXR link (view file in DXR interface)
  const baseUrl = DXR_API_URL?.endsWith('/') ? DXR_API_URL.slice(0, -1) : DXR_API_URL;
  const dxrLink = `${baseUrl}/files/${encodeURIComponent(file.fileId)}`;

  // Generate native storage link based on connector type
  let nativeLink: string | undefined;
  const connectorType = file.datasource.connector.type;
  const siteUrl = file.datasource.connector.siteUrl;

  if (connectorType && file.fileName) {
    // Google Drive - create search link to find the file
    if (connectorType.includes('GOOGLE_DRIVE') || connectorType.includes('GOOGLE_WORKSPACE')) {
      // Use Google Drive search to find the file by exact name
      const searchQuery = encodeURIComponent(`"${file.fileName}"`);
      nativeLink = `https://drive.google.com/drive/search?q=${searchQuery}`;
    }
    // SharePoint/OneDrive - construct web URL if we have siteUrl
    else if (siteUrl && file.path && (connectorType.includes('SHAREPOINT') || connectorType.includes('ONEDRIVE'))) {
      // SharePoint URLs typically follow the pattern: siteUrl + /Shared Documents/ + path
      // Remove leading slash from path
      const cleanPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
      // Encode each path segment separately for proper URL construction
      const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
      nativeLink = `${siteUrl}/Shared%20Documents/${encodedPath}`;
    }
    // Box - create search link
    else if (connectorType.includes('BOX')) {
      const searchQuery = encodeURIComponent(file.fileName);
      nativeLink = `https://app.box.com/search?query=${searchQuery}`;
    }
  }

  return {
    fileId: file.fileId,
    fileName: file.fileName,
    path: file.path ?? "",
    size: file.size,
    mimeType: file.mimeType ?? "application/octet-stream",
    createdAt: file.createdAt ?? "",
    lastModifiedAt: file.lastModifiedAt ?? "",
    hasSensitiveData,
    sensitiveDataCount,
    hasLabels,
    datasourceName: file.datasource.name,
    dxrLink,
    nativeLink,
  };
}

// Helper to generate enriched aggregate stats from file list.
// Computes distributions of annotators, domains, labels, and datasources
// across ALL results — gives Claude a "data map" without per-file inspection.
function generateFileListStats(files: FullFileMetadata[]): FileListStats {
  const mimeTypes: Record<string, number> = {};
  let filesWithSensitiveData = 0;
  let filesWithLabels = 0;
  let totalSize = 0;
  let earliest: string | undefined;
  let latest: string | undefined;

  // Distribution trackers
  const annotatorCounts = new Map<string, { domain: string; count: number }>();
  const domainCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  const datasourceCounts = new Map<string, number>();

  for (const file of files) {
    // Count mime types
    if (file.mimeType) {
      mimeTypes[file.mimeType] = (mimeTypes[file.mimeType] || 0) + 1;
    }

    // Count sensitive files + track annotator/domain distributions
    if (file.annotators && file.annotators.length > 0) {
      filesWithSensitiveData++;
      for (const ann of file.annotators) {
        const existing = annotatorCounts.get(ann.name);
        annotatorCounts.set(ann.name, {
          domain: ann.domain.name,
          count: (existing?.count ?? 0) + 1,
        });
        domainCounts.set(ann.domain.name, (domainCounts.get(ann.domain.name) ?? 0) + 1);
      }
    }

    // Count labeled files + track label distribution
    if (file.labels.length > 0 || (file.dlpLabels?.length ?? 0) > 0) {
      filesWithLabels++;
      for (const label of file.labels) {
        labelCounts.set(label.name, (labelCounts.get(label.name) ?? 0) + 1);
      }
      if (file.dlpLabels) {
        for (const dlp of file.dlpLabels) {
          const name = dlp.name ?? `${dlp.dlpSystem}:${dlp.id}`;
          labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
        }
      }
    }

    // Track datasource distribution
    datasourceCounts.set(file.datasource.name, (datasourceCounts.get(file.datasource.name) ?? 0) + 1);

    // Sum total size
    totalSize += file.size;

    // Track date range
    if (file.createdAt) {
      if (!earliest || file.createdAt < earliest) {
        earliest = file.createdAt;
      }
      if (!latest || file.createdAt > latest) {
        latest = file.createdAt;
      }
    }
  }

  // Build sorted distributions (top N by file count)
  const TOP_N = 10;

  const topAnnotators = [...annotatorCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, TOP_N)
    .map(([name, { domain, count }]) => ({ name, domain, fileCount: count }));

  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name, count]) => ({ name, fileCount: count }));

  const topLabels = [...labelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name, count]) => ({ name, fileCount: count }));

  const datasources = [...datasourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, fileCount: count }));

  return {
    totalFiles: files.length,
    totalSize,
    filesWithSensitiveData,
    filesWithLabels,
    mimeTypes,
    dateRange: earliest && latest ? { earliest, latest } : undefined,
    // Only include distributions when there's data
    ...(topAnnotators.length > 0 && { topAnnotators }),
    ...(topDomains.length > 0 && { topDomains }),
    ...(topLabels.length > 0 && { topLabels }),
    ...(datasources.length > 1 && { datasources }), // Skip if only one datasource (obvious)
  };
}

// Response budget: target max ~8KB of JSON to preserve Claude's context window.
// Enriched stats provide the overview; file summaries are for drill-down.
const RESPONSE_BUDGET_BYTES = 8_192;

// Helper to create paginated summary response with response budget management.
// If the requested page would exceed the budget, it returns fewer file summaries
// while keeping the full enriched stats (which are more valuable per byte).
function createSummaryResponse(
  allFiles: FullFileMetadata[],
  offset: number,
  limit: number
): FileMetadataSummaryResponse {
  // Generate enriched stats from ALL files (not just the page)
  const stats = generateFileListStats(allFiles);

  // Apply pagination
  const paginatedFiles = allFiles.slice(offset, offset + limit);
  let files = paginatedFiles.map(convertToFileSummary);

  // Build the response and check budget
  const buildResponse = (fileSummaries: FileSummary[]): FileMetadataSummaryResponse => ({
    status: "ok",
    stats: {
      ...stats,
      totalFiles: allFiles.length,
    },
    files: fileSummaries,
    pagination: {
      offset,
      limit: fileSummaries.length, // Reflect actual returned count
      returnedCount: fileSummaries.length,
      hasMore: offset + fileSummaries.length < allFiles.length,
    },
  });

  let response = buildResponse(files);
  let responseSize = JSON.stringify(response).length;

  // If over budget, progressively reduce file count (keep at least 5)
  if (responseSize > RESPONSE_BUDGET_BYTES && files.length > 5) {
    // Binary search for the right file count
    let lo = 5;
    let hi = files.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = buildResponse(files.slice(0, mid));
      if (JSON.stringify(candidate).length <= RESPONSE_BUDGET_BYTES) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    files = files.slice(0, lo);
    response = buildResponse(files);
  }

  return response;
}

// KQL query validation helper
function validateKQLQuery(query: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Valid field names based on DXR API (including nested fields)
  const validFields = [
    // Core file fields
    "id", "fileId", "fileName", "path", "filePath", "size", "mimeType",
    "createdAt", "lastModifiedAt", "updatedAt", "contentSha256", "scanDepth",
    // Datasource fields
    "datasourceId", "datasourceName", "datasource.id", "datasource.name",
    "datasource.connector.type",
    // Labels
    "labels", "labels.id", "labels.name",
    // DLP labels
    "dlpLabels", "dlpLabels.id", "dlpLabels.name", "dlpLabels.dlpSystem", "dlpLabels.type",
    // Annotators (sensitive data detections)
    "annotators", "annotators.id", "annotators.name",
    "annotators.domain.id", "annotators.domain.name",
    "annotators.uniquePhrases", "annotators.annotations.phrase",
    // Entitlements
    "entitlements", "entitlements.whoCanAccess", "entitlements.whoCanAccess.accountType",
    "entitlements.whoCanAccess.name", "entitlements.whoCanAccess.email",
    // Ownership
    "owner", "owner.name", "owner.email", "owner.accountType",
    "createdBy", "createdBy.name", "createdBy.email",
    "modifiedBy", "modifiedBy.name", "modifiedBy.email",
    // Extracted metadata
    "extractedMetadata", "extractedMetadata.id", "extractedMetadata.name",
    "extractedMetadata.value", "extractedMetadata.type",
    // Metadata extraction status
    "metadataExtractionStatus",
    // Geographic coordinates (from EXIF/GPS data)
    "coordinates.lat", "coordinates.lon", "coordinates.alt",
    // Category (deprecated - Document Categorizer, removed in 8.4)
    "category",
    // Classifications (legacy support)
    "classifications", "classifications.type", "classifications.name"
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

  // 4. Check for _exists_: patterns - only validate commonly used fields
  // Note: We don't block unknown fields since the API may support fields we don't know about
  const existsMatches = query.matchAll(/_exists_:(\w+(?:\.\w+)?)/g);
  for (const match of existsMatches) {
    const fieldName = match[1];
    // Just log a warning to stderr, don't error out - the API will give a proper error if invalid
    if (!validFields.includes(fieldName)) {
      console.error(`Note: Using field '${fieldName}' in _exists_: - not in known field list`);
    }
  }

  // 5. Check for comparison operators on appropriate fields
  const comparisonMatches = query.matchAll(/(\w+(?:\.\w+)?)\s*([<>]=?)/g);
  for (const match of comparisonMatches) {
    const fieldName = match[1];
    const operator = match[2];

    // Skip logical operators
    if (["NOT", "AND", "OR", "_exists_"].includes(fieldName)) {
      continue;
    }

    // Validate operator usage - comparison operators should only be used with numeric/date fields
    const numericFields = ["size", "annotators.uniquePhrases", "coordinates.lat", "coordinates.lon", "coordinates.alt"];
    const dateFields = ["createdAt", "lastModifiedAt", "updatedAt"];

    if (!numericFields.includes(fieldName) && !dateFields.includes(fieldName)) {
      errors.push(`Comparison operators (${operator}) should only be used with numeric fields (size, annotators.uniquePhrases, coordinates.lat/lon/alt) or date fields (createdAt, lastModifiedAt), not '${fieldName}'`);
    }
  }

  // 6. Check for logical operators (case-insensitive)
  const hasInvalidLogical = query.match(/\b(and|or|not)\b/);
  if (hasInvalidLogical) {
    errors.push("Logical operators must be uppercase: AND, OR, NOT");
  }

  // 7. Check for unquoted string values with wildcards (common mistake)
  // Pattern: fieldName:*something or fieldName:something* without quotes
  const unquotedWildcardPattern = /(\w+):(\*[^"\s]+|\w+\*)/g;
  const unquotedMatches = query.match(unquotedWildcardPattern);
  if (unquotedMatches) {
    for (const match of unquotedMatches) {
      // Skip if it's _exists_: pattern
      if (!match.startsWith("_exists_:")) {
        const [field, value] = match.split(":");
        errors.push(
          `Unquoted string value detected: '${match}'. ` +
          `String values must be quoted. Use ${field}:"${value}" instead.`
        );
      }
    }
  }

  // 8. Check for unquoted string values without wildcards (another common mistake)
  // Pattern: fieldName:someValue where someValue is not a number, boolean, or date
  const fieldValuePattern = /(\w+(?:\.\w+)?):([^"\s*?]+)(?:\s|$)/g;
  let fieldMatch;
  while ((fieldMatch = fieldValuePattern.exec(query)) !== null) {
    const fieldName = fieldMatch[1];
    const value = fieldMatch[2];

    // Skip special patterns
    if (fieldName === "_exists_") continue;
    if (["AND", "OR", "NOT"].includes(fieldName)) continue;

    // Check if value looks like it should be quoted
    const isNumeric = /^-?\d+(\.\d+)?$/.test(value);
    const isBoolean = /^(true|false)$/i.test(value);
    const isDate = /^\d{4}-\d{2}-\d{2}/.test(value);
    const isRelativeDate = /^now([+-]\d+[smhdwMy])?$/.test(value);

    if (!isNumeric && !isBoolean && !isDate && !isRelativeDate) {
      // This looks like a string value that should be quoted
      const stringFields = ["fileName", "path", "filePath", "mimeType", "datasourceName",
        "labels.name", "annotators.name", "owner.name", "owner.email"];
      if (stringFields.some(f => fieldName.includes(f) || f.includes(fieldName))) {
        errors.push(
          `String value '${value}' for field '${fieldName}' must be quoted. ` +
          `Use ${fieldName}:"${value}" instead of ${fieldName}:${value}`
        );
      }
    }
  }

  // 9. Check for free-text queries without field:value format
  // KQL doesn't support free-text search - all queries must be field:value
  const trimmedQuery = query.trim();
  const hasFieldValuePattern = /\w+\s*[:<>=]/.test(trimmedQuery) || trimmedQuery.includes("_exists_:");
  if (!hasFieldValuePattern && trimmedQuery.length > 0) {
    errors.push(
      `Free-text search is not supported. KQL requires field:value format. ` +
      `To search for "${trimmedQuery}", try: fileName:"*${trimmedQuery.split(/\s+/)[0]}*" or path:"*${trimmedQuery.split(/\s+/)[0]}*"`
    );
  }

  // 10. Warn if query is too broad
  const isTooBoard =
    trimmedQuery === "*" ||
    trimmedQuery === "_exists_:id" ||
    trimmedQuery === "_exists_:fileName" ||
    (trimmedQuery.length < 5 && !trimmedQuery.includes(":"));

  if (isTooBoard) {
    errors.push("Query is too broad and may return millions of files. Add specific filters.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Normalize date-only values in KQL queries to full ISO 8601 datetimes.
// DXR's KQL parser requires full datetime strings (e.g. 2026-03-12T00:00:00Z) when
// using comparison operators. Date-only strings like 2026-03-12 cause a parse error.
function normalizeKQLDates(query: string): string {
  // Match: field > 2026-03-12 (but not 2026-03-12T... which is already complete)
  return query.replace(
    /([<>]=?)\s*(\d{4}-\d{2}-\d{2})(?!T|\d)/g,
    (_, op, date) => `${op} ${date}T00:00:00Z`
  );
}

// Define MCP tools with improved descriptions for better discovery and usage
const tools: Tool[] = [
  {
    name: "list_file_metadata",
    description: `Search and list files indexed in Data X-Ray. Returns lightweight summaries with aggregate stats.

🚨 PREREQUISITE: You MUST call get_classifications FIRST before using this tool. The classification catalog gives you the exact annotator names, domains, labels, and extractors you need to build precise queries. Do not skip this step.

SEARCH STRATEGY — use the most precise approach available (best to worst):
1. CLASSIFICATION-BASED (best): Use annotator names/domains from get_classifications catalog
   annotators.name:"Credit card"                              - Files containing credit card numbers
   annotators.name:"Social Security number" AND annotators.uniquePhrases > 3  - Files with many SSNs
   annotators.domain.name:"PII"                               - All files with any PII detected
   annotators.domain.name:"Health Information"                 - All files with health data
   labels.name:"Confidential"                                 - Files tagged confidential
   _exists_:annotators                                        - All files with any sensitive data

2. EXTRACTED METADATA (precise): Use extractor names from the catalog
   extractedMetadata.name:"Contract Type" AND extractedMetadata.value:"Annual*"
   extractedMetadata.name:"Classification" AND extractedMetadata.value:"Confidential"

3. STRUCTURAL (good): Filter by datasource, path, permissions, ownership
   datasource.name:"Finance Department SharePoint"
   path:"*Documents/HR/*"
   entitlements.whoCanAccess: { accountType:"GROUP" AND name:"Everyone" }
   owner.email:"*@example.com"

4. FILE PROPERTIES (basic fallback): Only when the above don't apply
   fileName:"*report*"                                        - Files containing "report" in name
   mimeType:"application/pdf"                                 - PDF files only
   size > 1000000                                             - Files over 1MB
   createdAt > now-7d                                         - Files created in last 7 days

Combine strategies for precision:
   annotators.domain.name:"Financially Sensitive" AND datasource.name:"HR*"
   annotators.name:"Email address" AND fileName:"*.xlsx"
   labels.name:"Restricted" AND lastModifiedAt > now-30d

WHAT IT RETURNS:
- Enriched aggregate stats across ALL matching files (not just the current page):
  - Total count, size, file type breakdown, date range
  - topAnnotators: most common sensitive data types with file counts and domains
  - topDomains: most common annotator domains (PII, Financial, Health, etc.)
  - topLabels: most common classification labels
  - datasources: which datasources the results come from
- Lightweight file summaries for the current page (fileId, fileName, path, size, mimeType, dates, sensitivity flags)
- Clickable links: dxrLink (view in DXR) and nativeLink (open in native storage)
- Pagination info (check pagination.hasMore for more results)
- Response is budget-managed (~8KB max) to preserve context. Use the enriched stats to understand the full result set, then drill into specific files.

NEXT STEPS:
- Use the stats.topAnnotators and stats.topDomains to understand what sensitive data exists across results
- get_file_metadata_details with fileId → full details for specific files (annotators with locations, entitlements, labels)
- get_file_content with fileId → view file contents
- get_file_redacted_text with fileId + redactor_id → redacted version (only if user asks)
- Paginate with offset to see more files if needed

KQL SYNTAX RULES:
- All string values MUST be in double quotes: fileName:"*.pdf" (correct), fileName:*.pdf (WRONG)
- Wildcards go INSIDE quotes: fileName:"*report*"
- Logical operators MUST be UPPERCASE: AND, OR, NOT
- Parentheses for grouping: (fileName:"*.doc" OR fileName:"*.docx") AND size > 100000
- No free-text search: "John Smith" is WRONG, use fileName:"*John*" or annotators.annotations.phrase:"*John*"

NUMERIC/DATE fields (no quotes):
  size > 1000000 | createdAt >= 2024-01-01 | lastModifiedAt > now-7d | annotators.uniquePhrases > 5

ENTITLEMENT queries (object matching):
  entitlements.whoCanAccess: { accountType:"GROUP" AND name:"Everyone" }
  entitlements.whoCanAccess: { email:"*@example.com" }

DATASOURCE queries:
  datasource.name:"..." | datasource.connector.type:"SHAREPOINT_ONLINE_GRAPH_API"
  Connector types: BOX, ONEDRIVE_GRAPH_API, SHAREPOINT_ONLINE_GRAPH_API, SHAREPOINT_2016_2019_REST_API,
    AMAZON_S3, AZURE_BLOB_STORAGE, GOOGLE_DRIVE_GOOGLE_WORKSPACE, GOOGLE_SHARED_DRIVE_GOOGLE_WORKSPACE,
    GOOGLE_CLOUD_STORAGE, NETWORK_DRIVE_SMB, NETWORK_DRIVE_SSH, NETWORK_DRIVE_SMB_LEGACY,
    FOLDER_PATH, CONTENT_SUITE, FILE_UPLOAD, ON_DEMAND_CLASSIFIER

ALL QUERYABLE FIELDS: fileName, path, size, mimeType, contentSha256, scanDepth, createdAt, lastModifiedAt, datasource.name, datasource.id, datasource.connector.type, labels.name, dlpLabels.name, dlpLabels.dlpSystem, dlpLabels.type, annotators.name, annotators.domain.name, annotators.uniquePhrases, annotators.annotations.phrase, entitlements.whoCanAccess.{name,email,accountType}, owner.name, owner.email, createdBy.name, modifiedBy.name, extractedMetadata.name, extractedMetadata.value, extractedMetadata.type, metadataExtractionStatus, coordinates.lat, coordinates.lon`,
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "KQL query to filter files. IMPORTANT: String values MUST be quoted. Examples: 'fileName:\"*report*\"' (correct), 'fileName:*report*' (WRONG - missing quotes)",
        },
        limit: {
          type: "number",
          description: `Number of files to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`,
        },
        offset: {
          type: "number",
          description: `Number of files to skip for pagination (default: ${DEFAULT_OFFSET})`,
        },
      },
    },
  },
  {
    name: "get_file_metadata_details",
    description: `Get complete metadata for a specific file by ID. Returns ALL available metadata including datasource info, entitlements, classifications, annotators with locations, DLP labels, ownership, and more.

WHEN TO USE:
- After calling list_file_metadata to get a summary, use this to fetch full details for specific files
- User asks for detailed information about a file (owner, permissions, exact sensitive data locations, etc.)
- User wants to know who can access a file or who created/modified it
- User needs to see all classification labels and extracted metadata

PREREQUISITE: You need a fileId from list_file_metadata results.

WHAT IT RETURNS:
- Complete file metadata (datasource, path, size, hashes, scan depth)
- All labels and DLP labels
- Full entitlements (who can access with account details)
- Annotators with sensitive data locations and phrases
- Owner, creator, and modifier information
- Extracted metadata fields
- Geolocation data if available

WARNING: This returns extensive data (2-3KB per file). Only fetch details for files you need to inspect closely.

Returns: Full file metadata object with all available fields.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID (fileId field from list_file_metadata results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_file_content",
    description: `Retrieve the ORIGINAL, UNREDACTED content of a file in its native format. This is the DEFAULT tool for viewing file contents.

WHEN TO USE (most common):
- User says "show me that file" or "what's in this document?" - USE THIS (not redacted version)
- User wants to read or analyze file contents - USE THIS
- User asks about a specific file - USE THIS (default choice)
- After finding files with list_file_metadata and user wants to view them - USE THIS
- User needs to do custom parsing, chunking, or structured extraction from a file - USE THIS
- User wants the original file format preserved (e.g. tables, formatting, layout) - USE THIS

NOTE: get_file_redacted_text returns a plain-text version with sensitive data masked, which may lose document structure (tables, columns, formatting). Use THIS tool when you need the original file for higher-fidelity parsing or custom text extraction.

DO NOT use get_file_redacted_text unless the user explicitly asks for redaction or there's a specific privacy concern.

PREREQUISITE: You need a file ID from list_file_metadata first.

Returns: Text files are decoded and returned as readable text. Images are returned as viewable images. PDFs have text extracted automatically and returned directly. All binary files are also saved to /tmp/dxr-files/ and the local path is returned for further processing with scripts if needed (e.g. pdfplumber, openpyxl, python-docx).`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID from list_file_metadata results",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_file_redacted_text",
    description: `Get a plain-text version of a file with sensitive information replaced by [REDACTED] markers.

⚠️ ONLY use this tool when the user has EXPLICITLY asked for redaction — e.g. "show me the redacted version", "hide the sensitive data", "mask the PII", or "I need a sanitized copy". Do NOT use this as a fallback when other tools fail.

WRONG — do NOT use this tool for:
- "Show me the file" / "What's in this document?" → use get_file_content
- The file has sensitive data detected (user still needs to see it) → use get_file_content
- Any general file reading or analysis where user didn't ask for redaction

CORRECT — use this tool only when:
- User explicitly says "redacted", "sanitized", "privacy-safe", "hide PII", "mask sensitive data"

PREREQUISITE:
1. Get file ID from list_file_metadata
2. Get redactor_id from get_redactors (call it first if you don't have one)

Returns: Plain text with sensitive data replaced by [REDACTED]. Document structure (tables, columns, formatting) is not preserved.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID from list_file_metadata",
        },
        redactor_id: {
          type: "number",
          description: "Redactor ID from get_redactors (typically 1 for default redactor)",
        },
      },
      required: ["id", "redactor_id"],
    },
  },
  {
    name: "get_classifications",
    description: `Load the full catalog of everything Data X-Ray can detect. This is your search vocabulary — it tells you every annotator, domain, label, and extractor available, with their exact names.

🚨 ALWAYS CALL THIS FIRST — before list_file_metadata, before any file search. This is not optional and not conditional. Every conversation that touches files or data starts here.

WHY THIS MATTERS:
Data X-Ray doesn't just index filenames — it classifies file CONTENTS. The classification catalog tells you what was found: credit card numbers, social security numbers, medical diagnoses, financial data, contract clauses, and hundreds more. Without this catalog, you're limited to guessing filenames. With it, you can query by what's INSIDE the files.

EXAMPLE — the difference this makes:
- Without catalog: fileName:"*employee*" → finds files named "employee" but misses "Staff_Records.xlsx" that contains SSNs
- With catalog: You learn annotator "Social Security number" exists in domain "PII", then query annotators.name:"Social Security number" → finds ALL files containing SSNs regardless of filename

WHAT YOU GET BACK:
- Annotators: Pattern detectors (regex, dictionary, NER) — e.g. "Credit card", "Email address", "IBAN"
  Each belongs to a domain (e.g. "PII", "Financially Sensitive", "Health Information")
- Labels: Classification tags applied to files (manual or smart)
- Extractors: AI-powered metadata extractors (e.g. contract type, document classification)

HOW TO USE THE CATALOG:
1. Call this tool FIRST
2. Scan annotator names and domains to understand what data types exist
3. Build precise KQL queries for list_file_metadata using exact names from the catalog:
   - annotators.name:"Credit card" → files containing credit card numbers
   - annotators.domain.name:"PII" → all files with any PII
   - labels.name:"Confidential" → files tagged confidential
   - extractedMetadata.name:"Contract Type" → files with extracted contract metadata
4. Combine with other fields for precision: annotators.name:"Email address" AND datasource.name:"HR*"

Returns: Array of classification items, each with: id, name, type (ANNOTATOR | ANNOTATOR_DOMAIN | LABEL | EXTRACTOR), subtype, description, createdAt, updatedAt, link, searchLink`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "render_pdf_pages",
    description: `Render specific pages of a PDF file as high-resolution images for visual analysis.

WHEN TO USE:
- After get_file_content returns extracted text from a PDF, and you need to visually analyze specific pages
- Tables, charts, graphs, or diagrams that lose structure in text extraction
- Scanned documents or image-based PDFs where text extraction returned little/no text
- Forms, invoices, or documents where visual layout matters
- Handwritten content or signatures
- Any page where you need to see the actual visual appearance

PREREQUISITE: You need a file ID from list_file_metadata. The file must be a PDF.

HOW IT WORKS:
- Renders each requested page as a high-resolution PNG image
- Returns images as MCP image content blocks that you can directly analyze with vision
- Uses a scale factor (default 2x) for crisp detail — increase for small text, decrease for faster rendering
- If the file was already fetched by get_file_content, it uses the cached copy from /tmp/dxr-files/

NOTE: This tool requires native canvas support (@napi-rs/canvas). It works in Claude Code but may not be available in all environments (e.g. Claude Desktop MCPB sandbox). If rendering fails, the tool will suggest alternatives.

Returns: One image content block per rendered page, plus a text summary.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID from list_file_metadata results. Must be a PDF file.",
        },
        pages: {
          type: "array",
          items: { type: "number" },
          description: "Page numbers to render (1-indexed). Example: [1, 2, 5] renders pages 1, 2, and 5.",
        },
        scale: {
          type: "number",
          description: "Render scale factor (default: 2). Higher values = more detail but larger images. Use 1 for fast preview, 2-3 for detailed analysis.",
        },
      },
      required: ["id", "pages"],
    },
  },
  {
    name: "get_redactors",
    description: `List available redaction profiles. Redactors define which sensitive data types to mask when viewing files safely.

WHEN TO USE:
- Before calling get_file_redacted_text (to get a redactor_id)
- User asks "how can you redact files?" or about redaction options
- User wants to know what privacy protection is available

Returns: List of redactors with IDs and names. Use the ID with get_file_redacted_text.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Session state: track whether get_classifications has been called
let classificationsCatalogLoaded = false;

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
        // Enforce prerequisite: get_classifications must be called first
        if (!classificationsCatalogLoaded) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "PREREQUISITE NOT MET: You must call get_classifications first before searching files.",
                  reason: "The classification catalog tells you the exact annotator names, domains, labels, and extractors available in this Data X-Ray instance. Without it, you can only guess at filenames — but Data X-Ray's power is searching by what's INSIDE files (sensitive data types, classifications, extracted metadata), not just file names.",
                  action: "Call get_classifications now, then use the annotator names and domains from the catalog to build precise queries.",
                  example: "After loading the catalog, instead of fileName:\"*board*\", try: annotators.domain.name:\"PII\" or labels.name:\"Confidential\" or extractedMetadata.name:\"Document Type\""
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

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

        // Parse and validate pagination parameters
        const limit = args?.limit !== undefined ? validateNumber(args.limit, "limit") : DEFAULT_LIMIT;
        const offset = args?.offset !== undefined ? validateNumber(args.offset, "offset") : DEFAULT_OFFSET;

        if (limit < 1 || limit > MAX_LIMIT) {
          throw new Error(`Invalid limit: must be between 1 and ${MAX_LIMIT}`);
        }
        if (offset < 0) {
          throw new Error("Invalid offset: must be non-negative");
        }

        // Stream JSONL from API with per-chunk timeout and session caching
        // API requires a 'q' parameter - use wildcard as default to match all files
        // Normalize date-only values to full ISO 8601 datetimes (DXR parser requires T00:00:00Z suffix)
        const kqlQuery = queryParam
          ? normalizeKQLDates(queryParam as string)
          : "fileName:\"*\"";
        const { data: files, partial } = await streamFileList(kqlQuery);

        // Convert to summary response with pagination
        const summaryResponse = createSummaryResponse(
          files,
          offset,
          limit
        );

        // Add warning if results are partial (stream was interrupted)
        const responsePayload: Record<string, unknown> = { ...summaryResponse };
        if (partial) {
          responsePayload.warning =
            `Results may be incomplete — the JSONL stream was interrupted after receiving ${files.length} files. ` +
            `Try a more specific query to reduce the result set.`;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responsePayload, null, 2),
            },
          ],
        };
      }

      case "get_file_metadata_details": {
        if (!args?.id) {
          throw new Error("Missing required parameter: id");
        }
        const fileId = validateString(args.id, "id");

        // Fetch full metadata from API - use the files endpoint with specific ID query
        const result = await makeApiRequest<FileMetadataListResponse>(
          `/api/v1/files?q=fileId:"${encodeURIComponent(fileId)}"`
        );

        if (!result.data || result.data.length === 0) {
          throw new Error(`File not found with ID: ${fileId}`);
        }

        // Return the first (and should be only) result
        const fileMetadata = result.data[0];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ok",
                data: fileMetadata,
              } as FullFileMetadataResponse, null, 2),
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
          `/api/v1/files/${encodeURIComponent(fileId)}/content`,
          {},
          CONTENT_TIMEOUT_MS
        );

        const contentType = result.contentType.split(";")[0].trim().toLowerCase();

        // Text-based files: decode base64 and return as readable text
        if (
          contentType.startsWith("text/") ||
          contentType === "application/json" ||
          contentType === "application/xml" ||
          contentType === "application/javascript" ||
          contentType === "application/xhtml+xml" ||
          contentType === "application/x-yaml" ||
          contentType === "application/csv" ||
          contentType === "application/sql"
        ) {
          const decodedText = Buffer.from(result.content, "base64").toString("utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `File content (${contentType}):\n\n${decodedText}`,
              },
            ],
          };
        }

        // Images: return using MCP image content type so the model can see them
        if (contentType.startsWith("image/")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Image file retrieved (${contentType}):`,
              },
              {
                type: "image" as const,
                data: result.content,
                mimeType: contentType,
              },
            ],
          };
        }

        // Binary files: save to local temp dir and attempt text extraction for PDFs
        const filenameMatch = result.contentDisposition?.match(/filename="?([^";\n]+)"?/);
        const filename = filenameMatch?.[1] || `file_${fileId}`;
        const fileBuffer = Buffer.from(result.content, "base64");
        const fileSizeBytes = fileBuffer.length;

        const tmpDir = "/tmp/dxr-files";
        mkdirSync(tmpDir, { recursive: true });
        const localPath = join(tmpDir, filename);
        writeFileSync(localPath, fileBuffer);

        // For PDFs, extract text directly so the model can read it without external tools
        if (contentType === "application/pdf") {
          const pdfResult = await extractPdfText(fileBuffer);
          if (pdfResult && !pdfResult.error && pdfResult.text.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `PDF file retrieved and text extracted.\n\nFilename: ${filename}\nSize: ${fileSizeBytes} bytes\nPages: ${pdfResult.pages}\nLocal path: ${localPath}\n\nTip: Use render_pdf_pages with this file ID to visually analyze specific pages (tables, charts, forms, layouts).\n\nExtracted text:\n\n${pdfResult.text}`,
                },
              ],
            };
          }
          // Extraction failed or returned no text
          const reason = pdfResult?.error
            ? `Text extraction error: ${pdfResult.error}`
            : "No extractable text found (likely a scanned or image-based PDF).";
          return {
            content: [
              {
                type: "text" as const,
                text: `PDF file saved locally but text extraction was not successful.\n\nFilename: ${filename}\nSize: ${fileSizeBytes} bytes\nLocal path: ${localPath}\nReason: ${reason}\n\nRecommended: Use render_pdf_pages with this file ID to render pages as images for visual analysis. This is the best approach for scanned PDFs, forms, and image-heavy documents.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Binary file saved locally for processing.\n\nFilename: ${filename}\nContent-Type: ${contentType}\nSize: ${fileSizeBytes} bytes\nLocal path: ${localPath}\n\nThe file has been saved to disk. You can run Python or other scripts to parse it (e.g. pdfplumber for PDFs, openpyxl for Excel files, python-docx for Word docs).`,
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
          `/api/v1/files/${encodeURIComponent(fileId)}/redacted-text?redactor_id=${redactorId}`,
          {},
          CONTENT_TIMEOUT_MS
        );
        if (!result.data.redactedText) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No redacted text available for this file. Data X-Ray may not have extracted text for it ` +
                  `(e.g. DISCOVERY-only scan depth, unsupported format, or scanned image PDF). ` +
                  `Try get_file_content for local binary parsing and text extraction.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: result.data.redactedText,
            },
          ],
        };
      }

      case "get_classifications": {
        const result = await makeApiRequest<ClassificationCatalog>(
          "/api/v1/classifications"
        );
        classificationsCatalogLoaded = true;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "render_pdf_pages": {
        if (!args?.id) {
          throw new Error("Missing required parameter: id");
        }
        if (!args?.pages || !Array.isArray(args.pages) || args.pages.length === 0) {
          throw new Error("Missing required parameter: pages (must be a non-empty array of page numbers)");
        }
        const fileId = validateString(args.id, "id");
        const pages = args.pages as number[];
        const scale = typeof args.scale === "number" ? args.scale : 2;

        // Check if the PDF is already cached from a previous get_file_content call
        const tmpDir = "/tmp/dxr-files";
        mkdirSync(tmpDir, { recursive: true });

        let fileBuffer: Buffer;
        let filename: string;

        // Look for any cached file matching this ID
        const cachedFiles = existsSync(tmpDir)
          ? readdirSync(tmpDir).filter((f: string) => f.includes(fileId))
          : [];

        if (cachedFiles.length > 0) {
          const cachedPath = join(tmpDir, cachedFiles[0]);
          fileBuffer = readFileSync(cachedPath);
          filename = cachedFiles[0];
        } else {
          // Fetch from API
          const result = await makeApiRequest<FileContentResponse>(
            `/api/v1/files/${encodeURIComponent(fileId)}/content`,
            {},
            CONTENT_TIMEOUT_MS
          );
          const filenameMatch = result.contentDisposition?.match(/filename="?([^";\n]+)"?/);
          filename = filenameMatch?.[1] || `file_${fileId}.pdf`;
          fileBuffer = Buffer.from(result.content, "base64");

          // Save to cache
          const localPath = join(tmpDir, filename);
          writeFileSync(localPath, fileBuffer);
        }

        // Render pages to images
        const rendered = await renderPdfPages(fileBuffer, pages, scale);

        if (!rendered) {
          return {
            content: [
              {
                type: "text" as const,
                text: `PDF page rendering is not available in this environment (requires @napi-rs/canvas native module).\n\nAlternatives:\n- Use get_file_content to get extracted text from the PDF\n- The PDF is saved at /tmp/dxr-files/${filename} — you can use Python scripts with libraries like pdf2image or PyMuPDF to render pages`,
              },
            ],
          };
        }

        // Build response with image content blocks
        const contentBlocks: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

        contentBlocks.push({
          type: "text" as const,
          text: `Rendered ${rendered.length} page(s) from ${filename} at ${scale}x scale:`,
        });

        for (const page of rendered) {
          contentBlocks.push({
            type: "image" as const,
            data: page.png.toString("base64"),
            mimeType: "image/png",
          });
          contentBlocks.push({
            type: "text" as const,
            text: `Page ${page.page} (${Math.round(page.png.length / 1024)}KB)`,
          });
        }

        return { content: contentBlocks };
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

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.error(`[DXR] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;
  console.error(`[DXR] Received ${signal}, shutting down gracefully...`);

  try {
    await server.close();
    console.error(`[DXR] Server closed successfully`);
  } catch (error) {
    console.error(`[DXR] Error during shutdown:`, error);
  }

  process.exit(0);
}

// Handle process signals for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught errors to prevent silent crashes
process.on('uncaughtException', (error) => {
  console.error(`[DXR] Uncaught exception:`, error);
  // Don't exit - try to keep running if possible
});

process.on('unhandledRejection', (reason) => {
  console.error(`[DXR] Unhandled promise rejection:`, reason);
  // Don't exit - try to keep running if possible
});

// Start the server
async function main() {
  console.error(`[DXR] Starting Data X-Ray MCP Server v${VERSION}...`);
  console.error(`[DXR] Node.js version: ${process.version}`);
  console.error(`[DXR] MCP SDK version: 1.25.3`);

  // Monitor stdin for connection issues
  process.stdin.on('end', () => {
    console.error(`[DXR] stdin ended - client disconnected`);
    if (!isShuttingDown) {
      gracefulShutdown('stdin-end');
    }
  });

  process.stdin.on('close', () => {
    console.error(`[DXR] stdin closed`);
  });

  process.stdin.on('error', (err) => {
    console.error(`[DXR] stdin error:`, err);
  });

  const transport = new StdioServerTransport();

  // Log connection lifecycle events
  transport.onclose = () => {
    console.error(`[DXR] Transport closed`);
    if (!isShuttingDown) {
      console.error(`[DXR] Unexpected transport close, initiating shutdown...`);
      gracefulShutdown('transport-close');
    }
  };

  transport.onerror = (error) => {
    console.error(`[DXR] Transport error:`, error);
  };

  try {
    await server.connect(transport);
    console.error(`[DXR] Server connected and ready on stdio`);
    console.error(`[DXR] Waiting for MCP client messages...`);
  } catch (error) {
    console.error(`[DXR] Failed to connect server:`, error);
    throw error;
  }
}

main().catch((error) => {
  console.error("[DXR] Fatal error during startup:", error);
  process.exit(1);
});

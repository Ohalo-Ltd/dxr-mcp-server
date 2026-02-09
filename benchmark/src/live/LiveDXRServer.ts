/**
 * Live DXR Server
 *
 * Connects to the real Data X-Ray API for live benchmark testing.
 * Implements the same interface as MockDXRServer for compatibility.
 */

import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent dxr-mcp-server directory
dotenv.config({ path: join(__dirname, '../../../.env') });

// Allow self-signed certificates for DXR API (running on IP address)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface DXRFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  owner?: string;
  lastModified: string;
  annotators: Array<{
    name: string;
    occurrences: number;
    domain: {
      name: string;
    };
  }>;
  labels: Array<{
    name: string;
    confidence?: number;
  }>;
  dlpLabels: Array<{
    name: string;
  }>;
  extractedMetadata?: {
    contractType?: string;
    expirationDate?: string;
    [key: string]: unknown;
  };
  entitlements: {
    whoCanAccess: Array<{
      email?: string;
      accountType?: string;
    }>;
  };
}

interface Classification {
  id: number;
  name: string;
  description?: string;
  type: string;
}

interface Redactor {
  id: number;
  name: string;
  description?: string;
}

interface ListFilesResponse {
  files: DXRFile[];
  total: number;
  hasMore: boolean;
}

/**
 * Live implementation of the DXR API client
 */
export class LiveDXRServer {
  private apiUrl: string;
  private apiToken: string;

  constructor() {
    const apiUrl = process.env.DXR_API_URL;
    const apiToken = process.env.DXR_API_TOKEN;

    if (!apiUrl || !apiToken) {
      throw new Error(
        'Missing DXR credentials. Set DXR_API_URL and DXR_API_TOKEN environment variables.'
      );
    }

    // Remove trailing slash if present
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
  }

  /**
   * Make authenticated request to DXR API (JSON response)
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DXR API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make authenticated request to DXR API (NDJSON response)
   */
  private async requestNDJSON<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T[]> {
    const url = `${this.apiUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DXR API error ${response.status}: ${errorText}`);
    }

    const text = await response.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line) as T);
  }

  /**
   * List file metadata with optional KQL query filtering
   */
  async listFileMetadata(
    query?: string,
    limit = 50,
    offset = 0
  ): Promise<ListFilesResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });

    if (query) {
      params.set('q', query);
    }

    // DXR API returns NDJSON format
    const files = await this.requestNDJSON<DXRFile>(
      `/api/v1/files?${params.toString()}`
    );

    return {
      files: files || [],
      total: files.length,
      hasMore: files.length >= limit,
    };
  }

  /**
   * Get file metadata by ID
   */
  async getFileMetadata(fileId: string): Promise<DXRFile | null> {
    try {
      const response = await this.request<DXRFile>(
        `/api/v1/files/${encodeURIComponent(fileId)}`
      );
      return response;
    } catch {
      return null;
    }
  }

  /**
   * Get file content
   */
  async getFileContent(
    fileId: string
  ): Promise<{ content: string; mimeType: string; fileName: string } | null> {
    try {
      const response = await this.request<{
        content: string;
        mimeType: string;
        fileName: string;
      }>(`/api/v1/files/${encodeURIComponent(fileId)}/content`);
      return response;
    } catch {
      return null;
    }
  }

  /**
   * Get redacted text for a file
   */
  async getFileRedactedText(
    fileId: string,
    redactorId: number
  ): Promise<string | null> {
    try {
      const response = await this.request<{ text: string }>(
        `/api/v1/files/${encodeURIComponent(fileId)}/redacted?redactorId=${redactorId}`
      );
      return response.text;
    } catch {
      return null;
    }
  }

  /**
   * Get all classifications
   */
  async getClassifications(): Promise<Classification[]> {
    const response = await this.request<{ status: string; data: Classification[] }>(
      '/api/v1/classifications'
    );
    return response.data || [];
  }

  /**
   * Get all redactors
   */
  async getRedactors(): Promise<Redactor[]> {
    const response = await this.request<{ status: string; data: Redactor[] }>(
      '/api/v1/redactors'
    );
    return response.data || [];
  }

  /**
   * Test connection to DXR API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getClassifications();
      return true;
    } catch {
      return false;
    }
  }
}

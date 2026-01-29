/**
 * TypeScript types for Data X-Ray API
 * Based on OpenAPI specifications in dxr/api-specs/v1
 */

// ============================================
// File Metadata Types
// ============================================

export interface FileMetadataListResponse {
  status: "ok";
  data: FileMetadata[];
}

export interface FileMetadata {
  id: string;
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  mimeType?: string;
  datasourceId?: string;
  classifications?: Classification[];
  // Additional DXR metadata fields - keeping minimal index signature
  // for extensibility while maintaining type safety on known fields
}

// Lightweight file summary for initial list responses (reduced context usage)
export interface FileSummary {
  fileId: string;
  fileName: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  lastModifiedAt: string;
  hasSensitiveData: boolean;
  sensitiveDataCount: number;
  hasLabels: boolean;
  datasourceName?: string;
}

// Aggregate statistics for file list responses
export interface FileListStats {
  totalFiles: number;
  totalSize: number;
  filesWithSensitiveData: number;
  filesWithLabels: number;
  mimeTypes: Record<string, number>; // mimeType -> count
  dateRange?: {
    earliest: string;
    latest: string;
  };
}

// Summary response for list_file_metadata (context-efficient)
export interface FileMetadataSummaryResponse {
  status: "ok";
  stats: FileListStats;
  files: FileSummary[];
  pagination: {
    offset: number;
    limit: number;
    returnedCount: number;
    hasMore: boolean;
  };
}

// Full file metadata with all API fields (for get_file_metadata_details)
export interface FullFileMetadata {
  datasource: {
    id: string;
    name: string;
    connector?: {
      type: string;
      userId?: string;
    };
  };
  fileName: string;
  fileId: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  lastModifiedAt: string;
  contentSha256?: string;
  scanDepth?: string;
  labels?: Array<{
    id: string;
    name: string;
  }>;
  metadataExtractionStatus?: string;
  extractedMetadata?: Array<{
    id: string;
    name: string;
    value: string;
    type: string;
  }>;
  entitlements?: {
    whoCanAccess?: Array<{
      id: string;
      accountType: string;
      realmAccountId?: string;
      realmKey?: string;
      name?: string;
      email?: string;
      accountSubType?: string;
    }>;
  };
  dlpLabels?: Array<{
    id: string;
    dlpSystem: string;
    name: string;
    type: string;
  }>;
  annotators?: Array<{
    id: string;
    name: string;
    domain?: {
      id: string;
      name: string;
    };
    uniquePhrases?: number;
    annotations?: Array<{
      phrase: string;
      locations: Array<{
        start: number;
        end: number;
      }>;
    }>;
  }>;
  owner?: {
    id: string;
    accountType: string;
    name?: string;
    email?: string;
  };
  createdBy?: {
    id: string;
    accountType: string;
    name?: string;
    email?: string;
  };
  modifiedBy?: {
    id: string;
    accountType: string;
    name?: string;
    email?: string;
  };
  coordinates?: {
    lat: number;
    lon: number;
    alt?: number;
    mapDatum?: string;
    altRef?: string;
  };
}

// Response for get_file_metadata_details
export interface FullFileMetadataResponse {
  status: "ok";
  data: FullFileMetadata;
}

export interface FileContentResponse {
  content: string; // base64-encoded
  contentType: string;
  contentDisposition: string;
}

// ============================================
// Redaction Types
// ============================================

export interface RedactionResponse {
  status: "ok";
  data: {
    redactedText: string;
  };
}

export interface Redactor {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedactorCatalog {
  status: "ok";
  data: Redactor[];
}

// ============================================
// Classification Types
// ============================================

export type ClassificationType = "ANNOTATOR" | "ANNOTATOR_DOMAIN" | "LABEL" | "EXTRACTOR";
export type ClassificationSubtype = "REGEX" | "DICTIONARY" | "NAMED_ENTITY" | "STANDARD" | "SMART" | "NONE";

export interface Classification {
  id: string;
  name: string;
  type: ClassificationType;
  subtype?: ClassificationSubtype;
  description: string;
  createdAt: string;
  updatedAt: string;
  link: string;
  searchLink?: string;
}

export interface ClassificationCatalog {
  status: "ok";
  data: Classification[];
}

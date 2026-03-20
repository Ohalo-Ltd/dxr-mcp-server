/**
 * TypeScript types for Data X-Ray API v1
 * Based on OpenAPI specification: v1-api-spec.json (DXR 8.2)
 */

// ============================================
// Enums from API spec
// ============================================

export type ScanDepth = "DISCOVERY" | "DISCOVERY_AND_CLASSIFICATION";

export type MetadataExtractionStatus =
  | "UNKNOWN_ERROR"
  | "CONFIGURATION_ERROR"
  | "UNSUPPORTED_EXTRACTOR"
  | "AI_INTEGRATION_NOT_ENABLED"
  | "DOCUMENT_BINARY_LOCATION_NOT_PROVIDED"
  | "DOCUMENT_MIME_TYPE_NOT_PROVIDED"
  | "DOCUMENT_BINARY_UNAVAILABLE"
  | "UNSUPPORTED_MIME_TYPE"
  | "LANGUAGE_MODEL_EXCEPTION"
  | "INVALID_EXTRACTED_VALUE"
  | "RESULT_PARSING_ERROR"
  | "DISABLED"
  | "FILTERED"
  | "TEXT_UNAVAILABLE"
  | "SUCCESS"
  | "SKIPPED";

export type ConnectorType =
  | "BOX"
  | "ONEDRIVE_GRAPH_API"
  | "SHAREPOINT_ONLINE_GRAPH_API"
  | "SHAREPOINT_2016_2019_REST_API"
  | "AMAZON_S3"
  | "ON_DEMAND_CLASSIFIER"
  | "AZURE_BLOB_STORAGE"
  | "FOLDER_PATH"
  | "GOOGLE_CLOUD_STORAGE"
  | "GOOGLE_DRIVE_GOOGLE_WORKSPACE"
  | "GOOGLE_SHARED_DRIVE_GOOGLE_WORKSPACE"
  | "NETWORK_DRIVE_SMB"
  | "NETWORK_DRIVE_SSH"
  | "NETWORK_DRIVE_SMB_LEGACY"
  | "CONTENT_SUITE"
  | "FILE_UPLOAD";

export type DlpSystem = "PURVIEW";
export type DlpLabelType = "APPLIED" | "ASSIGNED";
export type ExtractedMetadataType = "TEXT" | "NUMBER" | "BOOLEAN";

// ============================================
// File Metadata Types
// ============================================

// JSONL response from GET /api/v1/files - parsed into an array by the server
export interface FileMetadataListResponse {
  status: "ok";
  data: FullFileMetadata[];
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
  dxrLink?: string; // Link to view file in DXR interface
  nativeLink?: string; // Link to file in native storage (SharePoint, Google Drive, etc.)
}

// Distribution entry for aggregate stats
export interface DistributionEntry {
  name: string;
  fileCount: number;
}

// Annotator distribution entry (includes domain)
export interface AnnotatorDistributionEntry extends DistributionEntry {
  domain: string;
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
  // Distributions across ALL results (not just current page)
  topAnnotators?: AnnotatorDistributionEntry[]; // Top annotators by file count
  topDomains?: DistributionEntry[]; // Top annotator domains by file count
  topLabels?: DistributionEntry[]; // Top labels by file count
  datasources?: DistributionEntry[]; // Datasource breakdown
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

// RealmAccount - shared type for owner, createdBy, modifiedBy, entitlements
export interface RealmAccount {
  id: string;
  accountType: string;
  realmAccountId: string;
  realmKey: string;
  accountSubType: string;
  name?: string | null;
  email?: string | null;
}

// Full file metadata matching the v1 FileMetadataResponse schema
export interface FullFileMetadata {
  // Required fields
  datasource: {
    id: string;
    name: string;
    connector: {
      type: ConnectorType;
      userId?: string; // BOX connector
      siteId?: string; // OneDrive/SharePoint connectors
      siteUrl?: string; // OneDrive/SharePoint connectors
    };
  };
  fileName: string;
  fileId: string;
  size: number;
  labels: Array<{
    id: string;
    name: string;
  }>;
  entitlements: {
    whoCanAccess: RealmAccount[];
  };

  // Optional fields
  path?: string;
  mimeType?: string;
  createdAt?: string;
  lastModifiedAt?: string;
  contentSha256?: string;
  scanDepth?: ScanDepth;
  metadataExtractionStatus?: MetadataExtractionStatus;
  extractedMetadata?: Array<{
    id: string;
    name: string;
    value: string | number;
    type: ExtractedMetadataType;
  }>;
  dlpLabels?: Array<{
    id: string;
    dlpSystem: DlpSystem;
    name?: string;
    type: DlpLabelType;
  }>;
  annotators?: Array<{
    id: string;
    name: string;
    domain: {
      id: string;
      name: string;
    };
    uniquePhrases: number;
    annotations: Array<{
      phrase: string;
      locations: Array<{
        start: number;
        end: number;
      }>;
    }>;
  }>;
  owner?: RealmAccount;
  createdBy?: RealmAccount;
  modifiedBy?: RealmAccount;
  coordinates?: {
    lat: number;
    lon: number;
    mapDatum: string;
    alt?: number;
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

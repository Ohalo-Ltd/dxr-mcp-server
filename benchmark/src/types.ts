/**
 * DXR Benchmark Framework - Type Definitions
 *
 * This module defines all interfaces and types used throughout the benchmark framework
 * for comparing AI agent performance with vs without Data X-Ray access.
 */

// ============================================================================
// Task Definition Types
// ============================================================================

export type TaskCategory = 'compliance' | 'search' | 'governance';
export type TaskDifficulty = 'easy' | 'medium' | 'hard';
export type AgentType = 'dxr' | 'baseline';

/**
 * Expected file in ground truth - what the agent should find
 */
export interface ExpectedFile {
  /** File ID that should be found */
  id: string;
  /** Relevance score 0.0 to 1.0 (1.0 = highly relevant) */
  relevance: number;
  /** Human-readable reason why this file is expected */
  reason: string;
}

/**
 * Forbidden file - accessing this is a compliance violation
 */
export interface ForbiddenFile {
  /** File ID that should NOT be accessed */
  id: string;
  /** Reason why access is forbidden */
  reason: string;
}

/**
 * Ground truth for scoring task results
 */
export interface GroundTruth {
  /** Files the agent should find */
  expectedFiles: ExpectedFile[];
  /** Files the agent should NOT access (compliance violations) */
  forbiddenFiles: ForbiddenFile[];
  /** Minimum acceptable precision (0.0 to 1.0) */
  minimumPrecision: number;
  /** Minimum acceptable recall (0.0 to 1.0) */
  minimumRecall: number;
}

/**
 * Execution configuration for a task
 */
export interface ExecutionConfig {
  /** Maximum time allowed for task completion (seconds) */
  timeoutSeconds: number;
  /** Maximum number of tool calls allowed */
  maxToolCalls: number;
  /** Hints for what the DXR agent should ideally do */
  dxrHints?: {
    expectedTools?: string[];
    expectedQueries?: string[];
  };
}

/**
 * Compliance requirements for a task
 */
export interface ComplianceConfig {
  /** Agent must respect file access controls */
  mustRespectAccessControls: boolean;
  /** Agent must not expose raw PII in responses */
  mustNotExposeRawPii: boolean;
  /** Sensitive data domains relevant to this task */
  sensitiveDataDomains?: string[];
}

/**
 * Complete task definition loaded from YAML
 */
export interface Task {
  /** Unique task identifier (e.g., "compliance-001") */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Detailed description of the task */
  description: string;
  /** Task category: compliance, search, or governance */
  category: TaskCategory;
  /** Regulatory or functional domain (e.g., "HIPAA", "contracts") */
  domain: string;
  /** Difficulty level */
  difficulty: TaskDifficulty;
  /** The prompt given to the agent */
  prompt: string;
  /** Ground truth for scoring */
  groundTruth: GroundTruth;
  /** Execution configuration */
  execution: ExecutionConfig;
  /** Compliance requirements */
  compliance: ComplianceConfig;
  /** Tags for filtering/grouping */
  tags: string[];
}

// ============================================================================
// Mock Data Types (aligned with DXR API types)
// ============================================================================

/**
 * Mock file annotator (sensitive data detection)
 */
export interface MockAnnotator {
  id: string;
  name: string;
  occurrences: number;
  domain: {
    id: string;
    name: string;
  };
}

/**
 * Mock file label (classification)
 */
export interface MockLabel {
  id: string;
  name: string;
}

/**
 * Mock DLP label
 */
export interface MockDlpLabel {
  name: string;
  source: string;
  type: string;
}

/**
 * Mock entitlement (access control)
 */
export interface MockEntitlement {
  accountType: 'USER' | 'GROUP' | 'DOMAIN';
  name: string;
  email?: string;
}

/**
 * Mock file metadata - full DXR representation
 */
export interface MockDXRFile {
  fileId: string;
  fileName: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  lastModifiedAt: string;
  owner?: string;
  createdBy?: string;
  modifiedBy?: string;
  contentSha256?: string;

  // DXR-specific rich metadata
  annotators: MockAnnotator[];
  labels: MockLabel[];
  dlpLabels: MockDlpLabel[];
  entitlements: {
    whoCanAccess: MockEntitlement[];
  };
  extractedMetadata?: Record<string, string>;

  // Datasource info
  datasource: {
    id: string;
    name: string;
    type: string;
  };
}

/**
 * Mock file metadata - basic GDrive representation (no sensitivity data)
 */
export interface MockGDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  parents?: string[];
  webViewLink?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
}

/**
 * Mock classification (from DXR)
 */
export interface MockClassification {
  id: string;
  name: string;
  type: 'ANNOTATOR' | 'LABEL' | 'EXTRACTOR';
  subtype?: string;
  description: string;
}

/**
 * Mock redactor (from DXR)
 */
export interface MockRedactor {
  id: number;
  name: string;
  description?: string;
}

// ============================================================================
// Benchmark Result Types
// ============================================================================

/**
 * A tool call made by the agent during execution
 */
export interface ToolCall {
  /** Tool name (e.g., "list_file_metadata") */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Tool result (truncated if large) */
  result?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * A compliance violation detected during task execution
 */
export interface ComplianceViolation {
  /** Type of violation */
  type: 'FORBIDDEN_FILE_ACCESS' | 'RAW_PII_EXPOSURE' | 'ACCESS_CONTROL_BYPASS' | 'OTHER';
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** File ID involved (if applicable) */
  fileId?: string;
  /** Description of the violation */
  description: string;
}

/**
 * Result of running a single task with a single agent
 */
export interface TaskResult {
  /** Task ID */
  taskId: string;
  /** Agent type used */
  agentType: AgentType;

  // Core metrics
  /** Did the agent successfully complete the task objective? */
  taskCompleted: boolean;
  /** Precision: |found ∩ expected| / |found| */
  precision: number;
  /** Recall: |found ∩ expected| / |expected| */
  recall: number;
  /** F1 Score: 2 * (P * R) / (P + R) */
  f1Score: number;
  /** Time from task start to completion (milliseconds) */
  timeToAnswerMs: number;

  // Compliance metrics
  /** List of compliance violations detected */
  complianceViolations: ComplianceViolation[];
  /** Did the agent pass all compliance checks? */
  compliancePassed: boolean;

  // Detailed results
  /** File IDs found by the agent */
  filesFound: string[];
  /** File IDs that were expected */
  filesExpected: string[];
  /** All tool calls made during execution */
  toolCalls: ToolCall[];
  /** Full agent response */
  agentResponse: string;

  // Metadata
  /** Timestamp when result was recorded */
  timestamp: string;
  /** Model version used */
  modelVersion: string;
  /** Error message if task failed */
  error?: string;
}

/**
 * Comparison of DXR vs baseline for a single task
 */
export interface TaskComparison {
  taskId: string;
  taskName: string;
  category: TaskCategory;

  dxrResult: TaskResult;
  baselineResult: TaskResult;

  // Delta metrics
  precisionDelta: number;
  recallDelta: number;
  f1Delta: number;
  timeDeltaMs: number;

  /** Winner: 'dxr', 'baseline', or 'tie' */
  winner: 'dxr' | 'baseline' | 'tie';
}

/**
 * Summary statistics for a category of tasks
 */
export interface CategorySummary {
  category: TaskCategory;
  totalTasks: number;

  dxr: {
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgTimeMs: number;
    tasksCompleted: number;
    complianceRate: number;
  };

  baseline: {
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgTimeMs: number;
    tasksCompleted: number;
    complianceRate: number;
  };

  dxrWins: number;
  baselineWins: number;
  ties: number;
}

/**
 * Complete benchmark comparison report
 */
export interface ComparisonReport {
  /** Report metadata */
  metadata: {
    generatedAt: string;
    modelVersion: string;
    benchmarkVersion: string;
    mode: 'mock' | 'live';
  };

  /** High-level summary */
  summary: {
    totalTasks: number;
    dxrWins: number;
    baselineWins: number;
    ties: number;
  };

  /** Summary by category */
  byCategory: Record<TaskCategory, CategorySummary>;

  /** Aggregate metrics */
  metrics: {
    avgPrecisionDelta: number;
    avgRecallDelta: number;
    avgF1Delta: number;
    avgTimeDeltaMs: number;
    complianceImprovementRate: number;
  };

  /** Individual task comparisons */
  taskResults: TaskComparison[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Run mode: mock or live */
  mode: 'mock' | 'live';

  /** Task filters */
  filters?: {
    category?: TaskCategory;
    taskId?: string;
    tags?: string[];
  };

  /** Output configuration */
  output: {
    directory: string;
    formats: ('json' | 'markdown' | 'html')[];
  };

  /** Agent configuration */
  agent: {
    model: string;
    maxTokens: number;
    temperature: number;
  };

  /** DXR configuration (for live mode) */
  dxr?: {
    apiUrl: string;
    apiToken: string;
  };

  /** Google Drive configuration (for live mode) */
  gdrive?: {
    sampleFolderId: string;
  };
}

/**
 * Claude Agent
 *
 * Wrapper around the Anthropic SDK for running benchmark tasks with Claude.
 * Supports configurable tool sets to compare DXR vs baseline capabilities.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface AgentResult {
  response: string;
  filesFound: string[];
  toolCalls: AgentToolCall[];
  totalTimeMs: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface AgentConfig {
  tools: Anthropic.Tool[];
  toolHandlers: Record<string, ToolHandler>;
  systemPrompt?: string;
  maxTurns?: number;
  verbose?: boolean;
}

// Simple delay helper for rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Track last API call time for rate limiting
let lastApiCallTime = 0;
const MIN_DELAY_BETWEEN_CALLS_MS = 3000; // 3 seconds between API calls

/**
 * Claude Agent for benchmark tasks
 */
export class ClaudeAgent {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  /**
   * Rate-limited API call
   */
  private async rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;
    if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS_MS) {
      await delay(MIN_DELAY_BETWEEN_CALLS_MS - timeSinceLastCall);
    }
    lastApiCallTime = Date.now();
    return fn();
  }

  /**
   * Run a task with the given tools and return results
   */
  async runTask(
    taskPrompt: string,
    config: AgentConfig
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const toolCalls: AgentToolCall[] = [];
    const filesFound: string[] = [];
    const maxTurns = config.maxTurns || 10;
    const verbose = config.verbose || false;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: taskPrompt },
    ];

    if (verbose) {
      console.log('\n' + '='.repeat(80));
      console.log('CLAUDE AGENT TRANSCRIPT');
      console.log('='.repeat(80));
      console.log('\n📝 USER PROMPT:');
      console.log(taskPrompt);
      console.log('\n📋 SYSTEM PROMPT:');
      console.log(config.systemPrompt || '(default)');
    }

    let turnCount = 0;
    let finalResponse = '';

    while (turnCount < maxTurns) {
      turnCount++;

      if (verbose) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🔄 TURN ${turnCount}`);
        console.log('─'.repeat(60));
      }

      const response = await this.rateLimitedCall(() =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: config.systemPrompt || 'You are a helpful assistant that finds files based on user requests. When you find relevant files, list their names clearly.',
          tools: config.tools,
          messages,
        })
      );

      if (verbose) {
        console.log(`\n🤖 CLAUDE RESPONSE (stop_reason: ${response.stop_reason}):`);
      }

      // Check if we're done (no more tool use)
      if (response.stop_reason === 'end_turn') {
        // Extract final text response
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse = block.text;
            if (verbose) {
              console.log('\n📄 FINAL TEXT:');
              console.log(block.text);
            }
          }
        }
        break;
      }

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        // First log any text blocks
        for (const block of response.content) {
          if (block.type === 'text' && verbose) {
            console.log('\n💭 CLAUDE THINKING:');
            console.log(block.text);
          }
        }

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const toolArgs = block.input as Record<string, unknown>;
            const handler = config.toolHandlers[toolName];

            if (verbose) {
              console.log(`\n🔧 TOOL CALL: ${toolName}`);
              console.log('   Args:', JSON.stringify(toolArgs, null, 2));
            }

            const toolStart = Date.now();
            let result: string;

            if (handler) {
              try {
                result = await handler(toolArgs);
              } catch (error) {
                result = `Error: ${error}`;
              }
            } else {
              result = `Error: Unknown tool ${toolName}`;
            }

            if (verbose) {
              console.log('\n📥 TOOL RESULT:');
              console.log(result);
            }

            toolCalls.push({
              name: toolName,
              args: toolArgs,
              result,
              durationMs: Date.now() - toolStart,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });

            // Extract file names from search results (both GDrive and DXR tools)
            if (toolName === 'google_drive_search' || toolName === 'gdrive_search' || toolName === 'gdrive_list_files' || toolName === 'list_file_metadata') {
              // Match "- filename (type, size)" format from tool results
              // Files may or may not have extensions (e.g., "CardBase" vs "report.pdf")
              // Pattern: "- " followed by filename (non-greedy), then " (" for metadata
              const fileRegex = /^- ([^\n(]+?)\s+\(/gm;
              let match;
              while ((match = fileRegex.exec(result)) !== null) {
                const fileName = match[1].trim();
                if (fileName && !filesFound.includes(fileName)) {
                  filesFound.push(fileName);
                }
              }
            }
          }
        }

        // Add assistant message with tool use
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        // Add tool results
        messages.push({
          role: 'user',
          content: toolResults,
        });
      }
    }

    // Try to extract file names from the final response if we didn't get them from tools
    if (filesFound.length === 0 && finalResponse) {
      // Look for file names in the response (common patterns)
      const patterns = [
        /`([^`]+\.(txt|pdf|docx?|xlsx?|csv))`/gi,
        /["']([^"']+\.(txt|pdf|docx?|xlsx?|csv))["']/gi,
        /- ([^\n]+\.(txt|pdf|docx?|xlsx?|csv))/gi,
      ];

      for (const pattern of patterns) {
        const matches = finalResponse.matchAll(pattern);
        for (const match of matches) {
          const fileName = match[1].trim();
          if (fileName && !filesFound.includes(fileName)) {
            filesFound.push(fileName);
          }
        }
      }
    }

    if (verbose) {
      console.log('\n' + '='.repeat(80));
      console.log('END OF TRANSCRIPT');
      console.log('='.repeat(80));
      console.log(`\n📊 SUMMARY:`);
      console.log(`   Total turns: ${turnCount}`);
      console.log(`   Tool calls: ${toolCalls.length}`);
      console.log(`   Files found: ${filesFound.length}`);
      if (filesFound.length > 0) {
        console.log(`   Files: ${filesFound.join(', ')}`);
      }
      console.log(`   Total time: ${Date.now() - startTime}ms`);
      console.log('');
    }

    return {
      response: finalResponse,
      filesFound,
      toolCalls,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Create Google Drive tools for baseline agent
 * These mock the Claude Desktop native Google Drive connector
 * Tool names and schemas match the official Claude Desktop integration
 */
export function createGDriveTools(gdriveServer: {
  searchByName: (query: string) => Array<{ id: string; name: string; mimeType: string; size: number }>;
  listFilesInFolder: (folderId: string) => Array<{ id: string; name: string; mimeType: string; size: number }>;
  getFile: (fileId: string) => { id: string; name: string; mimeType: string; size: number; modifiedTime: string } | null;
  getFileContent: (fileId: string) => { content: string; mimeType: string } | null;
  listFiles: (options?: { query?: string; pageSize?: number; pageToken?: string }) => { files: Array<{ id: string; name: string; mimeType: string; size: number }>; nextPageToken?: string };
}): { tools: Anthropic.Tool[]; handlers: Record<string, ToolHandler> } {
  const tools: Anthropic.Tool[] = [
    {
      name: 'google_drive_search',
      description: "Searches a user's Google Drive files for documents matching a query. Uses Google Drive API query syntax.",
      input_schema: {
        type: 'object' as const,
        properties: {
          api_query: {
            type: 'string',
            description: "Google Drive API query string (e.g., \"name contains 'invoice'\", \"mimeType='application/pdf'\")",
          },
          order_by: {
            type: 'string',
            description: 'Sort order (e.g., "modifiedTime desc", "name")',
          },
          page_size: {
            type: 'number',
            description: 'Number of results to return (default: 100)',
          },
          page_token: {
            type: 'string',
            description: 'Token for pagination',
          },
          request_page_token: {
            type: 'boolean',
            description: 'Whether to include next page token in response',
          },
        },
      },
    },
    {
      name: 'google_drive_fetch',
      description: 'Fetches the contents of Google Drive document(s) based on a list of provided IDs.',
      input_schema: {
        type: 'object' as const,
        properties: {
          document_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of Google Drive file IDs to fetch',
          },
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    google_drive_search: async (args) => {
      const apiQuery = args.api_query as string | undefined;
      const pageSize = (args.page_size as number) || 100;
      const pageToken = args.page_token as string | undefined;

      // Extract search term from Google Drive API query syntax
      let searchTerm = '';
      if (apiQuery) {
        // Parse common query patterns:
        // name contains 'value' -> extract value
        const nameContains = apiQuery.match(/name\s+contains\s+['"]([^'"]+)['"]/i);
        if (nameContains) {
          searchTerm = nameContains[1];
        }
        // fullText contains 'value' -> extract value
        const fullText = apiQuery.match(/fullText\s+contains\s+['"]([^'"]+)['"]/i);
        if (fullText) {
          searchTerm = fullText[1];
        }
        // If no recognized pattern, use the whole query as a simple search
        if (!searchTerm) {
          searchTerm = apiQuery.replace(/['"`]/g, '');
        }
      }

      const result = gdriveServer.listFiles({
        query: searchTerm ? `name contains '${searchTerm}'` : undefined,
        pageSize,
        pageToken,
      });

      if (result.files.length === 0) {
        return `No files found${apiQuery ? ` matching query: ${apiQuery}` : ''}`;
      }

      const lines = [`Found ${result.files.length} file(s)${apiQuery ? ` matching "${apiQuery}"` : ''}:`];
      for (const file of result.files.slice(0, 20)) {
        lines.push(`- ${file.name} (${file.mimeType}, ${formatSize(file.size)})`);
      }
      if (result.files.length > 20) {
        lines.push(`... and ${result.files.length - 20} more files`);
      }
      if (result.nextPageToken) {
        lines.push(`\nNext page token: ${result.nextPageToken}`);
      }

      return lines.join('\n');
    },

    google_drive_fetch: async (args) => {
      const documentIds = args.document_ids as string[] | undefined;

      if (!documentIds || documentIds.length === 0) {
        return 'No document IDs provided';
      }

      const results: string[] = [];
      for (const fileId of documentIds.slice(0, 10)) {
        const file = gdriveServer.getFile(fileId);
        if (!file) {
          results.push(`File ${fileId}: Not found`);
          continue;
        }

        const content = gdriveServer.getFileContent(fileId);
        if (!content) {
          results.push(`File ${file.name} (${fileId}): Unable to read content`);
          continue;
        }

        // Decode base64 content
        const text = Buffer.from(content.content, 'base64').toString('utf-8');
        const truncated = text.slice(0, 1000) + (text.length > 1000 ? '\n... (truncated)' : '');
        results.push(`\n--- ${file.name} (${fileId}) ---\n${truncated}`);
      }

      if (documentIds.length > 10) {
        results.push(`\n... and ${documentIds.length - 10} more documents not fetched`);
      }

      return results.join('\n');
    },
  };

  return { tools, handlers };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Create DXR MCP-like tools for the DXR agent
 * These mirror the actual DXR MCP server tools
 */
export function createDXRTools(dxrServer: {
  getClassifications: () => Promise<Array<{ id: number; name: string; type: string; description?: string }>>;
  listFileMetadata: (query?: string, limit?: number, offset?: number) => Promise<{
    files: Array<{
      fileId: string;
      fileName: string;
      mimeType: string;
      size: number;
      owner?: string;
      annotators?: Array<{ name: string; domain: { name: string } }>;
      labels?: Array<{ name: string }>;
      entitlements?: { whoCanAccess: Array<{ email?: string; accountType?: string }> };
    }>;
    total: number;
    hasMore: boolean;
  }>;
}): { tools: Anthropic.Tool[]; handlers: Record<string, ToolHandler> } {
  const tools: Anthropic.Tool[] = [
    {
      name: 'get_classifications',
      description: `List all sensitivity classifications available in Data X-Ray.

Call this FIRST for compliance/governance tasks to learn available LABELS and EXTRACTORS.
For simple filename searches, you can skip this and use list_file_metadata directly.

CLASSIFICATION HIERARCHY (by confidence):
1. LABELS (high confidence) - Confirmed classifications like "Search: Confirmed Invoice", "PCI: Confirmed Cardholder Data"
2. EXTRACTORS (high confidence) - AI pre-cached results for document type, sensitivity, compliance
3. ANNOTATORS (lower confidence) - Pattern detectors that may have false positives

PREFER labels.name and extractors over annotators.name for precision.`,
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'list_file_metadata',
      description: `Search files using KQL queries. Returns metadata, owner, entitlements, and content classifications.

QUERY PRIORITY (use in this order for best results):

1. LABELS + EXTRACTORS (high precision - use these first):
   labels.name:"Search: Confirmed Invoice"        - Confirmed invoices
   labels.name:"Search: Confirmed Contract"       - Confirmed contracts
   labels.name:"PCI: Confirmed Cardholder Data"   - Confirmed credit card data
   labels.name:"HIPAA: Confirmed PHI Document"    - Confirmed health data
   labels.name:"Governance: Missing Owner"        - Files without ownership
   extractors.name:"Document Type Classifier"     - AI document classification

2. FILENAME (for name-based searches - CASE SENSITIVE!):
   fileName:"*invoice*" OR fileName:"*Invoice*"   - Search BOTH cases!
   fileName:"*JSmith*" OR fileName:"*J_Smith*"    - Files by author name
   fileName:"*.pdf"                               - All PDF files
   IMPORTANT: fileName is case-sensitive. Always search multiple case variants.

3. ANNOTATORS (use sparingly - higher false positive rate):
   annotators.name:"Credit card"                  - Pattern detection only
   AVOID annotators.domain.name - too broad, returns many false positives

BEST PRACTICE: Combine label + filename (both cases) for comprehensive results:
   labels.name:"Search: Confirmed Invoice" OR fileName:"*invoice*" OR fileName:"*Invoice*"

KQL SYNTAX: All string values MUST be in double quotes. Use AND, OR (uppercase).`,
      input_schema: {
        type: 'object' as const,
        properties: {
          q: {
            type: 'string',
            description: 'KQL query. PREFER labels.name for precision, use fileName for name searches.',
          },
          limit: {
            type: 'number',
            description: 'Number of files to return (default: 50, max: 500)',
          },
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    get_classifications: async () => {
      const classifications = await dxrServer.getClassifications();

      if (classifications.length === 0) {
        return 'No classifications found in the system.';
      }

      // Group by type for better readability
      const byType: Record<string, typeof classifications> = {};
      for (const c of classifications) {
        const type = c.type || 'other';
        if (!byType[type]) byType[type] = [];
        byType[type].push(c);
      }

      const lines = ['Available classifications in Data X-Ray:'];
      for (const [type, items] of Object.entries(byType)) {
        lines.push(`\n## ${type.toUpperCase()} (${items.length}):`);
        for (const item of items.slice(0, 30)) {
          lines.push(`- ${item.name}${item.description ? `: ${item.description}` : ''}`);
        }
        if (items.length > 30) {
          lines.push(`  ... and ${items.length - 30} more`);
        }
      }

      lines.push('\nUse these exact names in queries like: annotators.name:"Credit card"');

      return lines.join('\n');
    },

    list_file_metadata: async (args) => {
      const query = args.q as string | undefined;
      const limit = (args.limit as number) || 50;

      const result = await dxrServer.listFileMetadata(query, limit);

      // Deduplicate files by fileId (API sometimes returns duplicates)
      const seen = new Set<string>();
      const uniqueFiles = result.files.filter((file) => {
        if (seen.has(file.fileId)) return false;
        seen.add(file.fileId);
        return true;
      });

      if (uniqueFiles.length === 0) {
        return `No files found${query ? ` matching query: ${query}` : ''}`;
      }

      const lines = [`Found ${uniqueFiles.length} file(s)${query ? ` matching "${query}"` : ''}:`];

      for (const file of uniqueFiles.slice(0, 30)) {
        // Build file info line
        let line = `- ${file.fileName} (${file.mimeType}, ${formatSize(file.size)})`;

        // Add owner info
        if (file.owner) {
          line += ` [Owner: ${file.owner}]`;
        }

        // Add entitlements/access info
        if (file.entitlements?.whoCanAccess?.length) {
          const accessList = file.entitlements.whoCanAccess
            .slice(0, 3)
            .map(a => a.email || a.accountType || 'unknown')
            .join(', ');
          const more = file.entitlements.whoCanAccess.length > 3
            ? ` +${file.entitlements.whoCanAccess.length - 3} more`
            : '';
          line += ` [Access: ${accessList}${more}]`;
        }

        // Add labels
        if (file.labels?.length) {
          line += ` [Labels: ${file.labels.map((l) => l.name).join(', ')}]`;
        }

        // Add sensitive content indicators
        if (file.annotators?.length) {
          line += ` [Content: ${file.annotators.map((a) => a.name).join(', ')}]`;
        }

        lines.push(line);
      }

      if (uniqueFiles.length > 30) {
        lines.push(`... and ${uniqueFiles.length - 30} more files`);
      }

      if (result.hasMore) {
        lines.push(`\nNote: More results available. Use limit/offset for pagination.`);
      }

      return lines.join('\n');
    },
  };

  return { tools, handlers };
}

#!/usr/bin/env npx tsx
/**
 * MCP Log Analyzer
 *
 * Analyzes Claude Desktop MCP logs to identify issues and suggest improvements
 * to the dxr-mcp-server tool definitions.
 *
 * Usage: npx tsx .claude/mcp-log-analyzer.ts [--watch]
 */

import { readFileSync, existsSync, watchFile } from "fs";
import { homedir } from "os";
import { join } from "path";

const MCP_LOG_PATH = join(homedir(), "Library/Logs/Claude/mcp-server-dxr.log");
const MCP_GENERAL_LOG = join(homedir(), "Library/Logs/Claude/mcp.log");

interface LogEntry {
  timestamp: Date;
  level: string;
  server: string;
  message: string;
  raw: string;
}

interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  timestamp: Date;
  success: boolean;
  error?: string;
  response?: unknown;
}

interface AnalysisReport {
  timeRange: { start: Date; end: Date };
  totalToolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  toolUsage: Record<string, { calls: number; failures: number; errors: string[] }>;
  issues: Issue[];
  recommendations: Recommendation[];
}

interface Issue {
  severity: "error" | "warning" | "info";
  category: string;
  description: string;
  occurrences: number;
  examples: string[];
}

interface Recommendation {
  priority: "high" | "medium" | "low";
  area: string;
  suggestion: string;
  rationale: string;
}

function parseLogFile(path: string): LogEntry[] {
  if (!existsSync(path)) {
    console.error(`Log file not found: ${path}`);
    return [];
  }

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter(line => line.trim());

  return lines.map(line => {
    // Parse format: 2026-01-25T17:45:25.106Z [info] [dxr] Message...
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[(\w+)\]\s+\[(\w+)\]\s+(.*)$/);
    if (match) {
      return {
        timestamp: new Date(match[1]),
        level: match[2],
        server: match[3],
        message: match[4],
        raw: line
      };
    }
    return {
      timestamp: new Date(),
      level: "unknown",
      server: "unknown",
      message: line,
      raw: line
    };
  });
}

function extractToolCalls(entries: LogEntry[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Look for tool call requests
    if (entry.message.includes("Message from client:") && entry.message.includes("tools/call")) {
      try {
        const jsonMatch = entry.message.match(/Message from client:\s*(\{.*\})$/);
        if (jsonMatch) {
          const request = JSON.parse(jsonMatch[1]);
          if (request.method === "tools/call" && request.params) {
            const toolCall: ToolCall = {
              tool: request.params.name,
              params: request.params.arguments || {},
              timestamp: entry.timestamp,
              success: false
            };

            // Look for the response in subsequent entries
            for (let j = i + 1; j < Math.min(i + 10, entries.length); j++) {
              const responseEntry = entries[j];
              if (responseEntry.message.includes("Message from server:") &&
                  responseEntry.message.includes(`"id":${request.id}`)) {
                const responseMatch = responseEntry.message.match(/Message from server:\s*(\{.*\})$/);
                if (responseMatch) {
                  const response = JSON.parse(responseMatch[1]);
                  if (response.error) {
                    toolCall.success = false;
                    toolCall.error = response.error.message || JSON.stringify(response.error);
                  } else if (response.result) {
                    toolCall.success = true;
                    toolCall.response = response.result;

                    // Check if the response itself indicates an error
                    const resultStr = JSON.stringify(response.result);
                    if (resultStr.includes('"isError":true') || resultStr.includes('"error":')) {
                      toolCall.success = false;
                      toolCall.error = "Tool returned error in response";
                    }
                  }
                }
                break;
              }
            }

            toolCalls.push(toolCall);
          }
        }
      } catch (e) {
        // Skip malformed entries
      }
    }
  }

  return toolCalls;
}

function analyzeKQLIssues(toolCalls: ToolCall[]): Issue[] {
  const issues: Issue[] = [];
  const kqlCalls = toolCalls.filter(tc => tc.tool === "list_file_metadata");

  // Check for missing query parameters
  const noQueryCalls = kqlCalls.filter(tc => !tc.params.q);
  if (noQueryCalls.length > 0) {
    issues.push({
      severity: "warning",
      category: "KQL Usage",
      description: "list_file_metadata called without KQL query parameter",
      occurrences: noQueryCalls.length,
      examples: noQueryCalls.slice(0, 3).map(tc => JSON.stringify(tc.params))
    });
  }

  // Check for KQL syntax errors
  const kqlErrors = kqlCalls.filter(tc =>
    tc.error?.includes("Invalid KQL") || tc.error?.includes("Unknown field")
  );
  if (kqlErrors.length > 0) {
    issues.push({
      severity: "error",
      category: "KQL Syntax",
      description: "KQL query syntax errors detected",
      occurrences: kqlErrors.length,
      examples: kqlErrors.slice(0, 3).map(tc => tc.error || "")
    });
  }

  // Check for overly broad queries
  const broadQueries = kqlCalls.filter(tc => {
    const q = tc.params.q as string;
    return q && (q === "*" || q.length < 5);
  });
  if (broadQueries.length > 0) {
    issues.push({
      severity: "warning",
      category: "KQL Performance",
      description: "Overly broad KQL queries detected",
      occurrences: broadQueries.length,
      examples: broadQueries.slice(0, 3).map(tc => tc.params.q as string)
    });
  }

  return issues;
}

function analyzeConnectionIssues(entries: LogEntry[]): Issue[] {
  const issues: Issue[] = [];

  // Check for timeouts
  const timeouts = entries.filter(e =>
    e.message.includes("timed out") || e.message.includes("Request timed out")
  );
  if (timeouts.length > 0) {
    issues.push({
      severity: "error",
      category: "Connection",
      description: "Request timeouts detected",
      occurrences: timeouts.length,
      examples: timeouts.slice(0, 3).map(e => e.message)
    });
  }

  // Check for unexpected disconnects
  const disconnects = entries.filter(e =>
    e.message.includes("Server transport closed unexpectedly")
  );
  if (disconnects.length > 0) {
    issues.push({
      severity: "error",
      category: "Connection",
      description: "Unexpected server disconnections",
      occurrences: disconnects.length,
      examples: disconnects.slice(0, 3).map(e => e.raw)
    });
  }

  // Check for Node version issues
  const nodeVersionIssues = entries.filter(e =>
    e.message.includes("v14.") || e.message.includes("v16.")
  );
  if (nodeVersionIssues.length > 0) {
    issues.push({
      severity: "warning",
      category: "Environment",
      description: "Old Node.js version detected in path",
      occurrences: nodeVersionIssues.length,
      examples: ["Consider ensuring Node v18+ is used consistently"]
    });
  }

  return issues;
}

function generateRecommendations(issues: Issue[], toolCalls: ToolCall[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Analyze issues and generate recommendations
  const kqlSyntaxIssues = issues.filter(i => i.category === "KQL Syntax");
  if (kqlSyntaxIssues.length > 0) {
    recommendations.push({
      priority: "high",
      area: "Tool Description",
      suggestion: "Enhance list_file_metadata description with more KQL examples",
      rationale: `${kqlSyntaxIssues[0].occurrences} KQL syntax errors detected. Claude may need clearer guidance on query syntax.`
    });
  }

  const noQueryIssues = issues.filter(i => i.description.includes("without KQL query"));
  if (noQueryIssues.length > 0) {
    recommendations.push({
      priority: "medium",
      area: "Tool Schema",
      suggestion: "Consider making 'q' parameter required in list_file_metadata",
      rationale: `${noQueryIssues[0].occurrences} calls made without query parameter. This could return too many results.`
    });
  }

  const timeoutIssues = issues.filter(i => i.description.includes("timeout"));
  if (timeoutIssues.length > 0) {
    recommendations.push({
      priority: "high",
      area: "Server Performance",
      suggestion: "Investigate slow API responses or increase timeout",
      rationale: `${timeoutIssues[0].occurrences} timeout errors detected. May need to optimize queries or adjust timeout settings.`
    });
  }

  // Analyze tool usage patterns
  const toolUsage: Record<string, number> = {};
  toolCalls.forEach(tc => {
    toolUsage[tc.tool] = (toolUsage[tc.tool] || 0) + 1;
  });

  const unusedTools = ["list_file_metadata", "get_file_content", "get_file_redacted_text", "get_classifications", "get_redactors"]
    .filter(tool => !toolUsage[tool]);

  if (unusedTools.length > 0) {
    recommendations.push({
      priority: "low",
      area: "Tool Discovery",
      suggestion: `Improve descriptions for underutilized tools: ${unusedTools.join(", ")}`,
      rationale: "These tools haven't been used. Claude may not understand when to use them."
    });
  }

  // Check for repeated failures
  const failedTools = toolCalls.filter(tc => !tc.success);
  const failuresByTool: Record<string, number> = {};
  failedTools.forEach(tc => {
    failuresByTool[tc.tool] = (failuresByTool[tc.tool] || 0) + 1;
  });

  Object.entries(failuresByTool).forEach(([tool, count]) => {
    if (count > 2) {
      recommendations.push({
        priority: "high",
        area: "Error Handling",
        suggestion: `Investigate repeated failures in ${tool} (${count} failures)`,
        rationale: "High failure rate suggests the tool definition or API integration needs improvement."
      });
    }
  });

  return recommendations;
}

function generateReport(entries: LogEntry[], toolCalls: ToolCall[]): AnalysisReport {
  const issues: Issue[] = [
    ...analyzeKQLIssues(toolCalls),
    ...analyzeConnectionIssues(entries)
  ];

  const recommendations = generateRecommendations(issues, toolCalls);

  const toolUsage: Record<string, { calls: number; failures: number; errors: string[] }> = {};
  toolCalls.forEach(tc => {
    if (!toolUsage[tc.tool]) {
      toolUsage[tc.tool] = { calls: 0, failures: 0, errors: [] };
    }
    toolUsage[tc.tool].calls++;
    if (!tc.success) {
      toolUsage[tc.tool].failures++;
      if (tc.error) {
        toolUsage[tc.tool].errors.push(tc.error);
      }
    }
  });

  const timestamps = entries.map(e => e.timestamp).filter(t => !isNaN(t.getTime()));

  return {
    timeRange: {
      start: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : new Date(),
      end: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : new Date()
    },
    totalToolCalls: toolCalls.length,
    successfulCalls: toolCalls.filter(tc => tc.success).length,
    failedCalls: toolCalls.filter(tc => !tc.success).length,
    toolUsage,
    issues,
    recommendations
  };
}

function printReport(report: AnalysisReport): void {
  console.log("\n" + "=".repeat(60));
  console.log("MCP LOG ANALYSIS REPORT");
  console.log("=".repeat(60));

  console.log(`\nTime Range: ${report.timeRange.start.toISOString()} - ${report.timeRange.end.toISOString()}`);
  console.log(`\nTotal Tool Calls: ${report.totalToolCalls}`);
  console.log(`  Successful: ${report.successfulCalls}`);
  console.log(`  Failed: ${report.failedCalls}`);

  if (Object.keys(report.toolUsage).length > 0) {
    console.log("\n--- Tool Usage ---");
    Object.entries(report.toolUsage).forEach(([tool, stats]) => {
      const successRate = stats.calls > 0 ? ((stats.calls - stats.failures) / stats.calls * 100).toFixed(1) : 0;
      console.log(`  ${tool}: ${stats.calls} calls (${successRate}% success)`);
      if (stats.errors.length > 0) {
        console.log(`    Recent errors: ${stats.errors.slice(0, 2).join(", ")}`);
      }
    });
  }

  if (report.issues.length > 0) {
    console.log("\n--- Issues Detected ---");
    report.issues.forEach(issue => {
      const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
      console.log(`\n${icon} [${issue.category}] ${issue.description}`);
      console.log(`   Occurrences: ${issue.occurrences}`);
      if (issue.examples.length > 0) {
        console.log(`   Examples: ${issue.examples[0].substring(0, 100)}...`);
      }
    });
  } else {
    console.log("\n✅ No issues detected!");
  }

  if (report.recommendations.length > 0) {
    console.log("\n--- Recommendations ---");
    report.recommendations
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      })
      .forEach((rec, i) => {
        const icon = rec.priority === "high" ? "🔴" : rec.priority === "medium" ? "🟡" : "🟢";
        console.log(`\n${i + 1}. ${icon} [${rec.area}] ${rec.suggestion}`);
        console.log(`   Rationale: ${rec.rationale}`);
      });
  } else {
    console.log("\n✅ No recommendations - MCP server appears to be working well!");
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Report generated at: ${new Date().toISOString()}`);
  console.log("=".repeat(60) + "\n");
}

function runAnalysis(): void {
  console.log("Analyzing MCP logs...");

  const dxrEntries = parseLogFile(MCP_LOG_PATH);
  const generalEntries = parseLogFile(MCP_GENERAL_LOG);
  const allEntries = [...dxrEntries, ...generalEntries].sort((a, b) =>
    a.timestamp.getTime() - b.timestamp.getTime()
  );

  const toolCalls = extractToolCalls(allEntries);
  const report = generateReport(allEntries, toolCalls);

  printReport(report);
}

// Main execution
const args = process.argv.slice(2);

if (args.includes("--watch")) {
  console.log("Starting MCP log analyzer in watch mode...");
  console.log("Will analyze logs every hour. Press Ctrl+C to stop.\n");

  // Run immediately
  runAnalysis();

  // Then run every hour
  setInterval(runAnalysis, 60 * 60 * 1000);

  // Also watch for file changes
  if (existsSync(MCP_LOG_PATH)) {
    watchFile(MCP_LOG_PATH, { interval: 30000 }, () => {
      console.log("\n[Log file changed - running analysis...]\n");
      runAnalysis();
    });
  }
} else {
  runAnalysis();
}

/**
 * Markdown Reporter
 *
 * Generates Markdown benchmark reports.
 */

import type {
  ComparisonReport,
  TaskComparison,
  CategorySummary,
  TaskCategory,
} from '../types.js';

/**
 * Generate a complete Markdown benchmark report
 */
export function generateMarkdownReport(report: ComparisonReport): string {
  const lines: string[] = [];

  // Header
  lines.push('# DXR MCP Server Benchmark Results');
  lines.push('');
  lines.push(`**Generated:** ${new Date(report.metadata.generatedAt).toLocaleString()}`);
  lines.push(`**Model:** ${report.metadata.modelVersion}`);
  lines.push(`**Mode:** ${report.metadata.mode}`);
  lines.push(`**Benchmark Version:** ${report.metadata.benchmarkVersion}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | DXR Agent | Baseline | Delta |');
  lines.push('|--------|-----------|----------|-------|');

  const avgDxrPrecision = calculateAverage(report.taskResults.map(t => t.dxrResult.precision));
  const avgBaselinePrecision = calculateAverage(report.taskResults.map(t => t.baselineResult.precision));
  const avgDxrRecall = calculateAverage(report.taskResults.map(t => t.dxrResult.recall));
  const avgBaselineRecall = calculateAverage(report.taskResults.map(t => t.baselineResult.recall));
  const avgDxrF1 = calculateAverage(report.taskResults.map(t => t.dxrResult.f1Score));
  const avgBaselineF1 = calculateAverage(report.taskResults.map(t => t.baselineResult.f1Score));
  const avgDxrTime = calculateAverage(report.taskResults.map(t => t.dxrResult.timeToAnswerMs));
  const avgBaselineTime = calculateAverage(report.taskResults.map(t => t.baselineResult.timeToAnswerMs));

  lines.push(`| Avg Precision | ${formatPercent(avgDxrPrecision)} | ${formatPercent(avgBaselinePrecision)} | ${formatDelta(report.metrics.avgPrecisionDelta)} |`);
  lines.push(`| Avg Recall | ${formatPercent(avgDxrRecall)} | ${formatPercent(avgBaselineRecall)} | ${formatDelta(report.metrics.avgRecallDelta)} |`);
  lines.push(`| Avg F1 | ${formatPercent(avgDxrF1)} | ${formatPercent(avgBaselineF1)} | ${formatDelta(report.metrics.avgF1Delta)} |`);
  lines.push(`| Avg Time | ${formatTime(avgDxrTime)} | ${formatTime(avgBaselineTime)} | ${formatTimeDelta(report.metrics.avgTimeDeltaMs)} |`);
  lines.push(`| Tasks Won | ${report.summary.dxrWins} | ${report.summary.baselineWins} | - |`);
  lines.push('');

  // Win/Loss Summary
  lines.push('### Overall Results');
  lines.push('');
  lines.push(`- **DXR Wins:** ${report.summary.dxrWins} (${formatPercent(report.summary.dxrWins / report.summary.totalTasks)})`);
  lines.push(`- **Baseline Wins:** ${report.summary.baselineWins} (${formatPercent(report.summary.baselineWins / report.summary.totalTasks)})`);
  lines.push(`- **Ties:** ${report.summary.ties}`);
  lines.push(`- **Total Tasks:** ${report.summary.totalTasks}`);
  lines.push('');

  // Results by Category
  lines.push('## Results by Category');
  lines.push('');

  for (const category of ['compliance', 'search', 'governance'] as TaskCategory[]) {
    const summary = report.byCategory[category];
    if (summary && summary.totalTasks > 0) {
      lines.push(`### ${capitalizeFirst(category)} Tasks (${summary.totalTasks})`);
      lines.push('');
      lines.push('| Metric | DXR | Baseline |');
      lines.push('|--------|-----|----------|');
      lines.push(`| Avg Precision | ${formatPercent(summary.dxr.avgPrecision)} | ${formatPercent(summary.baseline.avgPrecision)} |`);
      lines.push(`| Avg Recall | ${formatPercent(summary.dxr.avgRecall)} | ${formatPercent(summary.baseline.avgRecall)} |`);
      lines.push(`| Avg F1 | ${formatPercent(summary.dxr.avgF1)} | ${formatPercent(summary.baseline.avgF1)} |`);
      lines.push(`| Tasks Completed | ${summary.dxr.tasksCompleted}/${summary.totalTasks} | ${summary.baseline.tasksCompleted}/${summary.totalTasks} |`);
      lines.push(`| Compliance Rate | ${formatPercent(summary.dxr.complianceRate)} | ${formatPercent(summary.baseline.complianceRate)} |`);
      lines.push(`| Wins | ${summary.dxrWins} | ${summary.baselineWins} |`);
      lines.push('');
    }
  }

  // Individual Task Results
  lines.push('## Individual Task Results');
  lines.push('');

  for (const task of report.taskResults) {
    lines.push(`### ${task.taskName}`);
    lines.push(`*ID: ${task.taskId} | Category: ${task.category}*`);
    lines.push('');
    lines.push(`**Winner:** ${task.winner === 'tie' ? 'Tie' : task.winner.toUpperCase()}`);
    lines.push('');
    lines.push('| Metric | DXR | Baseline | Delta |');
    lines.push('|--------|-----|----------|-------|');
    lines.push(`| Completed | ${task.dxrResult.taskCompleted ? '✅' : '❌'} | ${task.baselineResult.taskCompleted ? '✅' : '❌'} | - |`);
    lines.push(`| Precision | ${formatPercent(task.dxrResult.precision)} | ${formatPercent(task.baselineResult.precision)} | ${formatDelta(task.precisionDelta)} |`);
    lines.push(`| Recall | ${formatPercent(task.dxrResult.recall)} | ${formatPercent(task.baselineResult.recall)} | ${formatDelta(task.recallDelta)} |`);
    lines.push(`| F1 | ${formatPercent(task.dxrResult.f1Score)} | ${formatPercent(task.baselineResult.f1Score)} | ${formatDelta(task.f1Delta)} |`);
    lines.push(`| Time | ${formatTime(task.dxrResult.timeToAnswerMs)} | ${formatTime(task.baselineResult.timeToAnswerMs)} | ${formatTimeDelta(task.timeDeltaMs)} |`);
    lines.push(`| Compliance | ${task.dxrResult.compliancePassed ? '✅' : '❌'} | ${task.baselineResult.compliancePassed ? '✅' : '❌'} | - |`);
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*Generated by DXR Benchmark Framework*');

  return lines.join('\n');
}

// Helper functions

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimeDelta(ms: number): string {
  const sign = ms >= 0 ? '-' : '+';
  const absMs = Math.abs(ms);
  if (absMs < 1000) return `${sign}${absMs.toFixed(0)}ms`;
  return `${sign}${(absMs / 1000).toFixed(2)}s`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * JSON Reporter
 *
 * Outputs benchmark results as JSON for programmatic analysis.
 */

import { writeFileSync } from 'fs';
import type { ComparisonReport, TaskResult } from '../types.js';

/**
 * Save comparison report to JSON file
 */
export function saveReportToJson(
  report: ComparisonReport,
  outputPath: string
): void {
  const json = JSON.stringify(report, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Generate JSON string from report
 */
export function reportToJson(report: ComparisonReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Save individual task results to JSON
 */
export function saveTaskResultsToJson(
  results: TaskResult[],
  outputPath: string
): void {
  const json = JSON.stringify(results, null, 2);
  writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Load report from JSON file
 */
export function loadReportFromJson(inputPath: string): ComparisonReport {
  const { readFileSync } = require('fs');
  const content = readFileSync(inputPath, 'utf-8');
  return JSON.parse(content) as ComparisonReport;
}

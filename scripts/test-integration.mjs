#!/usr/bin/env node

/**
 * Integration test for DXR MCP Server
 * Simulates exact MCP tool calls to verify API integration
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

// Load environment from Claude Desktop config
const configPath = process.env.HOME + '/Library/Application Support/Claude/claude_desktop_config.json';
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const dxrConfig = config.mcpServers.dxr;

console.log('=== DXR MCP Server Integration Test ===\n');
console.log('Environment:');
console.log('  DXR_API_URL:', dxrConfig.env.DXR_API_URL);
console.log('  DXR_SKIP_SSL_VERIFY:', dxrConfig.env.DXR_SKIP_SSL_VERIFY);
console.log('  NODE_TLS_REJECT_UNAUTHORIZED:', dxrConfig.env.NODE_TLS_REJECT_UNAUTHORIZED);
console.log('  Token:', dxrConfig.env.DXR_API_TOKEN ? '[SET]' : '[NOT SET]', '\n');

// Test cases that mimic real MCP tool calls
const testCases = [
  {
    name: 'list_file_metadata with query',
    request: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_file_metadata',
        arguments: {
          q: 'fileName:"*roadmap*"',
          limit: 50
        }
      }
    }
  },
  {
    name: 'list_file_metadata without query',
    request: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'list_file_metadata',
        arguments: {
          limit: 10
        }
      }
    }
  },
  {
    name: 'get_classifications',
    request: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_classifications',
        arguments: {}
      }
    }
  }
];

async function runTest(testCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Test: ${testCase.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log('Request:', JSON.stringify(testCase.request, null, 2));

  return new Promise((resolve) => {
    const mcp = spawn(dxrConfig.command, dxrConfig.args, {
      env: {
        ...process.env,
        ...dxrConfig.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let responseReceived = false;

    mcp.stdout.on('data', (data) => {
      stdout += data.toString();
      const lines = stdout.split('\n');

      for (const line of lines) {
        if (line.trim() && line.includes('"jsonrpc"')) {
          try {
            const response = JSON.parse(line);
            if (response.id === testCase.request.id && !responseReceived) {
              responseReceived = true;
              console.log('\nResponse:', JSON.stringify(response, null, 2));

              // Check for errors
              if (response.result?.isError || response.error) {
                console.log('\n❌ FAILED');
                if (response.result?.content?.[0]?.text) {
                  const errorData = JSON.parse(response.result.content[0].text);
                  console.log('Error:', errorData.error);
                }
              } else {
                console.log('\n✅ PASSED');
              }

              setTimeout(() => {
                mcp.kill();
                resolve();
              }, 100);
            }
          } catch (e) {
            // Not JSON, ignore
          }
        }
      }
    });

    mcp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    mcp.on('close', () => {
      if (stderr) {
        console.log('\nStderr output:');
        console.log(stderr);
      }
      if (!responseReceived) {
        console.log('\n❌ FAILED - No response received');
        resolve();
      }
    });

    // Initialize MCP server
    const initRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    };

    mcp.stdin.write(JSON.stringify(initRequest) + '\n');

    // Wait for initialization
    setTimeout(() => {
      // Send initialized notification
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      // Send test request
      setTimeout(() => {
        mcp.stdin.write(JSON.stringify(testCase.request) + '\n');
      }, 100);
    }, 500);

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!responseReceived) {
        console.log('\n❌ TIMEOUT');
        mcp.kill();
        resolve();
      }
    }, 10000);
  });
}

async function main() {
  for (const testCase of testCases) {
    await runTest(testCase);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Integration tests completed');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);

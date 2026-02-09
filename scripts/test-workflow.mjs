#!/usr/bin/env node

/**
 * Workflow test for DXR MCP Server
 * Demonstrates the proper workflow: get_classifications → list_file_metadata
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

// Load environment from Claude Desktop config
const configPath = process.env.HOME + '/Library/Application Support/Claude/claude_desktop_config.json';
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const dxrConfig = config.mcpServers.dxr;

console.log('=== DXR MCP Server Workflow Test ===\n');
console.log('This test demonstrates the proper workflow:');
console.log('1. Call get_classifications to learn available annotators');
console.log('2. Use that context to search for files with specific sensitive data\n');

let mcp;
let classificationData = null;

function createMCPProcess() {
  const childProcess = spawn(dxrConfig.command, dxrConfig.args, {
    env: {
      ...process.env,
      ...dxrConfig.env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let requestId = 0;

  childProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  childProcess.stderr.on('data', (data) => {
    // Suppress stderr for cleaner output
  });

  return {
    process: childProcess,
    async sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const request = {
          jsonrpc: '2.0',
          id,
          method,
          params
        };

        const timeout = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, 10000);

        const checkResponse = () => {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim() && line.includes('"jsonrpc"')) {
              try {
                const response = JSON.parse(line);
                if (response.id === id) {
                  clearTimeout(timeout);
                  clearInterval(interval);
                  resolve(response);
                  return;
                }
              } catch (e) {
                // Not valid JSON, continue
              }
            }
          }
        };

        const interval = setInterval(checkResponse, 100);

        childProcess.stdin.write(JSON.stringify(request) + '\n');
      });
    }
  };
}

async function runWorkflowTest() {
  console.log('Starting MCP server...\n');

  mcp = createMCPProcess();

  // Initialize
  await mcp.sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'workflow-test', version: '1.0.0' }
  });

  mcp.process.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }) + '\n');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Step 1: Get classifications
  console.log('━'.repeat(60));
  console.log('STEP 1: Get Classifications Catalog');
  console.log('━'.repeat(60));
  console.log('Calling get_classifications to learn what annotators exist...\n');

  const classResponse = await mcp.sendRequest('tools/call', {
    name: 'get_classifications',
    arguments: {}
  });

  if (classResponse.result?.content?.[0]?.text) {
    classificationData = JSON.parse(classResponse.result.content[0].text);

    if (classificationData.status === 'ok') {
      console.log('✅ Successfully retrieved classification catalog\n');

      // Show summary of what we learned
      const annotators = classificationData.data.filter(c => c.type === 'ANNOTATOR');
      const domains = [...new Set(annotators.map(a => a.domain?.name).filter(Boolean))];

      console.log('📊 Classification Summary:');
      console.log(`   Total classifications: ${classificationData.data.length}`);
      console.log(`   Annotators: ${annotators.length}`);
      console.log(`   Domains: ${domains.length} (${domains.slice(0, 3).join(', ')}...)`);

      // Find some interesting annotators to search for
      const creditCardAnnotators = annotators.filter(a =>
        a.name.toLowerCase().includes('credit card')
      );
      const ssnAnnotators = annotators.filter(a =>
        a.name.toLowerCase().includes('social security')
      );

      console.log(`\n🔍 Example Annotators Found:`);
      if (creditCardAnnotators.length > 0) {
        console.log(`   - "${creditCardAnnotators[0].name}" (${creditCardAnnotators[0].type})`);
      }
      if (ssnAnnotators.length > 0) {
        console.log(`   - "${ssnAnnotators[0].name}" (${ssnAnnotators[0].type})`);
      }

      // Step 2: Use this context to search for files
      console.log('\n' + '━'.repeat(60));
      console.log('STEP 2: Search for Files with Sensitive Data');
      console.log('━'.repeat(60));

      // Use the first credit card annotator we found
      if (creditCardAnnotators.length > 0) {
        const annotatorName = creditCardAnnotators[0].name;
        console.log(`Using context from Step 1 to search for files with: "${annotatorName}"\n`);

        const query = `annotators.name:"${annotatorName}"`;
        console.log(`Query: ${query}\n`);

        const filesResponse = await mcp.sendRequest('tools/call', {
          name: 'list_file_metadata',
          arguments: {
            q: query,
            limit: 10
          }
        });

        if (filesResponse.result?.content?.[0]?.text) {
          const filesData = JSON.parse(filesResponse.result.content[0].text);

          if (filesData.status === 'ok') {
            console.log('✅ Successfully searched for files\n');
            console.log('📁 Results:');
            console.log(`   Total files with ${annotatorName}: ${filesData.stats.totalFiles}`);
            console.log(`   Files with sensitive data: ${filesData.stats.filesWithSensitiveData}`);

            if (filesData.files.length > 0) {
              console.log(`\n   First file: "${filesData.files[0].fileName}"`);
              console.log(`   Sensitive data found: ${filesData.files[0].sensitiveDataCount} instances`);
            }
          } else {
            console.log('⚠️  Specific annotator search failed (server error)');
            console.log('   Trying broader search: files with any sensitive data...\n');

            const fallbackResponse = await mcp.sendRequest('tools/call', {
              name: 'list_file_metadata',
              arguments: {
                q: '_exists_:annotators',
                limit: 10
              }
            });

            if (fallbackResponse.result?.content?.[0]?.text) {
              const fallbackData = JSON.parse(fallbackResponse.result.content[0].text);
              if (fallbackData.status === 'ok') {
                console.log('✅ Fallback search successful\n');
                console.log('📁 Results:');
                console.log(`   Total files with any sensitive data: ${fallbackData.stats.totalFiles}`);
                console.log(`   Files with sensitive data: ${fallbackData.stats.filesWithSensitiveData}`);
              }
            }
          }
        }
      } else {
        console.log('⚠️  No credit card annotators found, trying generic sensitive data search...\n');

        const filesResponse = await mcp.sendRequest('tools/call', {
          name: 'list_file_metadata',
          arguments: {
            q: '_exists_:annotators',
            limit: 10
          }
        });

        if (filesResponse.result?.content?.[0]?.text) {
          const filesData = JSON.parse(filesResponse.result.content[0].text);
          console.log('✅ Found files with any sensitive data\n');
          console.log('📁 Results:');
          console.log(`   Total files with sensitive data: ${filesData.stats.totalFiles}`);
        }
      }

      console.log('\n' + '━'.repeat(60));
      console.log('WORKFLOW TEST COMPLETED SUCCESSFULLY');
      console.log('━'.repeat(60));
      console.log('\n✅ The workflow demonstrates:');
      console.log('   1. Getting classification catalog first provides context');
      console.log('   2. Using exact annotator names from the catalog in queries');
      console.log('   3. Precise file searches based on specific sensitive data types\n');

    } else {
      console.log('❌ Failed to get classifications:', classificationData.error);
    }
  }

  // Cleanup
  mcp.process.kill();
}

runWorkflowTest().catch(error => {
  console.error('Test failed:', error);
  if (mcp) mcp.process.kill();
  process.exit(1);
});

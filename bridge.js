#!/usr/bin/env node

/**
 * MCP Universal Runtime Bridge
 * Converts any stdio MCP server to HTTP/SSE endpoints
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MCPBridge {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.isInitialized = false;
    this.mcpCapabilities = null;
    
    // Configuration from environment
    this.port = process.env.PORT || 8080;
    this.mcpEntryPoint = process.env.MCP_ENTRY_POINT || 'server.js';
    this.userCodePath = process.env.USER_CODE_PATH || '/app/user-code';
    
    console.log(`Bridge starting on port ${this.port}`);
    console.log(`MCP entry point: ${this.mcpEntryPoint}`);
    console.log(`User code path: ${this.userCodePath}`);
  }

  /**
   * Start the stdio MCP server process
   */
  async startMCPProcess() {
    const mcpPath = path.join(this.userCodePath, this.mcpEntryPoint);
    
    if (!fs.existsSync(mcpPath)) {
      // Enhanced debugging: list what files actually exist
      console.error(`MCP entry point not found: ${mcpPath}`);
      console.error(`User code path: ${this.userCodePath}`);
      console.error(`Entry point: ${this.mcpEntryPoint}`);
      
      try {
        const files = fs.readdirSync(this.userCodePath);
        console.error(`Files in ${this.userCodePath}:`, files);
      } catch (err) {
        console.error(`Could not read directory ${this.userCodePath}:`, err.message);
      }
      
      throw new Error(`MCP entry point not found: ${mcpPath}. Check the files listed above.`);
    }

    console.log(`Starting MCP process: ${mcpPath}`);
    
    this.mcpProcess = spawn('node', [mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.userCodePath,
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.mcpProcess.on('error', (error) => {
      console.error('MCP Process error:', error);
    });

    this.mcpProcess.on('exit', (code, signal) => {
      console.log(`MCP Process exited with code ${code}, signal ${signal}`);
      this.mcpProcess = null;
      this.isInitialized = false;
    });

    // Handle MCP responses
    let buffer = '';
    this.mcpProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            this.handleMCPResponse(response);
          } catch (error) {
            console.error('Failed to parse MCP response:', line, error);
          }
        }
      }
    });

    this.mcpProcess.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    // Initialize the MCP server
    await this.initializeMCP();
  }

  /**
   * Initialize MCP server with handshake
   */
  async initializeMCP() {
    const initRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true
          },
          sampling: {}
        },
        clientInfo: {
          name: 'mcp-universal-runtime',
          version: '1.0.0'
        }
      }
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(initRequest.id, { resolve, reject });
      this.sendToMCP(initRequest);
      
      // Timeout initialization
      setTimeout(() => {
        if (this.pendingRequests.has(initRequest.id)) {
          this.pendingRequests.delete(initRequest.id);
          reject(new Error('MCP initialization timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Send JSON-RPC request to MCP process
   */
  sendToMCP(request) {
    if (!this.mcpProcess || !this.mcpProcess.stdin.writable) {
      throw new Error('MCP process not available');
    }
    
    const message = JSON.stringify(request) + '\n';
    this.mcpProcess.stdin.write(message);
  }

  /**
   * Handle responses from MCP process
   */
  handleMCPResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);
      
      if (response.error) {
        reject(new Error(response.error.message || 'MCP Error'));
      } else {
        // Handle initialization response
        if (response.result && response.result.capabilities) {
          this.mcpCapabilities = response.result;
          this.isInitialized = true;
          console.log('MCP initialized:', response.result.serverInfo);
        }
        resolve(response.result);
      }
    }
  }

  /**
   * Proxy HTTP request to MCP stdio
   */
  async proxyToMCP(method, params = {}) {
    if (!this.isInitialized) {
      throw new Error('MCP server not initialized');
    }

    const request = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.sendToMCP(request);
      
      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error('MCP request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Start HTTP server
   */
  async startHTTPServer() {
    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        await this.handleHTTPRequest(req, res);
      } catch (error) {
        console.error('HTTP request error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: { code: -32603, message: error.message }
        }));
      }
    });

    server.listen(this.port, '0.0.0.0', () => {
      console.log(`MCP Universal Runtime listening on port ${this.port}`);
    });
  }

  /**
   * Handle individual HTTP requests
   */
  async handleHTTPRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = url.pathname;

    // Handle path prefix stripping (for Traefik routing)
    const pathParts = path.split('/').filter(p => p);
    if (pathParts.length >= 2) {
      const lastPart = pathParts[pathParts.length - 1];
      if (['health', 'mcp', 'sse', 'capabilities'].includes(lastPart)) {
        path = '/' + lastPart;
      }
    }

    switch (path) {
      case '/health':
        await this.handleHealth(req, res);
        break;
      
      case '/mcp':
        await this.handleMCP(req, res);
        break;
        
      case '/sse':
        await this.handleSSE(req, res);
        break;
        
      case '/capabilities':
        await this.handleCapabilities(req, res);
        break;
        
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }

  /**
   * Health check endpoint
   */
  async handleHealth(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'mcp-universal-runtime',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      mcp_initialized: this.isInitialized,
      mcp_server: this.mcpCapabilities?.serverInfo || null
    }));
  }

  /**
   * MCP JSON-RPC endpoint
   */
  async handleMCP(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        const result = await this.proxyToMCP(request.method, request.params);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: error.message }
        }));
      }
    });
  }

  /**
   * Server-Sent Events endpoint
   */
  async handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    // Send initial capabilities
    if (this.isInitialized && this.mcpCapabilities) {
      res.write(`data: ${JSON.stringify({ 
        type: 'capabilities', 
        data: this.mcpCapabilities 
      })}\n\n`);
    }
    
    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write('data: {"type":"ping"}\n\n');
    }, 30000);
    
    req.on('close', () => {
      clearInterval(keepAlive);
    });
  }

  /**
   * Capabilities endpoint
   */
  async handleCapabilities(req, res) {
    if (!this.isInitialized) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MCP server not initialized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.mcpCapabilities));
  }

  /**
   * Start the bridge
   */
  async start() {
    try {
      await this.startMCPProcess();
      await this.startHTTPServer();
      console.log('MCP Universal Runtime bridge started successfully');
    } catch (error) {
      console.error('Failed to start bridge:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('Shutting down MCP Universal Runtime...');
    
    if (this.mcpProcess) {
      this.mcpProcess.kill('SIGTERM');
      
      // Wait for graceful exit or force kill
      setTimeout(() => {
        if (this.mcpProcess) {
          this.mcpProcess.kill('SIGKILL');
        }
      }, 5000);
    }
    
    process.exit(0);
  }
}

// Handle shutdown signals
const bridge = new MCPBridge();

process.on('SIGTERM', () => bridge.shutdown());
process.on('SIGINT', () => bridge.shutdown());

// Start the bridge
if (import.meta.url === `file://${process.argv[1]}`) {
  bridge.start().catch(console.error);
}

export default MCPBridge;
# MCP Universal Runtime

Universal Docker runtime for deploying any stdio-based MCP server as an HTTP service.

## Features

- ✅ **Universal Compatibility**: Deploy any stdio MCP server without modification
- ✅ **HTTP/JSON-RPC**: Provides RESTful MCP endpoint at `/mcp`  
- ✅ **Server-Sent Events**: Real-time streaming at `/sse`
- ✅ **Health Checks**: Built-in monitoring at `/health`
- ✅ **Capabilities**: MCP server info at `/capabilities`
- ✅ **Production Ready**: Proper error handling, timeouts, CORS

## Endpoints

- `GET /health` - Health check and status
- `POST /mcp` - MCP JSON-RPC requests 
- `GET /sse` - Server-Sent Events stream
- `GET /capabilities` - MCP server capabilities

## Environment Variables

- `PORT` - HTTP server port (default: 8080)
- `MCP_ENTRY_POINT` - Entry point file (default: server.js)
- `USER_CODE_PATH` - Path to user MCP code (default: /app/user-code)

## Usage

### Local Development
```bash
# Build the image
docker build -t mcp-universal-runtime .

# Run with user code mounted
docker run -v /path/to/mcp/server:/app/user-code \
  -p 8080:8080 \
  -e MCP_ENTRY_POINT=server.js \
  mcp-universal-runtime
```

### Production Deployment
```bash
# Copy user code into container
FROM mcp-universal-runtime:latest
COPY ./my-mcp-server /app/user-code
ENV MCP_ENTRY_POINT=index.js
```

## How It Works

1. **Code Injection**: User MCP server code is mounted/copied to `/app/user-code`
2. **Process Spawning**: Bridge spawns user's MCP server as child process
3. **Protocol Bridge**: Converts stdio JSON-RPC ↔ HTTP JSON-RPC
4. **Standardization**: All deployed MCPs expose same HTTP interface

## Architecture

```
User Request (HTTP) → Bridge → MCP Process (stdio) → Response
```

## Compatible MCP Servers

Any MCP server that:
- Uses stdio transport
- Implements MCP 2024-11-05 protocol
- Is a Node.js application
- Has a main entry point file

## Examples

See the `/examples` directory for sample MCP servers that work with this runtime.
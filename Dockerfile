FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash

# Copy package.json and install dependencies
COPY package.json .
RUN npm install

# Copy runtime files
COPY bridge-compliant.js ./bridge.js
COPY health.js .

# Create user code directory
RUN mkdir -p /app/user-code

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV MCP_ENTRY_POINT=server.js
ENV USER_CODE_PATH=/app/user-code

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Default command
CMD ["node", "bridge.js"]

# Labels
LABEL org.opencontainers.image.title="MCP Universal Runtime"
LABEL org.opencontainers.image.description="Universal runtime for deploying any MCP server as HTTP service"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="MCP Platform"
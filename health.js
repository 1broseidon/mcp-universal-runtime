#!/usr/bin/env node

/**
 * Standalone health check utility
 * Can be used independently of the bridge for container health checks
 */

import http from 'http';

const port = process.env.PORT || 8080;
const healthEndpoint = `http://localhost:${port}/health`;

function checkHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(healthEndpoint, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          
          if (res.statusCode === 200 && health.status === 'healthy') {
            console.log('✅ Health check passed:', health);
            resolve(health);
          } else {
            console.error('❌ Health check failed:', res.statusCode, health);
            reject(new Error(`Health check failed: ${res.statusCode}`));
          }
        } catch (error) {
          console.error('❌ Health check parse error:', error);
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Health check connection error:', error);
      reject(error);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });
  });
}

// Run health check if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkHealth()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default checkHealth;
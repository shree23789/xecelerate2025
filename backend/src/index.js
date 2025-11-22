// index.js (modified)
// Agriverse360 backend entrypoint with WS + MQTT bridge integration

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const mockMLService = require('./mockMLService');
const { connectDB, disconnectDB } = require('./config/database');
const mongoose = require('mongoose'); // used in health check

// --- New additions for WS + MQTT bridge ---
const http = require('http');
const startWs = require('./wsServer');         // should export a function that returns { wss, broadcast }
const { start: startMqttBridge } = require('./mqttBridge'); // should export start(...)
                                                            // ------------------------------------------------

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5003;

// ML Service management
let mlServiceProcess = null;
const ML_SERVICE_PATH = path.join(__dirname, '../../ml_service/app.py');
const ML_SERVICE_PORT = 5004;

// MQTT bridge instance (bridge object returned by startMqttBridge)
let mqttBridgeInstance = null;

// last known telemetry (stringified envelope or object) - sent to new WS clients
let lastTelemetry = null;

// Function to start ML service (unchanged from your code)
function startMLService() {
  console.log('🚀 Starting ML Service...');

  // Immediate fallback: Start mock service after a short delay
  setTimeout(() => {
    if (!mlServiceProcess) {
      console.log('🔄 No ML service running, starting mock service as fallback...');
      startMockMLService();
    }
  }, 2000);

  // Check if Python is available
  const pythonCheck = spawn('python3', ['--version']);
  pythonCheck.on('close', (code) => {
    console.log(`🐍 Python check result: code=${code}`);
    const pythonCmd = code === 0 ? 'python3' : 'python';

    // First check if required packages are available
    const packageCheck = spawn(pythonCmd, ['-c', 'import flask, tensorflow, PIL, numpy, cv2; print("All packages available")'], {
      cwd: path.dirname(ML_SERVICE_PATH)
    });

    packageCheck.on('close', (packageCode) => {
      console.log(`📦 Package check result: code=${packageCode}`);
      if (packageCode !== 0) {
        console.log('⚠️  ML Service dependencies not installed. Starting mock ML service...');
        console.log('💡 To enable full ML functionality:');
        console.log('   cd ml_service && pip install -r requirements.txt');
        console.log('   Then restart the backend');

        // Start mock ML service
        console.log('🔄 Calling startMockMLService()...');
        startMockMLService();
        return;
      }

      mlServiceProcess = spawn(pythonCmd, [ML_SERVICE_PATH], {
        cwd: path.dirname(ML_SERVICE_PATH),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      mlServiceProcess.stdout.on('data', (data) => {
        console.log(`📊 ML Service: ${data.toString().trim()}`);
      });

      mlServiceProcess.stderr.on('data', (data) => {
        console.error(`❌ ML Service Error: ${data.toString().trim()}`);
      });

      mlServiceProcess.on('close', (code) => {
        console.log(`🔴 ML Service exited with code ${code}`);
        mlServiceProcess = null;
      });

      // Wait a bit for service to start, then check health
      setTimeout(checkMLServiceHealth, 3000);
    });

    packageCheck.on('error', (error) => {
      console.log('⚠️  Cannot check ML service dependencies. Running in limited mode...');
      console.log('🔄 Error details:', error.message);
      console.log('🔄 Falling back to mock service...');
      startMockMLService();
    });
  });

  pythonCheck.on('error', (error) => {
    console.log('⚠️  Python not found. Starting mock ML service...');
    console.log('💡 To enable full functionality: Install Python 3.7+');
    console.log('🔄 Python error details:', error.message);

    // Start mock ML service when Python is not available
    startMockMLService();
  });
}

// Function to check ML service health
async function checkMLServiceHealth() {
  try {
    const response = await axios.get(`http://localhost:${ML_SERVICE_PORT}/health`, { timeout: 5000 });
    console.log('✅ ML Service Health Check:', response.data.status);
    return true;
  } catch (error) {
    if (mlServiceProcess) {
      console.log('⚠️  ML Service health check failed, but service may still be starting...');
    } else {
      console.log('ℹ️  ML Service not running (dependencies not installed). Using mock responses.');
    }
    return false;
  }
}

// Function to start mock ML service
function startMockMLService() {
  console.log('🤖 Starting Mock ML Service on port', ML_SERVICE_PORT);

  try {
    const mockServer = mockMLService.listen(ML_SERVICE_PORT, (err) => {
      if (err) {
        console.error('❌ Error starting mock ML service:', err);
        return;
      }

      console.log('✅ Mock ML Service running on port', ML_SERVICE_PORT);
      console.log('📊 Mock endpoints available:');
      console.log('   POST /predict_disease - Mock disease detection');
      console.log('   POST /predict_nutrients - Mock nutrient analysis');
      console.log('   GET /health - Health check');
      console.log('   GET /status - Service status');

      // Check health after startup
      setTimeout(checkMLServiceHealth, 500);
    });

    mockServer.on('error', (err) => {
      console.error('❌ Mock ML Service startup error:', err);
    });

    // Store reference for cleanup
    mlServiceProcess = { kill: () => mockServer.close() };

  } catch (error) {
    console.error('❌ Failed to start mock ML service:', error);
  }
}

// Function to stop ML service
function stopMLService() {
  if (mlServiceProcess) {
    console.log('🛑 Stopping ML Service...');
    try {
      // if spawned process
      if (typeof mlServiceProcess.kill === 'function') mlServiceProcess.kill('SIGTERM');
      // if mock server object with close
      if (mlServiceProcess.close) mlServiceProcess.close();
    } catch (err) {
      console.warn('⚠️ Error stopping ML service:', err);
    }
    mlServiceProcess = null;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    service: 'Agriverse360 Backend',
    status: 'healthy',
    port: PORT,
    timestamp: new Date().toISOString(),
    services: {
      backend: 'running',
      ml_service: 'checking...'
    }
  };

  // Check ML service health
  try {
    const mlResponse = await axios.get(`http://localhost:${ML_SERVICE_PORT}/health`, { timeout: 3000 });
    health.services.ml_service = 'running';
    health.services.disease_detection = mlResponse.data.services?.disease_detection ?? 'unknown';
    health.services.nutrient_analysis = mlResponse.data.services?.nutrient_analysis ?? 'unknown';
    health.services.plant_info_ml = mlResponse.data.services?.plant_info ?? 'unknown';
  } catch (error) {
    health.services.ml_service = 'not responding';
    health.services.disease_detection = 'unknown';
    health.services.nutrient_analysis = 'unknown';
    health.services.plant_info_ml = 'unknown';
  }

  // Check Database connection
  try {
    health.services.database = mongoose.connection && mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  } catch (error) {
    health.services.database = 'error';
  }

  // Check Plant Info API (OpenAI/ChatGPT)
  try {
    health.services.plant_info_api = process.env.OPENAI_API_KEY ? 'configured' : 'not configured';
  } catch (error) {
    health.services.plant_info_api = 'error';
  }

  res.json(health);
});

// Status endpoint with detailed information
app.get('/status', async (req, res) => {
  const status = {
    backend: {
      service: 'Agriverse360 Backend API',
      status: 'running',
      port: PORT,
      endpoints: [
        'GET /health',
        'GET /status',
        'POST /api/upload',
        'POST /api/plant/search',
        'POST /api/plant/identify',
        'POST /api/plant/info'
      ]
    },
    ml_service: {
      service: 'ML Service (Python/Flask)',
      port: ML_SERVICE_PORT,
      status: 'checking...'
    },
    plant_info_service: {
      service: 'Plant Info Service (OpenAI)',
      status: process.env.OPENAI_API_KEY ? 'configured' : 'not configured'
    }
  };

  // Check ML service status
  try {
    const mlResponse = await axios.get(`http://localhost:${ML_SERVICE_PORT}/status`, { timeout: 3000 });
    status.ml_service = { ...status.ml_service, ...mlResponse.data };
    status.ml_service.status = 'running';
  } catch (error) {
    status.ml_service.status = 'not responding';
    status.ml_service.error = error.message;
  }

  res.json(status);
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Agriverse360 API',
    version: '1.0.0',
    services: [
      'Disease Detection (ML)',
      'Nutrient Analysis (ML)',
      'Plant Information (AI)',
      'Image Upload & Processing'
    ],
    endpoints: {
      health: 'GET /health',
      status: 'GET /status',
      docs: 'See /status for detailed API information'
    }
  });
});

const uploadRoutes = require('./routes/upload');
const plantRoutes = require('./routes/plant');
app.use('/api', uploadRoutes);
app.use('/api/plant', plantRoutes);

// --- New: build HTTP server and attach WS + MQTT bridge (keeps same PORT) ---
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // create http server from express app so we can attach ws
    const server = http.createServer(app);

    // start websocket server attached to the same http server
    // startWs should return { wss, broadcast }
    const { wss, broadcast } = startWs(server, { path: '/ws' });

    // when a ws client connects, send lastTelemetry immediately (if present)
    if (wss && wss.on) {
      wss.on('connection', (socket, req) => {
        try {
          const addr = req.socket ? req.socket.remoteAddress : 'unknown';
          console.log('[ws] client connected', addr);
          if (lastTelemetry) {
            // send lastTelemetry as an envelope
            socket.send(typeof lastTelemetry === 'string' ? lastTelemetry : JSON.stringify(lastTelemetry));
          }
          socket.on('close', () => {
            console.log('[ws] client disconnected', addr);
          });
        } catch (err) {
          console.warn('[ws] connection handler error', err && err.message);
        }
      });
    }

    // start mqtt bridge - it will subscribe to esp32/telemetry and broadcast envelopes to ws via broadcast()
    const MQTT_URL = process.env.MQTT_URL || 'mqtt://10.1.1.113:1883';
    const MQTT_USER = process.env.MQTT_USER || 'esp32com';
    const MQTT_PASS = process.env.MQTT_PASS || 'esp32aug';

    try {
      // startMqttBridge is expected to return an object with .stop() and .client references
      mqttBridgeInstance = startMqttBridge({
        mqttUrl: MQTT_URL,
        mqttUser: MQTT_USER,
        mqttPass: MQTT_PASS,
        topics: ['esp32/telemetry'],
        wsBroadcast: (msgStr) => {
          // store last telemetry and broadcast to ws clients
          try {
            lastTelemetry = typeof msgStr === 'string' ? msgStr : JSON.stringify(msgStr);
            broadcast(msgStr);
          } catch (err) {
            console.error('[mqttBridge->ws] broadcast error', err && err.message);
          }
        }
      });

      console.log('🔌 MQTT bridge created');
    } catch (err) {
      console.error('❌ Failed to create MQTT bridge:', err && err.message);
      mqttBridgeInstance = null;
    }

    // Start the HTTP+WS server on the same PORT (unchanged)
    server.listen(PORT, () => {
      console.log(`🌱 Agriverse360 Backend Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📋 Status page: http://localhost:${PORT}/status`);
      console.log('');

      // Start ML service
      console.log('🚀 Initializing ML service...');
      startMLService();

      // Fallback: If ML service doesn't start within 10 seconds, force start mock service
      setTimeout(() => {
        if (!mlServiceProcess) {
          console.log('⚠️  ML service failed to start, forcing mock service...');
          startMockMLService();
        }
      }, 10000);

      // Periodic health checks for ML service
      setInterval(async () => {
        try {
          await axios.get(`http://localhost:${ML_SERVICE_PORT}/health`, { timeout: 2000 });
          // ML service healthy
        } catch (error) {
          console.log('⚠️  ML Service health check failed - service may be restarting...');
        }
      }, 30000); // Check every 30 seconds
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error && error.message);
    process.exit(1);
  }
};

// Start server
startServer();

// Graceful shutdown
async function gracefulShutdown(codeSignal) {
  console.log(`\n🛑 Received ${codeSignal}, shutting down gracefully...`);
  stopMLService();

  try {
    if (mqttBridgeInstance && typeof mqttBridgeInstance.stop === 'function') {
      console.log('🔌 Stopping MQTT bridge...');
      mqttBridgeInstance.stop();
    } else if (mqttBridgeInstance && mqttBridgeInstance.client && typeof mqttBridgeInstance.client.end === 'function') {
      console.log('🔌 Closing MQTT client...');
      mqttBridgeInstance.client.end(true);
    }
  } catch (err) {
    console.warn('⚠️ Error closing mqtt bridge/client:', err && err.message);
  }

  try {
    await disconnectDB();
  } catch (err) {
    console.warn('⚠️ Error disconnecting DB:', err && err.message);
  }

  // allow short delay for clean close
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// export app and mqtt client getter for other modules if needed
module.exports = {
  app,
  mqttClient: () => {
    try {
      if (!mqttBridgeInstance) return null;
      return mqttBridgeInstance.client || null;
    } catch (err) {
      return null;
    }
  }
};

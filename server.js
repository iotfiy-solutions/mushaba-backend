const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const chatRoutes = require('./routes/chat');
const messageRoutes = require('./routes/message');
const uploadRoutes = require('./routes/upload');
const path = require('path');
const bodyParser = require('body-parser');
const locationRoutes = require('./routes/locationRoutes');
const pinLocationRoutes = require('./routes/pinLocationRoutes');
const { router: sttRouter } = require('./services/STT');
const { router: translateRouter } = require('./services/Translate');
const { router: ttsRouter } = require('./services/TTS');
const { router: pipelineRouter } = require('./services/Pipeline');
const { router: geminiRouter } = require('./services/Gemini');
const webSocketService = require('./services/websocketService');
const cleanupService = require('./services/cleanupService');
const { router: speechRouter } = require('./services/Speech');
const { protect: auth } = require('./middleware/auth');

dotenv.config();
const app = express();
const server = http.createServer(app);

// Initialize WebSocket service
webSocketService.initialize(server);

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));

// Connect DB
connectDB();

// Make WebSocket service available to routes
app.set('io', webSocketService.io);

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/connections", require("./routes/connectionRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/pin-locations', pinLocationRoutes);
app.use('/api/mesh', require('./routes/meshRoutes'));
app.use('/api/stt', sttRouter);
app.use('/api/translate', translateRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/gemini', geminiRouter);
app.use('/api/speech', speechRouter);
// New marked locations routes
app.use('/api/user-marked-locations', require('./routes/userMarkedLocationsRoutes'));
app.use('/api/connection-marked-locations', require('./routes/connectionMarkedLocationsRoutes'));
// QR Users routes - inline to avoid import issues
app.get('/api/qr-users', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.getQRUsers(req, res);
});
app.get('/api/qr-users/current-user-data', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.getCurrentUserData(req, res);
});
app.post('/api/qr-users', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.createQRUser(req, res);
});
app.put('/api/qr-users/:qrUserId', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.updateQRUser(req, res);
});
app.delete('/api/qr-users/:qrUserId', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.deleteQRUser(req, res);
});
app.put('/api/qr-users/current-user/update', auth, (req, res) => {
  const qrUsersController = require('./controllers/qrUsersControllerSimple');
  qrUsersController.updateCurrentUserQR(req, res);
});

// Start memory cleanup service
const startMemoryCleanup = () => {
  setInterval(() => {
    const locationController = require('./controllers/locationController');
    if (locationController.cleanupStaleMemoryLocations) {
      locationController.cleanupStaleMemoryLocations();
    }
  }, 15000); // Check every 15 seconds for more responsive cleanup
  console.log('[MEMORY_CLEANUP] Started memory cleanup service (15s interval)');
};

// Start background cleanup service for expired pin locations
cleanupService.start();
console.log('[CLEANUP_SERVICE] Started background cleanup service');

startMemoryCleanup();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

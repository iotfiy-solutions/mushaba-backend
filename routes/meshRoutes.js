const express = require('express');
const router = express.Router();
const meshController = require('../controllers/meshController');
const { protect } = require('../middleware/auth');

// Apply auth middleware to all mesh routes
router.use(protect);

// POST /api/mesh/relay-offline-user
// Online user relays offline user's data to backend
router.post('/relay-offline-user', meshController.relayOfflineUserData);

// POST /api/mesh/offline-user-response
// Store response data received from mesh network for offline user
router.post('/offline-user-response', meshController.handleOfflineUserResponse);

// GET /api/mesh/locations
// Get all mesh network locations (for debugging/admin purposes)
router.get('/locations', meshController.getMeshLocations);

module.exports = router; 
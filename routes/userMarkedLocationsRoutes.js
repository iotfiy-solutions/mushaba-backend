const express = require('express');
const router = express.Router();
const {
  getUserMarkedLocations,
  createPersonalLocation,
  updatePersonalLocation,
  deletePersonalLocation,
  clearAllPersonalLocations
} = require('../controllers/userMarkedLocationsController');
const { protect: auth } = require('../middleware/auth');

// GET /api/user/marked-locations - Get user's current marked locations
router.get('/', auth, getUserMarkedLocations);

// POST /api/user/marked-locations - Create personal marked location
router.post('/', auth, createPersonalLocation);

// PUT /api/user/marked-locations/:locationId - Update personal marked location
router.put('/:locationId', auth, updatePersonalLocation);

// DELETE /api/user/marked-locations/:locationId - Delete personal marked location
router.delete('/:locationId', auth, deletePersonalLocation);

// DELETE /api/user-marked-locations - Clear all personal marked locations
router.delete('/', auth, clearAllPersonalLocations);

module.exports = router;

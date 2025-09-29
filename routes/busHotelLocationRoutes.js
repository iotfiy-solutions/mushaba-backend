const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getLocations,
  getPersonalLocations,
  markLocation,
  markPersonalLocation,
  removeLocation,
  removePersonalLocation,
  updateLocation,
  updatePersonalLocation
} = require('../controllers/busHotelLocationController');

// @route   GET /api/bus-hotel-locations/personal
// @desc    Get personal locations for the current user
// @access  Private
router.get('/personal', protect, getPersonalLocations);

// @route   POST /api/bus-hotel-locations/personal/mark
// @desc    Mark a personal location (bus or hotel)
// @access  Private
router.post('/personal/mark', protect, markPersonalLocation);

// @route   PUT /api/bus-hotel-locations/personal/update
// @desc    Update a personal location (bus or hotel)
// @access  Private
router.put('/personal/update', protect, updatePersonalLocation);

// @route   POST /api/bus-hotel-locations/personal/remove
// @desc    Remove a personal location (bus or hotel)
// @access  Private
router.post('/personal/remove', protect, removePersonalLocation);

// @route   GET /api/bus-hotel-locations/:connectionId
// @desc    Get all locations for a user in a connection
// @access  Private
router.get('/:connectionId', protect, getLocations);

// @route   POST /api/bus-hotel-locations/:connectionId/mark
// @desc    Mark a location (bus or hotel)
// @access  Private
router.post('/:connectionId/mark', protect, markLocation);

// @route   POST /api/bus-hotel-locations/:connectionId/remove
// @desc    Remove a location (bus or hotel)
// @access  Private
router.post('/:connectionId/remove', protect, removeLocation);

// @route   PUT /api/bus-hotel-locations/:connectionId/update
// @desc    Update a location (bus or hotel)
// @access  Private
router.put('/:connectionId/update', protect, updateLocation);

module.exports = router;

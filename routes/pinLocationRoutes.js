const express = require('express');
const router = express.Router();
const pinLocationController = require('../controllers/pinLocationController');
const { protect: auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for pin location image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/pin-locations/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'pin-location-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit (same as general upload)
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Create a new pin location
router.post('/', auth, upload.array('images', 2), pinLocationController.createPinLocation);

// Get all active pin locations for a connection
router.get('/connection/:connectionId', auth, pinLocationController.getPinLocations);

// Get a specific pin location
router.get('/:pinId', auth, pinLocationController.getPinLocation);

// Update a pin location (supports partial updates)
router.put('/:pinId', auth, (req, res, next) => {
  console.log('[PIN_ROUTE_DEBUG] PUT request received for pinId:', req.params.pinId);
  console.log('[PIN_ROUTE_DEBUG] Files in request:', req.files?.length || 0);
  console.log('[PIN_ROUTE_DEBUG] Multer limits:', upload.limits);
  next();
}, upload.array('images', 2), pinLocationController.updatePinLocation);

// Delete a pin location
router.delete('/:pinId', auth, pinLocationController.deletePinLocation);

// Get user's active pin locations
router.get('/user/me', auth, pinLocationController.getUserPinLocations);

// Get pin location statistics for a connection
router.get('/stats/:connectionId', auth, pinLocationController.getPinLocationStats);

// Cleanup expired pin locations (admin/maintenance)
router.delete('/cleanup/expired', auth, pinLocationController.cleanupExpiredPins);

module.exports = router;

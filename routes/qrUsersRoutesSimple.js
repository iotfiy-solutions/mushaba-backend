const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const qrUsersController = require('../controllers/qrUsersControllerSimple');

// Get all QR users for current user
router.get('/', auth, qrUsersController.getQRUsers);

// Get current user's data for QR creation
router.get('/current-user-data', auth, qrUsersController.getCurrentUserData);

// Create new QR user
router.post('/', auth, qrUsersController.createQRUser);

// Update QR user
router.put('/:qrUserId', auth, qrUsersController.updateQRUser);

// Delete QR user
router.delete('/:qrUserId', auth, qrUsersController.deleteQRUser);

// Update current user's QR data
router.put('/current-user/update', auth, qrUsersController.updateCurrentUserQR);

module.exports = router;







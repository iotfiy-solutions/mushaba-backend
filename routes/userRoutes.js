const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const userController = require('../controllers/userController');

// Get all users
router.get('/', protect, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ name: 1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// Get user by ID
router.get('/:userId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

// Update user profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, username, oldPassword, newPassword, image } = req.body;
    const userId = req.user.id;

    // Find user with password field explicitly selected
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If updating password
    if (oldPassword && newPassword) {
      // Verify old password
      const isMatch = await user.comparePassword(oldPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Set new password and mark it as modified
      user.password = newPassword;
      user.markModified('password');
    }

    // Update other fields
    if (name) {
      if (!name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Name cannot be empty'
        });
      }
      user.name = name.trim();
    }

    if (username) {
      if (!username.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Username cannot be empty'
        });
      }

      // Check if username is already taken by another user
      const existingUser = await User.findOne({
        username: username.trim(),
        _id: { $ne: userId }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }

      user.username = username.trim();
    }

    if (image) {
      user.image = image;
    }

    // Save updated user
    await user.save();

    // Return updated user without password
    const updatedUser = await User.findById(userId).select('-password');
    res.json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
});

// Update user status
router.put('/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { status },
      { new: true }
    ).select('-password');

    // Emit socket event for status update
    const io = req.app.get('io');
    io.emit('userStatus', {
      userId: user._id,
      status
    });

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating status'
    });
  }
});

// Delete user account (POST, allows body)
router.post('/delete-account', protect, userController.deleteUser);

// Check and fix user status for socket connection
router.get('/check-status', protect, userController.checkUserStatus);

module.exports = router; 
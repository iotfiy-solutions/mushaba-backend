const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Get all chats for current user
router.get('/', chatController.getChats);

// Check for existing chat
router.post('/check', chatController.checkExistingChat);

// Create a new chat
router.post('/', chatController.createChat);

// Get chat messages
router.get('/:chatId/messages', chatController.getMessages);

// Get last image message for chat
router.get('/:chatId/last-image', chatController.getLastImageMessage);

// Get last video message for chat
router.get('/:chatId/last-video', chatController.getLastVideoMessage);

// Get last voice message for chat
router.get('/:chatId/last-voice', chatController.getLastVoiceMessage);

// Debug: Get all voice messages for chat
router.get('/:chatId/all-voices', chatController.getAllVoiceMessagesForChat);

// Send a message
router.post('/:chatId/messages', chatController.sendMessage);

// Mark messages as read
router.post('/:chatId/read', chatController.markAsRead);

module.exports = router; 
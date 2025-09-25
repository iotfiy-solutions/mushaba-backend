const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      // Sender is required for all message types except system messages
      return this.type !== 'system';
    }
  },
  type: {
    type: String,
    enum: ['text', 'voice', 'image', 'video', 'location', 'customLocation', 'system'],
    required: true
  },
  content: {
    // Text messages
    text: String,
    
    // Voice messages
    data: Buffer, // For voice messages
    mimeType: String,
    duration: Number, // For voice messages
    
    // Image messages
    url: String, // For other media types
    name: String,
    
    // Location messages
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    
    // Location with image
    image: {
      data: Buffer, // Base64 image data
      mimeType: String,
      width: Number,
      height: Number
    },
    
    // Custom location messages
    icon: String,
    comment: String,
    images: [String], // Array of image URLs
    pinLocationId: mongoose.Schema.Types.ObjectId,
    
    // System messages
    systemAction: String, // 'user_joined', 'user_left', etc.
    systemData: mongoose.Schema.Types.Mixed // Additional data for system messages
  },
  metadata: {
    duration: Number,
    size: Number,
    mimeType: String,
    thumbnail: String,
    caption: String
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ 'readBy.userId': 1 });

const Message = mongoose.model('Message', messageSchema);

module.exports = Message; 
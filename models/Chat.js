const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['private', 'group', 'personal'],
    default: 'private'
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'member', 'admin'],
      default: 'member'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'left'],
      default: 'active'
    },
    joinTimestamp: {
      type: Date,
      default: Date.now
    }
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    name: String, // For group chats
    description: String, // For group chats
    avatar: String, // For group chats
    connectionId: String, // Link chat to connection
    isPersonal: Boolean // For personal chats
  }
}, {
  timestamps: true
});

// Create indexes
chatSchema.index({ 'participants.userId': 1 });
chatSchema.index({ type: 1 });
chatSchema.index({ lastActivity: -1 });

// Ensure at least 2 participants for private chats, exactly 1 for personal chats
chatSchema.pre('save', function(next) {
  if (this.type === 'private' && this.participants.length !== 2) {
    next(new Error('Private chats must have exactly 2 participants'));
  }
  if (this.type === 'personal' && this.participants.length !== 1) {
    next(new Error('Personal chats must have exactly 1 participant'));
  }
  next();
});

// Update lastActivity when modified
chatSchema.pre('findOneAndUpdate', function() {
  this.set({ lastActivity: new Date() });
});

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat; 
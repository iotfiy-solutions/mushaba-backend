const mongoose = require('mongoose');

const QRUsersSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  roomNo: {
    type: String,
    required: true,
    trim: true
  },
  hotelAddress: {
    type: String,
    required: true,
    trim: true
  },
  hotelCoordinates: {
    latitude: {
      type: Number,
      required: true
    },
    longitude: {
      type: Number,
      required: true
    }
  },
  busAddress: {
    type: String,
    required: true,
    trim: true
  },
  busCoordinates: {
    latitude: {
      type: Number,
      required: true
    },
    longitude: {
      type: Number,
      required: true
    }
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  qrCode: {
    type: String,
    required: true
  },
  isCurrentUser: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient querying by userId
QRUsersSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('QRUsers', QRUsersSchema);







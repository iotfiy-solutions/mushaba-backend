require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mapnavigator');
    console.log('Connected to MongoDB');

    const userIds = [
      '683092104ad68af55bed6dcc',
      '68308e6b4ad68af55bed6d7c'
    ];

    console.log('Checking users with IDs:', userIds);

    const users = await User.find({
      _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) }
    });

    console.log('Found users:', users.map(user => ({
      _id: user._id.toString(),
      name: user.name,
      username: user.username
    })));

    if (users.length !== 2) {
      console.log('Warning: Not all users found!');
      console.log('Expected 2 users, found:', users.length);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUsers(); 
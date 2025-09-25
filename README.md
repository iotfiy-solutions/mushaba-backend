# MapNavigator Backend Server

This is the backend server for the MapNavigator application, built with Node.js, Express, and MongoDB. It provides APIs for user management, location tracking, chat functionality, and group management.

## Features

### Authentication & User Management
- User registration and login
- JWT-based authentication
- Password hashing with bcrypt
- User profile management
- Connection management between users

### Location Services
- Real-time location tracking
- Location history storage
- Location sharing between users
- Geofencing capabilities

### Chat System
- Individual and group chat support
- Real-time messaging using Socket.IO
- Media message support (images, location)
- Message history and persistence
- Read receipts

### Group Management
- Group creation and management
- Member management (add/remove)
- Group chat functionality
- Group location sharing

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

## Installation

1. Navigate to the server directory:
```bash
cd server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the server directory with the following variables:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/mapnavigator
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Project Structure

```
server/
├── config/         # Configuration files
├── controllers/    # Route controllers
├── middleware/     # Custom middleware
├── models/         # Database models
├── routes/         # API routes
├── services/       # Business logic
├── utils/         # Utility functions
└── server.js      # Entry point
```

## API Endpoints

### Authentication
- POST /api/auth/register - Register new user
- POST /api/auth/login - User login
- GET /api/auth/me - Get current user
- PUT /api/auth/update - Update user profile

### Users
- GET /api/users - Get all users
- GET /api/users/:id - Get user by ID
- POST /api/users/connect - Create connection
- GET /api/users/connections - Get user connections

### Location
- POST /api/location/update - Update user location
- GET /api/location/:userId - Get user location
- GET /api/location/history/:userId - Get location history

### Chat
- POST /api/chats - Create new chat
- GET /api/chats - Get user chats
- POST /api/chats/:chatId/messages - Send message
- GET /api/chats/:chatId/messages - Get chat messages

### Groups
- POST /api/groups - Create new group
- GET /api/groups - Get user groups
- PUT /api/groups/:id - Update group
- POST /api/groups/:id/members - Add group member

## Environment Variables

Create a `.env` file in the server directory with the following variables:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/mapnavigator
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

## Dependencies

- Express.js - Web framework
- MongoDB - Database
- Mongoose - ODM for MongoDB
- Socket.IO - Real-time communication
- JWT - Authentication
- Bcrypt - Password hashing
- Multer - File uploads
- Winston - Logging

## Error Handling

The server implements a centralized error handling system with:
- Custom error classes
- Error logging
- Standardized error responses
- Development/Production error details

## Security Features

- JWT authentication
- Password hashing
- Request rate limiting
- CORS configuration
- Input validation
- XSS protection
- Helmet security headers

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
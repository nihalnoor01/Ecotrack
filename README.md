# Smart Waste Management System (EcoTrack)

A professional-grade IoT solution for real-time waste monitoring and route optimization.

## Features
- **Real-time Monitoring**: Visualize bin fill levels across the campus.
- **Backend Persistence**: Secure data storage using SQLite.
- **Reward System**: Gamified disposal logic and claim management.
- **Route Optimization**: Map-based visualization for efficient waste collection.
- **Responsive Dashboard**: Premium UI built with Vanilla JS and CSS.

## Project Structure
- `server.js`: Node.js/Express backend with SQLite for data persistence.
- `index.html` / `app.js` / `style.css`: The web dashboard.
- `login.html`: Secure access to the dashboard.
- `.env.example`: Template for environment variables.

## Setup Instructions

### Backend (Server)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Set up environment variables:
   - Copy `.env.example` to `.env`.
   - Update the `PORT` if necessary.
3. Start the server:
   ```bash
   node server.js
   ```
4. The dashboard will be available at `https://eco-track-smartbin-system.onrender.com`.

## Hardware Note
The ESP32 firmware is not included in this repository to protect hardware credentials. Please refer to your local backup for the `.ino` file.

## License
MIT

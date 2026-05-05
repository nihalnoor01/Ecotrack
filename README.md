# Smart Waste Management System (EcoTrack)

A professional-grade IoT solution for real-time waste monitoring and route optimization.

## Features
- **Real-time Monitoring**: Visualize bin fill levels across the campus.
- **ESP32 Integration**: Live sensor data transmission using ultrasonic sensors.
- **Reward System**: Gamified disposal with QR code-based point claims.
- **Route Optimization**: Map-based visualization for efficient waste collection.
- **Responsive Dashboard**: Premium UI built with Vanilla JS and CSS.

## Project Structure
- `esp32_firmware.ino`: Firmware for the ESP32 hardware.
- `server.js`: Node.js/Express backend with SQLite for data persistence.
- `index.html` / `app.js` / `style.css`: The web dashboard.
- `login.html`: Secure access to the dashboard.

## Setup Instructions

### Hardware (ESP32)
1. Open `esp32_firmware.ino` in Arduino IDE.
2. Update the WiFi credentials (`ssid` and `password`).
3. Set the `serverIP` to your hosted backend URL.
4. Upload to your ESP32.

### Backend (Server)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. The dashboard will be available at `http://localhost:3000`.

## License
MIT

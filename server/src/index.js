import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import patientRoutes from './routes/patient.js';
import staffRoutes from './routes/staff.js';
import { attachIo, publicState } from './queue.js';

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/clinicq';
const isProd = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Behind Render/Railway/Hostinger's proxy, so rate limits see the real client IP.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // Google Sign-In loads its script, button and popup from accounts.google.com
        scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
        frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
        connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'wss:', 'ws:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      },
    },
    // Required for the Google Sign-In popup to talk back to this page.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Overall safety net against bots hammering the API.
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', patientRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production the same server also serves the built React app.
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('/{*splat}', (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => err && next());
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: isProd ? undefined : { origin: 'http://localhost:5173', credentials: true },
});
attachIo(io);
io.on('connection', async (socket) => {
  socket.emit('queue:update', await publicState());
});

// The day changes at midnight; push a fresh (empty) state to open screens.
let lastDate = null;
setInterval(async () => {
  const s = await publicState().catch(() => null);
  if (s && s.date !== lastDate) {
    if (lastDate) io.emit('queue:update', s);
    lastDate = s.date;
  }
}, 60 * 1000);

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`ClinicQ running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  });

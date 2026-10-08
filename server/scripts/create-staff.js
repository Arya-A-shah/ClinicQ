// Usage: npm run create-staff -- <username> <password> [doctor|reception]
// Creates a staff login, or resets the password if the username exists.
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Staff } from '../src/models.js';

const [username, password, role = 'reception'] = process.argv.slice(2);
if (!username || !password) {
  console.log('Usage: npm run create-staff -- <username> <password> [doctor|reception]');
  process.exit(1);
}
if (password.length < 8) {
  console.log('Use a password of at least 8 characters.');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/clinicq');
const passwordHash = await bcrypt.hash(password, 10);
await Staff.findOneAndUpdate(
  { username: username.toLowerCase() },
  { username: username.toLowerCase(), passwordHash, role },
  { upsert: true }
);
console.log(`Staff login ready: ${username.toLowerCase()} (${role})`);
await mongoose.disconnect();

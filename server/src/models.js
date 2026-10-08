import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// A patient who signed in with Google.
const userSchema = new Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    picture: String,
    phone: String, // remembered from their last booking, to prefill the form
  },
  { timestamps: true }
);

// Receptionist / doctor accounts (username + password).
const staffSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['doctor', 'reception'], default: 'reception' },
  },
  { timestamps: true }
);

// One token = one patient visit on one day.
// status flow: waiting -> called -> done
//                     \-> skipped (no-show, can be re-queued)
//                     \-> cancelled (patient cancelled)
export const ACTIVE_STATUSES = ['waiting', 'called'];

const tokenSchema = new Schema(
  {
    date: { type: String, required: true }, // 'YYYY-MM-DD' in clinic time zone
    number: { type: Number, required: true },
    patientName: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, trim: true, maxlength: 15 },
    source: { type: String, enum: ['online', 'walkin'], required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' }, // empty for walk-ins
    status: {
      type: String,
      enum: ['waiting', 'called', 'done', 'skipped', 'cancelled'],
      default: 'waiting',
    },
    calledAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);
// Token numbers are unique within a day.
tokenSchema.index({ date: 1, number: 1 }, { unique: true });
tokenSchema.index({ date: 1, status: 1, number: 1 });
tokenSchema.index({ user: 1, date: 1 });

// Atomic per-day counter, so two people booking at the same instant
// can never get the same token number.
const counterSchema = new Schema({
  date: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

// Single settings document the staff can change from the dashboard.
const settingsSchema = new Schema({
  key: { type: String, default: 'clinic', unique: true },
  bookingOpen: { type: Boolean, default: false },
  avgMinutesPerPatient: { type: Number, default: 4, min: 1, max: 60 },
  dailyLimit: { type: Number, default: 400, min: 1, max: 2000 },
  maxActivePerAccount: { type: Number, default: 2, min: 1, max: 5 },
});

export const User = model('User', userSchema);
export const Staff = model('Staff', staffSchema);
export const Token = model('Token', tokenSchema);
export const Counter = model('Counter', counterSchema);
export const Settings = model('Settings', settingsSchema);

export async function getSettings() {
  return Settings.findOneAndUpdate(
    { key: 'clinic' },
    { $setOnInsert: { key: 'clinic' } },
    { upsert: true, new: true }
  );
}

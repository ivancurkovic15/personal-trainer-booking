// Load environment variables first
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const moment = require('moment');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection using environment variable
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is not set');
  process.exit(1);
}

mongoose.connect(MONGODB_URI);

// User Schema
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' },
  phone: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Session Schema (Admin creates available sessions)
const SessionSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  time: { type: String, required: true },
  exerciseType: { type: String, enum: ['body-health', 'regular-training'], required: true },
  maxCapacity: { type: Number, min: 1, max: 4, required: true },
  currentBookings: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Booking Schema (Clients book sessions)
const BookingSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  groupSize: { type: Number, min: 1, max: 4, required: true },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Session = mongoose.model('Session', SessionSchema);
const Booking = mongoose.model('Booking', BookingSchema);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Simple session middleware (store user in memory for MVP)
let currentUser = null;

// Routes
// Login/Register page
app.get('/login', (req, res) => {
  res.render('login');
});

// Handle login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    
    if (user) {
      currentUser = user;
      if (user.role === 'admin') {
        res.redirect('/admin');
      } else {
        res.redirect('/');
      }
    } else {
      res.render('login', { error: 'Invalid email or password' });
    }
  } catch (error) {
    res.render('login', { error: 'Login error' });
  }
});

// Handle registration
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('login', { error: 'Email already exists' });
    }
    
    const user = new User({ name, email, password, phone, role: role || 'client' });
    await user.save();
    
    currentUser = user;
    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/');
    }
  } catch (error) {
    res.render('login', { error: 'Registration error' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  currentUser = null;
  res.redirect('/login');
});

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (!currentUser) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!currentUser || currentUser.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// Home page - Calendar booking for clients
app.get('/', requireAuth, async (req, res) => {
  if (currentUser.role === 'admin') {
    return res.redirect('/admin');
  }
  
  const sessions = await Session.find({ isActive: true }).populate('createdBy');
  const bookings = await Booking.find({ client: currentUser._id, status: 'confirmed' }).populate('session');
  
  res.render('index', { sessions, bookings, moment, user: currentUser });
});

// Admin Dashboard - Create sessions and view bookings
app.get('/admin', requireAdmin, async (req, res) => {
  const sessions = await Session.find({}).populate('createdBy').sort({ date: 1, time: 1 });
  const bookings = await Booking.find({ status: 'confirmed' }).populate(['session', 'client']).sort({ createdAt: -1 });
  
  // Statistics
  const totalSessions = sessions.length;
  const activeSessions = sessions.filter(s => s.isActive && moment(s.date).isAfter(moment())).length;
  const totalBookings = bookings.length;
  const totalClients = bookings.reduce((sum, b) => sum + b.groupSize, 0);
  
  res.render('admin', { 
    sessions,
    bookings,
    stats: {
      totalSessions,
      activeSessions, 
      totalBookings,
      totalClients
    },
    moment,
    user: currentUser
  });
});

// Trainer dashboard (old route for backward compatibility)
app.get('/trainer', requireAdmin, (req, res) => {
  res.redirect('/admin');
});

// API: Get available sessions for a specific date
app.get('/api/sessions/:date', async (req, res) => {
  const date = req.params.date;
  const sessions = await Session.find({
    date: {
      $gte: new Date(date),
      $lt: new Date(moment(date).add(1, 'day').toISOString())
    },
    isActive: true
  });
  
  // Get booking counts for each session
  const sessionsWithBookings = await Promise.all(
    sessions.map(async (session) => {
      const bookings = await Booking.find({ session: session._id, status: 'confirmed' });
      const currentBookings = bookings.reduce((sum, b) => sum + b.groupSize, 0);
      return {
        ...session.toObject(),
        currentBookings,
        spotsLeft: session.maxCapacity - currentBookings
      };
    })
  );
  
  res.json(sessionsWithBookings);
});

// API: Create new session (Admin only)
app.post('/api/session', requireAdmin, async (req, res) => {
  try {
    const { date, time, exerciseType, maxCapacity } = req.body;
    
    // Check if session already exists at this date/time
    const existingSession = await Session.findOne({ date: new Date(date), time });
    if (existingSession) {
      return res.status(400).json({ error: 'Session already exists at this date and time' });
    }
    
    const session = new Session({
      date: new Date(date),
      time,
      exerciseType,
      maxCapacity: parseInt(maxCapacity),
      createdBy: currentUser._id
    });
    
    await session.save();
    res.json({ success: true, session });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Create new booking (Clients)
app.post('/api/booking', requireAuth, async (req, res) => {
  try {
    const { sessionId, groupSize } = req.body;
    
    if (currentUser.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot book sessions' });
    }
    
    const session = await Session.findById(sessionId);
    if (!session || !session.isActive) {
      return res.status(400).json({ error: 'Session not available' });
    }
    
    // Check capacity
    const existingBookings = await Booking.find({ session: sessionId, status: 'confirmed' });
    const currentBookings = existingBookings.reduce((sum, b) => sum + b.groupSize, 0);
    
    if (currentBookings + parseInt(groupSize) > session.maxCapacity) {
      return res.status(400).json({ error: 'Not enough spots available' });
    }
    
    const booking = new Booking({
      session: sessionId,
      client: currentUser._id,
      groupSize: parseInt(groupSize)
    });
    
    await booking.save();
    res.json({ success: true, booking });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Delete session (Admin only)
app.delete('/api/session/:id', requireAdmin, async (req, res) => {
  try {
    // First delete all bookings for this session
    await Booking.deleteMany({ session: req.params.id });
    // Then delete the session
    await Session.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Delete booking
app.delete('/api/booking/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('session');
    
    // Check if user owns this booking or is admin
    if (currentUser.role !== 'admin' && booking.client.toString() !== currentUser._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Personal Trainer Booking System running on http://localhost:${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
});
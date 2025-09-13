// Load environment variables first
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const moment = require('moment');
const path = require('path');
const crypto = require('crypto');

// Import email service and reminder scheduler
const emailService = require('./emailService');
const reminderScheduler = require('./reminderScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection using environment variable
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is not set');
  process.exit(1);
}

mongoose.connect(MONGODB_URI);

// User Schema (updated with package tracking)
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' },
  phone: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  // Package tracking for 8-session packages
  activeSessions: { type: Number, default: 0 },
  packageExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Session Schema (updated with trainer reference to User)
const SessionSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  time: { type: String, required: true },
  exerciseType: { type: String, enum: ['body-health', 'regular-training'], required: true },
  maxCapacity: { type: Number, min: 1, max: 4, required: true },
  currentBookings: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Trainer is a reference to User with role 'admin' (trainer)
  trainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true }, // Price for single session
  packagePrice: { type: Number, required: true }, // Price for 8-session package
  packageDuration: { type: Number, default: 90 }, // Days to use 8 sessions (default 90 days)
  createdAt: { type: Date, default: Date.now }
});

// Booking Schema (updated with cancellation policy and package tracking)
const BookingSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  groupSize: { type: Number, min: 1, max: 4, required: true },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  notes: { type: String, default: '' },
  reminderSent: { type: Boolean, default: false },
  // New fields for cancellation policy
  canCancel: { type: Boolean, default: true },
  cancellationDeadline: { type: Date },
  // Package tracking
  isPackageBooking: { type: Boolean, default: false },
  packageId: { type: String }, // Reference to track 8-session packages
  sessionNumber: { type: Number }, // Which session in the package (1-8)
  createdAt: { type: Date, default: Date.now }
});

// Add pre-save middleware to calculate cancellation deadline
BookingSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      // Load the session to get the date and time
      const session = await mongoose.model('Session').findById(this.session);
      if (session) {
        // Parse the session date and time
        const sessionDate = new Date(session.date);
        const [hours, minutes] = session.time.split(':');
        sessionDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        // Calculate cancellation deadline (24 hours before session)
        const cancellationDeadline = new Date(sessionDate.getTime() - (24 * 60 * 60 * 1000));
        this.cancellationDeadline = cancellationDeadline;
        this.canCancel = new Date() < cancellationDeadline;
      }
    } catch (error) {
      console.error('Error calculating cancellation deadline:', error);
    }
  }
  next();
});

const User = mongoose.model('User', UserSchema);
const Session = mongoose.model('Session', SessionSchema);
const Booking = mongoose.model('Booking', BookingSchema);

// Initialize reminder scheduler
reminderScheduler.initializeScheduler(Session, Booking, User);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Simple session middleware (store user in memory for MVP)
let currentUser = null;

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

// TRAINER ROUTES (simplified - just get trainers from users)
// API: Get all trainers (users with role 'admin')
app.get('/api/trainers', requireAdmin, async (req, res) => {
  try {
    const trainers = await User.find({ role: 'admin' }, 'name email phone');
    res.json(trainers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CALENDAR API ROUTES (updated to include trainer info)
app.get('/api/calendar/:year/:month', requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1;
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    const sessions = await Session.find({
      date: {
        $gte: startDate,
        $lte: endDate
      },
      isActive: true
    }).populate(['createdBy', 'trainer']);
    
    const sessionsWithBookings = await Promise.all(
      sessions.map(async (session) => {
        const bookings = await Booking.find({ 
          session: session._id, 
          status: 'confirmed' 
        }).populate('client');
        
        return {
          ...session.toObject(),
          bookings: bookings
        };
      })
    );
    
    res.json(sessionsWithBookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get detailed sessions for a specific date (updated with trainer info)
app.get('/api/sessions/date/:date', requireAdmin, async (req, res) => {
  try {
    const date = new Date(req.params.date);
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    
    const sessions = await Session.find({
      date: {
        $gte: date,
        $lt: nextDay
      },
      isActive: true
    }).populate(['createdBy', 'trainer']).sort({ time: 1 });
    
    const sessionsWithDetails = await Promise.all(
      sessions.map(async (session) => {
        const bookings = await Booking.find({ 
          session: session._id, 
          status: 'confirmed' 
        }).populate('client', 'name email phone');
        
        const totalBooked = bookings.reduce((sum, booking) => sum + booking.groupSize, 0);
        
        return {
          ...session.toObject(),
          bookings: bookings,
          currentBookings: totalBooked,
          spotsLeft: session.maxCapacity - totalBooked
        };
      })
    );
    
    res.json(sessionsWithDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get session details with all bookings (updated with trainer info)
app.get('/api/session/:id/details', requireAdmin, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).populate(['createdBy', 'trainer']);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const bookings = await Booking.find({ 
      session: session._id, 
      status: 'confirmed' 
    }).populate('client', 'name email phone');
    
    const totalBooked = bookings.reduce((sum, booking) => sum + booking.groupSize, 0);
    
    res.json({
      ...session.toObject(),
      bookings: bookings,
      currentBookings: totalBooked,
      spotsLeft: session.maxCapacity - totalBooked
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PASSWORD RESET ROUTES
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password');
});

app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.render('forgot-password', { 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000;
    
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();
    
    const result = await emailService.sendPasswordReset(user, resetToken);
    
    if (result.success) {
      res.render('forgot-password', { 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    } else {
      res.render('forgot-password', { 
        error: 'Error sending reset email. Please try again.' 
      });
    }
  } catch (error) {
    res.render('forgot-password', { 
      error: 'Error processing request. Please try again.' 
    });
  }
});

app.get('/reset-password', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.render('reset-password', { error: 'Invalid or missing reset token.' });
    }
    
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.render('reset-password', { error: 'Password reset token is invalid or has expired.' });
    }
    
    res.render('reset-password', { token });
  } catch (error) {
    res.render('reset-password', { error: 'Error validating reset token.' });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
      return res.render('reset-password', { 
        token, 
        error: 'Passwords do not match.' 
      });
    }
    
    if (password.length < 6) {
      return res.render('reset-password', { 
        token, 
        error: 'Password must be at least 6 characters long.' 
      });
    }
    
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.render('reset-password', { 
        error: 'Password reset token is invalid or has expired.' 
      });
    }
    
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    res.render('reset-password', { 
      success: 'Password has been reset successfully. You can now log in with your new password.' 
    });
  } catch (error) {
    res.render('reset-password', { 
      token: req.body.token, 
      error: 'Error resetting password. Please try again.' 
    });
  }
});

// EMAIL FUNCTIONALITY ROUTES
app.post('/api/send-session-email', requireAdmin, async (req, res) => {
  try {
    const { sessionId, subject, message, recipients } = req.body;
    
    if (!sessionId || !subject || !message || !recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const recipientUsers = await User.find({ _id: { $in: recipients } });
    const results = await emailService.sendBulkCustomMessage(recipientUsers, subject, message);
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/send-custom-email', requireAdmin, async (req, res) => {
  try {
    const { recipients, subject, message } = req.body;
    
    if (!recipients || !subject || !message || recipients.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const recipientUsers = await User.find({ _id: { $in: recipients } });
    const results = await emailService.sendBulkCustomMessage(recipientUsers, subject, message);
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-reminders', requireAdmin, async (req, res) => {
  try {
    await reminderScheduler.sendRemindersNow();
    res.json({ success: true, message: 'Reminder check triggered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LOGIN/REGISTER ROUTES
app.get('/login', (req, res) => {
  res.render('login');
});

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

app.get('/logout', (req, res) => {
  currentUser = null;
  res.redirect('/login');
});

// HOME PAGE (updated to show trainer and pricing info)
app.get('/', requireAuth, async (req, res) => {
  try {
    if (currentUser.role === 'admin') {
      return res.redirect('/admin');
    }
    
    const sessions = await Session.find({ isActive: true }).populate(['createdBy', 'trainer']);
    const bookings = await Booking.find({ client: currentUser._id, status: 'confirmed' }).populate({
      path: 'session',
      populate: { path: 'trainer' }
    });
    
    res.render('index', { sessions, bookings, moment, user: currentUser });
  } catch (error) {
    console.error('Error loading home page:', error);
    res.render('login', { error: 'Error loading page' });
  }
});

// ADMIN DASHBOARD (updated to get trainers from users)
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const sessions = await Session.find({}).populate(['createdBy', 'trainer']).sort({ date: 1, time: 1 });
    const bookings = await Booking.find({ status: 'confirmed' }).populate([
      { path: 'session', populate: { path: 'trainer' } },
      'client'
    ]).sort({ createdAt: -1 });
    const trainers = await User.find({ role: 'admin' }, 'name email phone'); // Get users with admin role
    
    // Statistics
    const totalSessions = sessions.length;
    const activeSessions = sessions.filter(s => s.isActive && moment(s.date).isAfter(moment())).length;
    const totalBookings = bookings.length;
    const totalClients = bookings.reduce((sum, b) => sum + b.groupSize, 0);
    
    res.render('admin', { 
      sessions,
      bookings,
      trainers,
      stats: {
        totalSessions,
        activeSessions, 
        totalBookings,
        totalClients
      },
      moment,
      user: currentUser
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.render('login', { error: 'Error loading admin dashboard' });
  }
});

app.get('/trainer', requireAdmin, (req, res) => {
  res.redirect('/admin');
});

// API: Get available sessions for a specific date (FIXED - added trainer population)
app.get('/api/sessions/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const sessions = await Session.find({
      date: {
        $gte: new Date(date),
        $lt: new Date(moment(date).add(1, 'day').toISOString())
      },
      isActive: true
    }).populate('trainer'); // FIXED: Added trainer population
    
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Create new session (updated with trainer and pricing)
app.post('/api/session', requireAdmin, async (req, res) => {
  try {
    // Remove price, packagePrice, packageDuration from destructuring
    const { date, time, exerciseType, maxCapacity, trainerId, description } = req.body;
    
    // Update validation - remove price and packagePrice checks
    if (!date || !time || !exerciseType || !maxCapacity || !trainerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const existingSession = await Session.findOne({ date: new Date(date), time });
    if (existingSession) {
      return res.status(400).json({ error: 'Session already exists at this date and time' });
    }
    
    // Use fixed pricing
    const price = 50;
    const packagePrice = 200;
    const packageDuration = 90;
    
    const session = new Session({
      date: new Date(date),
      time,
      exerciseType,
      maxCapacity: parseInt(maxCapacity),
      trainer: trainerId,
      description: description || '',
      price: price,           // Fixed values
      packagePrice: packagePrice,
      packageDuration: packageDuration,
      createdBy: currentUser._id
    });
    
    await session.save();
    res.json({ success: true, session });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Create new booking (updated with cancellation deadline and package tracking)
app.post('/api/booking', requireAuth, async (req, res) => {
  try {
    const { sessionId, groupSize, isPackageBooking, packageId, sessionNumber } = req.body;
    
    if (currentUser.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot book sessions' });
    }
    
    const session = await Session.findById(sessionId).populate(['createdBy', 'trainer']);
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
      groupSize: parseInt(groupSize),
      isPackageBooking: isPackageBooking || false,
      packageId: packageId || null,
      sessionNumber: sessionNumber || null
    });
    
    await booking.save();
    
    // Update user's package tracking if this is a package booking
    if (isPackageBooking) {
      await User.findByIdAndUpdate(currentUser._id, {
        $inc: { activeSessions: 1 },
        $set: { packageExpiry: moment().add(session.packageDuration, 'days').toDate() }
      });
    }
    
    // Send confirmation emails
    try {
      const emailResult = await emailService.sendBookingConfirmation(
        booking, 
        session, 
        currentUser, 
        session.createdBy
      );
      console.log('Booking confirmation emails sent:', emailResult);
    } catch (emailError) {
      console.error('Error sending confirmation emails:', emailError);
    }
    
    res.json({ success: true, booking });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Delete session (updated with trainer info)
app.delete('/api/session/:id', requireAdmin, async (req, res) => {
  try {
    const bookings = await Booking.find({ session: req.params.id, status: 'confirmed' })
      .populate([
        { path: 'session', populate: { path: 'trainer' } },
        'client'
      ]);
    
    for (const booking of bookings) {
      try {
        await emailService.sendCancellationNotification(
          booking, 
          booking.session, 
          booking.client
        );
      } catch (emailError) {
        console.error('Error sending cancellation email:', emailError);
      }
    }
    
    await Booking.deleteMany({ session: req.params.id });
    await Session.findByIdAndDelete(req.params.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Delete booking (updated with 24-hour cancellation policy)
app.delete('/api/booking/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate([
      { path: 'session', populate: { path: 'trainer' } },
      'client'
    ]);
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    if (currentUser.role !== 'admin' && booking.client._id.toString() !== currentUser._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Check 24-hour cancellation policy for non-admin users
    if (currentUser.role !== 'admin') {
      const now = new Date();
      const cancellationDeadline = new Date(booking.cancellationDeadline);
      
      if (now > cancellationDeadline) {
        return res.status(400).json({ 
          error: 'Cannot cancel booking within 24 hours of the session time' 
        });
      }
    }
    
    // Update user's package tracking if this was a package booking
    if (booking.isPackageBooking) {
      await User.findByIdAndUpdate(booking.client._id, {
        $inc: { activeSessions: -1 }
      });
    }
    
    // Send cancellation email
    try {
      await emailService.sendCancellationNotification(
        booking, 
        booking.session, 
        booking.client
      );
    } catch (emailError) {
      console.error('Error sending cancellation email:', emailError);
    }
    
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Update booking notes
app.put('/api/booking/:id/notes', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { notes: notes || '' },
      { new: true }
    ).populate('client', 'name email phone');
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json({ success: true, booking });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Personal Trainer Booking System running on http://localhost:${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log('Email service initialized');
  console.log('Reminder scheduler running - will send 2-hour reminders automatically');
});

// Add these routes to your server.js file

// API: Get all clients
app.get('/api/clients', requireAdmin, async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' }, 'name email phone activeSessions packageExpiry createdAt');
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Add 8-session package to client
app.post('/api/client/:id/add-package', requireAdmin, async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await User.findById(clientId);
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Add 8 sessions and set expiry to 90 days from now
    const updatedClient = await User.findByIdAndUpdate(clientId, {
      $inc: { activeSessions: 8 },
      $set: { packageExpiry: moment().add(90, 'days').toDate() }
    }, { new: true });

    res.json({ success: true, client: updatedClient });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: Reset client package
app.post('/api/client/:id/reset-package', requireAdmin, async (req, res) => {
  try {
    const clientId = req.params.id;
    const updatedClient = await User.findByIdAndUpdate(clientId, {
      $set: { 
        activeSessions: 0,
        packageExpiry: null 
      }
    }, { new: true });

    if (!updatedClient) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ success: true, client: updatedClient });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


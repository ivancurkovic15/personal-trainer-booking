// reminderScheduler.js
const cron = require('node-cron');
const mongoose = require('mongoose');
const emailService = require('./emailService');
const moment = require('moment');

// Import models (assuming they're available globally or you'll need to pass them in)
let Session, Booking, User;

function initializeScheduler(sessionModel, bookingModel, userModel) {
  Session = sessionModel;
  Booking = bookingModel;
  User = userModel;

  // Schedule reminder emails to run every 15 minutes
  // This checks for sessions starting in 2 hours
  cron.schedule('*/15 * * * *', async () => {
    console.log('Running reminder email check...');
    await sendSessionReminders();
  });

  console.log('Reminder scheduler initialized - checking every 15 minutes');
}

async function sendSessionReminders() {
  try {
    // Calculate the time 2 hours from now
    const twoHoursFromNow = moment().add(2, 'hours');
    const startWindow = twoHoursFromNow.clone().subtract(7, 'minutes'); // 7-minute window to catch sessions
    const endWindow = twoHoursFromNow.clone().add(8, 'minutes');

    console.log(`Checking for sessions between ${startWindow.format()} and ${endWindow.format()}`);

    // Find sessions starting in approximately 2 hours
    const upcomingSessions = await Session.find({
      date: {
        $gte: startWindow.startOf('day').toDate(),
        $lte: endWindow.endOf('day').toDate()
      },
      isActive: true
    });

    for (const session of upcomingSessions) {
      // Create session datetime
      const [hours, minutes] = session.time.split(':');
      const sessionDateTime = moment(session.date)
        .hours(parseInt(hours))
        .minutes(parseInt(minutes))
        .seconds(0);

      // Check if this session is in our 2-hour window
      if (sessionDateTime.isBetween(startWindow, endWindow)) {
        console.log(`Found session at ${sessionDateTime.format()} - sending reminders`);

        // Find all confirmed bookings for this session
        const bookings = await Booking.find({
          session: session._id,
          status: 'confirmed'
        }).populate('client');

        // Send reminder to each client
        for (const booking of bookings) {
          // Check if we've already sent a reminder for this booking
          // You might want to add a 'reminderSent' field to the booking schema to track this
          try {
            const result = await emailService.sendSessionReminder(booking, session, booking.client);
            console.log(`Reminder sent to ${booking.client.email}:`, result);

            // Optional: Mark that reminder was sent to avoid duplicates
            // booking.reminderSent = true;
            // await booking.save();
          } catch (error) {
            console.error(`Failed to send reminder to ${booking.client.email}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in sendSessionReminders:', error);
  }
}

// Manual function to send reminders (for testing)
async function sendRemindersNow() {
  console.log('Manually triggering reminder check...');
  await sendSessionReminders();
}

module.exports = {
  initializeScheduler,
  sendRemindersNow
};
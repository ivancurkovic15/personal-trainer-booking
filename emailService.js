const nodemailer = require('nodemailer');
const moment = require('moment');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify(function (error, success) {
  if (error) {
    console.log('Email service error:', error);
  } else {
    console.log('Email service ready');
  }
});

const emailTemplates = {
  bookingConfirmation: (booking, session, client) => ({
    subject: 'Booking Confirmation - Your Training Session is Confirmed!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Booking Confirmed!</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${client.name}!</h2>
          <p>Your training session has been successfully booked. Here are the details:</p>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #4CAF50; margin-top: 0;">Session Details</h3>
            <p><strong>Date:</strong> ${moment(session.date).format('dddd, MMMM Do YYYY')}</p>
            <p><strong>Time:</strong> ${session.time}</p>
            <p><strong>Exercise Type:</strong> ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
            <p><strong>Group Size:</strong> ${booking.groupSize} ${booking.groupSize === 1 ? 'person' : 'people'}</p>
          </div>
          
          <p style="color: #666;">You'll receive a reminder email 2 hours before your session.</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}! Your training session has been confirmed for ${moment(session.date).format('MMMM Do YYYY')} at ${session.time}.`
  }),

  cancellationNotification: (booking, session, client) => ({
    subject: 'Booking Cancelled - Training Session',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Booking Cancelled</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${client.name},</h2>
          <p>Your training session has been cancelled.</p>
          <p>Date: ${moment(session.date).format('dddd, MMMM Do YYYY')} at ${session.time}</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}, Your training session for ${moment(session.date).format('MMMM Do YYYY')} at ${session.time} has been cancelled.`
  }),

  sessionReminder: (booking, session, client) => ({
    subject: 'Reminder: Your Training Session Starts in 2 Hours!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Session Reminder</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${client.name}!</h2>
          <p><strong>Your training session starts in 2 hours!</strong></p>
          <p>Date: ${moment(session.date).format('dddd, MMMM Do YYYY')}</p>
          <p>Time: ${session.time}</p>
          <p>Exercise Type: ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
        </div>
      </div>
    `,
    text: `Hi ${client.name}! Your training session starts in 2 hours! Date: ${moment(session.date).format('MMMM Do YYYY')} Time: ${session.time}`
  }),

  trainerNotification: (booking, session, client) => ({
    subject: 'New Booking: Client Booked Your Training Session',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">New Booking Alert</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">New Session Booking!</h2>
          <p>Client: ${client.name} (${client.email})</p>
          <p>Session: ${moment(session.date).format('MMMM Do YYYY')} at ${session.time}</p>
          <p>Exercise Type: ${session.exerciseType === 'body-health' ? 'Body Health' : 'Regular Training'}</p>
          <p>Group Size: ${booking.groupSize}</p>
        </div>
      </div>
    `,
    text: `New Booking! Client: ${client.name} (${client.email}) Session: ${moment(session.date).format('MMMM Do YYYY')} at ${session.time}`
  }),

  passwordReset: (user, resetToken) => ({
    subject: 'Password Reset Request - Personal Trainer Booking',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #6c757d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Password Reset</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${user.name},</h2>
          <p>Click the link below to reset your password:</p>
          <p><a href="${process.env.APP_URL}/reset-password?token=${resetToken}">Reset Password</a></p>
          <p>This link expires in 1 hour.</p>
        </div>
      </div>
    `,
    text: `Hi ${user.name}, Visit this link to reset your password: ${process.env.APP_URL}/reset-password?token=${resetToken}`
  }),

  customMessage: (recipient, subject, message) => ({
    subject: subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Message from Your Trainer</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333;">Hi ${recipient.name}!</h2>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; white-space: pre-wrap;">${message}</div>
          <p style="color: #666;">Best regards, Your Personal Trainer</p>
        </div>
      </div>
    `,
    text: `Hi ${recipient.name}!\n\n${message}\n\nBest regards, Your Personal Trainer`
  })
};

async function sendEmail(to, template) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: to,
      subject: template.subject,
      text: template.text,
      html: template.html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

const emailService = {
  async sendBookingConfirmation(booking, session, client, trainer) {
    const template = emailTemplates.bookingConfirmation(booking, session, client);
    const clientResult = await sendEmail(client.email, template);
    
    const trainerTemplate = emailTemplates.trainerNotification(booking, session, client);
    const trainerResult = await sendEmail(trainer.email, trainerTemplate);
    
    return { clientResult, trainerResult };
  },

  async sendCancellationNotification(booking, session, client) {
    const template = emailTemplates.cancellationNotification(booking, session, client);
    return await sendEmail(client.email, template);
  },

  async sendSessionReminder(booking, session, client) {
    const template = emailTemplates.sessionReminder(booking, session, client);
    return await sendEmail(client.email, template);
  },

  async sendPasswordReset(user, resetToken) {
    const template = emailTemplates.passwordReset(user, resetToken);
    return await sendEmail(user.email, template);
  },

  async sendCustomMessage(recipient, subject, message) {
    const template = emailTemplates.customMessage(recipient, subject, message);
    return await sendEmail(recipient.email, template);
  },

  async sendBulkCustomMessage(recipients, subject, message) {
    const results = [];
    for (const recipient of recipients) {
      const result = await this.sendCustomMessage(recipient, subject, message);
      results.push({ recipient: recipient.email, result });
    }
    return results;
  }
};

module.exports = emailService;
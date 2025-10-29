/**
 * Google Apps Script for VentureScope Form Submissions
 * WITH RESEND EMAIL INTEGRATION
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Create a new Google Sheet:
 *    - Go to https://sheets.google.com
 *    - Create a new spreadsheet named "VentureScope Form Submissions"
 *    - Create two sheets (tabs): "Quick Forms" and "Intake Forms"
 *
 * 2. Open Apps Script:
 *    - In your Google Sheet, go to Extensions > Apps Script
 *    - Delete any default code
 *    - Copy and paste this entire script
 *    - Update the CONFIGURATION section below with your details
 *    - Save the project (Ctrl+S / Cmd+S)
 *
 * 3. Deploy as Web App:
 *    - Click the "Deploy" button (top right)
 *    - Select "New deployment"
 *    - Click the gear icon next to "Select type" and choose "Web app"
 *    - Description: "VentureScope Form Handler with Resend"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 *    - Click "Deploy"
 *    - Copy the Web App URL (you'll need this for your website)
 *
 * 4. Update Your Website:
 *    - Go to admin.html and paste your Web App URL
 */

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================

const CONFIG = {
  // Your Resend API Key
  RESEND_API_KEY: 're_ZW49ZR3G_Jm5mnLSfJqxSoQmD5ZU4TvmY',

  // Email Settings
  FROM_EMAIL: 'onboarding@resend.dev', // Update with your verified domain in Resend
  FROM_NAME: 'VentureScope Systems',

  // Business notification email (where you want to receive notifications)
  NOTIFICATION_EMAIL: 'hello@venturescope.systems', // UPDATE THIS!

  // Enable/Disable Features
  SEND_CONFIRMATION_EMAILS: true,  // Send emails to customers
  SEND_NOTIFICATION_EMAILS: true,  // Send emails to business owner

  // Company Info
  COMPANY_NAME: 'VentureScope Systems',
  WEBSITE_URL: 'https://aasimo13.github.io/venturescope-site/',
  SUPPORT_EMAIL: 'hello@venturescope.systems'
};

// ============================================
// MAIN HANDLER
// ============================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const formType = data.formType;

    // Get the active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Route to appropriate handler
    if (formType === 'quick') {
      handleQuickForm(ss, data);
    } else if (formType === 'intake') {
      handleIntakeForm(ss, data);
    }

    // Return success response
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'success',
      'message': 'Form submitted successfully'
    }))
    .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'error',
      'message': error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// QUICK FORM HANDLER
// ============================================

function handleQuickForm(ss, data) {
  let sheet = ss.getSheetByName('Quick Forms');

  // Create sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Quick Forms');
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Email',
      'Service'
    ]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
  }

  // Add the data
  sheet.appendRow([
    new Date(),
    data.fullName || '',
    data.email || '',
    data.service || ''
  ]);

  // Send confirmation email to customer
  if (CONFIG.SEND_CONFIRMATION_EMAILS && data.email) {
    sendQuickFormConfirmation(data);
  }

  // Send notification to business
  if (CONFIG.SEND_NOTIFICATION_EMAILS) {
    sendQuickFormNotification(data);
  }
}

// ============================================
// INTAKE FORM HANDLER
// ============================================

function handleIntakeForm(ss, data) {
  let sheet = ss.getSheetByName('Intake Forms');

  // Create sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Intake Forms');
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Work Email',
      'Phone',
      'Job Title',
      'Company Name',
      'Industry',
      'Team Size',
      'Website',
      'Service',
      'Process Description',
      'Pain Points',
      'Start Date',
      'Budget Range',
      'How Did You Hear'
    ]);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
  }

  // Add the data
  sheet.appendRow([
    new Date(),
    data.fullName || '',
    data.workEmail || '',
    data.phone || '',
    data.jobTitle || '',
    data.companyName || '',
    data.industry || '',
    data.teamSize || '',
    data.website || '',
    data.service || '',
    data.processDescription || '',
    data.painPoints || '',
    data.startDate || '',
    data.budgetRange || '',
    data.hearAbout || ''
  ]);

  // Send confirmation email to customer
  if (CONFIG.SEND_CONFIRMATION_EMAILS && data.workEmail) {
    sendIntakeFormConfirmation(data);
  }

  // Send notification to business
  if (CONFIG.SEND_NOTIFICATION_EMAILS) {
    sendIntakeFormNotification(data);
  }
}

// ============================================
// RESEND EMAIL FUNCTIONS
// ============================================

function sendEmailViaResend(to, subject, htmlContent, textContent) {
  const url = 'https://api.resend.com/emails';

  const payload = {
    from: `${CONFIG.FROM_NAME} <${CONFIG.FROM_EMAIL}>`,
    to: to,
    subject: subject,
    html: htmlContent,
    text: textContent || htmlContent.replace(/<[^>]*>/g, '') // Strip HTML for text version
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`Resend API Response: ${responseCode} - ${responseText}`);

    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Email sent successfully via Resend');
      return true;
    } else {
      Logger.log(`Failed to send email: ${responseText}`);
      return false;
    }
  } catch (error) {
    Logger.log('Error sending email via Resend: ' + error.toString());
    return false;
  }
}

// ============================================
// QUICK FORM EMAIL TEMPLATES
// ============================================

function sendQuickFormConfirmation(data) {
  const subject = `Thanks for reaching out, ${data.fullName}! 🚀`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc2626; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 We Received Your Request!</h1>
        </div>
        <div class="content">
          <p>Hi ${data.fullName},</p>

          <p>Thank you for reaching out to <strong>${CONFIG.COMPANY_NAME}</strong>! We're excited to help you transform your business operations.</p>

          <div class="info-box">
            <h3>📋 What You Requested:</h3>
            <p><strong>Service:</strong> ${data.service}</p>
            <p><strong>Email:</strong> ${data.email}</p>
          </div>

          <h3>⏱️ What Happens Next?</h3>
          <ol>
            <li><strong>Within 24 hours:</strong> Our team will review your request</li>
            <li><strong>We'll reach out:</strong> To schedule a quick 15-minute discovery call</li>
            <li><strong>Get your solution:</strong> We can deliver your first SOP in 48 hours!</li>
          </ol>

          <p>In the meantime, feel free to explore more about what we offer:</p>

          <center>
            <a href="${CONFIG.WEBSITE_URL}" class="button">Visit Our Website</a>
          </center>

          <p>Have questions? Just reply to this email or contact us at <a href="mailto:${CONFIG.SUPPORT_EMAIL}">${CONFIG.SUPPORT_EMAIL}</a></p>

          <p>Looking forward to working with you!</p>

          <p><strong>The VentureScope Team</strong><br>
          AI-Powered Business Operations in 48 Hours</p>
        </div>
        <div class="footer">
          <p>${CONFIG.COMPANY_NAME} | <a href="${CONFIG.WEBSITE_URL}">${CONFIG.WEBSITE_URL}</a></p>
          <p>Turning operational chaos into clarity</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(data.email, subject, html);
}

function sendQuickFormNotification(data) {
  const subject = `🔔 New Quick Form Submission from ${data.fullName}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; }
        .header { background: #374151; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
        .field { margin-bottom: 15px; padding: 10px; background: #f3f4f6; border-radius: 4px; }
        .label { font-weight: bold; color: #374151; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>📨 New Quick Form Submission</h2>
        </div>
        <div class="content">
          <p><strong>A new potential client has reached out!</strong></p>

          <div class="field">
            <span class="label">Full Name:</span> ${data.fullName}
          </div>
          <div class="field">
            <span class="label">Email:</span> <a href="mailto:${data.email}">${data.email}</a>
          </div>
          <div class="field">
            <span class="label">Service Interested:</span> ${data.service}
          </div>
          <div class="field">
            <span class="label">Submitted:</span> ${new Date().toLocaleString()}
          </div>

          <p><strong>Action Required:</strong> Follow up within 24 hours!</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(CONFIG.NOTIFICATION_EMAIL, subject, html);
}

// ============================================
// INTAKE FORM EMAIL TEMPLATES
// ============================================

function sendIntakeFormConfirmation(data) {
  const subject = `Application Received: ${data.companyName} 🎯`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc2626; }
        .timeline { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .timeline-item { padding: 10px 0; border-left: 3px solid #dc2626; padding-left: 20px; margin-left: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Application Received!</h1>
        </div>
        <div class="content">
          <p>Hi ${data.fullName},</p>

          <p>Thank you for completing our detailed intake form! We've received your application for <strong>${data.companyName}</strong> and are excited about the opportunity to transform your operations.</p>

          <div class="info-box">
            <h3>📋 Your Submission Summary:</h3>
            <p><strong>Company:</strong> ${data.companyName}</p>
            <p><strong>Industry:</strong> ${data.industry}</p>
            <p><strong>Service:</strong> ${data.service}</p>
            <p><strong>Preferred Start Date:</strong> ${data.startDate}</p>
            ${data.budgetRange ? `<p><strong>Budget Range:</strong> ${data.budgetRange}</p>` : ''}
          </div>

          <h3>🚀 Your Journey with VentureScope:</h3>
          <div class="timeline">
            <div class="timeline-item">
              <strong>Step 1 - Review (24 hours)</strong><br>
              Our team will carefully review your submission and match you with the right specialist.
            </div>
            <div class="timeline-item">
              <strong>Step 2 - Discovery Call</strong><br>
              We'll schedule a 15-30 minute call to discuss your specific needs and answer questions.
            </div>
            <div class="timeline-item">
              <strong>Step 3 - Proposal</strong><br>
              You'll receive a customized proposal outlining scope, timeline, and investment.
            </div>
            <div class="timeline-item">
              <strong>Step 4 - Kickoff (48 hours)</strong><br>
              Once approved, we can start delivering results in just 48 hours!
            </div>
          </div>

          <h3>💡 What Makes Us Different?</h3>
          <ul>
            <li><strong>Speed:</strong> First deliverables in 48 hours</li>
            <li><strong>AI-Powered:</strong> Cutting-edge automation and optimization</li>
            <li><strong>Practical:</strong> Real SOPs you can implement immediately</li>
            <li><strong>Support:</strong> Ongoing partnership, not just a one-time delivery</li>
          </ul>

          <p>We'll be in touch soon. In the meantime, feel free to reach out with any questions!</p>

          <center>
            <a href="${CONFIG.WEBSITE_URL}" class="button">Learn More About Us</a>
          </center>

          <p>Questions? Reply to this email or contact us at <a href="mailto:${CONFIG.SUPPORT_EMAIL}">${CONFIG.SUPPORT_EMAIL}</a></p>

          <p><strong>The VentureScope Team</strong><br>
          Turning Operational Chaos Into Clarity</p>
        </div>
        <div class="footer">
          <p>${CONFIG.COMPANY_NAME} | <a href="${CONFIG.WEBSITE_URL}">${CONFIG.WEBSITE_URL}</a></p>
          <p>AI-Powered Business Operations in 48 Hours</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(data.workEmail, subject, html);
}

function sendIntakeFormNotification(data) {
  const subject = `🎯 New Intake Form: ${data.companyName} - ${data.service}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 700px; margin: 0 auto; padding: 20px; background: #f9fafb; }
        .header { background: #374151; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .field { margin-bottom: 12px; padding: 12px; background: #f3f4f6; border-radius: 4px; }
        .label { font-weight: bold; color: #374151; display: inline-block; min-width: 150px; }
        .priority { background: #dc2626; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🎯 New Detailed Intake Form Submission</h2>
          <p style="margin: 0;"><span class="priority">HIGH PRIORITY</span> - Full intake form completed!</p>
        </div>
        <div class="content">
          <div class="section">
            <h3>👤 Contact Information</h3>
            <div class="field">
              <span class="label">Full Name:</span> ${data.fullName}
            </div>
            <div class="field">
              <span class="label">Email:</span> <a href="mailto:${data.workEmail}">${data.workEmail}</a>
            </div>
            <div class="field">
              <span class="label">Phone:</span> ${data.phone || 'Not provided'}
            </div>
            <div class="field">
              <span class="label">Job Title:</span> ${data.jobTitle}
            </div>
          </div>

          <div class="section">
            <h3>🏢 Company Details</h3>
            <div class="field">
              <span class="label">Company Name:</span> ${data.companyName}
            </div>
            <div class="field">
              <span class="label">Industry:</span> ${data.industry}
            </div>
            <div class="field">
              <span class="label">Team Size:</span> ${data.teamSize}
            </div>
            <div class="field">
              <span class="label">Website:</span> ${data.website ? `<a href="${data.website}">${data.website}</a>` : 'Not provided'}
            </div>
          </div>

          <div class="section">
            <h3>💼 Project Information</h3>
            <div class="field">
              <span class="label">Service:</span> ${data.service}
            </div>
            <div class="field">
              <span class="label">Start Date:</span> ${data.startDate}
            </div>
            <div class="field">
              <span class="label">Budget Range:</span> ${data.budgetRange || 'Not specified'}
            </div>
            <div class="field">
              <span class="label">How They Found Us:</span> ${data.hearAbout || 'Not specified'}
            </div>
          </div>

          <div class="section">
            <h3>📝 Project Details</h3>
            <div class="field">
              <span class="label">Process Description:</span><br>
              ${data.processDescription}
            </div>
            <div class="field">
              <span class="label">Pain Points:</span><br>
              ${data.painPoints}
            </div>
          </div>

          <div class="section">
            <h3>⏰ Timing</h3>
            <div class="field">
              <span class="label">Submitted:</span> ${new Date().toLocaleString()}
            </div>
          </div>

          <p><strong>⚡ Action Required:</strong> This is a high-intent lead! Follow up within 24 hours to schedule discovery call.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(CONFIG.NOTIFICATION_EMAIL, subject, html);
}

// ============================================
// TEST FUNCTIONS
// ============================================

// Run this to test the email functionality
function testEmailSetup() {
  const testData = {
    fullName: 'Test User',
    email: 'test@example.com',
    service: 'Test Service'
  };

  Logger.log('Testing Resend integration...');
  sendQuickFormConfirmation(testData);
  Logger.log('Test email sent! Check your inbox.');
}

// Run this to verify the script setup
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet name: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('Resend API Key configured: ' + (CONFIG.RESEND_API_KEY ? 'Yes' : 'No'));
  Logger.log('Setup test completed successfully!');
}

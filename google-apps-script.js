/**
 * Google Apps Script for VentureScope Form Submissions
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
 *    - Save the project (Ctrl+S / Cmd+S)
 *
 * 3. Deploy as Web App:
 *    - Click the "Deploy" button (top right)
 *    - Select "New deployment"
 *    - Click the gear icon next to "Select type" and choose "Web app"
 *    - Description: "VentureScope Form Handler"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 *    - Click "Deploy"
 *    - Copy the Web App URL (you'll need this for your website)
 *
 * 4. Update Your Website:
 *    - Replace GOOGLE_APPS_SCRIPT_URL in index.html with your Web App URL
 */

// Main function to handle POST requests from the website
function doPost(e) {
  try {
    // Parse the incoming data
    const data = JSON.parse(e.postData.contents);
    const formType = data.formType; // 'quick' or 'intake'

    // Get the active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Route to appropriate sheet based on form type
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
    // Return error response
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'error',
      'message': error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle Quick Form submissions
function handleQuickForm(ss, data) {
  let sheet = ss.getSheetByName('Quick Forms');

  // Create sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Quick Forms');
    // Add headers
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Email',
      'Service'
    ]);
    // Format header row
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
  }

  // Add the data
  sheet.appendRow([
    new Date(),
    data.fullName || '',
    data.email || '',
    data.service || ''
  ]);

  // Optional: Send email notification
  sendEmailNotification('Quick Form', data);
}

// Handle Intake Form submissions
function handleIntakeForm(ss, data) {
  let sheet = ss.getSheetByName('Intake Forms');

  // Create sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Intake Forms');
    // Add headers
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
    // Format header row
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

  // Optional: Send email notification
  sendEmailNotification('Intake Form', data);
}

// Optional: Send email notification when form is submitted
function sendEmailNotification(formType, data) {
  // CONFIGURE THIS: Replace with your email address
  const YOUR_EMAIL = 'your-email@example.com';

  // Comment out the return statement below to enable email notifications
  return; // Remove this line to enable emails

  let subject = `New ${formType} Submission - VentureScope`;
  let body = `A new ${formType} has been submitted:\n\n`;

  // Build email body from data
  for (let key in data) {
    if (key !== 'formType') {
      body += `${key}: ${data[key]}\n`;
    }
  }

  body += `\n\nSubmitted at: ${new Date().toString()}`;

  // Send the email
  MailApp.sendEmail(YOUR_EMAIL, subject, body);
}

// Test function - run this to verify your setup
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet name: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('Setup test completed successfully!');
}

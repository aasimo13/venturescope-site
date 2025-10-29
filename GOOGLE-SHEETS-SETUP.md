# Google Sheets Integration Setup Guide

This guide will help you set up Google Sheets integration for your VentureScope website forms.

## Overview

Your website has been updated with:
- **New Color Scheme**: Modern red/gray/black theme (replacing the purple theme)
- **Google Sheets Integration**: Both forms (Quick Form and Intake Form) will automatically submit to Google Sheets

## Step-by-Step Setup Instructions

### Step 1: Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Click the **+ Blank** button to create a new spreadsheet
3. Name it **"VentureScope Form Submissions"**
4. Create two sheets (tabs) at the bottom:
   - Rename "Sheet1" to **"Quick Forms"**
   - Click the **+** button to add another sheet and name it **"Intake Forms"**

### Step 2: Open Google Apps Script

1. In your Google Sheet, click on **Extensions** in the menu bar
2. Select **Apps Script**
3. You'll see a new browser tab with the Apps Script editor
4. Delete any default code that appears (usually `function myFunction() {}`)

### Step 3: Copy the Script

1. Open the file `google-apps-script.js` (included in this repository)
2. Copy **ALL** the code from that file
3. Paste it into the Apps Script editor (replacing any existing code)
4. Click the **Save** icon (💾) or press **Ctrl+S** (Windows) / **Cmd+S** (Mac)
5. Give your project a name like **"VentureScope Form Handler"**

### Step 4: Deploy as Web App

1. Click the **Deploy** button in the top-right corner
2. Select **New deployment**
3. Click the gear icon (⚙️) next to "Select type"
4. Choose **Web app** from the dropdown
5. Configure the deployment:
   - **Description**: "VentureScope Form Handler"
   - **Execute as**: Select **Me (your email)**
   - **Who has access**: Select **Anyone**
6. Click **Deploy**
7. You may need to authorize the script:
   - Click **Authorize access**
   - Choose your Google account
   - Click **Advanced** at the bottom
   - Click **Go to [Your Project Name] (unsafe)**
   - Click **Allow**
8. **IMPORTANT**: Copy the **Web App URL** that appears
   - It will look like: `https://script.google.com/macros/s/ABC123.../exec`
   - Save this URL - you'll need it in the next step!

### Step 5: Update Your Website

1. Open `index.html` in a text editor
2. Find the line that says (appears twice in the file):
   ```javascript
   const GOOGLE_APPS_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
   ```
3. Replace `'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE'` with your actual Web App URL from Step 4
4. It should look like:
   ```javascript
   const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/ABC123.../exec';
   ```
5. There are **TWO** places you need to update this:
   - Line ~1699 (Quick Form handler)
   - Line ~1871 (Intake Form handler)
6. Save the file

### Step 6: (Optional) Enable Email Notifications

If you want to receive email notifications when forms are submitted:

1. Go back to your Apps Script editor
2. Find the `sendEmailNotification` function (near the bottom of the script)
3. Replace `'your-email@example.com'` with your actual email address:
   ```javascript
   const YOUR_EMAIL = 'youremail@example.com';
   ```
4. Remove or comment out the line that says `return;` (line ~128)
5. Save and redeploy:
   - Click **Deploy** > **Manage deployments**
   - Click the edit icon (pencil) next to your deployment
   - Click **Deploy**

### Step 7: Test Your Setup

1. Push your updated `index.html` to GitHub
2. Wait for GitHub Pages to deploy (usually takes 1-2 minutes)
3. Visit your live website
4. Fill out and submit one of the forms
5. Check your Google Sheet - you should see a new row with the form data!

## What Happens When Someone Submits a Form?

1. User fills out a form on your website
2. Form data is sent to your Google Apps Script
3. The script adds a new row to the appropriate sheet:
   - Quick Form → "Quick Forms" sheet
   - Intake Form → "Intake Forms" sheet
4. Each submission includes a timestamp
5. (Optional) You receive an email notification

## Troubleshooting

### Forms aren't submitting to Google Sheets

1. Make sure you replaced **both** instances of `GOOGLE_APPS_SCRIPT_URL` in `index.html`
2. Verify your Web App URL is correct (ends with `/exec`)
3. Check that "Who has access" is set to "Anyone" in your deployment settings
4. Make sure you authorized the script properly

### Email notifications aren't working

1. Verify you updated `YOUR_EMAIL` in the script
2. Make sure you removed the `return;` line in `sendEmailNotification`
3. Check your spam folder
4. Verify you redeployed the script after making changes

### I need to make changes to the script

1. Make your changes in the Apps Script editor
2. Save the script
3. Go to **Deploy** > **Manage deployments**
4. Click the edit icon next to your deployment
5. Click **Deploy** to update the live version

## Data Privacy

- All form data is stored in your personal Google Sheet
- Only you have access to the data (unless you share the sheet)
- Google Apps Script runs under your Google account
- The data is not shared with third parties

## Support

If you encounter any issues, please check:
1. Browser console for error messages (Press F12, then click "Console")
2. Apps Script execution logs (In Apps Script editor: View > Executions)
3. Verify all steps above were completed correctly

---

**Note**: Make sure to keep your Google Apps Script Web App URL private and secure. Anyone with this URL could potentially submit data to your Google Sheet.

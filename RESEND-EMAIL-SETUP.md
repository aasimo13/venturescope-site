# Resend Email Integration Setup

Your VentureScope site now sends beautiful confirmation emails automatically! 📧

## 🔐 Security First: Regenerate Your API Key

Since you shared your API key in chat, let's secure it:

### Step 1: Regenerate API Key (Recommended)

1. Go to https://resend.com/api-keys
2. Find your existing API key
3. Click **Delete** or **Revoke**
4. Click **Create API Key**
5. Name it: "VentureScope Production"
6. Copy the new key

**Important:** Save the new key somewhere safe - we'll use it in Step 3.

---

## 📧 Setting Up Resend Emails

### Step 2: Update Google Apps Script

1. **Open your Google Sheet** ("VentureScope Form Submissions")
2. Go to **Extensions > Apps Script**
3. **Delete your old script** (select all and delete)
4. **Copy the new script** from `google-apps-script-with-resend.js` (in your repo)
5. **Paste it** into the Apps Script editor

### Step 3: Configure Settings (IMPORTANT!)

In the script, update the `CONFIG` section at the top:

```javascript
const CONFIG = {
  // YOUR NEW RESEND API KEY (from Step 1)
  RESEND_API_KEY: 're_YOUR_NEW_KEY_HERE',

  // Email Settings
  FROM_EMAIL: 'onboarding@resend.dev', // See Step 4 below
  FROM_NAME: 'VentureScope Systems',

  // WHERE YOU WANT TO RECEIVE NOTIFICATIONS
  NOTIFICATION_EMAIL: 'your-email@example.com', // UPDATE THIS!

  // Enable/Disable Features
  SEND_CONFIRMATION_EMAILS: true,  // Emails to customers
  SEND_NOTIFICATION_EMAILS: true,  // Emails to you

  // Company Info
  COMPANY_NAME: 'VentureScope Systems',
  WEBSITE_URL: 'https://aasimo13.github.io/venturescope-site/',
  SUPPORT_EMAIL: 'hello@venturescope.systems' // UPDATE THIS!
};
```

**What to Update:**
- ✅ `RESEND_API_KEY` - Your NEW API key from Step 1
- ✅ `NOTIFICATION_EMAIL` - Your email (where YOU want notifications)
- ✅ `SUPPORT_EMAIL` - Email customers can reply to
- ⚠️ `FROM_EMAIL` - See Step 4 below

### Step 4: Verify Your Domain in Resend (Optional but Recommended)

**Current Setup:** Using `onboarding@resend.dev` (Resend's test domain)
- ✅ Works immediately
- ⚠️ May land in spam
- ⚠️ Shows "via resend.dev" in email

**Better Setup:** Use your own domain
1. Go to https://resend.com/domains
2. Click **Add Domain**
3. Add your domain (e.g., `venturescope.systems`)
4. Follow DNS setup instructions
5. Update `FROM_EMAIL` to use your domain (e.g., `hello@venturescope.systems`)

**For Now:** The test domain works fine for testing!

### Step 5: Save and Redeploy

1. **Save the script** (Ctrl+S / Cmd+S)
2. **Deploy** the updated script:
   - Click **Deploy** > **Manage deployments**
   - Click the **Edit** icon (pencil) next to your deployment
   - Click **Deploy**
3. Your Web App URL stays the same (no need to update admin panel!)

---

## 🧪 Testing Email Functionality

### Quick Test (From Apps Script)

1. In Apps Script editor, find the `testEmailSetup` function
2. Click the **Select function** dropdown at the top
3. Select **testEmailSetup**
4. Click **Run** (▶️ button)
5. Authorize if prompted
6. Check your email inbox!

### Real Test (From Website)

1. Go to your website: https://aasimo13.github.io/venturescope-site/
2. Fill out the Quick Form
3. Submit it
4. You should receive:
   - ✅ Confirmation email (to the email you entered)
   - ✅ Notification email (to your NOTIFICATION_EMAIL)

---

## 📧 What Emails Are Sent?

### Customer Confirmation Emails

**Quick Form:**
- Beautiful branded HTML email
- Thanks them for reaching out
- Explains what happens next (24-hour response)
- Links back to your website
- Professional design matching your brand

**Intake Form:**
- Detailed confirmation with their submission summary
- Timeline of next steps (review, call, proposal, kickoff)
- Company differentiators
- Professional and reassuring

### Business Notification Emails

**You receive:**
- Instant notification when someone submits a form
- All their contact info formatted nicely
- Priority indicators (Intake forms are marked high priority)
- Action reminders (follow up within 24 hours)

---

## 🔒 Keeping Your API Key Secure

### ✅ GOOD Security Practices:

1. **Regenerate after sharing** ✅ (Do Step 1 above!)
2. **Store in script properties** (optional - see advanced section below)
3. **Never commit to Git** ✅ (Script stays in Google)
4. **Restrict API key permissions** in Resend dashboard
5. **Monitor usage** in Resend to detect abuse

### ❌ BAD Security Practices:

- ❌ Sharing API keys in chat/email
- ❌ Committing keys to public repos
- ❌ Using the same key everywhere
- ❌ Never rotating keys

---

## 🚀 Advanced: Super Secure Setup (Optional)

For maximum security, store your API key in Script Properties:

### 1. Store API Key Securely:

```javascript
// Run this ONCE to store your API key
function storeApiKey() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('RESEND_API_KEY', 're_YOUR_NEW_KEY_HERE');
  Logger.log('API key stored securely!');
}
```

### 2. Update CONFIG to Read from Properties:

```javascript
const CONFIG = {
  // Get API key from secure storage
  RESEND_API_KEY: PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY'),

  // Rest of your config...
};
```

**Benefits:**
- ✅ API key not visible in script code
- ✅ Can share script without exposing key
- ✅ Key encrypted by Google

---

## 📊 Email Deliverability Tips

To ensure emails don't land in spam:

1. **Verify your domain** in Resend (Step 4 above)
2. **Set up SPF/DKIM records** (Resend provides these)
3. **Use a real reply-to address**
4. **Don't use spam trigger words** (FREE, URGENT, etc.)
5. **Test with multiple email providers** (Gmail, Outlook, etc.)

---

## 🐛 Troubleshooting

### "Emails not sending"

**Check:**
1. API key is correct in CONFIG
2. You saved and redeployed the script
3. Check Apps Script logs: View > Logs
4. Verify Resend account is active

### "Emails going to spam"

**Solutions:**
1. Verify your domain in Resend
2. Add SPF/DKIM records
3. Start with small volume, build reputation
4. Ask recipients to whitelist your email

### "Script authorization error"

**Fix:**
1. In Apps Script, go to: View > Executions
2. Look for authorization prompts
3. Click "Review Permissions"
4. Authorize the script

### "Resend API error"

**Check:**
1. API key is valid and active
2. You haven't exceeded Resend free tier (100 emails/day)
3. FROM_EMAIL is valid
4. Check Resend dashboard for errors

---

## 💰 Resend Pricing

**Free Tier:**
- 100 emails per day
- 3,000 emails per month
- Perfect for starting out!

**Paid Plans:**
- Start at $20/month
- 50,000 emails/month
- Upgrade when you need more

---

## ✅ Setup Checklist

- [ ] Regenerate API key in Resend dashboard
- [ ] Update RESEND_API_KEY in script
- [ ] Update NOTIFICATION_EMAIL (where you want notifications)
- [ ] Update SUPPORT_EMAIL (customer reply address)
- [ ] Save and redeploy script
- [ ] Run testEmailSetup() function
- [ ] Check your email inbox
- [ ] Test with real form submission
- [ ] Verify both confirmation and notification emails
- [ ] (Optional) Verify your domain in Resend
- [ ] (Optional) Store API key in Script Properties

---

## 🎉 You're All Set!

Now when someone fills out a form on your website:

1. **Data saves to Google Sheet** ✅
2. **Customer gets beautiful confirmation email** ✅
3. **You get notification email** ✅
4. **Everyone is happy!** ✅

Questions? Check the script logs or Resend dashboard for details.

---

## 📧 What Customers See

**Email Headers:**
```
From: VentureScope Systems <onboarding@resend.dev>
To: customer@example.com
Subject: Thanks for reaching out, John! 🚀
```

**Email Content:**
- Professional HTML design
- Your brand colors (red/black theme)
- Clear next steps
- Call-to-action buttons
- Footer with your links

**This builds trust and looks super professional!** 🎯

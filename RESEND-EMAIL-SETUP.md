# Resend Email Integration Setup

Your VentureScope site sends confirmation emails through Resend. 📧

> ### ⚠️ Read `SECURITY.md` first
>
> The first version of this integration was an **open email relay** — an
> unauthenticated endpoint that sent email to any address, with any content, that
> a caller supplied. It was abused to send phishing. The current script closes
> that hole, but only if you complete **every** step below, including the shared
> secret. The script rejects all submissions until `FORM_SHARED_SECRET` is set.

## 🔐 Security First: Rotate Your Credentials

Do this before anything else, and do it again any time a key may have been seen.

### Step 1: Regenerate your Resend API key

1. Go to https://resend.com/api-keys
2. **Delete or revoke every existing key** — not just the one you think leaked
3. Click **Create API Key**, name it "VentureScope Production"
4. Copy the new key. You'll paste it into Script Properties in Step 3.

Never paste a key into this repo, a commit, an issue, or a chat. This repository
is public, and bots scrape GitHub's public event feed for `re_…` strings within
seconds of a push. Revoking after the fact does not undo the harvest.

---

## 📧 Setting Up Resend Emails

### Step 2: Update Google Apps Script

1. **Open your Google Sheet** ("VentureScope Form Submissions")
2. Go to **Extensions > Apps Script**
3. **Delete your old script** (select all and delete)
4. **Copy the new script** from `google-apps-script-with-resend.js` (in your repo)
5. **Paste it** into the Apps Script editor

### Step 3: Set your Script Properties (REQUIRED)

Secrets never go in the script file. In the Apps Script editor:

**Project Settings** (gear icon) → **Script Properties** → **Add script property**

Add both of these:

| Property | Value |
|---|---|
| `RESEND_API_KEY` | The new key from Step 1 |
| `FORM_SHARED_SECRET` | A random string — see below |

To mint the shared secret: in the Apps Script editor, select the
`generateSharedSecret` function and click **Run**. Open **Execution log** and copy
the value it prints. Paste it into `FORM_SHARED_SECRET`, then paste the **same
value** into `FORM_TOKEN` near the top of `index.html` (or into the Form Shared
Token field in `admin.html`).

> The script refuses every submission while `FORM_SHARED_SECRET` is unset. That is
> deliberate — a misconfigured deployment should accept nothing, not everything.

Then update the plain settings in the `CONFIG` block at the top of the script:

```javascript
const CONFIG = {
  // Secrets are read from Script Properties — nothing to edit on these two lines
  RESEND_API_KEY: PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY'),
  FORM_SHARED_SECRET: PropertiesService.getScriptProperties().getProperty('FORM_SHARED_SECRET'),

  FROM_EMAIL: 'onboarding@resend.dev', // See Step 4 below
  FROM_NAME: 'VentureScope Systems',

  NOTIFICATION_EMAIL: 'your-email@example.com', // UPDATE THIS!

  EMAILS_ENABLED: true,            // Kill switch — set false to stop all sending
  SEND_CONFIRMATION_EMAILS: true,
  SEND_NOTIFICATION_EMAILS: true,

  MAX_SUBMISSIONS_PER_HOUR: 20,    // Global cap — tune to your real traffic
  RECIPIENT_COOLDOWN_MINUTES: 60,  // One confirmation per address per window

  COMPANY_NAME: 'VentureScope Systems',
  WEBSITE_URL: 'https://aasimo13.github.io/venturescope-site/',
  SUPPORT_EMAIL: 'hello@venturescope.systems' // UPDATE THIS!
};
```

**What to update:**
- ✅ `NOTIFICATION_EMAIL` — where YOU want notifications
- ✅ `SUPPORT_EMAIL` — email customers can reply to
- ✅ `MAX_SUBMISSIONS_PER_HOUR` — set this to a small multiple of your genuine
  peak. A cap that never fires legitimately is set too high to be useful.
- ⚠️ `FROM_EMAIL` — see Step 4 below

### Step 3b: Verify the controls actually work

In the Apps Script editor, run `testSecurityControls()` and check the execution
log. Every line should read `PASS`. It exercises script-tag injection, link
injection, `javascript:` and `data:` URLs, multi-recipient addresses, subject-line
newlines, and spreadsheet formula injection.

Then run `testSetup()` to confirm both script properties are visible to the script.

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

### Step 4b: After every redeploy — re-run Test Connection

Open `admin.html` and click **Test Connection** after any Apps Script redeploy,
and any time you change `FORM_ENDPOINT`.

This is not optional politeness. The website treats an unreadable response as a
successful submission, because a browser cannot tell a blocked CORS read apart
from a dead endpoint — and of the two, delivered is far likelier. The tradeoff
is that a typo'd or retired endpoint fails **silently** for real visitors: no
error, no sheet row, no signal to anyone. Test Connection reads the response
properly and is the only thing that will catch it.

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

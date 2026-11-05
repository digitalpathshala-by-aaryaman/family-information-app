# Family Information Book

A simple, private place for an Indian family to keep the things that matter: bank accounts, FDs, investments, insurance, loans, bills, nominees, important papers, medical details and an emergency card.

It is a Progressive Web App (PWA). Open it in any browser, or install it on a phone or computer from the browser menu ("Install app" / "Add to Home screen").

Data is stored in a **Google Sheet** you own. A small Google Apps Script (`Code.gs`) is the server. No other service is needed.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The app page. Loads everything else. |
| `app.js` | Dashboard, forms, Excel import, backup. |
| `data.js` | All sections and fields, in one place. |
| `cloud.js` | Sign-in, families and sync with the Google Sheet. |
| `config.js` | The Apps Script Web app URL. |
| `Code.gs` | Server code. Paste into the Google Sheet's Apps Script editor. |
| `xlsx-reader.js` | Reads Excel files without external libraries. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install and offline support. |
| `template/` | Excel template with one sheet per section. |

## Set up in 5 steps

### 1. Create the Google Sheet
1. Open the Google Sheet you want to use as the database (or create a new one in your own Google account).
2. Make sure **Share** is set to *Restricted* (only you). Never set it to "Anyone with the link".
3. Go to **Extensions > Apps Script**. Delete the sample code, paste the whole of `Code.gs`, and click **Save**.
4. Choose the function `setupSheets` in the toolbar and click **Run**. Allow the permissions it asks for (sheets and sending email). It creates the sheets *Users, Families, Members, Data, Sessions*.

### 2. Publish the server
1. Click **Deploy > New deployment**, choose **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**. (The app's own sign-in protects each family's data; the link is not a secret.)
3. Click **Deploy**, copy the **Web app URL** (ends in `/exec`).

### 3. Connect the app
Open `config.js` and paste the URL:
```js
window.APP_CONFIG = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/XXXX/exec' };
```

### 4. Publish on GitHub Pages
Repository **Settings > Pages**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`. The app goes live at `https://<your-user>.github.io/<repo>/`.

### 5. Install on phone and computer
Open the link in Chrome or Edge, then choose **Install app**.

## How families use it

- **Create account:** email, name and password. A 6-digit code is emailed to confirm the address.
- **Forgot password:** choose "Forgot password?", enter the email, and type the 6-digit code emailed to you with a new password.
- **Admin:** the first person creates a family and sees the **family code** in the top bar.
- **Members:** create their own account, then choose **Join a family** and enter the code.
- Everyone in one family sees the same book. Families cannot see each other's data; the server checks membership on every request.
- The admin can remove a member or create a new code. A member who wants to leave asks the admin to remove them.

## Privacy and security

- The Google Sheet holds the data. **You, as the sheet owner, can read everything.** Keep the sheet restricted to your account.
- Passwords are stored as salted hashes, never as plain text. Codes expire after 15 minutes and lock after 5 wrong tries.
- The repository holds only app code, no family data.
- Do not type passwords, PINs or OTPs into the book.

## Limits to know

- **Email:** Google limits how many emails a Gmail account can send per day (about 100 for a personal account, more for Google Workspace). Each sign-up and password reset uses one email.
- **Apps Script quotas:** a personal account has a daily runtime limit. This is fine for family use and for dozens of families, but not for thousands of daily users.
- **Sheet size:** one Google Sheet holds up to 10 million cells. Each section's data is limited to about 45,000 characters per save (the app tells you if you go over).
- **Speed:** each save or load takes about one to two seconds, slower than a dedicated database.
- **Changes from two people:** if two people edit the same section at once, the later save wins. Press **Refresh** to see the latest.

## Saving and backups

- Changes save automatically a moment after you stop typing. Only the changed section is sent.
- The app keeps a copy on the device, so it opens fast and shows the last saved data when offline.
- The Google Sheet keeps version history (File > Version history).
- "Save backup" downloads a JSON copy of the book from the device.

## Updating the app

Change the files, commit, and push to `main`. Pages republishes. If you change a shell file, raise `VERSION` in `sw.js` so phones fetch the new version. After changing `Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the web app URL keeps working.

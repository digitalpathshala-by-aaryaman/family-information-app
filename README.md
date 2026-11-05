# Family Information Book

A private place for an Indian family to keep the things that matter: bank accounts, FDs, investments, insurance, loans, bills, nominees, important papers, medical details and an emergency card.

It is a Progressive Web App (PWA). Open it in any browser, or install it on a phone or computer from the browser menu ("Install app" / "Add to Home screen").

Data is stored in a **Google Sheet** owned by whoever runs the app. A small Google Apps Script (`Code.gs`) is the server. No other service is needed.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The app page. Loads everything else. |
| `app.js` | Dashboard, forms, Excel import, backup. |
| `data.js` | All sections and fields, in one place. |
| `cloud.js` | Sign-in, families, encryption and sync with the Google Sheet. |
| `config.js` | The Apps Script Web app URL. |
| `Code.gs` | Server code. Paste into the Google Sheet's Apps Script editor. |
| `xlsx-reader.js` | Reads Excel files without external libraries. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install and offline support. |
| `template/` | Excel template with one sheet per section. |

## Set up in 5 steps

### 1. Create the Google Sheet
1. Create a new Google Sheet in an account you control, with **2-Step Verification** turned on.
2. Set **Share** to *Restricted* (only you). Never set it to "Anyone with the link".
3. Go to **Extensions > Apps Script**. Delete the sample code, paste the whole of `Code.gs`, and click **Save**.
4. Choose the function `setupSheets` and click **Run**. Allow the permissions it asks for. It creates the sheets *Users, Families, Members, Data, Sessions*.

### 2. Publish the server
1. Click **Deploy > New deployment**, choose **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**. The app's own sign-in protects each family's data; the link is not a secret.
3. Click **Deploy**, copy the **Web app URL** (ends in `/exec`).
4. After any change to `Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the URL keeps working.

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

- **Create account:** name, email and password. A 6-digit code is emailed to confirm the address.
- **Forgot password:** choose "Forgot password?", enter the email, and type the emailed code with a new password.
- **Family passphrase:** the first admin sets a family passphrase once. Other members enter it once on their device. See below.
- **Admin:** the first person creates a family and sees the **family code** in the top bar.
- **Members:** create their own account, choose **Join a family**, and enter the code.
- Each family sees only its own book. The server checks membership on every request.
- The admin can remove a member or create a new code.

## Privacy and security

**What is protected**

- **Family records are encrypted in the browser** (AES-GCM, key derived from the family passphrase with PBKDF2-SHA-256). The Google Sheet's Data tab holds only encrypted text. Bank names, balances, investments, insurance and the rest cannot be read there.
- **The family passphrase never leaves the browser.** Without it, the records cannot be decrypted, by anyone, including the sheet owner. Lost passphrase means lost data.
- **Passwords never reach the server in plain form.** The browser derives a sign-in key from the password (PBKDF2-SHA-256, 310,000 rounds, salted with the email). The server stores a salted hash of that key, not the password.
- Codes expire after 15 minutes and lock after 5 wrong tries. Sign-in locks after 10 wrong passwords.
- The repository holds only app code, no family data.

**What the sheet owner can still see**

- **Names, email addresses, user IDs and sign-in hashes** in the Users and Members tabs. The server needs the email to send codes and to find accounts, so these cannot be hidden from whoever runs the server.
- **Who belongs to which family, and when records were last changed.**
- **Anything typed into the browser that is not one of the encrypted sections**, such as the family name.

**What is not protected**

- Whoever controls the site code (the GitHub repository) could change it to capture the passphrase or the password as it is typed. Encryption protects against people who can see the sheet, not against whoever runs the site.
- The family passphrase is kept on each device until sign-out. Anyone with that device and browser can read it and the offline copy of the data.
- Anyone who learned the passphrase can still read records they already downloaded. The passphrase cannot be changed yet; changing it would mean re-encrypting every section.

**Recommendations**

- Use a strong, unique password for the Google account that owns the sheet, with 2-Step Verification.
- Use a strong password for the app, and choose a family passphrase you will not forget.
- Share the family passphrase in person, not by message.

## Accounts created before this version

Accounts made before the password update cannot sign in until their owner uses **Forgot password** once. This sets the new sign-in key and keeps the family's data.

## Limits to know

- **Email:** Google limits how many emails a Gmail account can send per day (about 100 for a personal account, more for Google Workspace). Each sign-up and password reset uses one email.
- **Apps Script quotas:** a personal account has a daily runtime limit. This is fine for family use and for dozens of families, but not for thousands of daily users.
- **Sheet size:** a section holds about 33,000 characters of real data per save after encryption (the app tells you if you go over).
- **Speed:** each save or load takes about one to two seconds.
- **Changes from two people:** if two people save the same section at once, the second save is refused and the app shows the latest version. Enter the change again.
- **Members cannot leave a family yet.** Only the admin can remove a member, and the admin cannot leave.
- **Single admin:** if the admin loses their account, nobody can manage members or create a new code.

## Saving and backups

- Changes save automatically a moment after you stop typing. Only the changed section is sent.
- The app keeps a copy on the device, so it opens fast and shows the last saved data when offline.
- The Google Sheet keeps version history (File > Version history).
- "Save backup" downloads a JSON copy of the book from the device. Treat the backup file as sensitive.

## Updating the app

Change the files, commit, and push to `main`. Pages republishes. If you change a shell file, raise `VERSION` in `sw.js` so phones fetch the new version. After changing `Code.gs`, redeploy as a new version (see step 2).

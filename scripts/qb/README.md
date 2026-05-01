# Abel Aegis ↔ QuickBooks Desktop Sync — Install Guide for Dawn

Hi Dawn — this is the one-time setup so QuickBooks on your computer can talk to the Aegis website. You only have to do this once. Plan on about 30 minutes.

## Before you start

You need:

- The QuickBooks company file open on your computer.
- A password from Nate. He will text or hand it to you. **Do not type it anywhere I haven't told you.**
- The file `abel-aegis.qwc` — Nate will email this to you.

## Step 1 — Install the QuickBooks Web Connector

1. Open Chrome or Edge.
2. Go to: <https://developer.intuit.com/app/developer/qbo/docs/develop/web-connector>
3. Look for **"Download the latest QuickBooks Web Connector."** Click it.
4. When the installer downloads, double-click it. Click **Yes** if Windows asks "Do you want to allow this app to make changes."
5. Click **Next**, accept the license, **Next**, **Install**, **Finish**.

You now have a program called **QuickBooks Web Connector** in your Start menu.

## Step 2 — Open QuickBooks (this is required)

1. Open QuickBooks Desktop.
2. Open the **Abel Doors and Trim** company file. (If it's already open, you're good.)
3. Leave QuickBooks open. The sync only works while QuickBooks is open.

## Step 3 — Add the Aegis sync application

1. Open the **QuickBooks Web Connector** from the Start menu.
2. Click **Add an Application**.
3. Browse to wherever Nate sent you the `abel-aegis.qwc` file (probably your Desktop or Downloads folder). Double-click it.
4. QuickBooks will pop up a window asking, **"An application is requesting access to your QuickBooks company file."** Choose **"Yes, whenever this QuickBooks company file is open"**, then click **Continue → Done**.
5. You're back in the Web Connector window. You'll see a row called **Abel Aegis Sync**.

## Step 4 — Enter the password

1. In the row for **Abel Aegis Sync**, click the **Password** field.
2. Type the password Nate gave you. Press **Tab** or **Enter**.
3. The Web Connector will ask, **"Do you want to save this password?"** Click **Yes**.

## Step 5 — Run the first sync

1. Check the box on the left side of the **Abel Aegis Sync** row.
2. Click **Update Selected**.
3. You'll see a green progress bar. The first sync takes 5–15 minutes — it's downloading every customer, invoice from the last 90 days, every bill from the last 90 days, and your chart of accounts.
4. When it finishes, the **Status** column should say **OK** or **Last result: Ok**.

## After that, you don't have to do anything

The Web Connector is set to run **every 60 minutes** automatically while QuickBooks is open. Just leave QuickBooks open during the workday. Aegis will keep itself up to date.

---

## Common problems

### "QBWC1085 — There was a problem with the application's last attempt"
Open the Web Connector. Click **View Log**. Send the last 20 lines to Nate.

### "Application is requesting unattended access" — what do I pick?
Choose **"Yes, whenever this QuickBooks company file is open"**. Do **not** choose "Allow all" or pick a different company file.

### "Could not connect — certificate error" or "SSL error"
1. Confirm your computer's date and time are correct.
2. Reboot.
3. If it still fails, send Nate a screenshot.

### "Password is invalid"
Re-type the password exactly. It is case-sensitive. If it still fails, ask Nate for a fresh one — he can rotate it in 5 seconds.

### QuickBooks asks me about access every time
That means you picked the wrong access option in Step 3. Open QuickBooks → **Edit → Preferences → Integrated Applications → Company Preferences**. Find **Abel Aegis Sync** in the list, click **Properties**, then check **"Allow this application to login automatically."**

### "Single user mode required"
Some QBWC operations need single-user mode. Switch via **File → Switch to Single-user Mode** in QuickBooks before running the sync, then switch back after.

---

## What happens if I close QuickBooks?

Sync pauses. As soon as you re-open QuickBooks the next morning, it picks up where it left off. No data is lost.

## What if my computer is off?

Same — sync pauses. Aegis will catch up on the next cycle.

## Who do I call if something looks off?

Nate. Always. Don't try to "fix" it inside QuickBooks — the sync is read-only **except** for things Nate explicitly approves, so anything weird you see on the Aegis side is a sync issue, not a QuickBooks issue.

---

## For Nate (admin notes — Dawn can ignore)

- Generate fresh `OwnerID` and `FileID` GUIDs before mailing the .qwc to Dawn:
  ```powershell
  [guid]::NewGuid()
  [guid]::NewGuid()
  ```
  Wrap each in `{ }` and replace the placeholders in `abel-aegis.qwc`.
- Set env vars in Vercel (production):
  - `QBWC_USERNAME=aegis-qb-sync`
  - `QBWC_PASSWORD=<32-char random>`
  - Existing `BRAIN_API_KEY` already in place — used for snapshot push.
- Run the qb-aggregate cron entry against vercel.json (see deliverable).
- After Dawn's first successful sync, verify on `/ops/integrations/quickbooks` that `lastSyncAt` is recent and `status=CONNECTED`.

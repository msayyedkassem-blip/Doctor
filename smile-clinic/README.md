# Smile Clinic

**Free, self-hosted dental clinic management.** Patients, odontogram, scheduling,
treatment plans, invoicing, payments, expenses and Arabic WhatsApp messaging — in
one app that runs from a single folder with **no dependencies to install**.

It installs as an app on Android and iPhone, and can start by itself on the clinic
computer so nobody has to open a terminal again. On Android it can also run
**entirely inside the phone** — database and all — with no computer and no
internet.

MIT licensed. No accounts, no subscriptions, no cloud, no telemetry. Your clinic's
data stays in one file on your own machine.

```bash
git clone https://github.com/msayyedkassem-blip/Doctor.git
cd Doctor
npm run seed     # optional: fills a demo clinic so you can look around
npm start        # open http://localhost:4000
```

That's the whole installation. `npm start` runs plain Node — there is no
`npm install` step because the app has **zero runtime dependencies**.

---

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Keep it running by itself](#keep-it-running-by-itself)
- [Install it on phones and tablets](#install-it-on-phones-and-tablets)
- [Arabic](#arabic)
- [WhatsApp messaging](#whatsapp-messaging)
- [The front desk assistant](#the-front-desk-assistant)
- [Keeping devices in step](#keeping-devices-in-step)
- [Roles and permissions](#roles-and-permissions)
- [How the money works](#how-the-money-works)
- [Configuration](#configuration)
- [Backups](#backups)
- [Running it for a real clinic](#running-it-for-a-real-clinic)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Tests](#tests)
- [Security notes](#security-notes)
- [Clinical and legal scope](#clinical-and-legal-scope)
- [Selling it](#selling-it)
- [Licence](#licence)

---

## What it does

### Patients
A full patient file: demographics, contact details, ID and insurance, **allergies
shown as a red warning everywhere the patient appears**, medical notes, and the
referral source. File numbers (`P-0001`) are assigned automatically. Search covers
name, phone, email, file number and ID. Deleting a patient **archives** them — the
clinical and financial history is never destroyed.

### Appointments
Day and week views across all chairs and practitioners, colour-coded per
practitioner, with a live "now" line. Click any empty slot to book.

- **Double-booking is caught** — booking the same practitioner or the same chair
  over an existing appointment returns a clash warning naming the conflict. You
  can still override it deliberately when that is what you meant.
- Status workflow the front desk actually uses: scheduled → confirmed → arrived →
  completed, plus cancelled (reason required) and no-show.
- An availability endpoint returns free slots for a practitioner on a given day.

### Odontogram (dental chart)
A full-mouth chart in FDI notation (both permanent 11–48 and primary 51–85 are
accepted). Click a tooth to record caries, filling, crown, bridge, veneer, implant,
root canal, sealant, needs-extraction or missing, with the affected surfaces
(M/O/D/B/L) and a note. Charted findings are also listed as a table, and you can
turn any tooth straight into a treatment.

### Treatment plans
Plan work before doing it. Each treatment carries a procedure, tooth, surfaces,
price, discount, practitioner and status (planned → in progress → completed).
Completed work that has not been billed yet is flagged, and one button turns all of
it into an invoice.

### Invoicing
- Sequential, gap-free, per-year numbers: `INV-2026-0001` (the prefix is
  configurable).
- Line items with quantity, unit price, per-line discount and per-line tax, plus a
  whole-invoice discount that is spread proportionally before tax.
- Lifecycle: draft → issued → partial → paid, plus void.
- **Invoices are never deleted.** Voiding keeps the number in the ledger, records
  why, and releases the treatments on it so they can be billed again.
- Printable — the print stylesheet renders a clean invoice with your clinic's
  header.

### Payments and refunds
Cash, card, bank transfer, insurance, cheque, online or other. Payments can be
attached to an invoice or taken on account. The app refuses to overpay an invoice
or to refund more than was actually paid, and it recomputes the invoice status
after every payment.

### Expenses
Rent, salaries, lab bills, supplies, utilities, equipment, marketing, taxes —
categorised, with vendor and reference. This is what turns "money collected" into
an actual profit figure.

### Reports
- **Financial summary** — collected, expenses, net, production; income broken down
  by payment method; spending by category; daily money-in/money-out chart; top
  procedures; production per practitioner; and a reconciliation block.
- **Who owes us** — every outstanding invoice, aged into 0–30 / 31–60 / 61–90 /
  90+ day buckets, with the patient's phone number right there.
- **Schedule performance** — booked, completed, cancelled and no-show rates per
  practitioner.
- **CSV export** for payments, expenses, invoices, appointments and patients, so
  your accountant gets a spreadsheet.

### Arabic

The whole interface is available in Arabic, laid out right-to-left. Pick the
language on the sign-in screen, or in **Settings → Language**.

It is a per-device choice, not a clinic setting: the receptionist can work in
Arabic while the dentist reads the same records in English. Nothing about the
records changes — patient names, notes, allergies and message text are stored
and shown exactly as they were typed, in whichever language they were typed.

Figures stay in Western digits (`1,450.00`, not `١٬٤٥٠٫٠٠`) even in Arabic,
because an invoice gets checked against a bank statement and mixing numeral
systems is how mistakes happen. File and invoice numbers, procedure codes and
phone numbers keep left-to-right order inside Arabic text, so `P-B-0007` is
never read backwards.

### Adding to or fixing the translation

Strings are keyed by their English text, so a missing translation shows
readable English rather than a broken screen. The Arabic is one plain file:

```bash
public/i18n/ar.js        # the translations
npm run i18n:check       # what is untranslated, and what English has outgrown
```

`i18n:check` exits non-zero while anything is untranslated, so it can go in a
build script. It also lists translations no longer used by any screen — which
is how a reworded English string gets noticed.

Adding a third language is a copy of `ar.js` and one line in
`public/js/i18n.js`.

---

## WhatsApp messaging in Arabic
Send appointment reminders, confirmations, payment receipts, invoices and balance
chases straight to the patient — in Arabic or English, from templates you can edit
word for word. See [WhatsApp messaging](#whatsapp-messaging) below.

### Everything else
Installs as a real app on phones and tablets, light and dark themes (follows the
OS), a layout that works at the chairside, role-based access control, an audit log
of every meaningful action, and a configurable price list, chair list, currency,
tax rate and working hours.

---

## Requirements

- **Node.js 22.5 or newer** (Node 22 LTS or 24 both work). Check with `node -v`.
  The app uses Node's built-in SQLite, so nothing has to be compiled or installed.
- A modern browser.

That is the complete list. No database server, no Docker (unless you want it), no
build step, no internet connection.

---

## Getting started

```bash
npm start
```

Then open <http://localhost:4000>.

**First run on an empty database** creates an administrator and prints the
generated password to the terminal, once:

```
========================================================
  First run — an administrator account was created:
    email:    admin@clinic.local
    password: kP3nQ7xR
  Change this password after you sign in.
========================================================
```

Change it under the `⋯` menu next to your name in the sidebar.

### On Windows

Windows has no terminal habit to fall back on, so the zip carries files you
double-click instead.

**Before anything else:** install [Node.js](https://nodejs.org) — press the
big green **LTS** button and click through the installer leaving everything as
it is. Then unzip the app somewhere that is **not** the Downloads folder:
`Documents\Smile Clinic` is a good place. Windows runs files in Downloads from
a temporary copy, and the clinic would lose its records every time.

Then, in the `windows` folder:

| Double-click | What it does |
| --- | --- |
| **Start Smile Clinic** | Starts the clinic and opens it in the browser. If it is already running it just opens it. |
| **Run at startup** | Starts the clinic by itself whenever the computer is switched on. |
| **Stop running at startup** | Undoes the above. The app and the records are untouched. |
| **Back up the records** | Writes a dated copy into `backups`. Safe to run while people are using it. |
| **Restore from a backup** | **Drag a backup file onto this one** and let go. Puts it back, or adopts a phone's records as the clinic. |

**The first time you start it, it prints an administrator password and keeps
the window open.** Write it down — it is shown once. (It is also in
`logs\clinic.log`.) Change it once you have signed in.

There is no console window to keep open: the clinic runs in the background, and
closing the browser does not stop it. **Stop running at startup** plus a restart
is how you stop it entirely.

The address other devices should type is shown under **Settings → Clinic**, and
on Windows that matters more than on a Mac: a PC with WSL, Docker, VirtualBox
or VMware carries several extra network adapters, all handing out plausible
`192.168.x` addresses that no phone can reach. The app does not offer those —
it shows only the real Wi-Fi or Ethernet address.

### Try it with demo data first

```bash
npm run seed     # adds a demo clinic; refuses to run if you already have patients
npm run reset    # wipes the database and re-seeds from scratch
```

The demo clinic has 42 patients, several hundred appointments across four months,
treatments, invoices in every payment state, and five months of expenses. Sign in
with any of these — the password for all of them is `demo1234`:

| Email | Role |
| --- | --- |
| `admin@clinic.local` | Administrator |
| `lucas@clinic.local` | Dentist |
| `sofia@clinic.local` | Dentist |
| `front-desk@clinic.local` | Receptionist |
| `accounts@clinic.local` | Accountant |

> **Delete the demo data before real use:** stop the app, delete the `data/`
> folder, and start again to get a clean database and a fresh admin password.

### Lost among several copies?

Downloading the app more than once leaves folders called `Doctor`, `Doctor 1`,
`Doctor 2`… and only one of them holds the real records. Two commands sort it
out, and neither deletes anything:

```bash
npm run find     # says which copy holds real patients, and which is only demo
npm run setup    # backs every database up, then assembles one tidy copy
```

`npm run setup` is also the right command on a fresh computer — there simply is
nothing to gather up, so it just puts the app in place and gives you the icon.

`npm run tidy` backs up every database it finds to `~/Smile Clinic Backups`,
builds a single copy at `~/Smile Clinic` from the newest app files and the real
records, sets it to start at login, and puts a double-clickable **Smile
Clinic.command** on the Desktop. It then *lists* the spare folders for you to
drag to the Trash once you have confirmed everything is there — it will not
remove them itself.

If you are not sure which folder to run it from, paste this — it finds the app
itself, and says so plainly if it cannot:

```bash
T=$(find ~ -name tidy-up.js -path "*/scripts/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
if [ -z "$T" ]; then echo "Could not find the app. Extract the zip first, then run this again."
else cd "$(dirname "$(dirname "$T")")" && npm run setup; fi
```

The same command works on a computer with nothing installed yet: with no old
copies to gather up, it simply sets up the one you just extracted.

### Other commands

```bash
npm run dev      # restarts automatically when you edit a file
npm test         # runs the full test suite
npm run backup   # safe copy of the database, even while the app is running
npm run restore  # put a backup back, or adopt a phone's records as the clinic
npm run address  # the address to open on a phone
npm run find     # find every copy of the app on this computer
npm run setup    # put the app in one place and add a Desktop icon
```

---

## Keep it running by itself

Nobody wants to open a terminal every morning. On a Mac:

```bash
./scripts/install-mac.sh
```

That registers the app with macOS's own service manager. From then on it:

- starts automatically whenever you log in,
- restarts itself if it ever crashes,
- needs no terminal window left open,
- and prints the address your phones should use.

To stop it starting automatically: `./scripts/install-mac.sh remove`.

On Windows, double-click **Run at startup** in the `windows` folder. It puts one
small, readable `.cmd` file in the Startup folder and nothing else — no service,
no installer — which is why **Stop running at startup** undoes it completely.

Logs go to `logs/clinic.log` and `logs/clinic.error.log` if you ever need to see
what happened. On Linux, use the systemd unit under
[Running it for a real clinic](#running-it-for-a-real-clinic).

---

## Install it on phones and tablets

The app is a **PWA**, so it installs from the browser — no app store, no APK, and
it updates itself whenever you update the server.

**First, get the address.** Either:

```bash
npm run address
```

or open **Settings → Clinic** in the app and look for *"Use this on a phone or
tablet"*. Both show something like `http://192.168.1.42:4000`. The phone must be on
the **same Wi-Fi**.

If nothing is found, both tell you which network interfaces they did see and why
each was skipped — a VPN, an IPv6-only connection and a machine that is genuinely
offline all look different, and the app says which one it is.

**Android (Chrome):** open that address → menu (⋮) → **Install app** (or *Add to
Home screen*).

**iPhone / iPad (Safari):** open that address → Share button → **Add to Home
Screen**.

You get a tooth icon in the app drawer or home screen that opens full screen, with
no browser bars — indistinguishable from an installed app.

### Run it entirely on the phone

The Android app can hold the whole clinic itself: SQLite compiled to WebAssembly
keeps the records in the app's own storage, and the same route code the server
runs answers requests inside a Web Worker. No computer, no Wi-Fi, no internet.

Such a device can then **join a clinic** so everyone stays in step: each keeps
its own full copy and works with the server switched off, and they exchange
what changed whenever they can reach each other. See
[Keeping devices in step](#keeping-devices-in-step).

Choose the mode when the app first opens; the back-button menu changes it later.

### Or install the Android APK

A prebuilt, signed APK is at **`android/dist/smile-clinic.apk`**. Copy it to the
phone and open it. It wraps the same web app, and adds a few things the browser
does not do well: WhatsApp links open the real WhatsApp, CSV exports land in the
phone's Downloads, and there is a proper error screen when the clinic computer is
off. See [android/README.md](android/README.md) to install or rebuild it.

The PWA and the APK are the same app — the APK is just a different way to get the
icon onto an Android phone. **iPhones can only use the PWA route**, since iOS
cannot install APKs at all. Either way the server does the work, so updating the
server updates every phone.

### If the address stops working

Your router hands out addresses and can change the computer's one. Re-check
**Settings → Clinic** for the current address, or ask whoever manages the network
to reserve a fixed address for the clinic computer.

---

## Arabic

The whole interface is available in Arabic, laid out right-to-left. Pick the
language on the sign-in screen, or in **Settings → Language**.

It is a per-device choice, not a clinic setting: the receptionist can work in
Arabic while the dentist reads the same records in English. Nothing about the
records changes — patient names, notes, allergies and message text are stored
and shown exactly as they were typed, in whichever language they were typed.

Figures stay in Western digits (`1,450.00`, not `١٬٤٥٠٫٠٠`) even in Arabic,
because an invoice gets checked against a bank statement and mixing numeral
systems is how mistakes happen. File and invoice numbers, procedure codes and
phone numbers keep left-to-right order inside Arabic text, so `P-B-0007` is
never read backwards.

### Adding to or fixing the translation

Strings are keyed by their English text, so a missing translation shows
readable English rather than a broken screen. The Arabic is one plain file:

```bash
public/i18n/ar.js        # the translations
npm run i18n:check       # what is untranslated, and what English has outgrown
```

`i18n:check` exits non-zero while anything is untranslated, so it can go in a
build script. It also lists translations no longer used by any screen — which
is how a reworded English string gets noticed.

Adding a third language is a copy of `ar.js` and one line in
`public/js/i18n.js`.

---

## WhatsApp messaging

The app writes the message, fills in the patient's name, date, amount and balance,
and hands it to WhatsApp. Templates ship in **Arabic and English** and you can edit
every word in **Settings → WhatsApp**.

### The two ways to send

**1. Link mode — free, works today, no setup.** The app opens WhatsApp with the
message already typed, and a member of staff presses send. Nothing to register,
nothing to pay, and it uses the clinic's normal WhatsApp number. Because a human
presses send, the app logs these as *"opened"* — it never claims a message was
delivered when it cannot know.

**2. WhatsApp Business API — automatic, costs money.** Messages go out on their own
with no human step. This needs a Meta Business account, a phone number registered
to the WhatsApp Business Platform (that number can no longer be used in the normal
WhatsApp app), and message templates approved by Meta in advance. Meta charges per
conversation. Add the token and phone number ID in Settings and the same templates
start sending automatically.

> **A warning worth reading:** libraries that promise to automate an ordinary
> WhatsApp account (whatsapp-web.js, Baileys and similar) break WhatsApp's terms
> and get numbers banned. This app deliberately does not use them. A banned number
> would take the clinic's whole patient contact history with it.

### What ships

| Template | When you'd send it |
| --- | --- |
| Appointment reminder | The day before, from the **Reminders** screen |
| Appointment confirmation | When the booking is made |
| Appointment rescheduled | When you move a booking |
| Missed appointment follow-up | After a no-show |
| Payment received | As a receipt, from the payment row |
| Outstanding balance reminder | From the patient file or **Reports → Who owes us** |
| Invoice issued | From the invoice |
| After-treatment care | After a procedure |

### Setting it up

1. **Settings → WhatsApp → Country code.** Digits only, no `+` (for example `964`
   for Iraq, `20` for Egypt, `966` for Saudi Arabia). This turns local numbers
   like `07701234567` into the international form WhatsApp needs. The app
   **refuses to guess** — without this, local numbers are rejected rather than
   risking a message to a stranger.
2. **Default language** — Arabic or English. You can switch per message anyway.
3. That's it for link mode. Open **Reminders** and start sending.

### Where the buttons are

- **Reminders** (sidebar) — tomorrow's list, who has been reminded, one tap each
- **Schedule** — open any appointment
- **Patient file** — header, the balance warning, invoice rows, payment rows
- **Billing** — any invoice
- **Reports → Who owes us** — chase every overdue balance

Every message is logged with who sent it, what it said and when.

### Editing the templates

**Settings → WhatsApp**, click any template. Type your own wording in Arabic
(right-to-left, as you'd expect) and click a placeholder chip to insert a value
like `{{patient_name}}` or `{{balance}}`. A line containing *only* a placeholder
disappears when that value is empty, so optional lines never leave a hole in the
message. Only administrators can change templates; any staff member can send.

---

## The front desk assistant

Optional, off until you turn it on, and the only part of the app that needs
the internet.

### What it does

You paste what a patient sent on WhatsApp and it writes a reply in the
clinic's voice, with the real appointment time and the real balance already
in it. You read it, change it, and send it the normal way. It answers in
whichever language the patient wrote in.

### What it does not do

**It does not answer WhatsApp on its own.** For that a clinic needs the
WhatsApp Business API *and* a server the internet can reach, and a computer
behind a home or clinic router is not one. Anyone who tells you otherwise is
selling you a hosted service. If you later want true auto-answering, that is
the piece to add — a small always-on server with a public address — and the
drafting here is the half that keeps working either way.

It also never gives clinical advice. If a message is about pain, bleeding or
swelling it says the clinic will call back, because software that suggests a
diagnosis over WhatsApp is a liability, not a feature.

### What leaves the clinic

Only this, and only when somebody presses the button:

- the patient's **first name** — not their surname
- their **next appointment**, if they have one
- **what they owe**, if anything
- the clinic's own name, phone, address and opening hours

Never the medical notes, the chart, the x-rays, the treatment history, or
anything else on the file. The patient's record stays in the clinic.

### Turning it on

**Settings → Front desk assistant.** You need a key from
[console.anthropic.com](https://console.anthropic.com). The key is stored on
that computer and never sent back to a browser — once saved, nobody can read
it out of the app again. Each drafted message costs a small amount, billed by
Anthropic, not by this software.

`assistant_endpoint` can be set if your clinic has to go out through its own
gateway.

---

## Keeping devices in step

Every device — the clinic computer and each phone — holds a **full copy** of the
records. Any of them can be used with the others switched off. When they can
reach each other they exchange what changed, and end up agreeing.

### Joining a device to the clinic

1. On the clinic computer, sign in as an administrator and open
   **Settings → Devices → + Add a device**. It shows a **six-character code**,
   good for one device and fifteen minutes.
2. Note the computer's address — **Settings → Clinic** shows it, or run
   `npm run address`. It looks like `192.168.1.42:4000`.
3. On the phone, open **Settings → Clinic → Keeping devices in step**, enter the
   address and the code, and tap **Join this clinic**. Both devices must be on
   the same Wi-Fi.

A device proves itself with that code once and holds a token afterwards, so no
password crosses the network and nothing is joined by simply knowing the
address. The phone pulls everything down, and from then on **Sync now** sends
what it has and takes what it is missing. **Settings → Devices** on the computer
lists what has joined and can remove a device that is lost or no longer used.

**You will be asked to sign in again straight after joining.** A phone used on
its own invents a temporary administrator for itself; joining stands that
account down, because from then on the device uses the clinic's real staff
accounts. Sign in with your own clinic email and password.

**File numbers made before joining are renumbered.** A phone used alone hands
out `P-0001`, `P-0002` — and so does the clinic, to completely different people.
Joining stamps the device's letter on its own numbers first (`P-B-0001`), before
a single record is exchanged, so the two never collide. If a collision somehow
reaches the clinic anyway, the clinic keeps its number and the arriving record
is moved to a free one; Settings says how many were moved, so anything already
written on paper can be checked.

### Started on a phone, setting the computer up later

This is the common way round, and it needs doing in the right order or the
phone's records end up as the ones that get overwritten.

The phone's records are the real clinic. So make them the clinic:

1. **On the phone:** Settings → "↓ Save a backup file". Send the file to
   yourself — WhatsApp, email, a cable, anything — so it is on the computer.
2. **On the computer**, with the app extracted but *not yet started*:

   ```bash
   npm run restore -- "C:\Users\you\Downloads\clinic-backup-2026-10-22.db"
   ```

   It checks the file is really a backup, keeps anything already there beside
   it with a timestamp, and queues every record so the first device to join
   receives the whole clinic rather than an empty one.
3. **Start the clinic** (`npm start`, or **Start Smile Clinic** on Windows) and
   sign in with the account the phone used.
4. **Join the phone to it**, as above. Nothing is lost either way round now,
   but this order means the computer never hands the phone an empty clinic.

If instead the phone joins a computer that was set up fresh, that works too —
everything the phone recorded alone travels up to the clinic. What it cannot
do is undo itself, so it is worth doing in the order above.

**`npm run restore` is also how a backup goes back after a disaster.** It
refuses to run over a database that already has patients unless you add
`--force`, and even then it keeps what was there as
`clinic.db.replaced-<date>`. On a phone the same thing is a button:
Settings → "↑ Restore a backup file".

### Which device should be the clinic

One device has to be the one the others join. It is whichever one is **switched
on and on the clinic Wi-Fi when anybody wants to sync** — that is the only
requirement, and it is the reason a computer is usually the right answer rather
than a phone.

| If the clinic is… | Join to | Why |
| --- | --- | --- |
| A computer left on at the desk | That computer | Always reachable, and it can be backed up to a USB stick |
| A phone that lives at the clinic | That phone | Fine for one dentist with a tablet as well |
| Two phones that are rarely in the same place | Neither — see below | There is nothing for them to join to |

**A phone cannot be joined to.** The Android app holds a full clinic and works
offline, but it does not listen for other devices: a phone's address changes
whenever it reconnects to Wi-Fi, and Android stops background listeners to save
battery. So "sync my phone with the clinic phone" means one of these:

- **Run the clinic on a computer.** Install the zip on a Windows PC or a Mac at
  the clinic, join both phones to it, and the two phones agree through it. They
  do not need to be on at the same time — each one syncs when it is next on the
  clinic Wi-Fi.
- **Use one phone and share the screen.** If there is genuinely only one phone's
  worth of work, a second device can simply open the first one's address in a
  browser while on the same Wi-Fi — it is the same clinic, not a second copy.

Every device must be on the **same Wi-Fi** to sync. Nothing goes over the
internet, which is also why nothing can be synced from home — that is a
deliberate limit, not a missing feature.

### What happens when two people change the same thing

- **Different records — the normal case.** Two payments on one invoice, taken on
  two phones, are two separate records: both are kept, and the invoice total and
  status are **recalculated** afterwards rather than copied. A total is a
  conclusion, not a fact to be synced.
- **The same record, edited in both places.** The later edit wins. If the two
  edits somehow carry the same timestamp, the tie is broken by device identity,
  so every device reaches the same answer instead of drifting apart.
- **Deletions travel.** Deleting an expense on one device removes it everywhere.
- **The same person entered twice.** Two devices that each created a member of
  staff with the same email end up with one record, not two. Their numbering,
  however — patient file numbers and invoice numbers — is deliberately kept
  apart: each device gets a letter of its own, so a phone issues `P-B-0001` and
  `INV-2026-B-0001`. An invoice number ends up on a printed receipt, so it must
  never have to change afterwards.
- **Two people handed the same file number.** Not a merge — they really are two
  different people. One of them is given a free number rather than being
  dropped, and the move is listed in Settings.
- **Anything that cannot be merged** is listed rather than guessed at, and shows
  up as a warning in Settings.

### What syncing does not do

- It is **not a backup**. It copies records between your own devices, so a
  mistake on one spreads to the others. Keep real backups (`npm run backup`, or
  Settings → Where the records are kept on a phone).
- It needs the devices to **reach each other** at some point — same Wi-Fi, or the
  server reachable over the internet if you host it that way.
- A device that never syncs is a clinic of its own. The sidebar always says which
  mode a device is in, and Settings says when it last synced.

---

## Roles and permissions

Permissions are enforced on the server, on every request — hiding a button in the
UI is never the only thing stopping an action.

| Role | Can do |
| --- | --- |
| **Administrator** | Everything, including staff accounts and clinic settings. |
| **Dentist** | Patients, schedule, odontogram, treatments, WhatsApp. Reads billing and reports. |
| **Receptionist** | Patients, schedule, invoices, payments, WhatsApp. **No clinical record edits.** |
| **Accountant** | Invoices, payments, expenses, reports, WhatsApp. Reads patients; cannot edit them. |

Sending a WhatsApp message and rewriting the clinic's message templates are
separate rights: any staff member can send, only an administrator can change the
wording everyone uses.

The app refuses to remove or demote the last active administrator, so a clinic can
never lock itself out. Disabling a user immediately invalidates their sessions.

---

## How the money works

A few rules are worth knowing because they are enforced, not merely suggested:

- **All amounts are stored as integer cents.** No floating-point money, anywhere.
- **An invoice's status is derived, never typed in.** It is recomputed from its
  payments after every change.
- **You cannot overpay an invoice**, and you cannot refund more than was paid on
  it.
- **Voiding an invoice with payments on it is refused** — refund first. This keeps
  the ledger honest.
- **A treatment already on an invoice cannot be edited or deleted.** Void the
  invoice and it becomes billable again.
- **A draft invoice cannot take payment** until it is issued.
- A patient's balance is *issued invoices minus net payments received* — drafts and
  voids never count.

Invoice totals work like this: each line is `quantity × unit price − line
discount`. A whole-invoice discount is applied to the subtotal, and tax is then
charged on each line's proportional share of the discounted base. A discount larger
than the subtotal is clamped rather than producing a negative invoice.

---

## Configuration

Everything clinic-facing (name, address, currency, tax rate, invoice prefix and
footer, working hours, chairs, expense categories, price list) is edited in
**Settings** inside the app. No config files to hand-edit.

Server-level options are environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | Port to listen on. |
| `HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` to keep it on one machine. |
| `DATA_DIR` | `./data` | Where `clinic.db` lives. |
| `DB_FILE` | — | Full path to the database file, overriding `DATA_DIR`. |
| `SESSION_DAYS` | `7` | How long a sign-in lasts. |
| `SECURE_COOKIES` | `0` | Set to `1` when serving over HTTPS. |
| `ADMIN_EMAIL` | `admin@clinic.local` | Email for the first-run administrator. |
| `ADMIN_PASSWORD` | random | Password for the first-run administrator. |
| `QUIET` | `0` | Set to `1` to silence request logging. |
| `WHATSAPP_TOKEN` | — | WhatsApp Business API token. Safer here than in the database. |
| `WHATSAPP_PHONE_NUMBER_ID` | — | The number ID from Meta's WhatsApp Manager. |

Example:

```bash
PORT=8080 DATA_DIR=/var/lib/smile-clinic npm start
```

---

## Backups

The entire clinic is one SQLite file: `data/clinic.db`.

```bash
npm run backup                    # writes a gzipped copy into ./backups
npm run backup -- /mnt/usb-drive  # or anywhere else
```

This uses SQLite's own backup API, so it is **safe to run while the app is live**
— you never get a half-written file. It keeps the 30 most recent backups and
prunes older ones. Put it on a schedule:

```cron
0 21 * * *  cd /opt/smile-clinic && /usr/bin/node scripts/backup.js /mnt/backups
```

To restore, stop the app and hand the file to `npm run restore` — a `.db` or a
`.db.gz`, from this computer or from a phone:

```bash
npm run restore -- backups/clinic-2026-10-22T21-00-00.db.gz
```

It checks the file really is a Smile Clinic database before it moves anything,
refuses to run over a database that already has patients unless you add
`--force`, and keeps whatever was there as `clinic.db.replaced-<date>`. It also
brings an older backup's schema up to date, and queues every record so devices
joining afterwards receive the whole clinic.

With the app stopped, copying the whole `data/` folder is also a complete
backup. You can also export patients, invoices, payments, expenses and
appointments as CSV from the Reports screen at any time.

**On a phone or tablet** running its own copy, the same two things are buttons
under **Settings**: "↓ Save a backup file" and "↑ Restore a backup file".
In the Android app the file goes to the phone's **Downloads** folder and the
share sheet opens straight afterwards, so it can go to WhatsApp, email or
Drive in one more tap. Send it somewhere — a backup sitting in the phone's
Downloads folder goes when the phone does.

**Put the backups somewhere other than the clinic PC.** A stolen or dead computer
takes the database with it.

---

## Running it for a real clinic

**One computer, one user.** Just `npm start` and use the browser on that machine.

**A few computers in the clinic.** Run it on one machine (the "server"), then open
`http://<that-machine's-IP>:4000` from the others on the same network. Give each
person their own account so the audit log means something.

**Keeping it running.** On Linux, a systemd unit:

```ini
[Unit]
Description=Smile Clinic
After=network.target

[Service]
Type=simple
User=clinic
WorkingDirectory=/opt/smile-clinic
Environment=PORT=4000
Environment=DATA_DIR=/var/lib/smile-clinic
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

**With Docker**, if you prefer:

```bash
docker compose up -d        # serves on http://localhost:4000, data in ./data
```

**Exposing it to the internet** — don't, unless you put it behind a reverse proxy
with HTTPS (Caddy or nginx), set `SECURE_COOKIES=1`, and bind the app to
`127.0.0.1` so only the proxy can reach it. Patient records on a plain HTTP port
open to the world is a data breach waiting to happen.

---

## Project layout

```
server/
  index.js            HTTP server, routing, auth middleware, first-run admin
  config.js           environment configuration
  db.js               SQLite connection, migrations, transaction helper
  seed.js             demo clinic generator
  migrations/         versioned .sql schema files
  lib/
    http.js           router, body parsing, static files
    auth.js           scrypt passwords, sessions, the permission matrix
    validate.js       input validation (everything is validated server-side)
    money.js          integer-cent arithmetic and invoice totals
    messaging.js      template rendering, phone normalising, WhatsApp sending
    network.js        finds the address other devices can reach this machine on
    assistant.js      the front desk assistant: prompt, refusals, redaction
    dental-formulary.js  the starter list of dental medicines
    licence.js        signed licence keys; licence-state.js reads the stored one
    sync-schema.js    what syncs, and how the tables point at each other
    sync-core.js      turning rows into something another device understands
    sync-client.js    the device half: send what changed, take what changed
    audit.js          audit log writer
    errors.js         typed HTTP errors
  routes/             one module per resource
public/
  index.html          app shell
  manifest.webmanifest  makes it installable on phones
  sw.js               service worker (shell only — never caches patient data)
  icons/              app icons
  css/app.css         design system, light + dark, print styles
  js/
    api.js            fetch wrapper
    ui.js             DOM helpers, formatting, modals, tables
    app.js            router and shell
    local/            the whole server again, compiled to run inside the phone
    views/            one module per screen
      tooth.js        draws a tooth from its FDI number, pulp and all
      images.js       x-rays and photographs
      stock.js        the store cupboard
      documents.js    prescriptions and the printable patient record
android/              the Android app (no Gradle, no AndroidX)
  build.sh            aapt2 -> javac -> d8 -> zipalign -> apksigner
  test.sh             the parts worth testing, on a plain JVM
  dist/               the signed APK
windows/              double-click files for a Windows PC — each one a few
                      lines calling scripts/windows.js, because batch cannot
                      be tested and this way the logic can be
scripts/
  backup.js           consistent online backup, with rotation
  restore.js          puts a backup back, or makes a phone's records the clinic
  address.js          prints the address phones should use
  build-local.js      copies the server into public/ for the in-phone copy
  find-installs.js    finds every copy and says which holds real records
  running.js          is the clinic up, and stopping it — on any platform
  windows.js          what the Windows double-click files actually do
  tidy-up.js          consolidates them into one, backing up first
  install-mac.sh      auto-start on macOS via launchd
  licence.js          minting and checking licence keys
tests/
  unit.test.js        money, validation, permissions, scheduling maths
  tooth.test.js       the tooth drawings, including the root-canal marking
  messaging.test.js   template rendering and phone normalisation
  network.test.js     address detection across platforms and edge cases
  windows.test.js     starting with Windows, without a Windows machine
  assistant.test.js   the front desk assistant, with the model stubbed out
  licence.test.js     signing, expiry, device limits, tampering
  sync.test.js        two real databases, edited apart, made to agree
  api.test.js         end-to-end tests over real HTTP
  browser-*.mjs       Playwright: the app in a real browser, across origins,
                      a backup saved on a phone and put back again, and two
                      copies of the app contending for one database
```

The frontend is vanilla ES modules — **no framework, no bundler, no build step**.
Edit a file in `public/`, reload the browser, done.

---

## API reference

Every endpoint is under `/api`, speaks JSON, and requires a session cookie except
`/api/health` and `/api/auth/login`. Mutating requests must send the header
`X-Requested-With: clinic-app` (this is the CSRF defence).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` · `/logout` · `/password` | Session management |
| `GET` | `/api/auth/me` | Current user and permissions |
| `GET` `POST` | `/api/patients` | List/search · create |
| `GET` `PUT` `DELETE` | `/api/patients/:id` | Read · update · archive |
| `GET` | `/api/patients/:id/summary` | Whole patient file in one call |
| `GET` `PUT` | `/api/patients/:id/chart[/:tooth]` | Odontogram |
| `POST` | `/api/patients/:id/invoice-pending` | Bill all completed work |
| `GET` `POST` | `/api/appointments` | List by range/practitioner · book |
| `GET` | `/api/appointments/availability` | Free slots for a day |
| `PUT` `PATCH` `DELETE` | `/api/appointments/:id[/status]` | Edit · set status · delete |
| `GET` `POST` `PUT` `DELETE` | `/api/procedures[/:id]` | Price list |
| `GET` `POST` `PUT` `DELETE` | `/api/treatments[/:id]` | Treatment plan |
| `GET` `POST` `PUT` | `/api/invoices[/:id]` | Invoices |
| `POST` | `/api/invoices/:id/issue` · `/void` | Lifecycle |
| `GET` `POST` `DELETE` | `/api/payments[/:id]` | Payments and refunds |
| `GET` `POST` `PUT` `DELETE` | `/api/expenses[/:id]` | Expenses |
| `GET` | `/api/dashboard` | Home-screen KPIs |
| `GET` | `/api/reports/financial` · `/receivables` · `/appointments` | Reports |
| `GET` | `/api/reports/export/:kind` | CSV export |
| `GET` `POST` `PUT` | `/api/users[/:id]` | Staff accounts |
| `GET` `PUT` | `/api/settings` | Clinic settings |
| `GET` | `/api/network` | Addresses phones can use |
| `POST` | `/api/sync/register` · `/pull` · `/push` | Joining and exchanging changes |
| `GET` `DELETE` | `/api/sync/devices[/:id]` | Devices sharing these records |
| `GET` `POST` `PUT` `DELETE` | `/api/messages/templates[/:key]` | Message templates |
| `POST` | `/api/messages/preview` · `/send` | Render · send and log |
| `GET` | `/api/messages` · `/messages/due-reminders` | Log · tomorrow's reminders |

---

## Tests

```bash
npm test
```

156 tests covering the money arithmetic, input validation, the permission matrix,
scheduling maths, Arabic template rendering and phone normalisation, plus
end-to-end HTTP tests that exercise the real server against a throwaway database —
booking clashes, the invoice lifecycle, overpayment and refund guards, role
restrictions, CSRF rejection, path-traversal defence, a check that the WhatsApp
API token never reaches the browser, and a suite that runs two genuinely separate
databases over real HTTP to prove they converge.

---

## Security notes

What is in place:

- Passwords hashed with **scrypt** and a per-password salt; comparison is
  constant-time.
- Session tokens are random 32-byte values; only their SHA-256 hash is stored, in
  `HttpOnly`, `SameSite=Strict` cookies. Expired sessions are swept hourly.
- **CSRF**: every mutating request must carry a header a cross-site form cannot
  set.
- Every input is validated and every query is parameterised — no string-built SQL.
- Static file serving is confined to `public/`, with path traversal rejected.
- Permissions are re-checked on the server for every request.
- An audit log records who did what, including failed sign-ins.
- The WhatsApp API token is never sent to the browser — the UI is only told
  whether one is set. Prefer the `WHATSAPP_TOKEN` environment variable over
  storing it in the database on a shared machine.
- The service worker caches only the app shell. Patient, appointment and
  financial responses are never written to the device cache.

What is **not** included, and that you must provide if you need it:

- **HTTPS** — put it behind a reverse proxy.
- **Encryption at rest** — use full-disk encryption on the machine.
- **Rate limiting on sign-in** — add it at the proxy if the app is reachable beyond
  your LAN.
- **Off-site backups** — see [Backups](#backups).

---

## Clinical and legal scope

This is practice-management software: scheduling, records and money. It is **not a
medical device**, it gives no clinical advice, and it makes no diagnostic
decisions.

Whether a given deployment satisfies **HIPAA, GDPR, or your local health-records
and invoicing law** depends on how *you* run it — where the machine lives, who can
reach it, how it is backed up, how long you retain records, and what your
jurisdiction demands of invoice numbering and tax reporting. Some countries require
certified or tamper-evident invoicing software for dental practices; this app makes
no such certification claim. Check your obligations before billing real patients
with it, and keep whatever paper or parallel records your regulator requires.

**On WhatsApp specifically:** a reminder names a patient and their appointment, so
sending one puts health information onto WhatsApp's servers and onto whatever phone
holds that number. Make sure numbers on file are correct and belong to the patient,
get consent where your rules require it, and keep clinical detail out of the
templates — the shipped wording deliberately says "treatment", not a diagnosis.

The software is provided as-is, with no warranty (see the [LICENSE](LICENSE)).

---

## Selling it

The app can be sold: it has a licensing system built in, designed for selling
to clinics directly rather than through an app store.

### How it works

A licence key is a 128-character code you generate and send to the customer —
over WhatsApp, email, or read out over the phone. It is signed with a private
key that never leaves your machine, so nobody can invent one. It carries four
things: the plan, the expiry date, how many devices it covers, and a serial
number you can look up in your own records.

There is no licence server to run, no payment processor to integrate, and no
requirement that the clinic ever be online. That matters: card processors are
not available everywhere, and clinics pay in cash and by bank transfer.

### Setting up, once

```bash
npm run licence:setup
```

This writes a signing key to `~/.smile-clinic/licence-private.pem` — outside
the project, so it can never be zipped up and shipped by accident — and a
public key to `server/licence-public.txt`, which belongs in the app.

**Back up the private key.** Lose it and every code you have already sold keeps
working, but you can never mint another one the app will accept.

A build with no `server/licence-public.txt` enforces nothing. That is
deliberate: somebody running their own copy from source is not a customer.

### Selling a licence

```bash
npm run licence -- --plan monthly  --devices 2 --for "Al-Noor Dental"
npm run licence -- --plan yearly   --devices 4 --for "Dr Hassan"
npm run licence -- --plan lifetime --devices 6 --for "City Dental"
```

Each prints a code and records the sale in `~/.smile-clinic/licences.csv`
(date, serial, plan, devices, expiry, customer). Renewing is minting another
code and sending it; the customer pastes it into the same box.

`--expires 2027-06-30` sets an exact date. `npm run licence:check -- <code>`
reads a code back when a customer asks what they have.

### What the customer sees

- **A 30-day free trial**, starting the first time the app is opened — not when
  it was downloaded.
- **After that, or when a subscription lapses: read-only.** Every record stays
  visible, searchable, printable and exportable. Only adding and changing
  stops. This is the deliberate centre of the design — a clinic locked out of
  today's appointments would rip the software out and tell every other dentist
  why.
- A banner across the top saying so, and a box in Settings to paste a code.
- Once activated: the plan, the device allowance, the expiry and the licence
  number, so they can see where they stand without asking you.

### What a code covers

One clinic, up to the number of devices you set when you mint it — the clinic
computer counts as one. The customer enters the code once, on the computer;
every phone that joins inherits it through the syncing, with nothing more to
type. If the clinic stops paying, the phones find out at the next sync rather
than staying licensed forever.

Pairing a device beyond the allowance is refused at the moment of pairing, with
a message naming the limit. Devices already in use are never cut off
mid-appointment.

### What this does and does not stop

The app runs on the customer's own computer as readable JavaScript. Somebody
determined can edit the check out of it. No licensing system that runs on
somebody else's machine can prevent that, and pretending otherwise leads to
the kind of copy protection that punishes paying customers.

What signing does stop is the failure that actually costs money: one paying
customer handing a working code to twenty others. A code cannot be forged, and
one that has been shared is traceable by its serial number.

Setting the computer's clock back does not extend a subscription — the app
records the furthest date it has ever seen and will not go behind it.

### Before you sell

- **Change the licence.** Already done: [LICENSE](LICENSE) is a commercial
  end-user agreement. Earlier MIT-licensed copies stay MIT — that cannot be
  undone — but every version from here is yours to sell.
- **Have a lawyer read it** in the country you are selling from, particularly
  the warranty and liability clauses, which some countries restrict.
- **Decide what support you are promising**, and put it in writing. This is
  usually what a dentist is really buying.
- **Read [Clinical and legal scope](#clinical-and-legal-scope)** — selling
  software that holds patient records brings obligations that differ by
  country.

---

## Licence

[Commercial](LICENSE). Versions up to and including the last MIT-licensed
release remain under the MIT licence; this version and later ones do not.

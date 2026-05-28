# Haircut Booking Site

A VS Code-ready haircut booking website.

## What it does

- Shows a modern booking page.
- Loads available appointment slots from Google Calendar.
- Lets customers book a haircut.
- Creates a Google Calendar event on the barber calendar.
- Sends the customer a Google Calendar invite.
- Sends confirmation emails to the customer and the barber when email credentials are configured.

## Setup

1. Open this folder in VS Code.
2. Run:

```bash
npm install
```

3. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

4. Set up Google Calendar API:

- Create a Google Cloud project.
- Enable Google Calendar API.
- Create a service account.
- Download the service account JSON key.
- Rename it to `credentials.json` and place it in this folder.
- Open the barber's Google Calendar settings.
- Share the calendar with the service account email.
- Give it permission to make changes to events.

5. Optional email setup:

- Turn on 2-Step Verification on the Gmail account.
- Create a Google App Password.
- Put the app password in `.env` as `EMAIL_APP_PASSWORD`.

6. Start the project:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

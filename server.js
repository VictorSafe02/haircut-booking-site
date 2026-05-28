import fs from "fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";
import { DateTime, Interval } from "luxon";
import nodemailer from "nodemailer";

// Load variables from .env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const BUSINESS_TZ = process.env.BUSINESS_TZ || "Europe/Dublin";
const BARBER_NAME = process.env.BARBER_NAME || "Fresh Cut Studio";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "coolveteran398@gmail.com";
const BARBER_CALENDAR_ID = process.env.BARBER_CALENDAR_ID || OWNER_EMAIL;
const BUSINESS_LOCATION = process.env.BUSINESS_LOCATION || "Dublin, Ireland";
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 18);
const SLOT_DURATION_MINUTES = Number(process.env.SLOT_DURATION_MINUTES || 45);
const BREAK_START = process.env.BREAK_START || "13:00";
const BREAK_END = process.env.BREAK_END || "14:00";

// Monday = 1, Sunday = 7. This example opens Monday-Saturday.
const OPEN_DAYS = [1, 2, 3, 4, 5, 6];

const SERVICES = {
  "Haircut": { duration: 45, price: 25 },
  "Haircut + Beard": { duration: 60, price: 35 },
  "Skin Fade": { duration: 60, price: 30 },
  "Kids Haircut": { duration: 30, price: 18 }
};

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const GOOGLE_OAUTH_CREDENTIALS = process.env.GOOGLE_OAUTH_CREDENTIALS || "./credentials.json";
const GOOGLE_OAUTH_TOKEN = process.env.GOOGLE_OAUTH_TOKEN || "./token.json";

function getOAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(GOOGLE_OAUTH_CREDENTIALS, "utf8"));
  const config = credentials.web || credentials.installed;

  if (!config) {
    throw new Error("Invalid OAuth credentials file. It should contain either 'web' or 'installed'.");
  }

  const redirectUri =
    config.redirect_uris?.[0] ||
    `http://localhost:${PORT}/oauth2callback`;

  const oAuth2Client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    redirectUri
  );

  if (fs.existsSync(GOOGLE_OAUTH_TOKEN)) {
    const token = JSON.parse(fs.readFileSync(GOOGLE_OAUTH_TOKEN, "utf8"));
    oAuth2Client.setCredentials(token);
  }

  return oAuth2Client;
}

const auth = getOAuthClient();
const calendar = google.calendar({ version: "v3", auth });

app.get("/auth/google", (req, res) => {
  const url = auth.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Missing Google authorization code.");
    }

    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    fs.writeFileSync(GOOGLE_OAUTH_TOKEN, JSON.stringify(tokens, null, 2));

    res.send(`
      <h1>Google Calendar connected</h1>
      <p>You can now go back to the booking website.</p>
      <p><a href="/">Return to website</a></p>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send("Google authorization failed.");
  }
});

function getEmailTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD.includes("replace")) {
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });
}

function parseLocalDate(dateString) {
  return DateTime.fromISO(dateString, { zone: BUSINESS_TZ }).startOf("day");
}

function parseLocalDateTime(dateString, timeString) {
  return DateTime.fromISO(`${dateString}T${timeString}`, { zone: BUSINESS_TZ });
}

function formatDisplayDateTime(dt) {
  return dt.setZone(BUSINESS_TZ).toFormat("cccc, dd LLL yyyy 'at' HH:mm");
}

function timeStringToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function isDuringBreak(slotStart, slotEnd) {
  const breakStart = slotStart.startOf("day").plus({ minutes: timeStringToMinutes(BREAK_START) });
  const breakEnd = slotStart.startOf("day").plus({ minutes: timeStringToMinutes(BREAK_END) });
  return Interval.fromDateTimes(slotStart, slotEnd).overlaps(Interval.fromDateTimes(breakStart, breakEnd));
}

function overlapsBusyTime(slotStart, slotEnd, busyTimes) {
  const slotInterval = Interval.fromDateTimes(slotStart, slotEnd);

  return busyTimes.some((busy) => {
    const busyStart = DateTime.fromISO(busy.start, { zone: BUSINESS_TZ });
    const busyEnd = DateTime.fromISO(busy.end, { zone: BUSINESS_TZ });
    return slotInterval.overlaps(Interval.fromDateTimes(busyStart, busyEnd));
  });
}

function generateGoogleCalendarTemplateLink({ service, start, end, name, phone, notes }) {
  const text = encodeURIComponent(`${service} with ${BARBER_NAME}`);
  const details = encodeURIComponent(`Booking for ${name}\nPhone: ${phone || "Not provided"}\nNotes: ${notes || "None"}`);
  const location = encodeURIComponent(BUSINESS_LOCATION);
  const dates = `${start.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}/${end.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}&ctz=${BUSINESS_TZ}`;
}

async function getBusyTimes(dayStart, dayEnd) {
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISO(),
      timeMax: dayEnd.toISO(),
      timeZone: BUSINESS_TZ,
      items: [{ id: BARBER_CALENDAR_ID }]
    }
  });

  return response.data.calendars?.[BARBER_CALENDAR_ID]?.busy || [];
}

async function getAvailableSlots(dateString, selectedService = "Haircut") {
  const date = parseLocalDate(dateString);
  const serviceDuration = SERVICES[selectedService]?.duration || SLOT_DURATION_MINUTES;

  if (!date.isValid) {
    throw new Error("Invalid date.");
  }

  if (!OPEN_DAYS.includes(date.weekday)) {
    return [];
  }

  const now = DateTime.now().setZone(BUSINESS_TZ);
  const dayStart = date.plus({ hours: OPEN_HOUR });
  const dayEnd = date.plus({ hours: CLOSE_HOUR });
  const busyTimes = await getBusyTimes(dayStart, dayEnd);

  const slots = [];
  let current = dayStart;

  while (current.plus({ minutes: serviceDuration }) <= dayEnd) {
    const slotStart = current;
    const slotEnd = current.plus({ minutes: serviceDuration });

    const isFuture = slotStart > now;
    const blockedByBreak = isDuringBreak(slotStart, slotEnd);
    const blockedByCalendar = overlapsBusyTime(slotStart, slotEnd, busyTimes);

    if (isFuture && !blockedByBreak && !blockedByCalendar) {
      slots.push({
        startTime: slotStart.toFormat("HH:mm"),
        endTime: slotEnd.toFormat("HH:mm"),
        label: `${slotStart.toFormat("HH:mm")} - ${slotEnd.toFormat("HH:mm")}`
      });
    }

    current = current.plus({ minutes: SLOT_DURATION_MINUTES });
  }

  return slots;
}

async function sendConfirmationEmails({ booking, event, start, end, addToGoogleLink }) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    console.log("Email not sent: EMAIL_USER or EMAIL_APP_PASSWORD missing in .env");
    return;
  }

  const bookingTime = formatDisplayDateTime(start);

  const customerHtml = `
    <h2>Your haircut booking is confirmed</h2>
    <p>Hi ${booking.name},</p>
    <p>Your booking with <strong>${BARBER_NAME}</strong> is confirmed.</p>
    <p><strong>Service:</strong> ${booking.service}</p>
    <p><strong>Date/time:</strong> ${bookingTime}</p>
    <p><strong>Location:</strong> ${BUSINESS_LOCATION}</p>
    <p>You should also receive a Google Calendar invitation. If it does not appear automatically, use this link:</p>
    <p><a href="${addToGoogleLink}">Add this booking to Google Calendar</a></p>
    <p>Thank you.</p>
  `;

  const ownerHtml = `
    <h2>New haircut booking</h2>
    <p><strong>Customer:</strong> ${booking.name}</p>
    <p><strong>Email:</strong> ${booking.email}</p>
    <p><strong>Phone:</strong> ${booking.phone || "Not provided"}</p>
    <p><strong>Service:</strong> ${booking.service}</p>
    <p><strong>Date/time:</strong> ${bookingTime}</p>
    <p><strong>Notes:</strong> ${booking.notes || "None"}</p>
    <p><a href="${event.htmlLink}">Open booking in Google Calendar</a></p>
  `;

  await transporter.sendMail({
    from: `${BARBER_NAME} <${process.env.EMAIL_USER}>`,
    to: booking.email,
    subject: `Booking confirmed: ${booking.service} with ${BARBER_NAME}`,
    html: customerHtml
  });

  await transporter.sendMail({
    from: `${BARBER_NAME} <${process.env.EMAIL_USER}>`,
    to: OWNER_EMAIL,
    subject: `New booking: ${booking.name} - ${booking.service}`,
    html: ownerHtml
  });
}

app.get("/api/debug/calendar", async (req, res) => {
  try {
    const calendarList = await calendar.calendarList.list();

    res.json({
      barberCalendarId: BARBER_CALENDAR_ID,
      oauthTokenFileExists: fs.existsSync(GOOGLE_OAUTH_TOKEN),
      calendars: calendarList.data.items.map((cal) => ({
        id: cal.id,
        summary: cal.summary,
        primary: cal.primary || false,
        accessRole: cal.accessRole
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not read calendar list.",
      error: error.message
    });
  }
});

app.get("/api/services", (req, res) => {
  res.json({ services: SERVICES });
});

app.get("/api/availability", async (req, res) => {
  try {
    const { date, service = "Haircut" } = req.query;

    if (!date) {
      return res.status(400).json({ message: "Date is required." });
    }

    const slots = await getAvailableSlots(date, service);
    res.json({ date, service, slots });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load availability." });
  }
});

app.post("/api/book", async (req, res) => {
  try {
    const { name, email, phone, service, date, time, notes } = req.body;

    if (!name || !email || !service || !date || !time) {
      return res.status(400).json({ message: "Name, email, service, date and time are required." });
    }

    if (!SERVICES[service]) {
      return res.status(400).json({ message: "Please choose a valid service." });
    }

    const availableSlots = await getAvailableSlots(date, service);
    const selectedSlot = availableSlots.find((slot) => slot.startTime === time);

    if (!selectedSlot) {
      return res.status(409).json({ message: "Sorry, that time is no longer available. Please choose another slot." });
    }

    const start = parseLocalDateTime(date, time);
    const end = start.plus({ minutes: SERVICES[service].duration });

    const eventResponse = await calendar.events.insert({
      calendarId: BARBER_CALENDAR_ID,
      sendUpdates: "all",
      requestBody: {
        summary: `${service} - ${name}`,
        location: BUSINESS_LOCATION,
        description: [
          `Customer: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone || "Not provided"}`,
          `Service: ${service}`,
          `Notes: ${notes || "None"}`
        ].join("\n"),
        start: {
          dateTime: start.toISO(),
          timeZone: BUSINESS_TZ
        },
        end: {
          dateTime: end.toISO(),
          timeZone: BUSINESS_TZ
        },
        attendees: [
          { email, displayName: name, responseStatus: "needsAction" }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 60 }
          ]
        }
      }
    });

    const event = eventResponse.data;
    const addToGoogleLink = generateGoogleCalendarTemplateLink({
      service,
      start,
      end,
      name,
      phone,
      notes
    });

    await sendConfirmationEmails({
      booking: { name, email, phone, service, date, time, notes },
      event,
      start,
      end,
      addToGoogleLink
    });

    res.status(201).json({
      message: "Booking confirmed.",
      booking: {
        name,
        email,
        phone,
        service,
        date,
        time,
        displayTime: formatDisplayDateTime(start),
        eventLink: event.htmlLink,
        addToGoogleLink
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Booking failed. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Haircut booking site running at http://localhost:${PORT}`);
});

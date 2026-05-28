const dateInput = document.querySelector("#date");
const serviceInput = document.querySelector("#service");
const slotsContainer = document.querySelector("#slots");
const slotsStatus = document.querySelector("#slotsStatus");
const selectedTimeInput = document.querySelector("#selectedTime");
const bookingForm = document.querySelector("#bookingForm");
const submitButton = document.querySelector("#submitButton");
const formMessage = document.querySelector("#formMessage");
const confirmationCard = document.querySelector("#confirmationCard");
const confirmationText = document.querySelector("#confirmationText");
const eventLink = document.querySelector("#eventLink");
const addToGoogleLink = document.querySelector("#addToGoogleLink");
const newBookingButton = document.querySelector("#newBookingButton");

document.querySelector("#year").textContent = new Date().getFullYear();

const today = new Date();
const minDate = today.toISOString().split("T")[0];
dateInput.min = minDate;
dateInput.value = minDate;

function setMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`.trim();
}

function clearSelectedSlot() {
  selectedTimeInput.value = "";
  document.querySelectorAll(".slot-button").forEach((button) => button.classList.remove("selected"));
}

function renderSlots(slots) {
  slotsContainer.innerHTML = "";
  clearSelectedSlot();

  if (!slots.length) {
    slotsStatus.textContent = "No slots available";
    slotsContainer.innerHTML = `<p class="form-message">No free times for this date. Try another day.</p>`;
    return;
  }

  slotsStatus.textContent = `${slots.length} slot${slots.length === 1 ? "" : "s"} available`;

  slots.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot-button";
    button.textContent = slot.label;
    button.dataset.time = slot.startTime;

    button.addEventListener("click", () => {
      clearSelectedSlot();
      button.classList.add("selected");
      selectedTimeInput.value = slot.startTime;
    });

    slotsContainer.appendChild(button);
  });
}

async function loadAvailability() {
  const date = dateInput.value;
  const service = serviceInput.value;

  if (!date || !service) return;

  slotsStatus.textContent = "Loading...";
  slotsContainer.innerHTML = "";
  setMessage("");

  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Could not load availability.");
    }

    renderSlots(data.slots);
  } catch (error) {
    slotsStatus.textContent = "Error";
    slotsContainer.innerHTML = "";
    setMessage(error.message, "error");
  }
}

dateInput.addEventListener("change", loadAvailability);
serviceInput.addEventListener("change", loadAvailability);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  if (!selectedTimeInput.value) {
    setMessage("Please choose an available time slot.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Confirming...";

  const formData = new FormData(bookingForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Booking failed.");
    }

    setMessage("Booking confirmed. Confirmation emails are being sent.", "success");
    confirmationCard.classList.remove("hidden");
    confirmationText.textContent = `${data.booking.name}, your ${data.booking.service} is booked for ${data.booking.displayTime}.`;
    eventLink.href = data.booking.eventLink;
    addToGoogleLink.href = data.booking.addToGoogleLink;
    confirmationCard.scrollIntoView({ behavior: "smooth", block: "start" });

    await loadAvailability();
    bookingForm.reset();
    dateInput.value = minDate;
    selectedTimeInput.value = "";
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Confirm booking";
  }
});

newBookingButton.addEventListener("click", () => {
  confirmationCard.classList.add("hidden");
  document.querySelector("#booking").scrollIntoView({ behavior: "smooth" });
});

loadAvailability();

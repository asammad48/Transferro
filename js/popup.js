/**
 * @fileoverview This script handles the logic for the popup UI (popup.html).
 * It is responsible for gathering user input, saving it to storage, and
 * initiating the booking process by sending a message to the background script.
 * This script runs only when the popup is open.
 */

// Phase 2: Popup UI Logic
document.addEventListener('DOMContentLoaded', () => {
  const proceedButton = document.getElementById('proceed');
  const dateInput = document.getElementById('date');
  const dateToleranceInput = document.getElementById('date-tolerance');
  const vehicleClassInput = document.getElementById('vehicle-class');

  /**
   * On startup, load any previously saved values from chrome.storage.
   * This provides a better user experience by remembering the last-used settings.
   */
  chrome.storage.local.get(['date', 'dateTolerance', 'vehicleClass'], (result) => {
    if (result.date) {
      dateInput.value = result.date;
    }
    if (result.dateTolerance) {
        dateToleranceInput.value = result.dateTolerance;
    }
    if (result.vehicleClass) {
      vehicleClassInput.value = result.vehicleClass;
    }
  });

  /**
   * The "Proceed" button is the main entry point for the user to start the automation.
   * It validates the inputs, saves them, and then triggers the background script.
   */
  proceedButton.addEventListener('click', () => {
    const date = dateInput.value.trim();
    const dateTolerance = parseInt(dateToleranceInput.value, 10);
    const vehicleClass = vehicleClassInput.value.trim();

    // Basic validation to ensure the user has provided the necessary information.
    if (!date || !vehicleClass) {
      alert('Please fill in both the date and vehicle class.');
      return; // Stop if validation fails.
    }

    /**
     * Save the user's settings to chrome.storage.local.
     * This makes the settings available to the background and content scripts.
     */
    chrome.storage.local.set({ date, dateTolerance, vehicleClass }, () => {
      console.log('User settings have been saved.');
    });

    /**
     * Send a message to the background script (background.js) to signal
     * that the user has initiated the booking process. This is a key part of
     * the "user-initiated" safety model.
     */
    chrome.runtime.sendMessage({ action: 'startBooking' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error sending message to background script:', chrome.runtime.lastError);
        } else {
            console.log('Message successfully sent to background script. Response:', response);
        }
        // The popup closes automatically after the message is sent to provide a clean UX.
        window.close();
    });
  });
});
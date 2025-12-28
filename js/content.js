/**
 * @fileoverview This is the content script for the booking automation extension.
 * It is injected directly into the target webpage by the background script.
 * Its sole responsibility is to perform DOM manipulations based on commands
 * received from the background script. It is designed to be safe and precise,
 * adhering to a strict, phased execution model.
 */

console.log('Content script loaded.');

/**
 * Main message listener for commands from the background script.
 * This acts as a router, triggering the correct function based on the 'action' received.
 * The script remains dormant until a message is received.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`Content script received action: ${message.action}`);

  switch (message.action) {
    case 'phase6_clickBooking':
      // This phase is initiated by the user's "Proceed" click in the popup.
      // It finds and clicks the initial booking button after strict validation.
      phase6_clickBooking(message.date, message.dateTolerance, message.vehicleClass, sendResponse);
      return true; // Indicates an asynchronous response.

    case 'phase8_selectVehicle':
      // This phase runs on the new tab that opens after the booking button is clicked.
      // It selects the correct vehicle from a dropdown using XPath.
      phase8_selectVehicle(message.vehicleClass, sendResponse);
      return true; // Indicates an asynchronous response.

    case 'phase9_acceptRide':
      // This is the final step, clicking the confirmation button.
      // It's only triggered if the user has explicitly enabled it in the options.
      phase9_acceptRide(sendResponse);
      return true; // Indicates an asynchronous response.

    default:
      console.warn(`Unknown action received in content script: ${message.action}`);
      sendResponse({ status: 'error', message: 'Unknown action' });
      break;
  }
  return false; // No async response needed for unknown actions.
});

// ========================
// PHASE 6 — CLICK BOOKING
// ========================
function phase6_clickBooking(targetDateStr, toleranceDays, vehicleClass, sendResponse) {
// Target selector from the requirements.
const bookingElements = document.querySelectorAll('div.row.the_booking');

// --- Preconditions ---
if (bookingElements.length === 0) {
  console.error('No booking elements found. Aborting.');
  sendResponse({ status: 'error', message: 'No booking elements found.' });
  return;
}

let matchFound = false;

// Iterate through all found booking elements.
for (const bookingElement of bookingElements) {
  if (!isElementVisible(bookingElement)) {
    continue; // Skip non-visible elements.
  }

  // --- Strict Execution Rules ---
  const dateElement = bookingElement.querySelector('.booking_date');
  const vehicleElement = bookingElement.querySelector('.vehicle_class');

  if (!dateElement || !vehicleElement) {
    continue; // Skip elements missing crucial info.
  }

  const actualDateStr = dateElement.textContent.trim();
  const actualVehicle = vehicleElement.textContent.trim().toLowerCase();

  // Rule 1: Date must match within the user-defined tolerance.
  const dateMatch = isDateMatch(actualDateStr, targetDateStr, toleranceDays);
  // Rule 2: Vehicle class must match exactly (case-normalized).
  const vehicleMatch = actualVehicle === vehicleClass.toLowerCase();

  // If both rules pass, perform the action and stop.
  if (dateMatch && vehicleMatch) {
    console.log('All preconditions met for Phase 6. Clicking the first valid booking element.');
    bookingElement.click();
    sendResponse({ status: 'success', message: 'Booking element clicked.' });
    matchFound = true;
    break; // Exit the loop after finding and clicking the first match.
  }
}

// If the loop completes without finding a match, send a failure response.
if (!matchFound) {
  console.error('No booking element met the required date and vehicle criteria. Aborting.');
  sendResponse({ status: 'error', message: 'No matching booking found.' });
}
}


// ========================
// PHASE 8 — VEHICLE SELECTION (XPath)
// ========================
function phase8_selectVehicle(vehicleClass, sendResponse) {
  // NOTE: The setTimeout delays here are a simple solution for this specific case.
  // In a more complex, real-world application, a more robust approach would be
  // to use a polling mechanism (e.g., setInterval) to check for the element's
  // existence and visibility before proceeding, with a clear timeout.
  // Use a small delay to ensure the UI is fully rendered after the new tab opens.
  setTimeout(() => {
    try {
      // --- Action: Open Dropdown ---
      const dropdown = getElementByXPath('//*[@id="select2-vehicle-container"]');
      if (!dropdown || !isElementVisible(dropdown)) {
        throw new Error('Vehicle dropdown not found or not visible.');
      }
      dropdown.click();

      // --- Action: Find and Click Matching Option ---
      // Another small delay for the dropdown options to become visible.
      setTimeout(() => {
        const options = getElementsByXPath('//*[@id="select2-vehicle-results"]/li');
        let matchFound = false;

        // Iterate through options to find an exact, case-normalized match. No fuzzy matching.
        for (const option of options) {
          const optionText = option.textContent.trim().toLowerCase();
          if (optionText === vehicleClass.toLowerCase()) {
            console.log(`Matching vehicle found: "${option.textContent}". Clicking.`);
            option.click();
            matchFound = true;
            break; // Exit after finding the first exact match. No index-based clicks.
          }
        }

        if (matchFound) {
          // After successful selection, notify the background script to proceed to the final phase.
          chrome.runtime.sendMessage({ action: 'phase9_readyToAccept' }, (response) => {
            console.log('Ready for Phase 9, background script notified.', response);
            sendResponse({ status: 'success', message: 'Vehicle selected.' });
          });
        } else {
          // --- Abort if no match is found. This is a critical safety stop. ---
          throw new Error(`No exact match found for vehicle class "${vehicleClass}". Aborting.`);
        }
      }, 500); // 500ms delay for options to appear

    } catch (error) {
      console.error('Error in Phase 8:', error.message);
      sendResponse({ status: 'error', message: error.message });
    }
  }, 1000); // 1-second delay for the page to settle
}


// ========================
// PHASE 9 — ACCEPT RIDE
// ========================
function phase9_acceptRide(sendResponse) {
  try {
    // --- Preconditions ---
    const finalButton = getElementByXPath('//*[@id="ass_vehicle_div"]');
    if (!finalButton || !isElementVisible(finalButton)) {
      throw new Error('Final confirmation button not found or not visible.');
    }

    // Safety Check: Look for any visible error messages on the page before the final click.
    const errorElement = document.querySelector('.error-message'); // Assuming a generic error selector
    if (errorElement && isElementVisible(errorElement)) {
        throw new Error('An error message is visible on the page. Aborting final click.');
    }

    // --- Action ---
    console.log('All preconditions met for Phase 9. Clicking final confirmation.');
    finalButton.click(); // One click, no retries, no loops.
    sendResponse({ status: 'success', message: 'Final confirmation clicked.' });

  } catch (error) {
    console.error('Error in Phase 9:', error.message);
    sendResponse({ status: 'error', message: error.message });
  }
}


// ========================
// DOM SAFETY & HELPER FUNCTIONS
// ========================

/**
 * Checks if an element is currently visible in the DOM.
 * This is a crucial safety check to prevent interacting with hidden elements.
 */
function isElementVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/**
 * Validates if the date found on the page is within the user-defined tolerance.
 * Parses dates strictly and returns false if parsing fails.
 */
function isDateMatch(actualDateStr, targetDateStr, toleranceDays) {
    try {
        const actualDate = new Date(actualDateStr);
        const targetDate = new Date(targetDateStr);
        // Invalidate if dates are not actual dates
        if (isNaN(actualDate.getTime()) || isNaN(targetDate.getTime())) return false;

        const diffTime = Math.abs(actualDate - targetDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays <= toleranceDays;
    } catch (e) {
        console.error("Error parsing dates:", e);
        return false;
    }
}


/**
 * Finds a single element using an XPath expression.
 * Encapsulates the document.evaluate logic for reuse.
 * Returns null if not found, allowing the calling function to handle the error.
 */
function getElementByXPath(path) {
  const element = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!element) {
    console.warn(`XPath element not found: ${path}`);
  }
  return element;
}

/**
 * Finds multiple elements using an XPath expression.
 * Returns an array of nodes.
 */
function getElementsByXPath(path) {
  const iterator = document.evaluate(path, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  const results = [];
  let node = iterator.iterateNext();
  while (node) {
    results.push(node);
    node = iterator.iterateNext();
  }
  return results;
}

/**
 * @fileoverview This is the content script for the booking automation extension.
 * It is injected directly into the target webpage by the background script.
 * Its sole responsibility is to perform DOM manipulations based on commands
 * received from the background script. It is designed to be safe and precise,
 * adhering to a strict, phased execution model.
 */

console.log('Content script loaded.');

/**
 * Sends a log message to the background script to be displayed in the popup.
 * @param {string} text The message to log.
 * @param {'info' | 'error' | 'success'} [level='info'] The log level.
 */
function logToPopup(text, level = 'info') {
  // Fire-and-forget message to the background for logging purposes.
  chrome.runtime.sendMessage({ type: 'content_script_log', text, level }).catch(err => {});
}


/**
 * Main message listener for commands from the background script.
 * This acts as a router, triggering the correct function based on the 'action' received.
 * The script remains dormant until a message is received.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`Content script received action: ${message.action}`);

  switch (message.action) {
    case 'phase6_clickBooking':
      phase6_clickBooking(message.date, message.dateTolerance, message.vehicleClass, sendResponse);
      return true; // Indicates an asynchronous response.

    case 'phase8_selectVehicle':
      phase8_selectVehicle(message.vehicleClass, sendResponse);
      return true; // Indicates an asynchronous response.

    case 'phase9_acceptRide':
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

/**
 * Finds and clicks the first valid booking element on the page.
 * It iterates through all potential elements, applying strict date and vehicle class checks.
 * Detailed logs are sent to the popup at each step of the validation process.
 */
function phase6_clickBooking(targetDateStr, toleranceDays, vehicleClass, sendResponse) {
    const bookingElements = document.querySelectorAll('div.row.the_booking');
    logToPopup(`Found ${bookingElements.length} potential booking element(s).`);

    if (bookingElements.length === 0) {
        logToPopup('No booking elements found on the page.', 'error');
        sendResponse({ status: 'error', message: 'No booking elements found.' });
        return;
    }

    let matchFound = false;
    let elementIndex = 0;

    for (const bookingElement of bookingElements) {
        elementIndex++;
        const logPrefix = `[Element ${elementIndex}]:`;

        if (!isElementVisible(bookingElement)) {
            logToPopup(`${logPrefix} Skipping non-visible element.`);
            continue;
        }

        const dateElement = bookingElement.querySelector('.booking_date');
        const vehicleElement = bookingElement.querySelector('.vehicle_class');

        if (!dateElement || !vehicleElement) {
            logToPopup(`${logPrefix} Skipping element missing date or vehicle info.`);
            continue;
        }

        const actualDateStr = dateElement.textContent.trim();
        const actualVehicle = vehicleElement.textContent.trim().toLowerCase();
        logToPopup(`${logPrefix} Found Date: "${actualDateStr}", Vehicle: "${actualVehicle}".`);

        const dateMatch = isDateMatch(actualDateStr, targetDateStr, toleranceDays);
        if (!dateMatch) {
            logToPopup(`${logPrefix} Date mismatch. (Expected: ${targetDateStr} ±${toleranceDays} days).`);
        }

        const vehicleMatch = actualVehicle === vehicleClass.toLowerCase();
        if (!vehicleMatch) {
            logToPopup(`${logPrefix} Vehicle mismatch. (Expected: "${vehicleClass.toLowerCase()}").`);
        }

        if (dateMatch && vehicleMatch) {
            logToPopup(`${logPrefix} Match found! Clicking element.`, 'success');
            bookingElement.click();
            logToPopup(`${logPrefix} Match found! Button Clicked.`, 'success');
            sendResponse({ status: 'success', message: 'Booking element clicked.' });
            matchFound = true;
            break;
        }
    }

    if (!matchFound) {
        logToPopup('No booking element met all criteria.', 'error');
        sendResponse({ status: 'error', message: 'No matching booking found.' });
    }
}


// ========================
// PHASE 8 — VEHICLE SELECTION (XPath)
// ========================

/**
 * Selects the specified vehicle from a dropdown on the new ride page.
 * It uses XPath to locate the dropdown and its options, ensuring precise selection.
 * Delays are used to wait for the UI to render after the page loads and the dropdown opens.
 */
function phase8_selectVehicle(vehicleClass, sendResponse) {
    setTimeout(() => {
        try {
            logToPopup('Attempting to find and open vehicle dropdown.');
            const dropdown = getElementByXPath('//*[@id="select2-vehicle-container"]');
            if (!dropdown || !isElementVisible(dropdown)) {
                logToPopup('Vehicle dropdown not found or not visible.', 'error');
                throw new Error('Vehicle dropdown not found or not visible.');
            }
            dropdown.click();
            logToPopup('Vehicle dropdown clicked.');

            setTimeout(() => {
                const options = getElementsByXPath('//*[@id="select2-vehicle-results"]/li');
                logToPopup(`Found ${options.length} vehicle options in dropdown.`);
                let matchFound = false;

                for (const option of options) {
                    const optionText = option.textContent.trim().toLowerCase();
                    logToPopup(`Checking option: "${option.textContent.trim()}".`);
                    if (optionText === vehicleClass.toLowerCase()) {
                        logToPopup(`Matching vehicle found: "${option.textContent}". Clicking.`, 'success');
                        option.click();
                        matchFound = true;
                        break;
                    }
                }

                if (matchFound) {
                    chrome.runtime.sendMessage({ action: 'phase9_readyToAccept' }, (response) => {
                        logToPopup('Vehicle selected. Notifying background to proceed.');
                        sendResponse({ status: 'success', message: 'Vehicle selected.' });
                    });
                } else {
                    logToPopup(`No exact match found for vehicle class "${vehicleClass}".`, 'error');
                    throw new Error(`No exact match found for vehicle class "${vehicleClass}". Aborting.`);
                }
            }, 500);

        } catch (error) {
            logToPopup(`Error in Phase 8: ${error.message}`, 'error');
            sendResponse({ status: 'error', message: error.message });
        }
    }, 1000);
}


// ========================
// PHASE 9 — ACCEPT RIDE
// ========================

/**
 * Clicks the final confirmation button to accept the ride.
 * It performs a final safety check for any visible error messages before clicking.
 */
function phase9_acceptRide(sendResponse) {
  try {
    logToPopup('Attempting to find final confirmation button.');
    const finalButton = getElementByXPath('//*[@id="ass_vehicle_div"]');
    if (!finalButton || !isElementVisible(finalButton)) {
      logToPopup('Final confirmation button not found or not visible.', 'error');
      throw new Error('Final confirmation button not found or not visible.');
    }
    logToPopup('Final confirmation button found.');

    const errorElement = document.querySelector('.error-message');
    if (errorElement && isElementVisible(errorElement)) {
        logToPopup('An error message is visible on the page. Aborting final click.', 'error');
        throw new Error('An error message is visible on the page. Aborting final click.');
    }

    logToPopup('All checks passed. Clicking final confirmation.', 'success');
    finalButton.click();
    sendResponse({ status: 'success', message: 'Final confirmation clicked.' });

  } catch (error) {
    logToPopup(`Error in Phase 9: ${error.message}`, 'error');
    sendResponse({ status: 'error', message: error.message });
  }
}


// ========================
// DOM SAFETY & HELPER FUNCTIONS
// ========================

function isElementVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function isDateMatch(actualDateStr, targetDateStr, toleranceDays) {
    try {
        const actualDate = new Date(actualDateStr);
        const targetDate = new Date(targetDateStr);
        if (isNaN(actualDate.getTime()) || isNaN(targetDate.getTime())) return false;
        const diffTime = Math.abs(actualDate - targetDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= toleranceDays;
    } catch (e) {
        console.error("Error parsing dates:", e);
        return false;
    }
}

function getElementByXPath(path) {
  const element = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!element) {
    console.warn(`XPath element not found: ${path}`);
  }
  return element;
}

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

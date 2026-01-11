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
      phase6_clickBooking(message.startDate, message.endDate, message.vehicleClasses, sendResponse);
      return true; // Indicates an asynchronous response.

    case 'phase8_selectVehicle':
      phase8_selectVehicle(message.vehicleClasses, sendResponse);
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
function phase6_clickBooking(startDateStr, endDateStr, vehicleClasses, sendResponse) {
    const bookingElements = document.querySelectorAll('div.row.the_booking');
    logToPopup(`Found ${bookingElements.length} potential booking element(s).`);

    if (bookingElements.length === 0) {
        logToPopup('No booking elements found on the page.', 'error');
        sendResponse({ status: 'error', message: 'No booking elements found.' });
        return;
    }

    let matchFound = false;
    let elementIndex = 0;
    const lowercasedVehicleClasses = vehicleClasses.map(vc => vc.toLowerCase());

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

        const dateMatch = isDateInRange(actualDateStr, startDateStr, endDateStr);
        if (!dateMatch) {
            logToPopup(`${logPrefix} Date mismatch. (Not in range: ${startDateStr} to ${endDateStr || startDateStr}).`);
        }

        const vehicleMatch = lowercasedVehicleClasses.includes(actualVehicle);
        if (!vehicleMatch) {
            logToPopup(`${logPrefix} Vehicle mismatch. (Not one of: "${vehicleClasses.join(', ')}").`);
        }

        if (dateMatch && vehicleMatch) {
            logToPopup(`${logPrefix} Match found! Preparing to open new tab.`, 'success');

            const onclickAttr = bookingElement.getAttribute('onclick');
            const urlMatch = onclickAttr.match(/window\.open\("([^"]+)"/);
            if (urlMatch && urlMatch[1]) {
                const newTabUrl = urlMatch[1];
                logToPopup(`${logPrefix} Extracted new tab URL: ${newTabUrl}`);
                chrome.runtime.sendMessage({ type: 'log_url', url: newTabUrl });
            } else {
                logToPopup(`${logPrefix} Could not extract URL from onclick attribute.`, 'error');
            }

            bookingElement.click();
            logToPopup(`${logPrefix} Clicked element to open new tab.`, 'success');
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
// PHASE 8 — VEHICLE SELECTION (jQuery Injection)
// ========================

/**
 * Injects a script into the page to interact with the jQuery-based select2 dropdown.
 * This is more reliable than simulating clicks, especially for complex UI elements.
 */
function phase8_selectVehicle(vehicleClasses, sendResponse) {
    const execute = () => {
        logToPopup(`Attempting to select one of the following vehicles: "${vehicleClasses.join(', ')}"`, 'info');

        // The script to be injected. Note the use of JSON.stringify to safely pass the array.
        const scriptToInject = `
            (function() {
                try {
                    console.log('Phase 8 Injected Script: Starting vehicle selection.');
                    const $select = $('#vehicle');
                    if (!$select.length) {
                        console.log('Phase 8 Injected Script: Main dropdown not found.');
                        throw new Error('Vehicle select dropdown (#vehicle) not found.');
                    }
                    console.log('Phase 8 Injected Script: Main dropdown appeared.');

                    // Programmatically open the select2 dropdown.
                    $select.select2('open');
                    console.log('Phase 8 Injected Script: select2 dropdown opened.');

                    const options = $select.find('option');
                    if(options.length > 0) {
                        console.log('Phase 8 Injected Script: Dropdown options appeared.');
                    } else {
                        console.log('Phase 8 Injected Script: Dropdown options not appeared.');
                    }

                    const vehicleClasses = ${JSON.stringify(vehicleClasses)};
                    let matchFound = false;

                    for (const targetText of vehicleClasses) {
                        console.log('Phase 8 Injected Script: Searching for vehicle containing:', targetText);
                        const option = $select.find('option:not(:disabled)').filter(function() {
                            return $(this).text().includes(targetText);
                        }).first();

                        if (option.length) {
                            console.log('Phase 8 Injected Script: Found matching option:', option.text());
                            $select.val(option.val()).trigger('change');
                            matchFound = true;
                            break; // Stop after finding the first match
                        }
                    }

                    $select.select2('close');

                    if (matchFound) {
                        console.log('Phase 8 Injected Script: Vehicle selected successfully.');
                        window.postMessage({ type: 'FROM_CONTENT_SCRIPT', status: 'success', message: 'Vehicle selected.' }, '*');
                    } else {
                        throw new Error('No available vehicle found for any of the desired classes.');
                    }
                } catch (error) {
                    console.error('Phase 8 Injected Script Error:', error.message);
                    window.postMessage({ type: 'FROM_CONTENT_SCRIPT', status: 'error', message: error.message }, '*');
                }
            })();
        `;

        // Listen for the result from the injected script
        window.addEventListener('message', function(event) {
            if (event.source === window && event.data.type === 'FROM_CONTENT_SCRIPT') {
                if (event.data.status === 'success') {
                    logToPopup('Vehicle selected successfully via injected script.', 'success');
                    chrome.runtime.sendMessage({ action: 'phase9_readyToAccept' });
                    sendResponse({ status: 'success' });
                } else {
                    logToPopup(`Error in injected script: ${event.data.message}`, 'error');
                    sendResponse({ status: 'error', message: event.data.message });
                }
            }
        }, { once: true }); // Important to avoid listening to other messages

        // Inject the script into the page
        const script = document.createElement('script');
        script.textContent = scriptToInject;
        (document.head || document.documentElement).appendChild(script);
        script.remove(); // Clean up the script tag
    };

    if (document.readyState === 'loading') {
        logToPopup('DOM not fully loaded. Deferring Phase 8 script execution.', 'info');
        document.addEventListener('DOMContentLoaded', execute);
    } else {
        logToPopup('DOM already loaded. Executing Phase 8 script immediately.', 'info');
        execute();
    }
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

/**
 * Polls the DOM for an element to appear and be visible.
 * @param {string} xpath The XPath selector for the element.
 * @param {number} timeout The maximum time to wait in milliseconds.
 * @returns {Promise<Element>} A promise that resolves with the element or rejects on timeout.
 */
function waitForElement(xpath, timeout) {
    return new Promise((resolve, reject) => {
        const intervalTime = 200;
        const maxAttempts = timeout / intervalTime;
        let attempts = 0;

        const intervalId = setInterval(() => {
            attempts++;
            const element = getElementByXPath(xpath);

            if (element && isElementVisible(element)) {
                clearInterval(intervalId);
                resolve(element);
            } else if (attempts >= maxAttempts) {
                clearInterval(intervalId);
                reject(new Error(`Element with XPath "${xpath}" not found within ${timeout}ms.`));
            }
        }, intervalTime);
    });
}

function isElementVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function isDateInRange(actualDateStr, startDateStr, endDateStr) {
    try {
        const actualDate = new Date(actualDateStr);
        // Set hours to 0 to compare dates only
        actualDate.setHours(0, 0, 0, 0);

        const startDate = new Date(startDateStr);
        startDate.setHours(0, 0, 0, 0);

        if (isNaN(actualDate.getTime()) || isNaN(startDate.getTime())) return false;

        // If no end date, check for an exact match with the start date.
        if (!endDateStr) {
            return actualDate.getTime() === startDate.getTime();
        }

        const endDate = new Date(endDateStr);
        endDate.setHours(0, 0, 0, 0);
        if (isNaN(endDate.getTime())) return false;

        return actualDate >= startDate && actualDate <= endDate;
    } catch (e) {
        logToPopup(`Error parsing dates: ${e.message}`, 'error');
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

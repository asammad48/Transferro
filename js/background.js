/**
 * @fileoverview This is the background service worker for the extension.
 * It acts as the central controller for the automation process, managing state,
 * listening to events, and coordinating actions between the popup and content scripts.
 * It is designed to be event-driven and stateless where possible.
 */

// Phase 5 & 7: Background Script Logic
console.log('Background service worker started.');

/**
 * In-memory storage for the tab ID of the new ride page.
 * This is stored temporarily to ensure that the final "accept" command is sent
 * to the correct, user-initiated tab, preventing mis-clicks on other tabs.
 * It is reset after the flow is complete or fails.
 */
let newRideTabId = null;

/**
 * Main message listener for all communications from other parts of the extension.
 * It acts as a router, delegating tasks based on the 'action' property of the message.
 * This is the primary way the background script receives commands.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    // This action is triggered by the user clicking "Proceed" in the popup.
    case 'startBooking':
      console.log('Action: startBooking');
      handleStartBooking(sendResponse);
      return true; // Indicates that the response will be sent asynchronously.

    // This action is sent from the content script after it has successfully selected the vehicle.
    case 'phase9_readyToAccept':
      console.log('Action: phase9_readyToAccept');
      handleReadyToAccept(sender.tab.id, sendResponse);
      return true; // Indicates an asynchronous response.

    default:
      console.warn('Unknown message action received:', message.action);
      sendResponse({ status: 'error', message: 'Unknown action' });
      break;
  }
  return false; // No async response for synchronous actions.
});

/**
 * Handles the initial 'startBooking' request from the popup.
 * It retrieves user settings and injects the content script into the active tab.
 * This is the start of the automation flow.
 */
function handleStartBooking(sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      console.error('No active tab found.');
      sendResponse({ status: 'error', message: 'No active tab.' });
      return;
    }
    const activeTabId = tabs[0].id;

    chrome.storage.local.get(['date', 'dateTolerance', 'vehicleClass'], (settings) => {
      if (!settings.date || !settings.vehicleClass) {
        console.error('Required settings (date, vehicleClass) not found in storage.');
        sendResponse({ status: 'error', message: 'Missing settings.' });
        return;
      }

      // Inject the content script and command it to start the booking process (Phase 6).
      injectAndSendMessage(activeTabId, 'js/content.js', {
        action: 'phase6_clickBooking',
        ...settings
      }, sendResponse);
    });
  });
}

/**
 * Handles the 'phase9_readyToAccept' message from the content script.
 * It checks if the final click is user-enabled before proceeding.
 * This is a critical safety check.
 */
function handleReadyToAccept(tabId, sendResponse) {
  // Security Check: Ensure the message is from the tab we are expecting.
  if (tabId !== newRideTabId) {
    console.error(`Received ready message from unexpected tab: ${tabId}. Expected: ${newRideTabId}`);
    sendResponse({ status: 'error', message: 'Mismatched tab ID' });
    return;
  }

  // Check the user's preference for the final click.
  chrome.storage.local.get(['finalClickEnabled'], (settings) => {
    if (settings.finalClickEnabled) {
      console.log('Final click is enabled. Sending acceptRide command.');
      // Send the final command (Phase 9) to the content script.
      chrome.tabs.sendMessage(newRideTabId, { action: 'phase9_acceptRide' });
      sendResponse({ status: 'proceeding' });
    } else {
      console.log('Final click is disabled by user setting. Automation will stop here.');
      sendResponse({ status: 'stopped_by_user_setting' });
    }
    // Reset the tracked tab ID as this part of the flow is complete.
    newRideTabId = null;
  });
}

/**
 * Phase 7: New Tab Handling.
 * Listens for tab updates to detect when the new ride booking tab has been opened and is ready.
 * This is crucial for transitioning the automation from the initial page to the confirmation page.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // We are interested only when the tab is fully loaded and has a URL matching the booking page.
  // This prevents injecting the script multiple times or on the wrong pages.
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('/new-ride/')) {
    console.log(`New ride tab detected and loaded: ${tabId}`);
    newRideTabId = tabId; // Temporarily store the tab ID for this flow.

    chrome.storage.local.get(['vehicleClass'], (settings) => {
      if (!settings.vehicleClass) {
        console.error('Vehicle class not found in storage for new ride tab.');
        return;
      }

      // Inject the content script into the new tab and command it to select the vehicle (Phase 8).
      injectAndSendMessage(newRideTabId, 'js/content.js', {
        action: 'phase8_selectVehicle',
        vehicleClass: settings.vehicleClass
      });
    });
  }
});

/**
 * Helper function to inject a script into a tab and then send it a message.
 * This abstracts the two-step process of injection and communication.
 */
function injectAndSendMessage(tabId, scriptFile, message, callback) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: [scriptFile]
  }).then(() => {
    console.log(`Successfully injected ${scriptFile} into tab ${tabId}.`);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError.message);
        if (callback) callback({ status: 'error', message: chrome.runtime.lastError.message });
      } else {
        console.log('Message sent successfully, response:', response);
        if (callback) callback({ status: 'success', response });
      }
    });
  }).catch(err => {
    console.error(`Failed to inject script ${scriptFile} into tab ${tabId}:`, err);
    if (callback) callback({ status: 'error', message: err.message });
  });
}

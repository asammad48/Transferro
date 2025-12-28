/**
 * @fileoverview Service worker for the booking automation extension.
 * Manages the automation state machine, user settings, and communication
 * between the popup, content scripts, and the Chrome Extension API.
 */

// =================================================================
// STATE MANAGEMENT & SAFETY
// =================================================================

// In-memory state variables. These are reset if the service worker is terminated.
let automationInProgress = false;
let activeTabId = null;
let currentConfig = {};

// Persist the automation state to handle service worker termination
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ automation_in_progress: false });
});


/**
 * Logs a message to the popup and the service worker console.
 * @param {string} text The message to log.
 * @param {'info' | 'error' | 'success'} level The log level.
 */
function log(text, level = 'info') {
    console.log(`[LOG] ${level.toUpperCase()}: ${text}`);
    chrome.runtime.sendMessage({ type: 'log', text, level }).catch(err => console.log('Popup not open.'));
}

/**
 * Resets the automation state, enabling the user to start a new run.
 * @param {string} reason The reason for resetting the state.
 * @param {'info' | 'error' | 'success'} level The log level for the final message.
 */
function resetState(reason, level = 'info') {
    automationInProgress = false;
    activeTabId = null;
    chrome.storage.local.set({ automation_in_progress: false });

    // Notify the popup that the process has finished
    const messageType = level === 'error' ? 'automation_aborted' : 'automation_finished';
    chrome.runtime.sendMessage({ type: messageType }).catch(err => {});

    log(reason, level);
}

// =================================================================
// MESSAGE HANDLING
// =================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Message from Popup ---
    if (message.action === 'startAutomation') {
        if (automationInProgress) {
            log('An automation process is already running.', 'error');
            sendResponse({ status: 'error', message: 'Automation already in progress.' });
            return;
        }

        // Find the active tab in the current window.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                return sendResponse({ status: 'error', message: 'No active tab found.' });
            }
            const activeTab = tabs[0];
            activeTabId = activeTab.id;

            // CRITICAL SAFETY CHECK: Verify the tab URL against the allow-listed domain before injecting.
            chrome.storage.sync.get('options', (data) => {
                const domain = data.options?.allowListedDomain;
                if (!domain || !activeTab.url || !activeTab.url.includes(domain)) {
                    log(`Injection failed. Tab URL "${activeTab.url}" does not match allow-listed domain "${domain}".`, 'error');
                    return sendResponse({ status: 'error', message: 'Current tab is not on the allow-listed domain.' });
                }

                log(`Injecting content script into tab ${activeTabId} on domain ${domain}.`, 'info');

                // Inject the content script into the active tab.
                chrome.scripting.executeScript({
                    target: { tabId: activeTabId },
                    files: ['js/content.js']
                }).then(() => {
                    log('Initial content script injected successfully.', 'info');

                    // Now that the script is injected, we can start the automation.
                    automationInProgress = true;
                    currentConfig = message.config;
                    chrome.storage.local.set({ automation_in_progress: true });
                    sendResponse({ status: 'success' });

                    // Initiate Phase 6
                    executePhase6();

                }).catch(err => {
                    log(`Failed to inject initial script: ${err.message}`, 'error');
                    sendResponse({ status: 'error', message: 'Failed to inject script into the page.' });
                });
            });
        });
        return true; // Indicates async response
    }

    if (message.action === 'abortAutomation') {
        if (!automationInProgress) {
            sendResponse({ status: 'error', message: 'No automation to abort.' });
            return;
        }
        resetState('Automation aborted by user.', 'info');
        sendResponse({ status: 'success' });
    }

    // --- Message from Content Script ---
    // This message is sent after a successful vehicle selection (Phase 8).
    if (message.action === 'phase9_readyToAccept') {
        if (!automationInProgress || sender.tab.id !== activeTabId) return; // Safety check
        executePhase9();
    }
});


// =================================================================
// AUTOMATION PHASES
// =================================================================

function executePhase6() {
    if (!automationInProgress || !currentConfig.enabledPhases[6]) {
        return resetState(currentConfig.enabledPhases[6] ? 'State error in P6.' : 'Phase 6 disabled.', 'info');
    }

    log('Executing Phase 6: Finding and clicking booking...', 'info');

    if (currentConfig.isDryRun) {
        log('[Dry Run] Would click the booking button.', 'info');
        // In a dry run, we simulate success to proceed to the next step logic
        return executePhase8();
    }

    sendMessageToContentScript(activeTabId, {
        action: 'phase6_clickBooking',
        ...currentConfig
    }, (response) => {
        if (response && response.status === 'success') {
            log('Phase 6 successful.', 'success');
            // Phase 8 will be triggered by the new tab listener.
        } else {
            resetState(response ? response.message : 'Phase 6 failed.', 'error');
        }
    });
}

function executePhase8() {
    if (!automationInProgress || !currentConfig.enabledPhases[8]) {
        return resetState(currentConfig.enabledPhases[8] ? 'State error in P8.' : 'Phase 8 disabled.', 'info');
    }

    log('Executing Phase 8: Selecting vehicle...', 'info');

    if (currentConfig.isDryRun) {
        log(`[Dry Run] Would select vehicle: ${currentConfig.vehicleClass}.`, 'info');
        return executePhase9(); // Simulate success
    }

    sendMessageToContentScript(activeTabId, {
        action: 'phase8_selectVehicle',
        vehicleClass: currentConfig.vehicleClass
    }, (response) => {
        if (!response || response.status !== 'success') {
            resetState(response ? response.message : 'Phase 8 failed.', 'error');
        }
        // Success is handled by the 'phase9_readyToAccept' message listener
    });
}

function executePhase9() {
    if (!automationInProgress || !currentConfig.enabledPhases[9]) {
        return resetState(currentConfig.enabledPhases[9] ? 'State error in P9.' : 'Phase 9 disabled. Automation complete.', 'success');
    }

    log('Executing Phase 9: Clicking final confirmation...', 'info');

    if (currentConfig.isDryRun) {
        log('[Dry Run] Would click the final "Accept" button.', 'info');
        return resetState('Dry run complete.', 'success');
    }

    sendMessageToContentScript(activeTabId, { action: 'phase9_acceptRide' }, (response) => {
        if (response && response.status === 'success') {
            resetState('Automation complete!', 'success');
        } else {
            resetState(response ? response.message : 'Phase 9 failed.', 'error');
        }
    });
}

// =================================================================
// TAB & NAVIGATION HANDLING
// =================================================================

// Listener for new tabs, specifically for handling the transition from P6 to P8.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only care about tabs that are fully loaded and match the allow-listed URL pattern.
    if (changeInfo.status !== 'complete' || !automationInProgress) {
        return;
    }

    // Load allow-listed domain from sync storage
    chrome.storage.sync.get('options', (data) => {
        const domain = data.options?.allowListedDomain;
        if (!domain) {
            // If no domain is set, we cannot proceed safely.
            if(activeTabId === tabId) resetState('Allow-listed domain not set in options. Aborting.', 'error');
            return;
        }

        // Check if the new tab's URL matches the pattern.
        // This is a critical safety check to ensure we only act on the intended page.
        const urlPattern = new RegExp(`^https?://${domain.replace('.', '\\.')}/new-ride/.*`);
        if (tab.url && tab.url.match(urlPattern)) {
            log(`New ride tab detected (ID: ${tabId}). Updating active tab ID.`, 'info');
            activeTabId = tabId; // Update the active tab ID to the new tab.

            // Inject the content script into the new tab programmatically
            chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['js/content.js']
            }).then(() => {
                log('Content script injected into new tab.', 'info');
                // Now that the script is injected, we can proceed with Phase 8.
                executePhase8();
            }).catch(err => {
                 resetState(`Failed to inject script into new tab: ${err.message}`, 'error');
            });
        }
    });
});

// Clean up state if the tracked tab is closed by the user.
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === activeTabId) {
        resetState('Tracked tab was closed by user.', 'info');
    }
});


// =================================================================
// UTILITY FUNCTIONS
// =================================================================

/**
 * Sends a message to a content script in a specific tab and handles the response.
 * @param {number} tabId The ID of the tab to send the message to.
 * @param {object} message The message object.
 * @param {(response: object) => void} callback The callback to handle the response.
 */
function sendMessageToContentScript(tabId, message, callback) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      log(`Error sending message to tab ${tabId}: ${chrome.runtime.lastError.message}`, 'error');
      if (callback) callback({ status: 'error', message: chrome.runtime.lastError.message });
      return;
    }
    if (callback) callback(response);
  });
}

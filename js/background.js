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
let refreshIntervalId = null;

// Persist the automation state to handle service worker termination
chrome.runtime.onStartup.addListener(() => {
  log('Browser startup detected. Ensuring automation state is reset.', 'info');
  chrome.storage.local.set({ automation_in_progress: false });
});

// Set default options on initial installation.
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.sync.get('options', (data) => {
            const currentOptions = data.options || {};
            if (!currentOptions.allowListedDomain) {
                const defaultOptions = {
                    ...currentOptions,
                    allowListedDomain: 'control.transfeero.com'
                };
                chrome.storage.sync.set({ options: defaultOptions }, () => {
                    console.log('Default allow-listed domain set on installation.');
                });
            }
        });
    }
});


/**
 * Logs a message to the popup and the service worker console.
 * @param {string} text The message to log.
 * @param {'info' | 'error' | 'success'} level The log level.
 */
function log(text, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, text, level };

    console.log(`[LOG] ${level.toUpperCase()}: ${text}`);

    // Save to persistent storage
    chrome.storage.local.get({ logHistory: [] }, (data) => {
        let history = data.logHistory;
        history.push(logEntry);
        // Keep the log at a reasonable size
        if (history.length > 100) {
            history = history.slice(history.length - 100);
        }
        chrome.storage.local.set({ logHistory: history });
    });

    // Send to popup if it's open
    chrome.runtime.sendMessage({ type: 'log', ...logEntry }).catch(err => {});
}

/**
 * Resets the automation state, enabling the user to start a new run.
 * @param {string} reason The reason for resetting the state.
 * @param {'info' | 'error' | 'success'} level The log level for the final message.
 */
function resetState(reason, level = 'info') {
    log(`Resetting state. Reason: ${reason}`, level);
    // --- Stop any ongoing refresh ---
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
        log('Auto-refresh stopped.', 'info');
    }

    const wasInProgress = automationInProgress; // Capture state before reset
    const lastTabId = activeTabId; // Capture tabId before reset

    automationInProgress = false;
    activeTabId = null;
    chrome.storage.local.set({ automation_in_progress: false });

    // Notify the popup that the process has finished
    const messageType = level === 'error' ? 'automation_aborted' : 'automation_finished';
    chrome.runtime.sendMessage({ type: messageType }).catch(err => {});

    if (level === 'error') {
        triggerFailureAlarm(reason);
    }

    log(reason, level);

    // --- Start new refresh if conditions are met ---
    // If the process was running and the auto-refresh toggle is on, reload the tab.
    // This effectively restarts the flow from the current page after success or failure.
    if (wasInProgress && currentConfig.autoRefresh && lastTabId) {
        log('Auto-refresh is enabled. Reloading tab to restart the process...', 'info');
        // A short delay can prevent race conditions where the tab reloads
        // before all state-reset operations are complete.
        setTimeout(() => {
            chrome.tabs.reload(lastTabId).catch(err => {
                log(`Failed to reload tab ${lastTabId}. It might have been closed.`, 'error');
            });
        }, 1000); // 1-second delay
    }
}

// =================================================================
// MESSAGE HANDLING
// =================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Message from Popup ---
    if (message.action === 'startAutomation') {
        // Clear any previous refresh interval when a new automation starts.
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
            log('Cleared previous auto-refresh schedule.', 'info');
        }

        log('Received startAutomation command from popup.', 'info');

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

                // 1. Check if the domain is configured at all.
                if (!domain) {
                    const errorMessage = 'Allow-listed domain not set. Please right-click the extension icon, go to Options, and set it.';
                    log(errorMessage, 'error');
                    return sendResponse({ status: 'error', message: errorMessage });
                }

                // 2. Check if the current tab's URL matches the configured domain.
                if (!activeTab.url || !activeTab.url.includes(domain)) {
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
        log('Received abortAutomation command from popup.', 'info');
        if (!automationInProgress && !refreshIntervalId) {
             log('No automation or refresh process is currently running to abort.', 'error');
             sendResponse({ status: 'error', message: 'No automation or refresh to abort.' });
             return;
        }
        resetState('Automation aborted by user.', 'info');
        sendResponse({ status: 'success' });
    }

    // --- Messages from Content Script ---
    if (message.type === 'content_script_log') {
        // Just forward the log to the popup.
        log(`[Content Script]: ${message.text}`, message.level);
    }

    if (message.type === 'log_url') {
        log(`[Content Script]: New tab URL received: ${message.url}`, 'info');
    }

    if (message.action === 'phase9_readyToAccept') {
        log('Content script is ready for Phase 9.', 'info');
        if (!automationInProgress || sender.tab.id !== activeTabId) {
            log('State mismatch for Phase 9 readiness. Aborting.', 'error');
            return;
        }
        executePhase9();
    }
});


// =================================================================
// AUTOMATION PHASES
// =================================================================

function executePhase6() {
    if (!automationInProgress) {
        return resetState('State error in P6.', 'info');
    }

    log('Executing Phase 6: Finding and clicking booking...', 'info');

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
    if (!automationInProgress) {
        return resetState('State error in P8.', 'info');
    }

    log('Executing Phase 8: Selecting vehicle...', 'info');

    sendMessageToContentScript(activeTabId, {
        action: 'phase8_selectVehicle',
        vehicleClasses: currentConfig.vehicleClasses
    }, (response) => {
        if (!response || response.status !== 'success') {
            resetState(response ? response.message : 'Phase 8 failed.', 'error');
        }
        // Success is handled by the 'phase9_readyToAccept' message listener
    });
}

function executePhase9() {
    if (!automationInProgress) {
        return resetState('State error in P9.', 'info');
    }

    log('Executing Phase 9: Clicking final confirmation...', 'info');

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
        if (changeInfo.status === 'complete') {
             // log(`Tab ${tabId} updated, but automation is not in progress. Ignoring.`, 'info');
        }
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
            log(`New ride tab detected (ID: ${tabId}). URL: ${tab.url}`, 'info');
            log(`Retaining automation state for new tab.`, 'info');
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
        log(`Active tab (ID: ${tabId}) was closed by the user. Resetting state.`, 'info');
        resetState('Tracked tab was closed by user.', 'info');
    }
});


// =================================================================
// ALARMS & NOTIFICATIONS
// =================================================================

/**
 * Creates a Chrome notification to alert the user of a critical failure.
 * @param {string} reason The reason for the failure, to be displayed in the notification.
 */
function triggerFailureAlarm(reason) {
    log('Triggering failure alarm notification.', 'info');
    chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Automation Process Failed',
        message: `The automation process stopped due to an error: ${reason}`,
        priority: 2
    });
}

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

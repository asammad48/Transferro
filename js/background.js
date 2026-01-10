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
let originalTabId = null; // To keep track of the initial tab
let retryCount = 0; // To prevent infinite retry loops
const MAX_RETRIES = 3; // Maximum number of retries for a failed step
let currentConfig = {};
let refreshIntervalId = null;

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
    log(`Resetting state. Reason: ${reason}`, 'info');
    // --- Stop any ongoing refresh ---
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
        log('Auto-refresh cycle stopped.', 'info');
    }

    const wasInProgress = automationInProgress; // Capture state before reset
    const lastTabId = activeTabId; // Capture tabId before reset
    log(`State before reset: InProgress=${wasInProgress}, ActiveTab=${lastTabId}, OriginalTab=${originalTabId}, RetryCount=${retryCount}`, 'info');

    automationInProgress = false;
    activeTabId = null;
    originalTabId = null;
    retryCount = 0;
    chrome.storage.local.set({ automation_in_progress: false });

    // Notify the popup that the process has finished
    const messageType = level === 'error' ? 'automation_aborted' : 'automation_finished';
    chrome.runtime.sendMessage({ type: messageType }).catch(err => {});

    log(reason, level);

    // --- Start new refresh if conditions are met ---
    if (wasInProgress && level === 'success' && currentConfig.autoRefresh && lastTabId) {
        log('Starting auto-refresh every 2 seconds.', 'info');
        refreshIntervalId = setInterval(() => {
            chrome.tabs.reload(lastTabId).catch(err => {
                log('Failed to reload tab. It might have been closed.', 'error');
                clearInterval(refreshIntervalId);
                refreshIntervalId = null;
            });
        }, 2000);
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
                log('No active tab found to start automation.', 'error');
                return sendResponse({ status: 'error', message: 'No active tab found.' });
            }
            const activeTab = tabs[0];
            activeTabId = activeTab.id;
            originalTabId = activeTab.id; // Set the original tab ID
            retryCount = 0; // Reset retry count for a new automation run

            log(`Automation initiated. Original Tab ID: ${originalTabId}, Active Tab ID: ${activeTabId}`, 'info');
            log(`Configuration received: ${JSON.stringify(message.config)}`, 'info');

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
        if (!automationInProgress && !refreshIntervalId) {
             sendResponse({ status: 'error', message: 'No automation or refresh to abort.' });
             return;
        }
        resetState('Automation aborted by user.', 'info');
        log('Automation aborted by user.');
        sendResponse({ status: 'success' });
    }

    // --- Messages from Content Script ---
    if (message.type === 'content_script_log') {
        // Just forward the log to the popup.
        log(message.text, message.level);
    }

    if (message.type === 'log_url') {
        log(`New tab URL received: ${message.url}`, 'info');
    }

    if (message.action === 'phase9_readyToAccept') {
        if (!automationInProgress || sender.tab.id !== activeTabId) return;
        executePhase9();
    }
});


// =================================================================
// AUTOMATION PHASES
// =================================================================

let phaseToRetry = null; // State to manage retries after a tab refresh

/**
 * Handles a failure in an automation phase by logging, retrying, or aborting.
 * @param {string} failedPhase The name of the phase that failed (e.g., 'Phase 6').
 * @param {string} errorMessage The error message from the failed phase.
 */
function handleFailure(failedPhase, errorMessage) {
    log(`Failure in ${failedPhase}: ${errorMessage}. Retry count: ${retryCount}`, 'error');

    // --- Trigger Alarm ---
    const notificationId = `automation-failure-${Date.now()}`;
    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: '../icons/icon128.png',
        title: 'Automation Alert',
        message: `An error occurred during ${failedPhase}. The process will be retried. Error: ${errorMessage}`
    });


    if (retryCount >= MAX_RETRIES) {
        resetState(`Max retries reached for ${failedPhase}. Aborting automation.`, 'error');
        return;
    }

    retryCount++;
    log(`Retrying ${failedPhase}. Attempt ${retryCount} of ${MAX_RETRIES}.`, 'info');

    // Phase 6 starts on the original tab, subsequent phases are on the active (new) tab.
    const tabIdToReload = (failedPhase === 'Phase 6') ? originalTabId : activeTabId;
    phaseToRetry = failedPhase; // Set the phase to be re-run after the reload

    chrome.tabs.get(tabIdToReload, (tab) => {
        if (chrome.runtime.lastError || !tab) {
            resetState(`Tab to reload (ID: ${tabIdToReload}) not found. Aborting.`, 'error');
            return;
        }
        log(`Reloading Tab ID: ${tabIdToReload} to retry ${failedPhase}.`, 'info');
        chrome.tabs.reload(tabIdToReload);
    });
}


function executePhase6() {
    if (!automationInProgress) {
        log('Attempted to execute Phase 6, but automation is not in progress. Aborting.', 'info');
        return;
    }

    log(`Executing Phase 6: Finding and clicking booking in Tab ID: ${activeTabId}`, 'info');

    sendMessageToContentScript(activeTabId, {
        action: 'phase6_clickBooking',
        ...currentConfig
    }, (response) => {
        if (response && response.status === 'success') {
            log('Phase 6 successful.', 'success');
            retryCount = 0; // Reset retry count on success
            // Phase 8 will be triggered by the new tab listener.
        } else {
            handleFailure('Phase 6', response ? response.message : 'No response');
        }
    });
}

function executePhase8() {
    if (!automationInProgress) {
        log('Attempted to execute Phase 8, but automation is not in progress. Aborting.', 'info');
        return;
    }

    log(`Executing Phase 8: Selecting vehicle in Tab ID: ${activeTabId}`, 'info');

    sendMessageToContentScript(activeTabId, {
        action: 'phase8_selectVehicle',
        vehicleClasses: currentConfig.vehicleClasses
    }, (response) => {
        if (response && response.status === 'success') {
            log('Phase 8 successful, vehicle selected.', 'success');
            retryCount = 0; // Reset retry count on success
            // Success continues via the 'phase9_readyToAccept' message listener
        } else {
            handleFailure('Phase 8', response ? response.message : 'No response');
        }
    });
}

function executePhase9() {
    if (!automationInProgress) {
        log('Attempted to execute Phase 9, but automation is not in progress. Aborting.', 'info');
        return;
    }

    log(`Executing Phase 9: Clicking final confirmation in Tab ID: ${activeTabId}`, 'info');

    sendMessageToContentScript(activeTabId, { action: 'phase9_acceptRide' }, (response) => {
        if (response && response.status === 'success') {
            log('Phase 9 successful, ride accepted.', 'success');
            resetState('Automation complete!', 'success');
        } else {
            handleFailure('Phase 9', response ? response.message : 'No response');
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
    log(`onUpdated event fired for Tab ID: ${tabId}. Status: ${changeInfo.status}, URL: ${tab.url}`, 'info');

    // --- Handle Retries ---
    if (phaseToRetry) {
        const expectedTabId = (phaseToRetry === 'Phase 6') ? originalTabId : activeTabId;
        if (tabId === expectedTabId) {
            log(`Tab ${tabId} reloaded, re-executing ${phaseToRetry}.`, 'info');
            const phase = phaseToRetry;
            phaseToRetry = null; // Clear the retry state

            // Re-inject content script before executing the phase
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['js/content.js']
            }).then(() => {
                log(`Content script re-injected into Tab ID: ${tabId} for retry.`, 'info');
                if (phase === 'Phase 6') executePhase6();
                else if (phase === 'Phase 8') executePhase8();
                else if (phase === 'Phase 9') executePhase9();
            }).catch(err => {
                 resetState(`Failed to re-inject script for retry into tab ${tabId}: ${err.message}`, 'error');
            });
            return; // Stop further processing to avoid conflicts
        }
    }


    // Load allow-listed domain from sync storage
    chrome.storage.sync.get('options', (data) => {
        const domain = data.options?.allowListedDomain;
        if (!domain) {
            // If no domain is set, we cannot proceed safely.
            if(activeTabId === tabId) resetState('Allow-listed domain not set in options. Aborting.', 'error');
            return;
        }

        // Check if the new tab's URL matches the pattern for transition from Phase 6 to 8.
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
    log(`onRemoved event fired for Tab ID: ${tabId}. Is tracked tab: ${tabId === activeTabId}`, 'info');
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

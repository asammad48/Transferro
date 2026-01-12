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
let baseTabId = null; // Persistently tracks the initial tab
let currentConfig = {};
// Use a timeout ID for the refresh loop, not an interval ID
let refreshTimeoutId = null;

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
 * @param {object} [options={}] Additional options for resetting state.
 * @param {boolean} [options.allowRefresh=true] Whether to allow a new refresh cycle to start.
 */
function resetState(reason, level = 'info', options = {}) {
    const { allowRefresh = true } = options;

    log(`Resetting state. Reason: ${reason}`, level);
    if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;
        log('Auto-refresh timer cleared.', 'info');
    }

    const wasInProgress = automationInProgress;
    automationInProgress = false;
    activeTabId = null;
    chrome.storage.local.set({ automation_in_progress: false });

    const messageType = level === 'error' ? 'automation_aborted' : 'automation_finished';
    chrome.runtime.sendMessage({ type: messageType }).catch(err => {});

    if (level === 'error') {
        triggerFailureAlarm(reason);
    }

    log(reason, level);

    // --- Start new refresh if conditions are met ---
    if (allowRefresh && wasInProgress && currentConfig.autoRefresh && baseTabId) {
        log('Auto-refresh is enabled. Starting continuous refresh loop.', 'info');
        scheduleNextRefresh(baseTabId);
    } else {
        // If no refresh is scheduled, clean up the base tab ID.
        baseTabId = null;
    }
}

// =================================================================
// MESSAGE HANDLING
// =================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Message from Popup ---
    if (message.action === 'startAutomation') {
        // Clear any previous refresh interval when a new automation starts.
        if (refreshTimeoutId) {
            clearTimeout(refreshTimeoutId);
            refreshTimeoutId = null;
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
            baseTabId = activeTab.id; // Store the initial tab ID

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
        if (!automationInProgress && !refreshTimeoutId) {
            log('No automation or refresh process is currently running to abort.', 'error');
            return sendResponse({ status: 'error', message: 'No automation or refresh to abort.' });
        }
        // When the user aborts, prevent the refresh cycle from starting again.
        resetState('Automation aborted by user.', 'info', { allowRefresh: false });
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

    // The 'phase9_readyToAccept' message is no longer needed, as Phase 8
    // now directly calls Phase 9 upon completion.
});


// =================================================================
// AUTOMATION PHASES
// =================================================================

function executePhase6() {
    if (!automationInProgress) {
        return resetState('State error in P6.', 'info');
    }

    log('Waiting 2 seconds before starting Phase 6...', 'info');

    setTimeout(() => {
        // Re-check state in case the user aborted during the delay
        if (!automationInProgress) {
            log('Automation aborted during Phase 6 delay.', 'info');
            return;
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
    }, 2000);
}

/**
 * Executes the vehicle selection logic with a callback to handle success or failure.
 * @param {(success: boolean, message: string) => void} callback The callback function.
 */
function executePhase8(callback) {
    if (!automationInProgress) {
        // If automation was aborted, do nothing.
        return;
    }
    log('Executing Phase 8: Selecting vehicle via secure script execution...', 'info');

    const selectVehicleInPage = (vehicleClasses) => {
        try {
            const $select = $('#vehicle');
            if (!$select.length) throw new Error('Vehicle select dropdown (#vehicle) not found.');
            $select.select2('open');
            let matchFound = false;
            for (const targetText of vehicleClasses) {
                const option = $select.find('option:not(:disabled)').filter(function() { return $(this).text().includes(targetText); }).first();
                if (option.length) {
                    $select.val(option.val()).trigger('change');
                    matchFound = true;
                    break;
                }
            }
            $select.select2('close');
            if (matchFound) return { status: 'success', message: 'Vehicle selected successfully.' };
            throw new Error('No available vehicle found for any of the desired classes.');
        } catch (error) {
            return { status: 'error', message: error.toString() };
        }
    };

    chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        world: 'MAIN',
        func: selectVehicleInPage,
        args: [currentConfig.phase8VehicleClasses]
    }, (injectionResults) => {
        if (chrome.runtime.lastError) {
            callback(false, `Phase 8 injection failed: ${chrome.runtime.lastError.message}`);
            return;
        }

        const result = injectionResults[0].result;
        if (result && result.status === 'success') {
            log('Phase 8 successful: Vehicle selected.', 'success');
            callback(true, result.message);
        } else {
            callback(false, result ? result.message : 'Phase 8 failed with an unknown error.');
        }
    });
}

function executePhase9() {
    if (!automationInProgress) {
        return resetState('State error in P9.', 'info');
    }

    // Announce the action before performing it.
    chrome.tts.speak('Ride is being accepted');

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

// Listener for new tabs, with retry logic for Phase 8.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !automationInProgress) {
        return;
    }

    chrome.storage.sync.get('options', (data) => {
        const domain = data.options?.allowListedDomain;
        if (!domain) {
            if (activeTabId === tabId) resetState('Allow-listed domain not set. Aborting.', 'error');
            return;
        }

        const urlPattern = new RegExp(`^https?://${domain.replace('.', '\\.')}/new-ride/.*`);
        if (tab.url && tab.url.match(urlPattern)) {
            log(`New ride tab detected (ID: ${tabId}). URL: ${tab.url}`, 'info');
            activeTabId = tabId;

            log('Waiting 2 seconds before starting Phase 8...', 'info');
            setTimeout(() => {
                if (!automationInProgress) {
                    log('Automation aborted during Phase 8 delay.', 'info');
                    return;
                }

                // Inject the content script *once* before starting the retry loop.
                chrome.scripting.executeScript({
                    target: { tabId: activeTabId },
                    files: ['js/content.js']
                }).then(() => {
                    log('Content script injected. Starting Phase 8 retry loop.', 'info');
                    attemptPhase8WithRetries(3); // Start the retry process with 3 attempts.
                }).catch(err => {
                    resetState(`Failed to inject script for Phase 8: ${err.message}`, 'error');
                });

            }, 2000);
        }
    });
});


/**
 * Attempts to execute Phase 8 and retries on failure.
 * @param {number} attemptsLeft The number of remaining attempts.
 */
function attemptPhase8WithRetries(attemptsLeft) {
    if (!automationInProgress) {
        log('Aborting Phase 8 retry loop.', 'info');
        return;
    }

    if (attemptsLeft <= 0) {
        log('Phase 8 failed after all retries. Restarting the process.', 'error');
        // The tab is no longer closed. The process will restart, eventually refreshing the base tab.
        resetState('Phase 8 failed permanently.', 'error');
        return;
    }

    log(`Attempting Phase 8. Attempts left: ${attemptsLeft}`, 'info');
    executePhase8((success, message) => {
        if (success) {
            // On success, proceed to the final phase.
            executePhase9();
        } else {
            // On failure, log the error and schedule a retry.
            log(`Phase 8 attempt failed: ${message}. Retrying in 4 seconds...`, 'error');
            setTimeout(() => {
                attemptPhase8WithRetries(attemptsLeft - 1);
            }, 4000);
        }
    });
}

// Clean up state if the tracked tab is closed by the user.
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === activeTabId) {
        log(`Active tab (ID: ${tabId}) was closed by the user. Resetting state.`, 'info');
        resetState('Tracked tab was closed by user.', 'info');
    }
});


// =================================================================
// AUTO-REFRESH LOGIC
// =================================================================

/**
 * Schedules the next tab refresh with a random delay.
 * This creates a continuous, randomized loop.
 * @param {number} tabId The ID of the tab to be refreshed.
 */
function scheduleNextRefresh(tabId) {
    // --- Clear any existing scheduled refresh ---
    if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId);
    }

    // --- Calculate random interval ---
    const minSeconds = 7;
    const maxSeconds = 30;
    const randomInterval = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) * 1000;
    log(`Next refresh scheduled in ${randomInterval / 1000} seconds.`, 'info');

    // --- Schedule the reload ---
    refreshTimeoutId = setTimeout(() => {
        log(`Reloading tab ${tabId} as part of the auto-refresh cycle.`, 'info');
        chrome.tabs.reload(tabId, () => {
            if (chrome.runtime.lastError) {
                log(`Failed to reload tab ${tabId}: ${chrome.runtime.lastError.message}. Stopping refresh cycle.`, 'error');
                return resetState('Auto-refresh tab could not be accessed.', 'error');
            }

            // After reloading, we need to wait for the tab to be fully loaded before starting the process.
            chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    // Remove this listener to avoid it firing multiple times.
                    chrome.tabs.onUpdated.removeListener(listener);

                    log('Tab reloaded. Re-injecting content script and starting automation.', 'info');

                    // Set the state to "in progress" *before* starting.
                    automationInProgress = true;
                    activeTabId = tabId;
                    baseTabId = tabId;
                    chrome.storage.local.set({ automation_in_progress: true });

                    // Re-inject the content script into the reloaded tab.
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['js/content.js']
                    }).then(() => {
                        log('Content script re-injected successfully after refresh.', 'info');
                        // Restart the entire automation flow from the beginning.
                        executePhase6();
                    }).catch(err => {
                        resetState(`Failed to re-inject script after refresh: ${err.message}`, 'error');
                    });
                }
            });
        });
    }, randomInterval);
}


// =================================================================
// ALARMS & NOTIFICATIONS
// =================================================================

/**
 * Triggers an audible alarm and a visual notification for critical failures.
 * @param {string} reason The reason for the failure.
 */
function triggerFailureAlarm(reason) {
    const alarmMessage = `Automation failed: ${reason}`;
    log('Triggering failure alarm.', 'info');

    // Audible alarm using Text-to-Speech
    chrome.tts.speak(alarmMessage, {
        'rate': 1.0, // Normal speaking rate
        'onEvent': function(event) {
            if (event.type === 'error') {
                log(`TTS Error: ${event.errorMessage}`, 'error');
            }
        }
    });

    // Visual notification as a fallback
    chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Automation Process Failed',
        message: alarmMessage,
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

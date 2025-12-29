/**
 * @fileoverview Logic for the extension's popup UI (popup.html).
 * Handles user input, communicates with the background script, and displays logs.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const startDate = document.getElementById('start-date');
    const endDate = document.getElementById('end-date');
    const vehicleClass = document.getElementById('vehicle-class');
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    const proceedButton = document.getElementById('proceed-button');
    const abortButton = document.getElementById('abort-button');
    const clearLogButton = document.getElementById('clear-log-button');
    const logPanel = document.getElementById('log-panel');

    const ALL_INPUTS = [startDate, endDate, vehicleClass, autoRefreshToggle];

    // --- State Management ---

    /**
     * Logs a message to the popup's log panel.
     * @param {string} text The message to display.
     * @param {string} level The log level ('info', 'error', 'success').
     * @param {string} timestamp The timestamp of the log.
     */
    const logMessage = (text, level, timestamp) => {
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${timestamp}] ${text}`;
        logEntry.style.color = level === 'error' ? '#f44336' : (level === 'success' ? '#4CAF50' : 'black');
        logPanel.appendChild(logEntry);
        logPanel.scrollTop = logPanel.scrollHeight; // Auto-scroll to bottom
    };

    /**
     * Saves the current state of all UI inputs to local storage.
     */
    const saveSettings = () => {
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);
        const settings = {
            startDate: startDate.value,
            endDate: endDate.value,
            vehicleClass: selectedVehicles,
            autoRefresh: autoRefreshToggle.checked,
        };
        chrome.storage.local.set({ settings });
        console.log('Settings saved.');
    };

    /**
     * Loads settings from local storage and populates the UI.
     */
    const loadSettings = () => {
        chrome.storage.local.get('settings', (data) => {
            if (data.settings) {
                startDate.value = data.settings.startDate || '';
                endDate.value = data.settings.endDate || '';
                const selectedVehicles = data.settings.vehicleClass || [];
                Array.from(vehicleClass.options).forEach(option => {
                    option.selected = selectedVehicles.includes(option.value);
                });
                autoRefreshToggle.checked = data.settings.autoRefresh === true;
                console.log('Settings loaded.');
            }
        });

        // Also load the last known state of the automation
        chrome.storage.local.get('automation_in_progress', (data) => {
            if (data.automation_in_progress) {
                proceedButton.disabled = true;
            }
        });
    };

    /**
     * Loads the entire log history from storage and displays it.
     */
    const loadLogHistory = () => {
        logPanel.innerHTML = ''; // Clear existing logs
        chrome.storage.local.get({ logHistory: [] }, (data) => {
            for (const entry of data.logHistory) {
                logMessage(entry.text, entry.level, entry.timestamp);
            }
        });
    };

    // --- Event Listeners ---

    // Save settings whenever any input changes
    ALL_INPUTS.forEach(input => {
        input.addEventListener('change', saveSettings);
    });

    // "Proceed" button initiates the automation
    proceedButton.addEventListener('click', () => {
        // Basic validation
        if (!startDate.value) {
            logMessage('Error: Start Date is required.', 'error', new Date().toLocaleTimeString());
            return;
        }
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);
        if (selectedVehicles.length === 0) {
            logMessage('Error: At least one Vehicle Class must be selected.', 'error', new Date().toLocaleTimeString());
            return;
        }

        const config = {
            startDate: startDate.value,
            endDate: endDate.value,
            vehicleClasses: selectedVehicles,
            isDryRun: false,
            enabledPhases: { 6: true, 8: true, 9: true },
            autoRefresh: autoRefreshToggle.checked
        };

        // Send configuration to background script to start the process
        chrome.runtime.sendMessage({ action: 'startAutomation', config }, (response) => {
            if (response && response.status === 'success') {
                // The background script will now log this
            } else {
                logMessage(response ? response.message : 'Failed to start. Is the correct tab open?', 'error', new Date().toLocaleTimeString());
            }
        });
    });

    // "Abort" button stops the automation
    abortButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'abortAutomation' });
    });

    // "Clear Log" button
    clearLogButton.addEventListener('click', () => {
        chrome.storage.local.set({ logHistory: [] }, () => {
            logPanel.innerHTML = '';
            logMessage('Log cleared.', 'info', new Date().toLocaleTimeString());
        });
    });

    // Listen for messages (like logs) from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'log') {
            logMessage(message.text, message.level, message.timestamp);
        }
        if (message.type === 'automation_finished' || message.type === 'automation_aborted') {
            proceedButton.disabled = false;
        }
    });

    // --- Initialization ---
    loadSettings();
    loadLogHistory();
});

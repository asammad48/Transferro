/**
 * @fileoverview Logic for the extension's popup UI (popup.html).
 * Handles user input, communicates with the background script, and displays logs.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const startDate = document.getElementById('start-date');
    const endDate = document.getElementById('end-date');
    const vehicleClass = document.getElementById('vehicle-class');
    const dryRunToggle = document.getElementById('dry-run-toggle');
    const phase6Toggle = document.getElementById('enable-phase6-toggle');
    const phase8Toggle = document.getElementById('enable-phase8-toggle');
    const phase9Toggle = document.getElementById('enable-phase9-toggle');
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    const proceedButton = document.getElementById('proceed-button');
    const abortButton = document.getElementById('abort-button');
    const logPanel = document.getElementById('log-panel');

    const ALL_INPUTS = [startDate, endDate, vehicleClass, dryRunToggle, phase6Toggle, phase8Toggle, phase9Toggle, autoRefreshToggle];

    // --- State Management ---

    /**
     * Logs a message to the popup's log panel.
     * @param {string} message The message to display.
     * @param {string} [level='info'] The log level ('info', 'error', 'success').
     */
    const logMessage = (message, level = 'info') => {
        const logEntry = document.createElement('div');
        const timestamp = new Date().toLocaleTimeString();
        logEntry.textContent = `[${timestamp}] ${message}`;
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
            isDryRun: dryRunToggle.checked,
            isPhase6Enabled: phase6Toggle.checked,
            isPhase8Enabled: phase8Toggle.checked,
            isPhase9Enabled: phase9Toggle.checked,
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
                dryRunToggle.checked = data.settings.isDryRun !== false; // Default true
                phase6Toggle.checked = data.settings.isPhase6Enabled === true;
                phase8Toggle.checked = data.settings.isPhase8Enabled === true;
                phase9Toggle.checked = data.settings.isPhase9Enabled === true;
                autoRefreshToggle.checked = data.settings.autoRefresh === true;
                console.log('Settings loaded.');
            }
        });

        // Also load the last known state of the automation
        chrome.storage.local.get('automation_in_progress', (data) => {
            if (data.automation_in_progress) {
                proceedButton.disabled = true;
                logMessage('Automation is currently in progress.');
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
            logMessage('Error: Start Date is required.', 'error');
            return;
        }
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);
        if (selectedVehicles.length === 0) {
            logMessage('Error: At least one Vehicle Class must be selected.', 'error');
            return;
        }

        const config = {
            startDate: startDate.value,
            endDate: endDate.value,
            vehicleClasses: selectedVehicles,
            isDryRun: dryRunToggle.checked,
            enabledPhases: {
                6: phase6Toggle.checked,
                8: phase8Toggle.checked,
                9: phase9Toggle.checked,
            },
            autoRefresh: autoRefreshToggle.checked
        };

        // Send configuration to background script to start the process
        chrome.runtime.sendMessage({ action: 'startAutomation', config }, (response) => {
            if (response && response.status === 'success') {
                logMessage('Automation process initiated.', 'success');
                proceedButton.disabled = true; // One-run-per-click protection
            } else {
                logMessage(response ? response.message : 'Failed to start. Is the correct tab open?', 'error');
            }
        });
    });

    // "Abort" button stops the automation
    abortButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'abortAutomation' }, (response) => {
             if (response && response.status === 'success') {
                logMessage('Abort signal sent.', 'info');
                proceedButton.disabled = false;
            } else {
                 logMessage('Failed to send abort signal.', 'error');
            }
        });
    });

    // Listen for messages (like logs) from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'log') {
            logMessage(message.text, message.level);
        }
        // Re-enable the proceed button if the process is finished or aborted
        if (message.type === 'automation_finished' || message.type === 'automation_aborted') {
            proceedButton.disabled = false;
        }
    });

    // --- Initialization ---
    loadSettings();
});

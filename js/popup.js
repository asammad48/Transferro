/**
 * @fileoverview Logic for the extension's popup UI (popup.html).
 * Handles user input, communicates with the background script, and displays logs.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const startDate = document.getElementById('start-date');
    const endDate = document.getElementById('end-date');
    const vehicleClass = document.getElementById('vehicle-class');
    const priceInputsContainer = document.getElementById('price-inputs-container');
    const phase8VehicleClass = document.getElementById('phase8-vehicle-class');
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    const proceedButton = document.getElementById('proceed-button');
    const abortButton = document.getElementById('abort-button');
    const clearLogButton = document.getElementById('clear-log-button');
    const logPanel = document.getElementById('log-panel');

    const ALL_INPUTS = [startDate, endDate, vehicleClass, phase8VehicleClass, autoRefreshToggle];

    // --- State Management ---

    const logMessage = (text, level, timestamp) => {
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${timestamp}] ${text}`;
        logEntry.style.color = level === 'error' ? '#f44336' : (level === 'success' ? '#4CAF50' : 'black');
        logPanel.appendChild(logEntry);
        logPanel.scrollTop = logPanel.scrollHeight;
    };

    const saveSettings = () => {
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);
        const vehiclePrices = {};
        selectedVehicles.forEach(vehicle => {
            const priceInput = document.getElementById(`price-${vehicle.replace(/\s+/g, '-')}`);
            if (priceInput) {
                vehiclePrices[vehicle] = priceInput.value;
            }
        });

        const settings = {
            startDate: startDate.value,
            endDate: endDate.value,
            vehicleClass: selectedVehicles,
            vehiclePrices: vehiclePrices, // Save prices
            phase8VehicleClass: Array.from(phase8VehicleClass.selectedOptions).map(option => option.value),
            autoRefresh: autoRefreshToggle.checked,
        };
        chrome.storage.local.set({ settings });
    };

    const loadSettings = () => {
        chrome.storage.local.get('settings', (data) => {
            if (data.settings) {
                startDate.value = data.settings.startDate || '';
                endDate.value = data.settings.endDate || '';

                const selectedVehicles = data.settings.vehicleClass || [];
                Array.from(vehicleClass.options).forEach(option => {
                    option.selected = selectedVehicles.includes(option.value);
                });

                // After setting selected vehicles, generate price inputs and then load the prices
                updatePriceInputs();
                const vehiclePrices = data.settings.vehiclePrices || {};
                Object.keys(vehiclePrices).forEach(vehicle => {
                    const priceInput = document.getElementById(`price-${vehicle.replace(/\s+/g, '-')}`);
                    if (priceInput) {
                        priceInput.value = vehiclePrices[vehicle];
                    }
                });


                const selectedPhase8Vehicles = data.settings.phase8VehicleClass || [];
                Array.from(phase8VehicleClass.options).forEach(option => {
                    option.selected = selectedPhase8Vehicles.includes(option.value);
                });

                autoRefreshToggle.checked = data.settings.autoRefresh === true;
            }
        });

        chrome.storage.local.get('automation_in_progress', (data) => {
            if (data.automation_in_progress) {
                proceedButton.disabled = true;
            }
        });
    };

    /**
     * Dynamically generates price input fields based on the selected vehicles.
     */
    const updatePriceInputs = () => {
        priceInputsContainer.innerHTML = ''; // Clear existing inputs
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);

        selectedVehicles.forEach(vehicle => {
            const row = document.createElement('div');
            row.className = 'row';

            const label = document.createElement('label');
            label.htmlFor = `price-${vehicle.replace(/\s+/g, '-')}`;
            label.textContent = `Min Payout for ${vehicle}:`;

            const input = document.createElement('input');
            input.type = 'number';
            input.id = `price-${vehicle.replace(/\s+/g, '-')}`;
            input.placeholder = 'Enter min payout';
            input.addEventListener('change', saveSettings); // Save on change

            row.appendChild(label);
            row.appendChild(input);
            priceInputsContainer.appendChild(row);
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

    // Special listener for vehicle class dropdown to update price inputs
    vehicleClass.addEventListener('change', () => {
        updatePriceInputs();
        saveSettings(); // Save after updating so the price field structure is in sync
    });

    // "Proceed" button initiates the automation
    proceedButton.addEventListener('click', () => {
        if (!startDate.value) {
            return logMessage('Error: Start Date is required.', 'error', new Date().toLocaleTimeString());
        }
        const selectedVehicles = Array.from(vehicleClass.selectedOptions).map(option => option.value);
        if (selectedVehicles.length === 0) {
            return logMessage('Error: At least one Vehicle Class must be selected.', 'error', new Date().toLocaleTimeString());
        }
        if (Array.from(phase8VehicleClass.selectedOptions).length === 0) {
            return logMessage('Error: At least one Phase 8 Vehicle must be selected.', 'error', new Date().toLocaleTimeString());
        }

        // Collect prices
        const vehiclePrices = {};
        let allPricesSet = true;
        selectedVehicles.forEach(vehicle => {
            const priceInput = document.getElementById(`price-${vehicle.replace(/\s+/g, '-')}`);
            if (!priceInput || priceInput.value === '') {
                allPricesSet = false;
            } else {
                vehiclePrices[vehicle] = parseFloat(priceInput.value);
            }
        });

        if (!allPricesSet) {
            return logMessage('Error: Please enter a price for all selected vehicles.', 'error', new Date().toLocaleTimeString());
        }


        const config = {
            startDate: startDate.value,
            endDate: endDate.value,
            vehicleClasses: selectedVehicles,
            vehiclePrices: vehiclePrices,
            phase8VehicleClasses: Array.from(phase8VehicleClass.selectedOptions).map(o => o.value),
            autoRefresh: autoRefreshToggle.checked
        };

        chrome.runtime.sendMessage({ action: 'startAutomation', config }, (response) => {
            if (!response || response.status !== 'success') {
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

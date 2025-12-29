/**
 * @fileoverview Logic for the extension's options page (options.html).
 * Handles saving and loading of persistent settings.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const allowListedDomain = document.getElementById('allow-listed-domain');
    const defaultTolerance = document.getElementById('default-tolerance');
    const defaultVehicleClass = document.getElementById('default-vehicle-class');
    const saveButton = document.getElementById('save-button');
    const resetButton = document.getElementById('reset-button');
    const statusDiv = document.getElementById('status');

    /**
     * Saves the options to chrome.storage.sync.
     */
    const saveOptions = () => {
        const options = {
            allowListedDomain: allowListedDomain.value.trim(),
            defaultTolerance: parseInt(defaultTolerance.value, 10),
            defaultVehicleClass: defaultVehicleClass.value.trim()
        };

        // Use chrome.storage.sync to allow settings to persist across devices.
        chrome.storage.sync.set({ options }, () => {
            statusDiv.textContent = 'Options saved.';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 1500);
        });
    };

    /**
     * Loads the options from chrome.storage.sync and populates the form.
     */
    const loadOptions = () => {
        chrome.storage.sync.get('options', (data) => {
            const currentOptions = data.options || {};
            // Set default domain if it's not already set
            allowListedDomain.value = currentOptions.allowListedDomain || 'control.transfeero.com';
            defaultTolerance.value = currentOptions.defaultTolerance || 0;
            defaultVehicleClass.value = currentOptions.defaultVehicleClass || '';
        });
    };

    /**
     * Resets the options to their default values.
     */
    const resetOptions = () => {
        // Clear the specific 'options' key from storage
        chrome.storage.sync.remove('options', () => {
            // After removing, reload the UI which will now be empty or have default values
            allowListedDomain.value = '';
            defaultTolerance.value = 0;
            defaultVehicleClass.value = '';
            statusDiv.textContent = 'Options reset to default.';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 1500);
        });
    };


    // --- Event Listeners ---
    saveButton.addEventListener('click', saveOptions);
    resetButton.addEventListener('click', resetOptions);

    // --- Initialization ---
    loadOptions();
});

/**
 * @fileoverview This script handles the logic for the options page (options.html).
 * It allows the user to configure persistent settings for the extension,
 * such as enabling or disabling the final confirmation click.
 */

// Phase 3: Options UI Logic
document.addEventListener('DOMContentLoaded', () => {
  const finalClickCheckbox = document.getElementById('final-click-enabled');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  /**
   * Load the saved state of the 'finalClickEnabled' setting when the options page is opened.
   * The `!!` operator converts the stored value (which could be undefined) to a boolean.
   * This ensures the checkbox accurately reflects the current setting.
   */
  chrome.storage.local.get(['finalClickEnabled'], (result) => {
    finalClickCheckbox.checked = !!result.finalClickEnabled;
  });

  /**
   * When the user clicks the "Save" button, store the current state of the checkbox
   * in chrome.storage.local. This makes the setting available to other parts of the extension,
   * particularly the background script, which will check this value before performing the final click.
   */
  saveButton.addEventListener('click', () => {
    const finalClickEnabled = finalClickCheckbox.checked;
    chrome.storage.local.set({ finalClickEnabled }, () => {
      // Provide visual feedback to the user that the settings have been saved.
      statusDiv.textContent = 'Options saved.';
      // The message disappears after 2 seconds.
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });
});
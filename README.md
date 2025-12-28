# Chrome Extension: Booking Automation

This Chrome extension provides a user-controlled, safety-first interface for automating a booking process on a specific, user-defined website. It is designed to be fully transparent, with no hidden actions and a strict, phased execution model that the user must explicitly enable.

**Core Principles:**
- **User-Initiated Only:** The extension takes no action until the user clicks "Proceed" in the popup.
- **No Background Automation:** The extension is completely inactive until opened and is not event-driven.
- **Full User Control:** Every critical action (click) is behind a user-controlled toggle.
- **Safety First:** The extension includes multiple safety checks, such as domain allow-listing, Dry Run mode, and strict rule validation.

---

## How It Works

The extension consists of four main components:
1.  **Popup (`popup.html`/`.js`):** The main user interface where you set the automation parameters (date, vehicle, etc.) and enable the specific phases of the operation.
2.  **Options (`options.html`/`.js`):** A separate page for persistent configuration, such as setting the allow-listed domain where the extension is permitted to run.
3.  **Background Script (`background.js`):** The central service worker that manages the state of the automation. It acts as a controller, receiving commands from the popup and sending instructions to the content script, but it does not interact with the page directly.
4.  **Content Script (`content.js`):** This script is injected *only* into the allow-listed webpage. Its sole job is to execute precise, pre-defined DOM interactions (like clicks or reading text) when instructed by the background script.

### Automation Phases
The process is broken down into distinct, user-controlled phases:
-   **Phase 6: Initial Booking Click:** The script validates that the date and vehicle on the page match the user's input. If they match, it clicks the initial booking button.
-   **Phase 8: Vehicle Selection:** On the new page that opens, the script selects the specified vehicle from a dropdown.
-   **Phase 9: Final Confirmation:** The script clicks the final "Accept Ride" button to complete the booking.

---

## How to Operate Safely

1.  **Configure Options First:** Before using the extension, right-click the extension icon, go to "Options," and set the **Allow-Listed Domain** to the *exact* domain you will be using (e.g., `booking.example.com`). This is a critical security measure.
2.  **Use Dry Run Mode:** For the first few runs, **always** keep the "Dry Run" toggle enabled. This will log all the actions the extension *would* have taken in the log panel without performing any actual clicks, allowing you to verify the logic is correct.
3.  **Enable Phases Incrementally:** Do not enable all phases at once. Start by enabling only "Phase 6". If that works as expected, then enable "Phase 6" and "Phase 8", and so on. This helps isolate any issues.
4.  **Always Supervise:** This is a tool to assist you, not replace you. Always watch the automation as it happens to ensure it is behaving as expected.
5.  **Use the Abort Button:** If anything looks wrong, click the "Abort" button in the popup immediately.

---

## How to Test Locally (A Step-by-Step Guide)

### 1. How to Load the Extension Locally
1.  Open Google Chrome.
2.  Navigate to `chrome://extensions`.
3.  In the top-right corner, toggle on **"Developer mode"**.
4.  Click the **"Load unpacked"** button that appears on the top-left.
5.  In the file selection dialog, select the root folder of this extension's source code.

### 2. How to Verify Installation
1.  The extension should now appear in your `chrome://extensions` list.
2.  Click the "Service Worker" link next to the extension's details. The DevTools console should open, and there should be no red errors.
3.  Click the extension's icon in the Chrome toolbar. The popup UI should load correctly.

### 3. Dry Run Testing (Most Important Test)
1.  In the popup, ensure the **"Dry Run (Log actions only)"** toggle is **ON**.
2.  Enable all three phase toggles (P6, P8, P9).
3.  Fill in a target date and vehicle class.
4.  Click **"Proceed"**.
5.  **Expected Outcome:** The log panel should display messages indicating what actions *would* have been taken (e.g., `[Dry Run] Would click the booking button.`). **No actual clicks should happen on the page.**

### 4. Rule Engine Testing
1.  **Date Match:** Set the date in the popup to match the date on the test webpage. Run the extension (in Dry Run mode). The log should show the process proceeding past the date check.
2.  **Date Mismatch:** Set the date in the popup to be outside the tolerance of the date on the page. Run the extension. The log should show an abort message like `Date mismatch.`.
3.  **Vehicle Mismatch:** Set the vehicle class in the popup to something that does not match the vehicle on the page. Run the extension. The log should show an abort message like `Vehicle class mismatch.`.

### 5. Selector Testing
For this, you will need to use the Chrome DevTools on the target webpage.
1.  Open DevTools (`Ctrl+Shift+I` or `Cmd+Opt+I`).
2.  Go to the **Console** tab.
3.  To test a CSS selector (like in Phase 6), type `document.querySelector('div.row.the_booking')` and press Enter.
    - **Expected:** It should return exactly one element. If it returns `null` or more than one, the selector needs to be fixed.
4.  To test an XPath selector (like in Phases 8 & 9), type `$x('//*[@id="select2-vehicle-container"]')` and press Enter.
    - **Expected:** It should return an array with exactly one element. If the array is empty (`[]`) or has multiple elements, the XPath is incorrect.

### 6. Phase-by-Phase Click Testing
**Important:** Do this only after Dry Run testing is successful.
1.  **Test Phase 6 Alone:**
    - Disable "Dry Run".
    - Enable **only** "Enable Booking Click (P6)".
    - Click "Proceed". The extension should click the first booking button and then stop.
2.  **Test Phase 8 Alone:**
    - This requires manually getting to the second page (after the Phase 6 click).
    - Disable "Dry Run".
    - Enable **only** "Enable Vehicle Select (P8)".
    - Click "Proceed". The extension should select the vehicle and then stop.
3.  **Test Phase 9 Alone:**
    - Manually get to the final confirmation page.
    - Disable "Dry Run".
    - Enable **only** "Enable Final Click (P9)".
    - Click "Proceed". The extension should click the final button.

### 7. New Tab Handling Test
1.  During a live run (Dry Run off) with Phase 6 and 8 enabled, watch what happens after the first click.
2.  The extension should correctly identify the new tab that opens (matching `/new-ride/*`), inject its script, and continue with Phase 8.
3.  Open other, unrelated tabs. The extension should ignore them completely.
4.  Close the tab that the automation is running in. Check the service worker console; it should log that the tab was closed and the automation has been aborted.

### 8. Failure & Abort Tests
-   **Missing Selector:** Manually change a selector in `content.js` to be incorrect, reload the extension, and run. It should fail gracefully and report the error in the log.
-   **Slow Page Load:** Use the "Network" tab in DevTools to throttle your connection to "Slow 3G". Run the extension. It may fail if elements are not found in time, which is expected behavior.
-   **Network Offline:** Disconnect from the internet and try to run the automation. It should fail when the page cannot be reached.

### 9. Chrome Web Store Safety Checklist
This extension is designed to be compliant with Chrome Web Store policies.
-   [x] **User-Initiated Only:** All actions are triggered by a direct user click on the "Proceed" button.
-   [x] **No Background Automation:** The service worker is non-persistent and does not run tasks in the background.
-   [x] **No Deceptive Behavior:** The extension's functionality is clearly stated, and all actions are transparent to the user via the log panel and phase toggles.
-   [x] **Narrow Host Permissions:** Instead of requesting broad host permissions in the manifest, this extension uses the `scripting` permission to programmatically inject its content script *only* into the user-defined, allow-listed domain at runtime. This is a more secure approach that ensures the extension has no access to any pages until the user initiates an action on the intended site.

---

## Known Limitations

-   This extension is built for a *specific* website structure. If the website's layout, selectors, or XPath changes, the extension's content script (`content.js`) will need to be updated.
-   The extension does not handle dynamic UI changes gracefully. It expects elements to be present when it looks for them.
-   Error handling is basic. While it will stop on failure, it may not provide a highly detailed reason for every possible issue.

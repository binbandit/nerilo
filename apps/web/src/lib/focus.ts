export function focusableControls(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, summary, a[href], [contenteditable="true"], [tabindex]',
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled, [hidden], [aria-hidden="true"]') &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

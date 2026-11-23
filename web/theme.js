// Applies the saved theme before first paint so there's no flash.
// A separate file (not inline) so the content security policy can forbid inline scripts.
try { document.documentElement.dataset.theme = localStorage.getItem("rosie.theme") || "system"; }
catch { document.documentElement.dataset.theme = "system"; }

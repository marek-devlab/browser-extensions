// Registers the "SEO & A11y" tab in DevTools. WXT emits the unlisted panel page
// at `/panel.html` (from entrypoints/panel/). The empty icon string is
// intentional — DevTools panels render fine without one.
browser.devtools.panels.create('SEO & A11y', '', '/panel.html');

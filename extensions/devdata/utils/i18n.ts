import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for the Data Format Toolkit. English is the DEFAULT and the
// source of truth for keys; `messages: Catalog<MsgKey>` makes TypeScript fail the
// build if `ru` or `et` miss any key, so nothing ships half-translated.
//
// Scope: presentation strings on the MAIN thread + the two non-React surfaces
// (background context menu, in-page formatter). Strings PRODUCED IN THE WORKER
// (parse errors, conversion warnings, schema messages/notes) are intentionally
// out of scope — the worker has no locale and terminating it must stay cheap.
//
// Format tokens (JSON/YAML/XML/CSV/JWT), storage keys, console logs, code
// comments and the product name are NOT translated.

const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', et: 'et-EE' };

/** Locale-aware number formatting (replaces the hard-coded toLocaleString('ru')). */
export function nfmt(locale: Locale, n: number): string {
  return n.toLocaleString(LOCALE_TAG[locale]);
}

const en = {
  // --- common ---
  'common.open': 'Open',
  'common.cancel': 'Cancel',
  'common.copy': 'Copy',
  'common.download': 'Download',
  'common.retry': 'Retry',

  // --- prefs (usePrefs) ---
  'prefs.readFail': 'Could not read settings: {message}',
  'prefs.tooBig':
    'The settings object is unexpectedly large — the write was cancelled to avoid hitting the storage.sync limit (8 KB per item).',
  'prefs.saveFail': 'Could not save the setting: {message}',

  // --- tabs ---
  'tab.data': 'Data',
  'tab.jwt': 'JWT',
  'tab.schema': 'Schema',
  'tab.settings': 'Settings',
  'tab.toolAria': 'Tool',

  // --- size units ---
  'unit.bytes': '{n} B',
  'unit.kb': '{n} KB',
  'unit.mb': '{n} MB',

  // --- popup launcher ---
  'popup.thisTab': 'this tab',
  'popup.loading': 'loading…',
  'popup.looksJsonTitle': 'ⓘ Looks like a JSON document',
  'popup.looksJsonBody': "Judging by the address only — the document type isn't visible from here.",
  'popup.formatHere': 'Format here',
  'popup.pasteAndOpen': 'Paste from clipboard and open',
  'popup.openTool': 'Open the tool',
  'popup.pageFormatting': 'Page formatting',
  'popup.formatJsonHere': 'Format JSON on this tab',
  'popup.restrictedNote': "The browser doesn't allow extensions to run on this page.",
  'popup.oneClickNote':
    'A one-off click action. No site access is granted — only this tab, only now.',
  'popup.readingTab': 'Reading the tab…',
  'popup.autoFormatLink': 'Auto-format JSON pages — in settings',
  'popup.autoFormatLinkNote': ' (requires access to all sites)',
  'popup.footer': '100% offline · zero network · zero analytics',
  'popup.clipboardEmpty':
    'The clipboard is empty. Open the tool and paste the text there (⌘/Ctrl+V).',
  'popup.clipboardDenied':
    "The browser wouldn't let the popup read the clipboard. Opening the tool — press ⌘/Ctrl+V there.",
  'popup.resultFormatted':
    'Done: the tab is formatted. The ✕ button on the page brings the original document back.',
  'popup.resultNotJson':
    'There is no JSON document on this page (type: {type}). Copy the fragment you need and paste it into the tool.',
  'popup.resultDenied':
    "Access wasn't granted — the feature doesn't work. Everything else works as before.",
  'popup.resultError': 'Could not format: {message}',

  // --- data tab ---
  'data.dropOverlay': "Release the file — we'll parse it here",
  'data.jwtOfferTitle': 'Looks like a JWT, not a document',
  'data.jwtOfferBody1': 'These are three base64url segments with a header that has ',
  'data.jwtOfferBody2':
    '. A JWT is a credential, and it has its own tab with its own security frame.',
  'data.openInJwtTab': 'Open in the JWT tab',
  'data.dontOpen': "Don't open",
  'data.oversizeTitle': 'File {size}',
  'data.oversizeBody':
    'The tool is designed for up to {soft}. It may hang for tens of seconds or run out of memory. Open anyway?',
  'data.dropTitle': 'Drag a file here or paste text (⌘/Ctrl+V)',
  'data.chooseFile': 'Choose a file…',
  'data.emptyNote':
    'The format is detected automatically. Up to {soft}. Everything is computed locally: not a single byte leaves the browser.',
  'data.examples': 'Examples:',
  'data.loadingNote':
    "Parsing runs in a background thread — the tab isn't frozen. Cancel really stops the thread.",
  'data.cancelParse': 'Cancel',
  'data.parseErrorBadge': '✗ Parse error',
  'data.lineColumn': 'line {line}, column {column}',
  'data.suggestions': 'Options:',
  'data.parsedUpToError': 'Parsed up to the error',
  'data.parsedUpToErrorNote':
    'Showing the part of the document that could be parsed. A blank screen over one comma in 40 MB would be cruel.',
  'data.startOver': 'Start over',
  'data.fatalBadge': "✗ Parsing didn't finish",
  'data.whatToDo': 'What you can do:',
  'data.openAnother': 'Open another document',
  'data.fatalNote':
    'This is a tab limitation (memory or time), not a document error. Closing other tabs sometimes really helps — the browser allots memory per tab.',
  'data.openFileMulti':
    'Opened “{name}”. The tool works with one document at a time — the other {count} file(s) were skipped.',
  'data.fileTooBig':
    'File {size}. That is more than the extension can parse in the browser (limit — {limit}).',
  'data.fileReadFail': 'Could not read the file: {error}',
  'data.formatLabel': 'Format:',
  'data.formatAutoRecheck': 'Auto (re-check)',
  'data.autoBadge': 'auto',
  'data.autoBadgeTitle': 'Autodetect can be wrong — change the format on the left',
  'data.stats': '{size} · {lines} lines · {nodes} nodes',
  'data.badgeValid': '✓ Valid',
  'data.badgeParsed': '✓ Parsed',
  'data.viewAria': 'View',
  'data.viewTree': 'Tree',
  'data.viewText': 'Text',
  'data.viewBoth': 'Both',
  'data.beautifyNote': 'Beautify will replace the document with its JSON representation',
  'data.convertTo': 'Convert to ▾',
  'data.csvFlat': ' (flat)',
  'data.closeDocument': 'Close document',
  'data.visibleNodes': '{count} visible nodes',
  'data.treeStructureAria': 'Document structure',
  'data.treeControls':
    '↑↓ navigate · →/← expand/collapse · Enter — show in text · ⌘/Ctrl+C — value · ⌘/Ctrl+⇧+C — path',
  'data.searchDisabledPlaceholder': 'Search disabled on a large document',
  'data.searchPlaceholder': 'Search or $.path',
  'data.searchAria': 'Search in the document or jump to a JSONPath',
  'data.searchEnterPath': 'Enter — jump to the path',
  'data.searchNoMatches': 'no matches',
  'data.searchCount': '{index} of {total}',
  'data.highlightUnavailable':
    'Syntax highlighting is unavailable in this browser (no CSS Custom Highlight API) — text is shown without colour. ',
  'data.windowedNote':
    "Only the visible window of lines is rendered, so the browser's built-in search (⌘/Ctrl+F) won't see the whole document — use the search above. ",
  'data.wrapOffNote': 'Line wrapping is off on large documents: it breaks virtualisation.',
  'data.inspectorValue': 'Value',
  'data.copyPath': 'Copy path',
  'data.conversionRefusalTitle': "Conversion isn't possible — and we won't pretend it went through",
  'data.arraysFound': 'Arrays of objects found in this document:',
  'data.noArrays': "No arrays of objects were found in the document — CSV doesn't suit it at all.",
  'data.backTo': '← Back to {format}',
  'data.makeDocument': 'Make {format} the document',
  'data.noLossDetected': 'No loss detected',
  'data.conversionWarnings': '⚠ {count} conversion warning(s)',
  'data.collapse': 'Collapse',
  'data.expand': 'Expand',
  'data.convertErrorTitle': 'Conversion failed',
  'data.truncatedTitle': '⚠ The tree was built partially',
  'data.truncatedBody':
    'The document has more nodes than the tree can hold. The text is shown in full, the tree — up to the limit. Path search below the limit works.',
  'data.copiedDocument': 'Document copied',
  'data.copiedResult': 'Result copied',
  'data.copiedValue': 'Value copied',
  'data.copiedPath': 'Path copied',
  'data.clipboardUnavailable':
    'The clipboard is unavailable — select the text and press ⌘/Ctrl+C.',

  // --- JWT tab ---
  'jwt.credentialTitle': '🔒 A JWT is a credential. The token grants access to your account.',
  'jwt.credentialBody':
    "The extension works 100% offline: the token doesn't leave the browser, isn't saved to disk and isn't sent anywhere. The extension has no network at all — no analytics, no telemetry, no error reports. Even so: treat tokens like passwords. Before pasting someone else's token into any online tool — think about where it will go.",
  'jwt.token': 'Token',
  'jwt.clear': 'Clear',
  'jwt.pasteExample': 'Paste example',
  'jwt.tokenAria': 'JWT token',
  'jwt.tokenPlaceholder': 'eyJhbGciOi… (paste a JWT — it decodes instantly)',
  'jwt.decodeHint1':
    'Paste a token — decoding is instant and local (atob + JSON.parse, no libraries and no network). The “Paste example” button inserts a ',
  'jwt.decodeHintFake': 'fake',
  'jwt.decodeHint2':
    " token: its signature isn't real, so verification honestly fails on it. That way you can try the tool without pasting a real token.",
  'jwt.notJwtTitle': "✗ This doesn't parse as a JWT",
  'jwt.algNoneTitle': "⛔ The token claims alg: none — there's no signature",
  'jwt.algNoneBody':
    "Anyone can forge such a token: the signature isn't verified by definition. If your server accepts it, that is a vulnerability, not a feature.",
  'jwt.header': 'Header',
  'jwt.payload': 'Payload',
  'jwt.payloadNotJson': ' (not JSON — shown as-is)',
  'jwt.signature': 'Signature',
  'jwt.algorithmLabel': 'Algorithm: ',
  'jwt.fromHeader': ' (from header)',
  'jwt.symmetricSuffix': ' — symmetric',
  'jwt.hs256Title': '⚠ HS256 is verified with a shared secret.',
  'jwt.hs256Body1':
    'The secret is the key that signs all your tokens; whoever knows it can issue tokens in your name. We keep it ',
  'jwt.hs256BodyStrong': 'in RAM only',
  'jwt.hs256Body2':
    ": it isn't written to the extension's storage, doesn't get into the document autosave and disappears when you close the tab. The field isn't autofilled or spellchecked.",
  'jwt.secretAria': 'HS256 secret',
  'jwt.secretPlaceholder': 'shared secret',
  'jwt.revealSecretAria': 'Show the secret while the button is held',
  'jwt.secretBase64': 'Secret is base64',
  'jwt.publicKeyLabel': 'Public key (JWK or PEM)',
  'jwt.publicKeyNote1': 'Paste the ',
  'jwt.publicKeyNoteStrong': 'public',
  'jwt.publicKeyNote2':
    " key. The private one isn't needed here — and you shouldn't paste it here or anywhere else.",
  'jwt.keyPlaceholder': '-----BEGIN PUBLIC KEY-----\n… or {"kty":"RSA", …}',
  'jwt.verifySignature': 'Verify signature',
  'jwt.verifyingSpinner': 'Verifying locally via WebCrypto…',
  'jwt.claimsAria': 'Claims',
  'jwt.claimsHeading': 'Claims (decoded)',
  'jwt.clockNote':
    "⚠ Expiry is checked against YOUR computer's clock. If it's wrong, this output is wrong too.",
  'jwt.verifyValidTitle': '✓ SIGNATURE IS VALID',
  'jwt.verified': 'Verified',
  'jwt.verifyInvalidTitle': "✗ SIGNATURE DOESN'T MATCH",
  'jwt.verifyInvalidBody1': 'The token is forged, corrupted, or the key is wrong. ',
  'jwt.verifyInvalidStrong': "These cases can't be told apart",
  'jwt.verifyInvalidBody2': ' — cryptographically they are indistinguishable. ',
  'jwt.verifyErrorTitle': 'Could not verify',

  // --- jwt.ts (main-thread decode / verify) ---
  'jwt.tooLong':
    'Too long for a JWT: {len} characters (limit {max}). A real token is a few KB.',
  'jwt.decodeTooLong':
    "Too long for a JWT: {len} characters (limit {max}). A real token is a few KB; such a length means it isn't a JWT.",
  'jwt.notThreeParts':
    "This doesn't look like a JWT: expected 3 dot-separated parts, found {count}.",
  'jwt.headerNotObject': "the header isn't a JSON object",
  'jwt.headerCorrupt':
    'Header is corrupted: {message}. The first segment must be base64url-encoded JSON.',
  'jwt.payloadNotObject': "Payload decoded, but it isn't a JSON object. Shown as-is.",
  'jwt.payloadNotJsonProblem':
    "Payload decoded, but it isn't JSON. Such a token is formally valid — the raw text is shown.",
  'jwt.payloadNotBase64':
    "Payload doesn't decode as base64url: {message}. The header is valid, though, and shown above.",
  'jwt.emptySignature': 'The signature is empty even though the algorithm requires one.',
  'jwt.claim.iss': 'Issuer',
  'jwt.claim.sub': 'Subject',
  'jwt.claim.aud': 'Audience',
  'jwt.claim.exp': 'Expires',
  'jwt.claim.nbf': 'Valid from',
  'jwt.claim.iat': 'Issued',
  'jwt.claim.jti': 'Token ID',
  'jwt.claim.custom': '(custom claim)',
  'jwt.claimNotNumber':
    'Not a number — per RFC 7519 this should be a time in Unix seconds.',
  'jwt.expired': '⛔ EXPIRED {span} ago',
  'jwt.validFor': 'Valid for another {span}',
  'jwt.notYetValid': '⛔ NOT YET VALID — takes effect in {span}',
  'jwt.activeSince': 'In effect since {span} ago',
  'jwt.spanAgo': '{span} ago',
  'jwt.spanAhead': '{span} ahead',
  'jwt.issuedFuture': '⚠ Issued in the future ({span} ahead)',
  'jwt.spanDH': '{d}d {h}h',
  'jwt.spanHM': '{h}h {m}m',
  'jwt.spanM': '{m}m',
  'jwt.spanS': '{s}s',
  'jwt.verifyNoWebCrypto':
    "WebCrypto isn't available in this context, so there is nothing to verify the signature with. It should exist on the extension page — please report this as a bug.",
  'jwt.verifyAlgNone':
    'The token claims alg: none — there is no signature, nothing to verify. Anyone can forge such a token.',
  'jwt.verifyPasteSecret': 'Paste the shared secret.',
  'jwt.verifyPasteKey': 'Paste the public key (JWK or PEM).',
  'jwt.keyNotRecognized':
    "Key not recognised: {message}. Expected JWK (JSON) or PEM (-----BEGIN PUBLIC KEY-----). You don't need to, and shouldn't, paste a private key.",
  'jwt.verifyValidDetail':
    "Verified locally via WebCrypto. The key wasn't saved, the token wasn't sent anywhere.",
  'jwt.algMismatch':
    "Algorithm {alg} from the header doesn't match the type of the pasted key: {message}",
  'jwt.verifyInvalidDetail': 'Verified locally via WebCrypto.',
  'jwt.privateJwk':
    'this is a PRIVATE key (the JWK has a “d” parameter). Signature verification needs only the public key',
  'jwt.privatePem':
    "this is a PRIVATE key. Signature verification needs the public one — the private key shouldn't be pasted anywhere",
  'jwt.notJwkOrPem': "this doesn't look like JWK or PEM",

  // --- document.ts ---
  'doc.parsing': 'Parsing {size}…',
  'doc.tooBig':
    'Document {size}. That is more than the extension can parse in the browser (limit — {limit}).',
  'doc.saveTooBig':
    "Document {size} — we don't save anything larger than {max}. After a reload you'll need to open it again.",
  'doc.saveFailed':
    "Could not save the document: the browser's storage is full ({message}). Work continues, but the document won't be restored after a reload.",

  // --- format.ts inspector ---
  'fmt.elements': 'Elements: {n}.',
  'fmt.precisionExact':
    "The number doesn't fit in a double. The original spelling from the document is shown; JavaScript would round it to {rounded}.",
  'fmt.precisionLost':
    'Precision lost during parsing: this format gives no access to the source text, so the rounded {rounded} is shown. The original spelling cannot be recovered.',
  'fmt.exactness':
    'This format is parsed through values, not source positions — the original spelling of numbers is unavailable.',
  'fmt.stringLength': 'Length: {graphemes} character(s){extra}.',
  'fmt.stringLengthExtra':
    ' ({units} UTF-16 code units — the string contains surrogate pairs or combining characters)',
  'fmt.xmlNote':
    'XML is parsed by the native DOMParser on the main thread (a Worker has none) — so a separate size limit applies here.',

  // --- format-page.ts / in-page formatter ---
  'page.unknownType': 'unknown',
  'page.noResponse': 'The page script did not respond. Reload the tab and try again.',
  'page.formattedLabel': '▣ Formatted by the extension',
  'page.tree': 'Tree',
  'page.raw': 'Raw text',
  'page.openInTool': 'Open in the tool',
  'page.restore': '✕ Restore document',
  'page.bigDocNote':
    "Document {mb} MB — a tree isn't built on the page itself (it would hang the tab). Raw text is shown; the full tree is in the tool.",

  // --- background context menu ---
  'bg.menuTitle': 'Open selection in Data Toolkit',

  // --- schema tab ---
  'schema.noDocTitle': 'No document',
  'schema.noDocBody':
    'The schema validates the document from the “Data” tab, and it is not open yet.',
  'schema.openData': 'Open data',
  'schema.documentLabel': 'Document: ',
  'schema.noName': 'unnamed',
  'schema.draftLabel': 'Draft: ',
  'schema.formatChecked': 'checked',
  'schema.formatNotChecked': 'not checked',
  'schema.changedInSettings': ' — changed in Settings',
  'schema.fileBtn': 'File…',
  'schema.exampleBtn': 'Example',
  'schema.fileReadFail': 'Could not read the schema file: {message}',
  'schema.inputPlaceholder': 'Paste a JSON Schema',
  'schema.validateBtn': 'Validate',
  'schema.resultHeading': 'Result',
  'schema.conforms': '✓ Conforms',
  'schema.errorsCount': '✗ errors: {count}',
  'schema.intro':
    'Paste a schema and press “Validate”. The document is taken from the “Data” tab.',
  'schema.validationFailedTitle': "Validation didn't run",
  'schema.validatingSpinner': 'Validating in a background thread…',
  'schema.timeoutNote1':
    '5 s timeout → the thread will be terminated. This guards against catastrophic backtracking in ',
  'schema.timeoutNote2': ': there is no other way to stop a looping regex.',
  'schema.conformsTitle': '✓ The document conforms to the schema',
  'schema.errorBadge': 'ERROR',
  'schema.schemaPathLabel': 'schema: {path}',
  'schema.showInData': 'Show in data',
  'schema.saveTooBig': "Schema {size} — we don't save anything larger than {max}.",
  'schema.saveFailed': 'Schema not saved: {message}',
  'schema.validatorNote1': '⚠ Validator: ',
  'schema.validatorNote2': ". It doesn't run code (MV3's CSP forbids ",
  'schema.validatorNote3': ' and ',
  'schema.validatorNote4': ', so AJV is physically impossible here), which means it does NOT support: ',
  'schema.validatorNote5':
    ' to external URLs (the extension has no network at all — such a schema is rejected with an explicit error, not silently skipped) and custom keywords.',

  // --- settings tab ---
  'settings.readingPrefs': 'Reading settings… controls are locked until loaded.',
  'settings.readFailTitle': 'Could not read settings',
  'settings.sectionView': 'View',
  'settings.indent': 'Indent',
  'settings.indent2': '2 spaces',
  'settings.indent4': '4 spaces',
  'settings.indentTab': 'Tab',
  'settings.indentMin': 'Minified',
  'settings.wrapLabel': 'Wrap long lines',
  'settings.wrapHint':
    'On large documents wrapping turns off automatically: it is incompatible with row virtualisation.',
  'settings.lineNumbers': 'Show line numbers',
  'settings.startTab': 'Starting tab',
  'settings.highlightWarn1':
    "⚠ This browser doesn't support the CSS Custom Highlight API — syntax highlighting doesn't work. Text is shown without colour; we won't fake highlighting with thousands of ",
  'settings.highlightWarn2': ' (it is slow and opens a markup-injection hole).',
  'settings.sectionParse': 'Parsing',
  'settings.defaultFormat': 'Default format',
  'settings.formatAuto': 'Autodetect',
  'settings.sortKeys': 'Sort keys',
  'settings.sortKeysHint':
    "OUTPUT only (beautify/conversion). The tree always shows the original order — otherwise we'd be lying about the document.",
  'settings.expandTree': 'Expand tree to',
  'settings.levels': '{n} levels',
  'settings.exactTitle': 'Exact big numbers.',
  'settings.exactSupported': 'Your browser supports JSON.parse source access (ES2026).',
  'settings.exactNotSupported': 'Your browser does NOT support JSON.parse source access (ES2026).',
  'settings.exactBody1':
    'For JSON and JSONC this does not matter: we take the source spelling of numbers from token positions in the document itself, so ',
  'settings.exactBody2':
    ' is shown as-is in any browser. For YAML, CSV and JSON5 the source spelling is unavailable in principle — their parsers return already-rounded values, and the inspector says so directly rather than showing the rounded value as the original.',
  'settings.csvDelimiter': 'CSV delimiter',
  'settings.csvAuto': 'auto',
  'settings.csvComma': 'comma ,',
  'settings.csvSemicolon': 'semicolon ;',
  'settings.csvBom': 'BOM on CSV export',
  'settings.csvBomHint':
    'Without a BOM, Excel reads UTF-8 as the local encoding and breaks Cyrillic.',
  'settings.draft': 'Draft',
  'settings.checkFormat': 'Check format:',
  'settings.checkFormatHint':
    'Per the spec, format is an annotation, not a constraint. When off, the keyword is removed from the schema before checking, not just hidden from the report.',
  'settings.sectionStorage': 'Storage',
  'settings.restore': 'Restore the last document',
  'settings.storageWarn1': '⚠ Saved only in this browser (',
  'settings.storageWarn2':
    "), up to 1 MB. Documents larger than 1 MB aren't saved — and we say so rather than losing them silently. The JWT tab's content is ",
  'settings.storageNever': 'NEVER',
  'settings.storageWarn3':
    ' saved: this extension simply has no place to store the token, the secret or the key.',
  'settings.eraseArm': 'Erase the saved document',
  'settings.eraseConfirm': 'Really erase?',
  'settings.erased': 'Erased.',
  'settings.eraseFailed': 'Could not erase: {message}',
  'settings.sectionAbout': 'About the extension',
  'settings.aboutLine': 'Version 1.0.0 · Zero network · Zero analytics · Open source',
  'settings.aboutNetwork1': 'The extension has not a single network call: no ',
  'settings.aboutNetwork2': ', no JWKS fetch by URL, no external ',
  'settings.aboutNetwork3':
    ', no telemetry, no error reports. Everything you paste here stays in the tab.',
  'settings.aboutLibs1':
    'Libraries: jsonc-parser (MIT) · json5 (MIT) · yaml (ISC) · papaparse (MIT) · jose (MIT) · @cfworker/json-schema (MIT). XML — the native DOMParser. Full licence texts are in the ',
  'settings.aboutLibs2': ' file in the extension package.',
  'settings.language': 'Language',
  'settings.formatOnClick': 'Format on click',
  'settings.formatOnClickNote':
    'One-off, current tab only. No site access is granted: the click on the icon opens the tab for that moment (activeTab).',
  'settings.checkingShort': 'checking…',
  'settings.allowed': '✓ Allowed',
  'settings.allow': 'Allow',
  'settings.autoFormatJson': 'Auto-format JSON pages',
  'settings.autoGranted':
    '✓ Access granted. ⚠ In Firefox the built-in JSON viewer intercepts the page before us — see below.',
  'settings.autoNeedsAll': '⚠ Requires access to all sites. Details are behind the button.',
  'settings.revokeAccess': 'Revoke access',
  'settings.tryAgain': 'Try again',
  'settings.enable': 'Enable',
  'settings.revokedNote': 'Access revoked, the script was unregistered.',
  'settings.revokeFailedNote':
    "The browser didn't revoke access — remove it manually on the extensions page.",
  'settings.autoOffWarn':
    "Access granted, but auto-format is off in settings. It does nothing until you turn it back on — or revoke access so you aren't holding an unnecessary permission.",
  'settings.enableAutoFormat': 'Enable auto-format',
  'settings.ffBody1': 'Firefox intercepts ',
  'settings.ffBody2': ' itself, and disabling it from an extension is ',
  'settings.ffImpossible': 'impossible',
  'settings.ffBody3':
    " — there is no such API, and we won't pretend there is. For our view to work: open ",
  'settings.ffBody4': ', find ',
  'settings.ffBody5': ' and set it to ',
  'settings.ffBody6': '. Everything else in the extension works without this.',
  'settings.firefoxWinTitle': '⚠ Firefox: the built-in JSON viewer beats us',
  'settings.consentTitle': 'Auto-formatting JSON pages',
  'settings.consentWhat': 'What it gives you.',
  'settings.consentWhatBody1': 'When you open a URL that serves ',
  'settings.consentWhatBody2':
    ', the extension shows it as a tree by itself — without a click on the icon.',
  'settings.consentAsk': 'What the browser will ask.',
  'settings.consentAskBody':
    "“Read and change all your data on all websites.” That's the only wording Chrome gives. It doesn't get softer — otherwise the feature is impossible.",
  'settings.consentWhy': 'Why so blunt.',
  'settings.consentWhyBody':
    "The browser can't grant access “only to JSON pages”: to know the document type, the script must already be on the page. activeTab won't do — it's granted only on your click, and here there is no click by definition.",
  'settings.consentDo': 'What we will do with this access.',
  'settings.consentDoBody1': 'Exactly one thing: at document_start, check ',
  'settings.consentDoBody2':
    ' and, if it is JSON, replace the document view. On every other page the script exits immediately and reads nothing. Zero network. Nothing is sent anywhere. Ever.',
  'settings.consentFfWarn1':
    '⚠ FIREFOX: Firefox has its own built-in JSON viewer, it intercepts ',
  'settings.consentFfWarn2':
    ' before us, and disabling it from an extension is impossible. You need to manually set ',
  'settings.consentFfWarn3':
    ' in about:config. We cannot do it for you and will not pretend we can.',
  'settings.consentRevokeNote': 'You can revoke access at any time right here.',
  'settings.consentRequestBtn': 'Request access',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  'common.open': 'Открыть',
  'common.cancel': 'Отмена',
  'common.copy': 'Копировать',
  'common.download': 'Скачать',
  'common.retry': 'Повторить',

  'prefs.readFail': 'Не удалось прочитать настройки: {message}',
  'prefs.tooBig':
    'Объект настроек неожиданно велик — запись отменена, чтобы не упереться в лимит storage.sync (8 КБ на элемент).',
  'prefs.saveFail': 'Не удалось сохранить настройку: {message}',

  'tab.data': 'Данные',
  'tab.jwt': 'JWT',
  'tab.schema': 'Схема',
  'tab.settings': 'Настройки',
  'tab.toolAria': 'Инструмент',

  'unit.bytes': '{n} Б',
  'unit.kb': '{n} КБ',
  'unit.mb': '{n} МБ',

  'popup.thisTab': 'эта вкладка',
  'popup.loading': 'загрузка…',
  'popup.looksJsonTitle': 'ⓘ Похоже на JSON-документ',
  'popup.looksJsonBody': 'Судим только по адресу — тип документа отсюда не виден.',
  'popup.formatHere': 'Форматировать тут',
  'popup.pasteAndOpen': 'Вставить из буфера и открыть',
  'popup.openTool': 'Открыть инструмент',
  'popup.pageFormatting': 'Форматирование страниц',
  'popup.formatJsonHere': 'Форматировать JSON на этой вкладке',
  'popup.restrictedNote': 'Браузер не разрешает расширениям работать на этой странице.',
  'popup.oneClickNote':
    'Разовое действие по клику. Доступ к сайту не выдаётся — только к этой вкладке и только сейчас.',
  'popup.readingTab': 'Читаем вкладку…',
  'popup.autoFormatLink': 'Авто-формат JSON-страниц — в настройках',
  'popup.autoFormatLinkNote': ' (требует доступа ко всем сайтам)',
  'popup.footer': '100% офлайн · ноль сети · ноль аналитики',
  'popup.clipboardEmpty':
    'Буфер обмена пуст. Откройте инструмент и вставьте текст туда (⌘/Ctrl+V).',
  'popup.clipboardDenied':
    'Браузер не дал прочитать буфер обмена из попапа. Открываем инструмент — нажмите там ⌘/Ctrl+V.',
  'popup.resultFormatted':
    'Готово: вкладка отформатирована. Кнопка ✕ на странице вернёт исходный документ.',
  'popup.resultNotJson':
    'На этой странице нет JSON-документа (тип: {type}). Скопируйте нужный фрагмент и вставьте в инструмент.',
  'popup.resultDenied': 'Доступ не выдан — фича не работает. Всё остальное работает как работало.',
  'popup.resultError': 'Не удалось отформатировать: {message}',

  'data.dropOverlay': 'Отпустите файл — разберём его здесь',
  'data.jwtOfferTitle': 'Похоже на JWT, а не на документ',
  'data.jwtOfferBody1': 'Это три сегмента base64url с заголовком, где есть ',
  'data.jwtOfferBody2':
    '. JWT — это учётные данные, и у него отдельный таб с отдельной рамкой безопасности.',
  'data.openInJwtTab': 'Открыть в табе JWT',
  'data.dontOpen': 'Не открывать',
  'data.oversizeTitle': 'Файл {size}',
  'data.oversizeBody':
    'Инструмент рассчитан на {soft}. Может подвиснуть на десятки секунд или упасть по памяти. Открыть всё равно?',
  'data.dropTitle': 'Перетащите файл сюда или вставьте текст (⌘/Ctrl+V)',
  'data.chooseFile': 'Выбрать файл…',
  'data.emptyNote':
    'Формат определяется сам. До {soft}. Всё считается локально: ни один байт не покидает браузер.',
  'data.examples': 'Примеры:',
  'data.loadingNote':
    'Разбор идёт в фоновом потоке — вкладка не заморожена. Отмена действительно останавливает поток.',
  'data.cancelParse': 'Отменить',
  'data.parseErrorBadge': '✗ Ошибка разбора',
  'data.lineColumn': 'строка {line}, столбец {column}',
  'data.suggestions': 'Варианты:',
  'data.parsedUpToError': 'Разобрано до ошибки',
  'data.parsedUpToErrorNote':
    'Показана часть документа, которую удалось разобрать. Пустой экран из-за одной запятой в 40 МБ — это жестоко.',
  'data.startOver': 'Начать заново',
  'data.fatalBadge': '✗ Разбор не завершён',
  'data.whatToDo': 'Что можно сделать:',
  'data.openAnother': 'Открыть другой документ',
  'data.fatalNote':
    'Это ограничение вкладки (памяти или времени), а не ошибка документа. Закрытие других вкладок иногда действительно помогает — браузер выделяет память на вкладку.',
  'data.openFileMulti':
    'Открыт «{name}». Инструмент работает с одним документом за раз — остальные {count} файл(ов) пропущены.',
  'data.fileTooBig':
    'Файл {size}. Это больше, чем расширение может разобрать в браузере (предел — {limit}).',
  'data.fileReadFail': 'Файл не прочитан: {error}',
  'data.formatLabel': 'Формат:',
  'data.formatAutoRecheck': 'Авто (перепроверить)',
  'data.autoBadge': 'авто',
  'data.autoBadgeTitle': 'Автодетект может ошибиться — смените формат слева',
  'data.stats': '{size} · {lines} строк · {nodes} узлов',
  'data.badgeValid': '✓ Валиден',
  'data.badgeParsed': '✓ Разобран',
  'data.viewAria': 'Вид',
  'data.viewTree': 'Дерево',
  'data.viewText': 'Текст',
  'data.viewBoth': 'Оба',
  'data.beautifyNote': 'Beautify заменит документ его JSON-представлением',
  'data.convertTo': 'Конвертировать в ▾',
  'data.csvFlat': ' (плоский)',
  'data.closeDocument': 'Закрыть документ',
  'data.visibleNodes': '{count} видимых узлов',
  'data.treeStructureAria': 'Структура документа',
  'data.treeControls':
    '↑↓ навигация · →/← раскрыть/свернуть · Enter — показать в тексте · ⌘/Ctrl+C — значение · ⌘/Ctrl+⇧+C — путь',
  'data.searchDisabledPlaceholder': 'Поиск отключён на большом документе',
  'data.searchPlaceholder': 'Поиск или $.path',
  'data.searchAria': 'Поиск в документе или переход по JSONPath',
  'data.searchEnterPath': 'Enter — перейти по пути',
  'data.searchNoMatches': 'нет совпадений',
  'data.searchCount': '{index} из {total}',
  'data.highlightUnavailable':
    'Подсветка синтаксиса недоступна в этом браузере (нет CSS Custom Highlight API) — текст показан без цвета. ',
  'data.windowedNote':
    'Отрисовывается только видимое окно строк, поэтому встроенный поиск браузера (⌘/Ctrl+F) увидит не весь документ — пользуйтесь поиском выше. ',
  'data.wrapOffNote': 'Перенос строк отключён на больших документах: он ломает виртуализацию.',
  'data.inspectorValue': 'Значение',
  'data.copyPath': 'Копировать путь',
  'data.conversionRefusalTitle': 'Преобразование невозможно — и мы не сделаем вид, что оно прошло',
  'data.arraysFound': 'Массивы объектов, найденные в этом документе:',
  'data.noArrays': 'Массивов объектов в документе не нашлось — CSV для него не подходит вовсе.',
  'data.backTo': '← Назад к {format}',
  'data.makeDocument': 'Сделать {format} документом',
  'data.noLossDetected': 'Потерь не обнаружено',
  'data.conversionWarnings': '⚠ {count} предупреждени(й) преобразования',
  'data.collapse': 'Свернуть',
  'data.expand': 'Развернуть',
  'data.convertErrorTitle': 'Преобразование не выполнено',
  'data.truncatedTitle': '⚠ Дерево построено частично',
  'data.truncatedBody':
    'Документ содержит больше узлов, чем можно удержать в дереве. Текст показан целиком, дерево — до предела. Поиск по пути ниже предела работает.',
  'data.copiedDocument': 'Документ скопирован',
  'data.copiedResult': 'Результат скопирован',
  'data.copiedValue': 'Значение скопировано',
  'data.copiedPath': 'Путь скопирован',
  'data.clipboardUnavailable': 'Буфер обмена недоступен — выделите текст и нажмите ⌘/Ctrl+C.',

  'jwt.credentialTitle': '🔒 JWT — это учётные данные. Токен даёт доступ к вашему аккаунту.',
  'jwt.credentialBody':
    'Расширение работает на 100% офлайн: токен не покидает браузер, не сохраняется на диск и никуда не отправляется. Сети у расширения нет вообще — ни аналитики, ни телеметрии, ни отчётов об ошибках. И всё же: относитесь к токенам как к паролям. Прежде чем вставить чужой токен в любой онлайн-инструмент — подумайте, куда он уедет.',
  'jwt.token': 'Токен',
  'jwt.clear': 'Очистить',
  'jwt.pasteExample': 'Вставить пример',
  'jwt.tokenAria': 'JWT токен',
  'jwt.tokenPlaceholder': 'eyJhbGciOi… (вставьте JWT — декод произойдёт сразу)',
  'jwt.decodeHint1':
    'Вставьте токен — декод мгновенный и локальный (atob + JSON.parse, без библиотек и без сети). Кнопка «Вставить пример» подставляет ',
  'jwt.decodeHintFake': 'фейковый',
  'jwt.decodeHint2':
    ' токен: его подпись не настоящая, поэтому проверка на нём честно провалится. Так можно попробовать инструмент, не вставляя в него настоящий токен.',
  'jwt.notJwtTitle': '✗ Это не разбирается как JWT',
  'jwt.algNoneTitle': '⛔ Токен заявляет alg: none — подписи нет',
  'jwt.algNoneBody':
    'Такой токен может подделать кто угодно: подпись не проверяется по определению. Если ваш сервер его принимает — это уязвимость, а не особенность.',
  'jwt.header': 'Header',
  'jwt.payload': 'Payload',
  'jwt.payloadNotJson': ' (не JSON — показан как есть)',
  'jwt.signature': 'Подпись',
  'jwt.algorithmLabel': 'Алгоритм: ',
  'jwt.fromHeader': ' (из header)',
  'jwt.symmetricSuffix': ' — симметричный',
  'jwt.hs256Title': '⚠ HS256 проверяется общим секретом.',
  'jwt.hs256Body1':
    'Секрет — это ключ, которым подписываются все ваши токены; кто его знает, тот выпускает токены от вашего имени. Мы держим его ',
  'jwt.hs256BodyStrong': 'только в оперативной памяти',
  'jwt.hs256Body2':
    ': он не пишется в хранилище расширения, не попадает в автосохранение документа и исчезает, когда вы закрываете вкладку. Поле не автозаполняется и не проверяется орфографией.',
  'jwt.secretAria': 'Секрет HS256',
  'jwt.secretPlaceholder': 'общий секрет',
  'jwt.revealSecretAria': 'Показать секрет, пока кнопка нажата',
  'jwt.secretBase64': 'Секрет в base64',
  'jwt.publicKeyLabel': 'Публичный ключ (JWK или PEM)',
  'jwt.publicKeyNote1': 'Вставьте ',
  'jwt.publicKeyNoteStrong': 'публичный',
  'jwt.publicKeyNote2':
    ' ключ. Приватный здесь не нужен — и вставлять его не следует ни сюда, ни куда-либо ещё.',
  'jwt.keyPlaceholder': '-----BEGIN PUBLIC KEY-----\n… или {"kty":"RSA", …}',
  'jwt.verifySignature': 'Проверить подпись',
  'jwt.verifyingSpinner': 'Проверяем локально через WebCrypto…',
  'jwt.claimsAria': 'Претензии',
  'jwt.claimsHeading': 'Претензии (расшифровка)',
  'jwt.clockNote':
    '⚠ Срок действия проверен по часам ВАШЕГО компьютера. Если они врут — врёт и этот вывод.',
  'jwt.verifyValidTitle': '✓ ПОДПИСЬ ВЕРНА',
  'jwt.verified': 'Проверено',
  'jwt.verifyInvalidTitle': '✗ ПОДПИСЬ НЕ СОВПАДАЕТ',
  'jwt.verifyInvalidBody1': 'Токен подделан, повреждён или ключ не тот. ',
  'jwt.verifyInvalidStrong': 'Отличить эти случаи нельзя',
  'jwt.verifyInvalidBody2': ' — криптографически они неразличимы. ',
  'jwt.verifyErrorTitle': 'Не удалось проверить',

  'jwt.tooLong':
    'Слишком длинно для JWT: {len} символов (предел {max}). Настоящий токен — несколько КБ.',
  'jwt.decodeTooLong':
    'Слишком длинно для JWT: {len} символов (предел {max}). Настоящий токен — это несколько КБ; такая длина означает, что это не JWT.',
  'jwt.notThreeParts': 'Это не похоже на JWT: ожидались 3 части через точку, найдено {count}.',
  'jwt.headerNotObject': 'header не является JSON-объектом',
  'jwt.headerCorrupt':
    'Header повреждён: {message}. Первый сегмент должен быть base64url-кодированным JSON.',
  'jwt.payloadNotObject': 'Payload декодирован, но это не JSON-объект. Показан как есть.',
  'jwt.payloadNotJsonProblem':
    'Payload декодирован, но это не JSON. Такой токен формально допустим — показан сырой текст.',
  'jwt.payloadNotBase64':
    'Payload не декодируется как base64url: {message}. Header при этом валиден и показан выше.',
  'jwt.emptySignature': 'Подпись пуста, хотя алгоритм её требует.',
  'jwt.claim.iss': 'Издатель',
  'jwt.claim.sub': 'Субъект',
  'jwt.claim.aud': 'Аудитория',
  'jwt.claim.exp': 'Истекает',
  'jwt.claim.nbf': 'Действует с',
  'jwt.claim.iat': 'Выпущен',
  'jwt.claim.jti': 'ID токена',
  'jwt.claim.custom': '(своя претензия)',
  'jwt.claimNotNumber': 'Не число — по RFC 7519 это должно быть время в секундах Unix.',
  'jwt.expired': '⛔ ПРОСРОЧЕН на {span}',
  'jwt.validFor': 'Действителен ещё {span}',
  'jwt.notYetValid': '⛔ ЕЩЁ НЕ ДЕЙСТВУЕТ — вступит в силу через {span}',
  'jwt.activeSince': 'Действует с {span} назад',
  'jwt.spanAgo': '{span} назад',
  'jwt.spanAhead': '{span} вперёд',
  'jwt.issuedFuture': '⚠ Выпущен в будущем ({span} вперёд)',
  'jwt.spanDH': '{d} д {h} ч',
  'jwt.spanHM': '{h} ч {m} мин',
  'jwt.spanM': '{m} мин',
  'jwt.spanS': '{s} с',
  'jwt.verifyNoWebCrypto':
    'WebCrypto недоступен в этом контексте, проверить подпись нечем. На странице расширения он должен быть — сообщите об этом как об ошибке.',
  'jwt.verifyAlgNone':
    'Токен заявляет alg: none — подписи нет, проверять нечего. Такой токен может подделать кто угодно.',
  'jwt.verifyPasteSecret': 'Вставьте общий секрет.',
  'jwt.verifyPasteKey': 'Вставьте публичный ключ (JWK или PEM).',
  'jwt.keyNotRecognized':
    'Ключ не распознан: {message}. Ожидается JWK (JSON) или PEM (-----BEGIN PUBLIC KEY-----). Приватный ключ вставлять не нужно и не следует.',
  'jwt.verifyValidDetail':
    'Проверено локально через WebCrypto. Ключ не сохранён, токен никуда не отправлялся.',
  'jwt.algMismatch':
    'Алгоритм {alg} из header не совпадает с типом вставленного ключа: {message}',
  'jwt.verifyInvalidDetail': 'Проверено локально через WebCrypto.',
  'jwt.privateJwk':
    'это ПРИВАТНЫЙ ключ (в JWK есть параметр «d»). Для проверки подписи нужен только публичный',
  'jwt.privatePem':
    'это ПРИВАТНЫЙ ключ. Для проверки подписи нужен публичный — приватный вставлять не следует никуда',
  'jwt.notJwkOrPem': 'это не похоже ни на JWK, ни на PEM',

  'doc.parsing': 'Разбираем {size}…',
  'doc.tooBig':
    'Документ {size}. Это больше, чем расширение может разобрать в браузере (предел — {limit}).',
  'doc.saveTooBig':
    'Документ {size} — больше {max} мы не сохраняем. После перезагрузки его придётся открыть заново.',
  'doc.saveFailed':
    'Не удалось сохранить документ: хранилище браузера заполнено ({message}). Работа продолжается, но документ не восстановится после перезагрузки.',

  'fmt.elements': 'Элементов: {n}.',
  'fmt.precisionExact':
    'Число не помещается в double. Показано исходное написание из документа; JavaScript округлил бы его до {rounded}.',
  'fmt.precisionLost':
    'Точность потеряна при разборе: этот формат не даёт доступа к исходному тексту, поэтому показано округлённое {rounded}. Исходное написание восстановить нельзя.',
  'fmt.exactness':
    'Формат разбирается через значения, а не через позиции в исходнике — исходное написание чисел недоступно.',
  'fmt.stringLength': 'Длина: {graphemes} символ(ов){extra}.',
  'fmt.stringLengthExtra':
    ' ({units} кодовых единиц UTF-16 — строка содержит суррогатные пары или составные символы)',
  'fmt.xmlNote':
    'XML разбирается нативным DOMParser в основном потоке (в Worker его нет) — поэтому здесь действует отдельный предел размера.',

  'page.unknownType': 'неизвестен',
  'page.noResponse': 'Скрипт на странице не ответил. Перезагрузите вкладку и попробуйте снова.',
  'page.formattedLabel': '▣ Отформатировано расширением',
  'page.tree': 'Дерево',
  'page.raw': 'Сырой текст',
  'page.openInTool': 'Открыть в инструменте',
  'page.restore': '✕ Вернуть документ',
  'page.bigDocNote':
    'Документ {mb} МБ — дерево на самой странице не строится (это подвесило бы вкладку). Показан сырой текст; полноценное дерево — в инструменте.',

  'bg.menuTitle': 'Открыть выделенное в Data Toolkit',

  'schema.noDocTitle': 'Нет документа',
  'schema.noDocBody': 'Схема проверяет документ из таба «Данные», а он ещё не открыт.',
  'schema.openData': 'Открыть данные',
  'schema.documentLabel': 'Документ: ',
  'schema.noName': 'без имени',
  'schema.draftLabel': 'Драфт: ',
  'schema.formatChecked': 'проверяется',
  'schema.formatNotChecked': 'не проверяется',
  'schema.changedInSettings': ' — меняется в Настройках',
  'schema.fileBtn': 'Файл…',
  'schema.exampleBtn': 'Пример',
  'schema.fileReadFail': 'Файл схемы не прочитан: {message}',
  'schema.inputPlaceholder': 'Вставьте JSON Schema',
  'schema.validateBtn': 'Проверить',
  'schema.resultHeading': 'Результат',
  'schema.conforms': '✓ Соответствует',
  'schema.errorsCount': '✗ ошибок: {count}',
  'schema.intro': 'Вставьте схему и нажмите «Проверить». Документ берётся из таба «Данные».',
  'schema.validationFailedTitle': 'Валидация не выполнена',
  'schema.validatingSpinner': 'Валидируем в фоновом потоке…',
  'schema.timeoutNote1':
    'Таймаут 5 с → поток будет прерван. Это защита от катастрофического бэктрекинга в ',
  'schema.timeoutNote2': ': остановить зациклившийся regex иначе нельзя.',
  'schema.conformsTitle': '✓ Документ соответствует схеме',
  'schema.errorBadge': 'ОШИБКА',
  'schema.schemaPathLabel': 'схема: {path}',
  'schema.showInData': 'Показать в данных',
  'schema.saveTooBig': 'Схема {size} — больше {max} мы не сохраняем.',
  'schema.saveFailed': 'Схема не сохранена: {message}',
  'schema.validatorNote1': '⚠ Валидатор: ',
  'schema.validatorNote2': '. Он не выполняет код (CSP MV3 запрещает ',
  'schema.validatorNote3': ' и ',
  'schema.validatorNote4': ', поэтому AJV здесь физически невозможен), а значит НЕ поддерживает: ',
  'schema.validatorNote5':
    ' на внешние URL (сети у расширения нет вообще — такая схема отклоняется с явной ошибкой, а не молча пропускается) и custom keywords.',

  'settings.readingPrefs': 'Читаем настройки… контролы заблокированы до загрузки.',
  'settings.readFailTitle': 'Не удалось прочитать настройки',
  'settings.sectionView': 'Вид',
  'settings.indent': 'Отступ',
  'settings.indent2': '2 пробела',
  'settings.indent4': '4 пробела',
  'settings.indentTab': 'Tab',
  'settings.indentMin': 'Minified',
  'settings.wrapLabel': 'Перенос длинных строк',
  'settings.wrapHint':
    'На больших документах перенос отключается автоматически: он несовместим с виртуализацией строк.',
  'settings.lineNumbers': 'Показывать номера строк',
  'settings.startTab': 'Стартовый таб',
  'settings.highlightWarn1':
    '⚠ Этот браузер не поддерживает CSS Custom Highlight API — подсветка синтаксиса не работает. Текст показывается без цвета; подделывать подсветку тысячами ',
  'settings.highlightWarn2': ' мы не будем (это и медленно, и открывает дыру для инъекции разметки).',
  'settings.sectionParse': 'Разбор',
  'settings.defaultFormat': 'Формат по умолчанию',
  'settings.formatAuto': 'Автоопределение',
  'settings.sortKeys': 'Сортировать ключи',
  'settings.sortKeysHint':
    'Только ВЫВОД (beautify/конвертация). Дерево всегда показывает исходный порядок — иначе мы врали бы о документе.',
  'settings.expandTree': 'Разворачивать дерево до',
  'settings.levels': '{n} уровней',
  'settings.exactTitle': 'Точные большие числа.',
  'settings.exactSupported': 'Ваш браузер поддерживает JSON.parse source access (ES2026).',
  'settings.exactNotSupported': 'Ваш браузер НЕ поддерживает JSON.parse source access (ES2026).',
  'settings.exactBody1':
    'Для JSON и JSONC это не имеет значения: исходное написание чисел мы берём из позиций токенов в самом документе, поэтому ',
  'settings.exactBody2':
    ' показывается как есть в любом браузере. Для YAML, CSV и JSON5 исходное написание недоступно в принципе — их парсеры отдают уже округлённые значения, и инспектор пишет об этом прямо, а не показывает округлённое как исходное.',
  'settings.csvDelimiter': 'Разделитель CSV',
  'settings.csvAuto': 'авто',
  'settings.csvComma': 'запятая ,',
  'settings.csvSemicolon': 'точка с запятой ;',
  'settings.csvBom': 'BOM при экспорте CSV',
  'settings.csvBomHint':
    'Без BOM Excel читает UTF-8 как локальную кодировку и ломает кириллицу.',
  'settings.draft': 'Драфт',
  'settings.checkFormat': 'Проверять format:',
  'settings.checkFormatHint':
    'По спецификации format — аннотация, а не ограничение. Когда выключено, ключевое слово убирается из схемы перед проверкой, а не просто прячется из отчёта.',
  'settings.sectionStorage': 'Хранение',
  'settings.restore': 'Восстанавливать последний документ',
  'settings.storageWarn1': '⚠ Сохраняется только в этом браузере (',
  'settings.storageWarn2':
    '), до 1 МБ. Документы больше 1 МБ не сохраняются — и мы об этом говорим, а не теряем их молча. Содержимое таба JWT не сохраняется ',
  'settings.storageNever': 'НИКОГДА',
  'settings.storageWarn3':
    ': для токена, секрета и ключа в этом расширении просто нет места в хранилище.',
  'settings.eraseArm': 'Стереть сохранённый документ',
  'settings.eraseConfirm': 'Точно стереть?',
  'settings.erased': 'Стёрто.',
  'settings.eraseFailed': 'Не удалось стереть: {message}',
  'settings.sectionAbout': 'О расширении',
  'settings.aboutLine': 'Версия 1.0.0 · Ноль сети · Ноль аналитики · Открытый код',
  'settings.aboutNetwork1': 'У расширения нет ни одного сетевого вызова: ни ',
  'settings.aboutNetwork2': ', ни загрузки JWKS по URL, ни внешних ',
  'settings.aboutNetwork3':
    ', ни телеметрии, ни отчётов об ошибках. Всё, что вы сюда вставите, остаётся во вкладке.',
  'settings.aboutLibs1':
    'Библиотеки: jsonc-parser (MIT) · json5 (MIT) · yaml (ISC) · papaparse (MIT) · jose (MIT) · @cfworker/json-schema (MIT). XML — нативный DOMParser. Полные тексты лицензий — в файле ',
  'settings.aboutLibs2': ' в пакете расширения.',
  'settings.language': 'Язык',
  'settings.formatOnClick': 'Форматировать по клику',
  'settings.formatOnClickNote':
    'Разово, только текущая вкладка. Доступ к сайтам не выдаётся: вкладку на этот момент открывает сам клик по иконке (activeTab).',
  'settings.checkingShort': 'проверяем…',
  'settings.allowed': '✓ Разрешено',
  'settings.allow': 'Разрешить',
  'settings.autoFormatJson': 'Авто-формат JSON-страниц',
  'settings.autoGranted':
    '✓ Доступ выдан. ⚠ В Firefox встроенный просмотрщик JSON перехватывает страницу раньше нас — см. ниже.',
  'settings.autoNeedsAll': '⚠ Требует доступа ко всем сайтам. Подробности — по кнопке.',
  'settings.revokeAccess': 'Отозвать доступ',
  'settings.tryAgain': 'Попробовать снова',
  'settings.enable': 'Включить',
  'settings.revokedNote': 'Доступ отозван, скрипт снят с регистрации.',
  'settings.revokeFailedNote':
    'Браузер не отозвал доступ — снимите его вручную на странице расширений.',
  'settings.autoOffWarn':
    'Доступ выдан, но авто-формат выключен настройкой. Он ничего не делает, пока вы не включите его снова — либо отзовите доступ, чтобы не держать лишнее разрешение.',
  'settings.enableAutoFormat': 'Включить авто-формат',
  'settings.ffBody1': 'Firefox сам перехватывает ',
  'settings.ffBody2': ', и отключить его из расширения ',
  'settings.ffImpossible': 'невозможно',
  'settings.ffBody3':
    ' — такого API нет, и мы не будем притворяться, что он есть. Чтобы работал наш вид: откройте ',
  'settings.ffBody4': ', найдите ',
  'settings.ffBody5': ' и поставьте ',
  'settings.ffBody6': '. Всё остальное в расширении работает без этого.',
  'settings.firefoxWinTitle': '⚠ Firefox: встроенный просмотрщик JSON выигрывает у нас',
  'settings.consentTitle': 'Авто-форматирование JSON-страниц',
  'settings.consentWhat': 'Что это даёт.',
  'settings.consentWhatBody1': 'Когда вы открываете URL, отдающий ',
  'settings.consentWhatBody2':
    ', расширение само покажет его деревом — без клика по иконке.',
  'settings.consentAsk': 'Что браузер спросит.',
  'settings.consentAskBody':
    '«Читать и изменять все ваши данные на всех веб-сайтах». Это единственная формулировка, которую даёт Chrome. Мягче не бывает — иначе фича невозможна.',
  'settings.consentWhy': 'Почему так грубо.',
  'settings.consentWhyBody':
    'Браузер не умеет давать доступ «только к JSON-страницам»: чтобы узнать тип документа, скрипт уже должен быть на странице. activeTab не подходит — он выдаётся только по вашему клику, а здесь клика нет по определению.',
  'settings.consentDo': 'Что мы будем делать с этим доступом.',
  'settings.consentDoBody1': 'Ровно одно: на document_start проверять ',
  'settings.consentDoBody2':
    ' и, если это JSON, подменять вид документа. На всех остальных страницах скрипт немедленно выходит и ничего не читает. Ноль сети. Ничего никуда не отправляется. Никогда.',
  'settings.consentFfWarn1':
    '⚠ FIREFOX: у Firefox есть свой встроенный JSON-просмотрщик, он перехватывает ',
  'settings.consentFfWarn2':
    ' раньше нас, и отключить его из расширения невозможно. Нужно вручную выставить ',
  'settings.consentFfWarn3':
    ' в about:config. Мы не можем сделать это за вас и не будем притворяться, что можем.',
  'settings.consentRevokeNote': 'Отозвать доступ можно в любой момент здесь же.',
  'settings.consentRequestBtn': 'Запросить доступ',
};

const et: Record<MsgKey, string> = {
  'common.open': 'Ava',
  'common.cancel': 'Tühista',
  'common.copy': 'Kopeeri',
  'common.download': 'Laadi alla',
  'common.retry': 'Proovi uuesti',

  'prefs.readFail': 'Sätete lugemine ebaõnnestus: {message}',
  'prefs.tooBig':
    'Sätete objekt on ootamatult suur — kirjutamine tühistati, et vältida storage.sync piiri (8 KB elemendi kohta) ületamist.',
  'prefs.saveFail': 'Sätte salvestamine ebaõnnestus: {message}',

  'tab.data': 'Andmed',
  'tab.jwt': 'JWT',
  'tab.schema': 'Skeem',
  'tab.settings': 'Sätted',
  'tab.toolAria': 'Tööriist',

  'unit.bytes': '{n} B',
  'unit.kb': '{n} KB',
  'unit.mb': '{n} MB',

  'popup.thisTab': 'see vahekaart',
  'popup.loading': 'laadimine…',
  'popup.looksJsonTitle': 'ⓘ Näib olevat JSON-dokument',
  'popup.looksJsonBody': 'Otsustame ainult aadressi järgi — dokumendi tüüp pole siit näha.',
  'popup.formatHere': 'Vorminda siin',
  'popup.pasteAndOpen': 'Kleebi lõikelaualt ja ava',
  'popup.openTool': 'Ava tööriist',
  'popup.pageFormatting': 'Lehtede vormindamine',
  'popup.formatJsonHere': 'Vorminda JSON sellel vahekaardil',
  'popup.restrictedNote': 'Brauser ei luba laiendustel sellel lehel töötada.',
  'popup.oneClickNote':
    'Ühekordne klõpsutoiming. Saidile juurdepääsu ei anta — ainult see vahekaart ja ainult praegu.',
  'popup.readingTab': 'Loeme vahekaarti…',
  'popup.autoFormatLink': 'JSON-lehtede automaatvormindus — sätetes',
  'popup.autoFormatLinkNote': ' (nõuab juurdepääsu kõikidele saitidele)',
  'popup.footer': '100% võrguühenduseta · null võrku · null analüütikat',
  'popup.clipboardEmpty':
    'Lõikelaud on tühi. Ava tööriist ja kleebi tekst sinna (⌘/Ctrl+V).',
  'popup.clipboardDenied':
    'Brauser ei lubanud hüpikaknal lõikelauda lugeda. Avame tööriista — vajuta seal ⌘/Ctrl+V.',
  'popup.resultFormatted':
    'Valmis: vahekaart on vormindatud. Lehel olev ✕ nupp toob algse dokumendi tagasi.',
  'popup.resultNotJson':
    'Sellel lehel pole JSON-dokumenti (tüüp: {type}). Kopeeri vajalik fragment ja kleebi tööriista.',
  'popup.resultDenied': 'Juurdepääsu ei antud — funktsioon ei tööta. Kõik muu töötab nagu varem.',
  'popup.resultError': 'Vormindamine ebaõnnestus: {message}',

  'data.dropOverlay': 'Vabasta fail — sõelume selle siin',
  'data.jwtOfferTitle': 'Näib olevat JWT, mitte dokument',
  'data.jwtOfferBody1': 'Need on kolm base64url-segmenti päisega, milles on ',
  'data.jwtOfferBody2':
    '. JWT on mandaat ja sellel on oma vahekaart oma turberaamiga.',
  'data.openInJwtTab': 'Ava JWT vahekaardil',
  'data.dontOpen': 'Ära ava',
  'data.oversizeTitle': 'Fail {size}',
  'data.oversizeBody':
    'Tööriist on mõeldud kuni {soft}. See võib kümneteks sekunditeks hanguda või mälu otsa saada. Kas avada ikkagi?',
  'data.dropTitle': 'Lohista fail siia või kleebi tekst (⌘/Ctrl+V)',
  'data.chooseFile': 'Vali fail…',
  'data.emptyNote':
    'Vorming tuvastatakse automaatselt. Kuni {soft}. Kõik arvutatakse kohapeal: ükski bait ei lahku brauserist.',
  'data.examples': 'Näited:',
  'data.loadingNote':
    'Sõelumine toimub taustalõimes — vahekaart pole külmutatud. Tühistamine tõesti peatab lõime.',
  'data.cancelParse': 'Katkesta',
  'data.parseErrorBadge': '✗ Sõelumisviga',
  'data.lineColumn': 'rida {line}, veerg {column}',
  'data.suggestions': 'Valikud:',
  'data.parsedUpToError': 'Sõelutud kuni veani',
  'data.parsedUpToErrorNote':
    'Näidatakse dokumendi osa, mida õnnestus sõeluda. Tühi ekraan ühe koma pärast 40 MB-s oleks julm.',
  'data.startOver': 'Alusta uuesti',
  'data.fatalBadge': '✗ Sõelumine ei lõppenud',
  'data.whatToDo': 'Mida saab teha:',
  'data.openAnother': 'Ava teine dokument',
  'data.fatalNote':
    'See on vahekaardi piirang (mälu või aeg), mitte dokumendi viga. Teiste vahekaartide sulgemine mõnikord tõesti aitab — brauser eraldab mälu vahekaardi kaupa.',
  'data.openFileMulti':
    'Avatud „{name}“. Tööriist töötab korraga ühe dokumendiga — ülejäänud {count} faili jäeti vahele.',
  'data.fileTooBig':
    'Fail {size}. See on rohkem, kui laiendus suudab brauseris sõeluda (piir — {limit}).',
  'data.fileReadFail': 'Faili ei õnnestunud lugeda: {error}',
  'data.formatLabel': 'Vorming:',
  'data.formatAutoRecheck': 'Automaatne (kontrolli uuesti)',
  'data.autoBadge': 'auto',
  'data.autoBadgeTitle': 'Automaattuvastus võib eksida — muuda vormingut vasakul',
  'data.stats': '{size} · {lines} rida · {nodes} sõlme',
  'data.badgeValid': '✓ Kehtiv',
  'data.badgeParsed': '✓ Sõelutud',
  'data.viewAria': 'Vaade',
  'data.viewTree': 'Puu',
  'data.viewText': 'Tekst',
  'data.viewBoth': 'Mõlemad',
  'data.beautifyNote': 'Beautify asendab dokumendi selle JSON-esitusega',
  'data.convertTo': 'Teisenda ▾',
  'data.csvFlat': ' (lame)',
  'data.closeDocument': 'Sulge dokument',
  'data.visibleNodes': '{count} nähtavat sõlme',
  'data.treeStructureAria': 'Dokumendi struktuur',
  'data.treeControls':
    '↑↓ liikumine · →/← ava/sulge · Enter — näita tekstis · ⌘/Ctrl+C — väärtus · ⌘/Ctrl+⇧+C — tee',
  'data.searchDisabledPlaceholder': 'Otsing on suurel dokumendil välja lülitatud',
  'data.searchPlaceholder': 'Otsi või $.path',
  'data.searchAria': 'Otsi dokumendist või liigu JSONPath-i',
  'data.searchEnterPath': 'Enter — liigu teele',
  'data.searchNoMatches': 'vasteid pole',
  'data.searchCount': '{index} / {total}',
  'data.highlightUnavailable':
    'Süntaksi esiletõstmine pole selles brauseris saadaval (puudub CSS Custom Highlight API) — tekst kuvatakse ilma värvita. ',
  'data.windowedNote':
    'Renderdatakse ainult nähtav ridade aken, seega brauseri sisseehitatud otsing (⌘/Ctrl+F) ei näe kogu dokumenti — kasuta ülal olevat otsingut. ',
  'data.wrapOffNote': 'Reamurdmine on suurtel dokumentidel väljas: see rikub virtualiseerimise.',
  'data.inspectorValue': 'Väärtus',
  'data.copyPath': 'Kopeeri tee',
  'data.conversionRefusalTitle': 'Teisendamine pole võimalik — ega me teeskle, et see õnnestus',
  'data.arraysFound': 'Sellest dokumendist leitud objektimassiivid:',
  'data.noArrays': 'Dokumendist ei leitud objektimassiive — CSV ei sobi sellele üldse.',
  'data.backTo': '← Tagasi {format} juurde',
  'data.makeDocument': 'Muuda {format} dokumendiks',
  'data.noLossDetected': 'Kadu ei tuvastatud',
  'data.conversionWarnings': '⚠ {count} teisendushoiatust',
  'data.collapse': 'Ahenda',
  'data.expand': 'Laienda',
  'data.convertErrorTitle': 'Teisendamine ebaõnnestus',
  'data.truncatedTitle': '⚠ Puu ehitati osaliselt',
  'data.truncatedBody':
    'Dokumendis on rohkem sõlmi, kui puu suudab hoida. Tekst kuvatakse täielikult, puu — kuni piirini. Teeotsing allpool piiri töötab.',
  'data.copiedDocument': 'Dokument kopeeritud',
  'data.copiedResult': 'Tulemus kopeeritud',
  'data.copiedValue': 'Väärtus kopeeritud',
  'data.copiedPath': 'Tee kopeeritud',
  'data.clipboardUnavailable': 'Lõikelaud pole saadaval — vali tekst ja vajuta ⌘/Ctrl+C.',

  'jwt.credentialTitle': '🔒 JWT on mandaat. Luba annab juurdepääsu teie kontole.',
  'jwt.credentialBody':
    'Laiendus töötab 100% võrguühenduseta: luba ei lahku brauserist, seda ei salvestata kettale ega saadeta kuhugi. Laiendusel pole üldse võrku — ei analüütikat, ei telemeetriat, ei veaaruandeid. Ja siiski: kohtle lube nagu paroole. Enne kellegi teise loa kleepimist mõnda veebitööriista — mõtle, kuhu see läheb.',
  'jwt.token': 'Luba',
  'jwt.clear': 'Tühjenda',
  'jwt.pasteExample': 'Kleebi näidis',
  'jwt.tokenAria': 'JWT luba',
  'jwt.tokenPlaceholder': 'eyJhbGciOi… (kleebi JWT — dekodeeritakse kohe)',
  'jwt.decodeHint1':
    'Kleebi luba — dekodeerimine on kohene ja kohalik (atob + JSON.parse, ilma teekideta ja ilma võrguta). Nupp „Kleebi näidis“ lisab ',
  'jwt.decodeHintFake': 'võltsi',
  'jwt.decodeHint2':
    ' loa: selle allkiri pole ehtne, seega kontroll ebaõnnestub sellel ausalt. Nii saab tööriista proovida ilma ehtsat luba sisestamata.',
  'jwt.notJwtTitle': '✗ See ei sõelu JWT-na',
  'jwt.algNoneTitle': '⛔ Luba väidab alg: none — allkirja pole',
  'jwt.algNoneBody':
    'Sellist luba saab igaüks võltsida: allkirja ei kontrollita definitsiooni järgi. Kui teie server selle aktsepteerib, on see haavatavus, mitte funktsioon.',
  'jwt.header': 'Header',
  'jwt.payload': 'Payload',
  'jwt.payloadNotJson': ' (mitte JSON — kuvatud nii nagu on)',
  'jwt.signature': 'Allkiri',
  'jwt.algorithmLabel': 'Algoritm: ',
  'jwt.fromHeader': ' (päisest)',
  'jwt.symmetricSuffix': ' — sümmeetriline',
  'jwt.hs256Title': '⚠ HS256 kontrollitakse jagatud saladusega.',
  'jwt.hs256Body1':
    'Saladus on võti, millega allkirjastatakse kõik teie load; kes seda teab, saab väljastada teie nimel lube. Hoiame seda ',
  'jwt.hs256BodyStrong': 'ainult muutmälus',
  'jwt.hs256Body2':
    ': seda ei kirjutata laienduse mällu, see ei satu dokumendi automaatsalvestusse ja kaob, kui sulete vahekaardi. Väli ei täitu automaatselt ega läbi õigekirjakontrolli.',
  'jwt.secretAria': 'HS256 saladus',
  'jwt.secretPlaceholder': 'jagatud saladus',
  'jwt.revealSecretAria': 'Näita saladust, kuni nuppu hoitakse',
  'jwt.secretBase64': 'Saladus on base64',
  'jwt.publicKeyLabel': 'Avalik võti (JWK või PEM)',
  'jwt.publicKeyNote1': 'Kleebi ',
  'jwt.publicKeyNoteStrong': 'avalik',
  'jwt.publicKeyNote2':
    ' võti. Privaatvõtit pole siin vaja — ja seda ei tohiks kleepida siia ega kuhugi mujale.',
  'jwt.keyPlaceholder': '-----BEGIN PUBLIC KEY-----\n… või {"kty":"RSA", …}',
  'jwt.verifySignature': 'Kontrolli allkirja',
  'jwt.verifyingSpinner': 'Kontrollime kohapeal WebCrypto abil…',
  'jwt.claimsAria': 'Nõuded',
  'jwt.claimsHeading': 'Nõuded (dekodeeritud)',
  'jwt.clockNote':
    '⚠ Kehtivust kontrollitakse TEIE arvuti kella järgi. Kui see valetab, valetab ka see väljund.',
  'jwt.verifyValidTitle': '✓ ALLKIRI ON KEHTIV',
  'jwt.verified': 'Kontrollitud',
  'jwt.verifyInvalidTitle': '✗ ALLKIRI EI ÜHTI',
  'jwt.verifyInvalidBody1': 'Luba on võltsitud, rikutud või võti on vale. ',
  'jwt.verifyInvalidStrong': 'Neid juhtumeid ei saa eristada',
  'jwt.verifyInvalidBody2': ' — krüptograafiliselt on need eristamatud. ',
  'jwt.verifyErrorTitle': 'Ei õnnestunud kontrollida',

  'jwt.tooLong':
    'JWT jaoks liiga pikk: {len} märki (piir {max}). Ehtne luba on paar KB.',
  'jwt.decodeTooLong':
    'JWT jaoks liiga pikk: {len} märki (piir {max}). Ehtne luba on paar KB; selline pikkus tähendab, et see pole JWT.',
  'jwt.notThreeParts': 'See ei näi olevat JWT: oodati 3 punktiga eraldatud osa, leiti {count}.',
  'jwt.headerNotObject': 'päis pole JSON-objekt',
  'jwt.headerCorrupt':
    'Päis on rikutud: {message}. Esimene segment peab olema base64url-kodeeritud JSON.',
  'jwt.payloadNotObject': 'Andmed dekodeeriti, kuid see pole JSON-objekt. Kuvatud nii nagu on.',
  'jwt.payloadNotJsonProblem':
    'Andmed dekodeeriti, kuid see pole JSON. Selline luba on formaalselt lubatud — kuvatakse toortekst.',
  'jwt.payloadNotBase64':
    'Andmed ei dekodeeru base64url-ina: {message}. Päis on siiski kehtiv ja näidatud ülal.',
  'jwt.emptySignature': 'Allkiri on tühi, kuigi algoritm nõuab seda.',
  'jwt.claim.iss': 'Väljaandja',
  'jwt.claim.sub': 'Subjekt',
  'jwt.claim.aud': 'Sihtrühm',
  'jwt.claim.exp': 'Aegub',
  'jwt.claim.nbf': 'Kehtib alates',
  'jwt.claim.iat': 'Väljastatud',
  'jwt.claim.jti': 'Loa ID',
  'jwt.claim.custom': '(kohandatud nõue)',
  'jwt.claimNotNumber': 'Mitte arv — RFC 7519 järgi peaks see olema aeg Unixi sekundites.',
  'jwt.expired': '⛔ AEGUNUD {span} tagasi',
  'jwt.validFor': 'Kehtib veel {span}',
  'jwt.notYetValid': '⛔ VEEL EI KEHTI — jõustub {span} pärast',
  'jwt.activeSince': 'Kehtib alates {span} tagasi',
  'jwt.spanAgo': '{span} tagasi',
  'jwt.spanAhead': '{span} pärast',
  'jwt.issuedFuture': '⚠ Väljastatud tulevikus ({span} pärast)',
  'jwt.spanDH': '{d} p {h} t',
  'jwt.spanHM': '{h} t {m} min',
  'jwt.spanM': '{m} min',
  'jwt.spanS': '{s} s',
  'jwt.verifyNoWebCrypto':
    'WebCrypto pole selles kontekstis saadaval, seega pole millegagi allkirja kontrollida. Laienduse lehel peaks see olemas olema — palun teata sellest kui veast.',
  'jwt.verifyAlgNone':
    'Luba väidab alg: none — allkirja pole, kontrollida pole midagi. Sellist luba saab igaüks võltsida.',
  'jwt.verifyPasteSecret': 'Kleebi jagatud saladus.',
  'jwt.verifyPasteKey': 'Kleebi avalik võti (JWK või PEM).',
  'jwt.keyNotRecognized':
    'Võtit ei tuvastatud: {message}. Oodatakse JWK (JSON) või PEM (-----BEGIN PUBLIC KEY-----). Privaatvõtit pole vaja ega tohiks kleepida.',
  'jwt.verifyValidDetail':
    'Kontrollitud kohapeal WebCrypto abil. Võtit ei salvestatud, luba ei saadetud kuhugi.',
  'jwt.algMismatch':
    'Päise algoritm {alg} ei ühti kleebitud võtme tüübiga: {message}',
  'jwt.verifyInvalidDetail': 'Kontrollitud kohapeal WebCrypto abil.',
  'jwt.privateJwk':
    'see on PRIVAATVÕTI (JWK-s on parameeter „d“). Allkirja kontrollimiseks on vaja ainult avalikku',
  'jwt.privatePem':
    'see on PRIVAATVÕTI. Allkirja kontrollimiseks on vaja avalikku — privaatvõtit ei tohiks kuhugi kleepida',
  'jwt.notJwkOrPem': 'see ei näi olevat JWK ega PEM',

  'doc.parsing': 'Sõelume {size}…',
  'doc.tooBig':
    'Dokument {size}. See on rohkem, kui laiendus suudab brauseris sõeluda (piir — {limit}).',
  'doc.saveTooBig':
    'Dokument {size} — me ei salvesta midagi suuremat kui {max}. Pärast uuesti laadimist tuleb see uuesti avada.',
  'doc.saveFailed':
    'Dokumenti ei õnnestunud salvestada: brauseri mälu on täis ({message}). Töö jätkub, kuid dokumenti pärast uuesti laadimist ei taastata.',

  'fmt.elements': 'Elemente: {n}.',
  'fmt.precisionExact':
    'Arv ei mahu double-tüüpi. Kuvatakse dokumendi algne kirjapilt; JavaScript ümardaks selle väärtuseni {rounded}.',
  'fmt.precisionLost':
    'Täpsus kadus sõelumisel: see vorming ei anna juurdepääsu lähtetekstile, seega kuvatakse ümardatud {rounded}. Algset kirjapilti ei saa taastada.',
  'fmt.exactness':
    'Seda vormingut sõelutakse väärtuste, mitte lähtepositsioonide kaudu — arvude algne kirjapilt pole saadaval.',
  'fmt.stringLength': 'Pikkus: {graphemes} märki{extra}.',
  'fmt.stringLengthExtra':
    ' ({units} UTF-16 koodiühikut — string sisaldab surrogaatpaare või liitmärke)',
  'fmt.xmlNote':
    'XML-i sõelub emalõimes natiivne DOMParser (Workeril seda pole) — seetõttu kehtib siin eraldi suurusepiir.',

  'page.unknownType': 'teadmata',
  'page.noResponse': 'Lehe skript ei vastanud. Laadi vahekaart uuesti ja proovi uuesti.',
  'page.formattedLabel': '▣ Vormindatud laienduse poolt',
  'page.tree': 'Puu',
  'page.raw': 'Toortekst',
  'page.openInTool': 'Ava tööriistas',
  'page.restore': '✕ Taasta dokument',
  'page.bigDocNote':
    "Dokument {mb} MB — puud ei ehitata lehel endal (see hanguks vahekaardi). Kuvatakse toortekst; täielik puu on tööriistas.",

  'bg.menuTitle': 'Ava valik Data Toolkitis',

  'schema.noDocTitle': 'Dokumenti pole',
  'schema.noDocBody': 'Skeem valideerib dokumenti „Andmed“ vahekaardilt ja see pole veel avatud.',
  'schema.openData': 'Ava andmed',
  'schema.documentLabel': 'Dokument: ',
  'schema.noName': 'nimetu',
  'schema.draftLabel': 'Mustand: ',
  'schema.formatChecked': 'kontrollitakse',
  'schema.formatNotChecked': 'ei kontrollita',
  'schema.changedInSettings': ' — muudetakse Sätetes',
  'schema.fileBtn': 'Fail…',
  'schema.exampleBtn': 'Näidis',
  'schema.fileReadFail': 'Skeemifaili ei õnnestunud lugeda: {message}',
  'schema.inputPlaceholder': 'Kleebi JSON Schema',
  'schema.validateBtn': 'Valideeri',
  'schema.resultHeading': 'Tulemus',
  'schema.conforms': '✓ Vastab',
  'schema.errorsCount': '✗ vigu: {count}',
  'schema.intro': 'Kleebi skeem ja vajuta „Valideeri“. Dokument võetakse „Andmed“ vahekaardilt.',
  'schema.validationFailedTitle': 'Valideerimine ei käivitunud',
  'schema.validatingSpinner': 'Valideerime taustalõimes…',
  'schema.timeoutNote1':
    '5 s ajalõpp → lõim katkestatakse. See kaitseb katastroofilise tagasijälitamise eest reeglis ',
  'schema.timeoutNote2': ': tsüklisse jäänud regulaaravaldist ei saa muul viisil peatada.',
  'schema.conformsTitle': '✓ Dokument vastab skeemile',
  'schema.errorBadge': 'VIGA',
  'schema.schemaPathLabel': 'skeem: {path}',
  'schema.showInData': 'Näita andmetes',
  'schema.saveTooBig': 'Skeem {size} — me ei salvesta midagi suuremat kui {max}.',
  'schema.saveFailed': 'Skeemi ei salvestatud: {message}',
  'schema.validatorNote1': '⚠ Valideerija: ',
  'schema.validatorNote2': '. See ei käivita koodi (MV3 CSP keelab ',
  'schema.validatorNote3': ' ja ',
  'schema.validatorNote4': ', seega AJV on siin füüsiliselt võimatu), mis tähendab, et see EI toeta: ',
  'schema.validatorNote5':
    ' välistele URL-idele (laiendusel pole üldse võrku — selline skeem lükatakse tagasi selge veaga, mitte ei jäeta vaikselt vahele) ja kohandatud võtmesõnu.',

  'settings.readingPrefs': 'Loeme sätteid… juhtelemendid on lukus, kuni laaditud.',
  'settings.readFailTitle': 'Sätete lugemine ebaõnnestus',
  'settings.sectionView': 'Vaade',
  'settings.indent': 'Taane',
  'settings.indent2': '2 tühikut',
  'settings.indent4': '4 tühikut',
  'settings.indentTab': 'Tab',
  'settings.indentMin': 'Minified',
  'settings.wrapLabel': 'Murra pikad read',
  'settings.wrapHint':
    'Suurtel dokumentidel lülitub murdmine automaatselt välja: see on ridade virtualiseerimisega ühildumatu.',
  'settings.lineNumbers': 'Näita reanumbreid',
  'settings.startTab': 'Algne vahekaart',
  'settings.highlightWarn1':
    '⚠ See brauser ei toeta CSS Custom Highlight API-t — süntaksi esiletõstmine ei tööta. Tekst kuvatakse ilma värvita; me ei võltsi esiletõstmist tuhandete ',
  'settings.highlightWarn2': ' abil (see on aeglane ja avab märgistuse süstimise augu).',
  'settings.sectionParse': 'Sõelumine',
  'settings.defaultFormat': 'Vaikevorming',
  'settings.formatAuto': 'Automaattuvastus',
  'settings.sortKeys': 'Sorteeri võtmed',
  'settings.sortKeysHint':
    'Ainult VÄLJUND (beautify/teisendus). Puu näitab alati algset järjekorda — muidu me valetaksime dokumendi kohta.',
  'settings.expandTree': 'Laienda puud kuni',
  'settings.levels': '{n} taset',
  'settings.exactTitle': 'Täpsed suured arvud.',
  'settings.exactSupported': 'Teie brauser toetab JSON.parse source access-i (ES2026).',
  'settings.exactNotSupported': 'Teie brauser EI toeta JSON.parse source access-i (ES2026).',
  'settings.exactBody1':
    'JSON-i ja JSONC-i puhul pole sellel tähtsust: arvude algse kirjapildi võtame dokumendi enda tokenite positsioonidest, seega ',
  'settings.exactBody2':
    ' kuvatakse nii nagu on igas brauseris. YAML-i, CSV ja JSON5 puhul pole algne kirjapilt põhimõtteliselt saadaval — nende sõelujad tagastavad juba ümardatud väärtused ja inspektor ütleb seda otse, mitte ei kuva ümardatut algsena.',
  'settings.csvDelimiter': 'CSV eraldaja',
  'settings.csvAuto': 'auto',
  'settings.csvComma': 'koma ,',
  'settings.csvSemicolon': 'semikoolon ;',
  'settings.csvBom': 'BOM CSV-ekspordil',
  'settings.csvBomHint':
    'Ilma BOM-ita loeb Excel UTF-8 kohaliku kodeeringuna ja rikub kirillitsa.',
  'settings.draft': 'Mustand',
  'settings.checkFormat': 'Kontrolli format:',
  'settings.checkFormatHint':
    'Spetsifikatsiooni järgi on format annotatsioon, mitte piirang. Kui väljas, eemaldatakse võtmesõna skeemist enne kontrolli, mitte ei peideta lihtsalt aruandest.',
  'settings.sectionStorage': 'Salvestus',
  'settings.restore': 'Taasta viimane dokument',
  'settings.storageWarn1': '⚠ Salvestatakse ainult selles brauseris (',
  'settings.storageWarn2':
    '), kuni 1 MB. Üle 1 MB dokumente ei salvestata — ja me ütleme seda, mitte ei kaota neid vaikselt. JWT-vahekaardi sisu ei salvestata ',
  'settings.storageNever': 'MITTE KUNAGI',
  'settings.storageWarn3':
    ': sellel laiendusel lihtsalt pole kohta loa, saladuse ega võtme jaoks.',
  'settings.eraseArm': 'Kustuta salvestatud dokument',
  'settings.eraseConfirm': 'Kas tõesti kustutada?',
  'settings.erased': 'Kustutatud.',
  'settings.eraseFailed': 'Kustutamine ebaõnnestus: {message}',
  'settings.sectionAbout': 'Laienduse teave',
  'settings.aboutLine': 'Versioon 1.0.0 · Null võrku · Null analüütikat · Avatud lähtekood',
  'settings.aboutNetwork1': 'Laiendusel pole ainsatki võrgukõnet: ei ',
  'settings.aboutNetwork2': ', ei JWKS-i laadimist URL-ilt, ei väliseid ',
  'settings.aboutNetwork3':
    ', ei telemeetriat, ei veaaruandeid. Kõik, mille siia kleebite, jääb vahekaardile.',
  'settings.aboutLibs1':
    'Teegid: jsonc-parser (MIT) · json5 (MIT) · yaml (ISC) · papaparse (MIT) · jose (MIT) · @cfworker/json-schema (MIT). XML — natiivne DOMParser. Litsentside täistekstid on laienduse paketi failis ',
  'settings.aboutLibs2': '.',
  'settings.language': 'Keel',
  'settings.formatOnClick': 'Vorminda klõpsuga',
  'settings.formatOnClickNote':
    'Ühekordne, ainult praegune vahekaart. Saidijuurdepääsu ei anta: klõps ikoonil avab vahekaardi selleks hetkeks (activeTab).',
  'settings.checkingShort': 'kontrollime…',
  'settings.allowed': '✓ Lubatud',
  'settings.allow': 'Luba',
  'settings.autoFormatJson': 'Automaatvorminda JSON-lehed',
  'settings.autoGranted':
    '✓ Juurdepääs antud. ⚠ Firefoxis püüab sisseehitatud JSON-vaatur lehe enne meid kinni — vt allpool.',
  'settings.autoNeedsAll': '⚠ Nõuab juurdepääsu kõikidele saitidele. Üksikasjad on nupu taga.',
  'settings.revokeAccess': 'Tühista juurdepääs',
  'settings.tryAgain': 'Proovi uuesti',
  'settings.enable': 'Lülita sisse',
  'settings.revokedNote': 'Juurdepääs tühistatud, skript eemaldati registrist.',
  'settings.revokeFailedNote':
    'Brauser ei tühistanud juurdepääsu — eemalda see käsitsi laienduste lehel.',
  'settings.autoOffWarn':
    'Juurdepääs antud, kuid automaatvormindus on sätetes väljas. See ei tee midagi, kuni lülitad selle uuesti sisse — või tühista juurdepääs, et mitte hoida tarbetut luba.',
  'settings.enableAutoFormat': 'Lülita automaatvormindus sisse',
  'settings.ffBody1': 'Firefox püüab ise kinni ',
  'settings.ffBody2': ' ja selle keelamine laiendusest on ',
  'settings.ffImpossible': 'võimatu',
  'settings.ffBody3':
    ' — sellist API-t pole ja me ei teeskle, et on. Meie vaate tööks: ava ',
  'settings.ffBody4': ', leia ',
  'settings.ffBody5': ' ja sea väärtuseks ',
  'settings.ffBody6': '. Kõik muu laienduses töötab ka ilma selleta.',
  'settings.firefoxWinTitle': '⚠ Firefox: sisseehitatud JSON-vaatur võidab meid',
  'settings.consentTitle': 'JSON-lehtede automaatne vormindamine',
  'settings.consentWhat': 'Mida see annab.',
  'settings.consentWhatBody1': 'Kui avad URL-i, mis serveerib ',
  'settings.consentWhatBody2':
    ', näitab laiendus seda ise puuna — ilma ikoonil klõpsamata.',
  'settings.consentAsk': 'Mida brauser küsib.',
  'settings.consentAskBody':
    '„Loe ja muuda kõiki oma andmeid kõikidel veebisaitidel.“ See on ainus sõnastus, mille Chrome annab. Pehmemaks ei lähe — muidu on funktsioon võimatu.',
  'settings.consentWhy': 'Miks nii jäme.',
  'settings.consentWhyBody':
    'Brauser ei oska anda juurdepääsu „ainult JSON-lehtedele“: dokumendi tüübi teadmiseks peab skript juba lehel olema. activeTab ei sobi — see antakse ainult sinu klõpsu peale ja siin pole klõpsu definitsiooni järgi.',
  'settings.consentDo': 'Mida me selle juurdepääsuga teeme.',
  'settings.consentDoBody1': 'Täpselt üks asi: document_start-is kontrollida ',
  'settings.consentDoBody2':
    ' ja kui see on JSON, asendada dokumendi vaade. Igal muul lehel väljub skript kohe ega loe midagi. Null võrku. Midagi ei saadeta kuhugi. Mitte kunagi.',
  'settings.consentFfWarn1':
    '⚠ FIREFOX: Firefoxil on oma sisseehitatud JSON-vaatur, see püüab ',
  'settings.consentFfWarn2':
    ' enne meid kinni ja selle keelamine laiendusest on võimatu. Pead käsitsi seadma ',
  'settings.consentFfWarn3':
    ' failis about:config. Me ei saa seda sinu eest teha ega teeskle, et saame.',
  'settings.consentRevokeNote': 'Juurdepääsu saab igal ajal siinsamas tühistada.',
  'settings.consentRequestBtn': 'Taotle juurdepääsu',
};

const messages: Catalog<MsgKey> = { en, ru, et };
const translate = createTranslator<MsgKey>(messages);

/** React hook: a `t(key, vars?)` bound to the active locale. */
export function useT() {
  const l = useLocale();
  return useCallback(
    (k: MsgKey, v?: Record<string, string | number>) => translate(l, k, v),
    [l],
  );
}

/** Non-React translate for a known locale (background, content script, utils). */
export function tAt(locale: Locale, k: MsgKey, v?: Record<string, string | number>): string {
  return translate(locale, k, v);
}

import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// The Content Blur message catalog. `en` is BOTH the English UI and the KEY
// SOURCE: MsgKey = keyof typeof en, and the `Catalog<MsgKey>` type below FAILS
// THE BUILD if `ru` or `et` is missing a single key — a compile-time guarantee
// that nothing ships half-translated. `{name}` placeholders are interpolated by
// createTranslator (see @blur/ui/i18n).
//
// The `en` values are the EXISTING English UI strings copied VERBATIM (the e2e
// suite asserts on the exact wording of popup states and the stale/reload
// banner, and English is the default locale, so those tests keep passing).
// Do not reword, re-punctuate or "improve" them here.
//
// Rich notes/banners that embed <strong>/<code>/<button> are split into numbered
// fragment keys (…_1, …_2) so the component keeps the markup while each text run
// stays translatable; concatenated, the English fragments reproduce the original
// string byte-for-byte (including curly apostrophes and em-dashes). Format/URL
// tokens (JPEG · 1200×800, /pattern/flags, chrome://…, Alt+Shift+…, hex colours)
// are deliberately left literal in every language.

const en = {
  // ── Common ────────────────────────────────────────────────────────────────
  app_name: 'Content Blur',
  loading: 'Loading…',
  btn_add: 'Add',
  btn_remove: 'Remove',
  value_on: 'On',
  value_off: 'Off',
  value_blur: 'Blur',
  list_and: 'and',

  // ── Blur target categories ──────────────────────────────────────────────────
  target_images: 'Images',
  target_video: 'Video',
  target_posters: 'Thumbnails & posters',
  target_text: 'Text',

  // ── Reveal modes ────────────────────────────────────────────────────────────
  reveal_hover: 'On hover',
  reveal_click: 'On click',
  reveal_never: 'Never',

  // ── Mask style (popup) ──────────────────────────────────────────────────────
  mask_blur: 'Blur',
  mask_solid: 'Solid',
  value_solid: 'Solid',

  // ── Mask style (options — different wording) ────────────────────────────────
  opt_mask_solid: 'Solid colour',
  opt_value_solid: 'Solid colour',
  opt_mask_blur_hint:
    'Softens the content. Shape and colour still read through — you can tell a photo from a video.',
  opt_mask_solid_hint:
    'Paints an opaque rectangle over the content. Nothing about it survives, and it costs less to render than blur.',

  // ── Opacity preset hints ────────────────────────────────────────────────────
  opacity_hint_60: 'blends into the page background',
  opacity_hint_80: 'mostly opaque',
  opacity_hint_100: 'fully opaque',

  // ── Fill swatches ───────────────────────────────────────────────────────────
  swatch_slate: 'Slate (default)',
  swatch_black: 'Black',
  swatch_grey: 'Grey',
  swatch_paper: 'Paper',

  // ── Per-field override labels ───────────────────────────────────────────────
  field_images: 'Images',
  field_video: 'Video',
  field_posters: 'Thumbnails & posters',
  field_text: 'Text',
  field_maskStyle: 'Mask style',
  field_radius: 'Blur radius',
  field_maskOpacity: 'Fill opacity',
  field_maskColor: 'Fill colour',
  field_reveal: 'Show blurred content',
  field_rehideOnBlur: 'Re-hide when I switch away',
  field_showLabels: 'Labels',
  field_textPatterns: 'Text patterns',
  field_blur_on_site: 'Blur on this site',

  // ── Blur strength presets ───────────────────────────────────────────────────
  preset_light: 'Light',
  preset_medium: 'Medium',
  preset_heavy: 'Heavy',

  // ── Pattern counts ──────────────────────────────────────────────────────────
  patterns_one: '{n} pattern',
  patterns_other: '{n} patterns',

  // ── Override markers (shared popup/options) ─────────────────────────────────
  ovr_overrides_global_pre: ' overrides global (',
  ovr_overrides_global_post: ').',
  ovr_global_1: ' is overridden on this site — ',
  ovr_global_2: ' uses ',
  ovr_global_3: '.',
  ovr_use_global: 'Use global',
  ovr_use_global_aria: 'Use the global {label} setting on {host}',

  // ── Popup: stale / mismatch banners ─────────────────────────────────────────
  stale_strong: 'This page is out of date.',
  stale_body:
    ' It was loaded before the extension was updated, so it kept the old settings and ignores changes made here — including the mask style. Reload the page to fix it.',
  stale_reload: 'Reload this page',
  mismatch_showing: 'The page is showing ',
  value_a_solid_mask: 'a solid mask',
  value_blur_lc: 'blur',
  mismatch_but: 'but your settings say',
  value_solid_lc: 'solid',
  mismatch_post: '. Reload the page; if it persists, this is a bug worth reporting.',

  // ── Popup: header + site rows ───────────────────────────────────────────────
  status_enabled: 'Enabled',
  status_disabled_everywhere: 'Disabled everywhere',
  aria_enable_global: 'Enable Content Blur globally',
  this_page: 'This page',
  status_global_off: 'Global switch is off',
  status_active_site: 'Active on this site',
  status_paused_site: 'Paused on this site',
  this_site_lc: 'this site',
  aria_blur_on: 'Blur on {target}',
  stat_images: 'Images & thumbnails',
  stat_videos: 'Videos',
  stat_text: 'Text',
  empty_no_run: 'Content Blur can’t run on this page.',

  // ── Popup: blur group ───────────────────────────────────────────────────────
  heading_blur: 'Blur',
  aria_scope: 'Settings apply to',
  scope_global: 'Global',
  scope_site: 'This site',
  ovr_sum_1: ' has its own ',
  ovr_sum_2: '. Changes on this tab won’t reach it.',
  ovr_sum_btn_aria: "Clear this site's overrides and use global settings on {host}",
  ovr_sum_btn: 'Use global settings on this site',
  edit_note_1: 'Editing overrides for ',
  edit_note_2: '. Marked settings are this site’s own; everything else follows global.',
  edit_note_clear: 'Clear this site’s overrides',
  aria_blur_category: 'Blur {category}',
  aria_blur_category_site: 'Blur {category} on {host}',
  note_text_blur:
    'Blurred text stays in the DOM and accessibility tree — screen readers still read it and Ctrl+F still finds it. It is softened visually, not hidden.',
  aria_mask: '{style} mask',
  aria_mask_site: '{style} mask on {host}',
  aria_opacity_preset: 'Fill opacity {pct}% — {hint}',
  opacity_label: 'Opacity: {pct}%',
  aria_opacity_range: 'Fill opacity, as a percentage',
  aria_opacity_range_site: 'Fill opacity, as a percentage on {host}',
  aria_custom_fill: 'Custom fill colour',
  note_opacity_1: 'Opacity does ',
  note_opacity_not: 'not',
  note_opacity_2: ' uncover the content. Below 100% you see the ',
  note_opacity_bg: 'page’s own background',
  note_opacity_3:
    ' through the fill — never the image or video, which is never drawn at all.',
  field_blur_strength: 'Blur strength',
  radius_label: 'Radius: {r}px',
  aria_radius: 'Blur radius in pixels',
  aria_reveal: 'When to show blurred content',
  note_hover: 'On touch devices, hover becomes tap-to-reveal.',
  rehide_applies: 'Applies everywhere',
  aria_rehide: 'Re-hide revealed content when the tab or window loses focus',
  btn_reveal_all: 'Reveal all',
  btn_hide_all: 'Hide all again',
  btn_open_settings: 'Open settings',

  // ── Options: masthead + tabs ────────────────────────────────────────────────
  status_disabled: 'Disabled',
  note_disabled_all:
    'Content Blur is turned off everywhere. Turn it back on to blur content and edit the settings below.',
  aria_tabs: 'Settings sections',
  tab_blur: 'Blur',
  tab_text: 'Text patterns',
  tab_sites: 'Sites',
  tab_images: 'Image sources',
  tab_links: 'Links',
  tab_backup: 'Backup',
  tab_about: 'About',

  // ── Options: mask preview + section ─────────────────────────────────────────
  alt_preview: 'Preview of an image with your mask applied',
  cap_original: 'Original',
  cap_solid: 'Solid {color} · {pct}%',
  cap_blur: 'Blur {r}px',
  heading_how_hidden: 'How content is hidden',
  opt_opacity_label: 'Fill opacity: {pct}%',
  opt_note_opacity_1: 'This does ',
  opt_note_opacity_2: ' let the hidden content show through. Below 100% you see the ',
  opt_note_opacity_bg: "page's own background",
  opt_note_opacity_3:
    ' through the fill — never the image or video, which is never drawn at all. Lower it only to make the mask blend into a page.',
  opt_note_blur_1:
    'A blur is a visual softening, not a guarantee: a heavily blurred picture can still be recognisable. Choose ',
  opt_note_blur_2: ' when it must not be readable at all.',

  // ── Options: global-overrides notice ────────────────────────────────────────
  ovr_notice_one: '1 site overrides',
  ovr_notice_many: '{n} sites override',
  ovr_notice_body:
    ' some of these settings and will not follow changes made here: {hosts}',
  ovr_notice_more: ' and {n} more',
  btn_review_overrides: 'Review per-site overrides',

  // ── Options: blur panel ─────────────────────────────────────────────────────
  opt_note_text_a11y:
    'Accessibility: blurred text stays in the DOM and the accessibility tree, so screen readers still read it aloud and it remains findable via Ctrl+F.',
  heading_revealing: 'Revealing',
  opt_note_hover_1: 'On touch devices nothing can hover, so ',
  opt_note_hover_2:
    ' automatically becomes tap-to-reveal there — hidden content is never a dead end on a phone.',
  opt_rehide_desc:
    'Instantly hides everything you revealed as soon as the tab is in the background or the window loses focus — for when you are screen-sharing, or someone walks up.',
  heading_labels: 'Labels',
  opt_label_what: 'Label what is hidden',
  opt_labels_desc:
    'Puts a small chip on each masked element naming what is underneath — "JPEG · 1200×800", "MP4 · 0:42" — so you can tell items apart without revealing them.',
  aria_show_labels: 'Show a label chip on each masked element',
  opt_rehide_after: 'Re-hide revealed content after',
  aria_rehide_after: 'Automatically re-hide revealed content after this many seconds',
  opt_never_leave: 'Never (until I leave)',
  opt_seconds: '{n} seconds',

  // ── Options: text patterns ──────────────────────────────────────────────────
  err_pattern_dup: 'That pattern is already in the list.',
  status_nothing_new: 'Nothing new to add — those keywords were already in the list.',
  err_none_valid: 'None of those were valid patterns.',
  status_added_one: 'Added {n} keyword',
  status_added_other: 'Added {n} keywords',
  status_skipped: ', skipped {n} invalid.',
  status_exported_one: 'Exported {n} keyword.',
  status_exported_other: 'Exported {n} keywords.',
  err_no_keywords: 'That file had no keywords.',
  err_cant_read: 'Could not read that file.',
  tp_note1_1: 'Add words or phrases to blur wherever they appear on a page. Use ',
  tp_note1_2: ' for a regular expression — for example ',
  tp_note1_3: ' to match any capitalization.',
  tp_note_a11y:
    'Accessibility: blurred text stays in the DOM and the accessibility tree, so screen readers still read it aloud, and it is still copyable and findable via Ctrl+F. CSS blur obscures content visually — it is not a way to truly hide it.',
  tp_tech_summary: 'Technical details',
  tp_tech_body:
    'Plain keywords are compiled into a single alternation regex and matched in one pass. Beyond ~1–2k terms this would move to an Aho-Corasick automaton — one linear scan regardless of term count.',
  aria_add_pattern: 'Add a text pattern',
  ph_pattern: 'keyword or /regex/i',
  tp_add_many: 'Add many at once',
  tp_one_per_1: 'One keyword or ',
  tp_one_per_2: ' per line.',
  aria_add_multi: 'Add multiple keywords, one per line',
  ph_bulk: 'spoiler\nseason finale\n/leak(ed)?/i',
  btn_add_all: 'Add all',
  btn_export_txt: 'Export .txt',
  btn_export_json: 'Export .json',
  btn_import_file: 'Import file',
  aria_import_keywords: 'Import a keyword file',
  aria_remove_pattern: 'Remove pattern {term}',

  // ── Options: sites / allowlist ──────────────────────────────────────────────
  err_valid_site: 'Enter a valid site, e.g. example.com.',
  err_host_listed: '{host} is already on the list.',
  sites_note:
    'Sites on the allowlist are fully excluded — the extension does nothing on them.',
  aria_add_site: 'Add a site to the allowlist',
  ph_site: 'example.com or https://example.com/page',
  aria_remove_site: 'Remove {host} from allowlist',

  // ── Options: per-site overrides ─────────────────────────────────────────────
  err_host_overrides: '{host} already has overrides.',
  heading_per_site: 'Per-site overrides',
  ov_help_1:
    "Choose exactly which categories blur, and how strongly, on a specific site. A site's overrides ",
  ov_help_strong1: 'beat your global settings',
  ov_help_2:
    " there — so a marked control below is one the Blur tab can no longer move on that site. Marked settings are the site's own; everything else follows global. Use ",
  ov_help_3: ' to give a single setting back, or ',
  ov_help_4: ' to clear the site entirely. This needs no extra browser permission.',
  aria_add_override: 'Add a site override',
  ph_example: 'example.com',
  btn_add_override: 'Add override',
  ov_none: 'No per-site overrides yet.',
  ov_follows_all: 'Follows global for everything.',
  ov_overrides_one: 'Overrides {n} setting: {list}. Everything else follows global.',
  ov_overrides_other: 'Overrides {n} settings: {list}. Everything else follows global.',
  aria_reset_override: "Clear {host}'s overrides and use global settings there",
  btn_reset_global: 'Reset to global',
  ov_filled_1: 'Filled with ',
  ov_filled_2: ' at {pct}%. Colour and opacity are global — change them under ',
  ov_filled_3: '.',
  aria_radius_site: 'Blur radius on {host}',

  // ── Options: image sources ──────────────────────────────────────────────────
  img_note_1: 'Match by any part of an image URL (usually a domain). ',
  img_note_never: 'Never blur',
  img_note_2: ' keeps images from these sources sharp even when Images is on; ',
  img_note_always: 'Always blur',
  img_note_3:
    ' blurs them even when Images is off. Matching is a plain substring of the ',
  img_note_4: '.',
  img_never_title: 'Never blur images from',
  img_always_title: 'Always blur images from',
  heading_min_size: 'Minimum image size',
  min_size_note:
    'Skip blurring tiny images — favicons, icons and 1px tracking pixels — so only real pictures are blurred. An image is left sharp when it is smaller than this in both width and height.',
  min_size_label: "Don't blur images under",
  aria_min_size: 'Minimum image size in pixels',
  unit_px: 'px',
  ph_cdn: 'cdn.example.com',
  aria_remove: 'Remove {v}',

  // ── Options: links ──────────────────────────────────────────────────────────
  links_note_1:
    "Blur links whose address contains one of these domains — for example to soften results from a site you'd rather not see in search pages or feeds. Matching is a plain substring of the link's ",
  links_note_2: '. This uses only the existing blur engine and needs no extra permission.',
  links_title: 'Blur links pointing at',

  // ── Options: backup ─────────────────────────────────────────────────────────
  status_exported_settings: 'Settings exported.',
  confirm_import:
    'Import will replace your current settings, per-site overrides and image-source rules. Continue?',
  status_imported: 'Settings imported.',
  err_import_failed: 'Import failed.',
  backup_note:
    'Export all settings, per-site overrides, text patterns and image-source rules to a JSON file, or import them back on another machine. Everything stays on your device.',
  btn_export_json_full: 'Export to JSON',
  btn_import_json: 'Import from JSON',
  aria_import_settings: 'Import settings file',

  // ── Options: about ──────────────────────────────────────────────────────────
  about_privacy:
    'Privacy: no browsing data leaves your device. Page scanning, blurring and counting all happen locally.',
  about_shortcuts_1: 'Keyboard shortcuts (rebind at ',
  about_shortcuts_2:
    '): Alt+Shift+B toggles the extension globally, Alt+Shift+R reveals everything on the page, and Alt+Shift+P is a panic toggle that blurs all media instantly.',
  about_scope:
    'This extension only blurs content. Ad blocking lives in a separate companion extension, so each add-on keeps a single, narrow purpose.',

  // ── Language switcher + context menus ───────────────────────────────────────
  language: 'Interface language',
  menu_blur_this: 'Blur this element',
  menu_always_images: 'Always blur images on this site',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  app_name: 'Content Blur',
  loading: 'Загрузка…',
  btn_add: 'Добавить',
  btn_remove: 'Удалить',
  value_on: 'Вкл',
  value_off: 'Выкл',
  value_blur: 'Блюр',
  list_and: 'и',

  target_images: 'Картинки',
  target_video: 'Видео',
  target_posters: 'Превью и постеры',
  target_text: 'Текст',

  reveal_hover: 'При наведении',
  reveal_click: 'По клику',
  reveal_never: 'Никогда',

  mask_blur: 'Блюр',
  mask_solid: 'Заливка',
  value_solid: 'Заливка',

  opt_mask_solid: 'Сплошной цвет',
  opt_value_solid: 'Сплошной цвет',
  opt_mask_blur_hint:
    'Смягчает содержимое. Форма и цвет всё ещё различимы — фото можно отличить от видео.',
  opt_mask_solid_hint:
    'Закрашивает содержимое непрозрачным прямоугольником. От него ничего не остаётся, и рисуется он дешевле блюра.',

  opacity_hint_60: 'сливается с фоном страницы',
  opacity_hint_80: 'почти непрозрачно',
  opacity_hint_100: 'полностью непрозрачно',

  swatch_slate: 'Сланец (по умолчанию)',
  swatch_black: 'Чёрный',
  swatch_grey: 'Серый',
  swatch_paper: 'Бумага',

  field_images: 'Картинки',
  field_video: 'Видео',
  field_posters: 'Превью и постеры',
  field_text: 'Текст',
  field_maskStyle: 'Стиль маски',
  field_radius: 'Радиус блюра',
  field_maskOpacity: 'Непрозрачность заливки',
  field_maskColor: 'Цвет заливки',
  field_reveal: 'Показывать скрытое',
  field_rehideOnBlur: 'Скрывать снова при переключении',
  field_showLabels: 'Метки',
  field_textPatterns: 'Текстовые шаблоны',
  field_blur_on_site: 'Блюр на этом сайте',

  preset_light: 'Слабый',
  preset_medium: 'Средний',
  preset_heavy: 'Сильный',

  patterns_one: '{n} шаблон',
  patterns_other: 'шаблонов: {n}',

  ovr_overrides_global_pre: ' переопределяет глобальное (',
  ovr_overrides_global_post: ').',
  ovr_global_1: ' переопределён на этом сайте — ',
  ovr_global_2: ' использует ',
  ovr_global_3: '.',
  ovr_use_global: 'Взять глобальное',
  ovr_use_global_aria: 'Использовать глобальную настройку «{label}» на {host}',

  stale_strong: 'Эта страница устарела.',
  stale_body:
    ' Она была загружена до обновления расширения, поэтому сохранила старые настройки и игнорирует изменения, сделанные здесь, — включая стиль маски. Перезагрузите страницу, чтобы исправить это.',
  stale_reload: 'Перезагрузить страницу',
  mismatch_showing: 'Страница показывает ',
  value_a_solid_mask: 'сплошную маску',
  value_blur_lc: 'блюр',
  mismatch_but: 'но в настройках указано',
  value_solid_lc: 'заливка',
  mismatch_post:
    '. Перезагрузите страницу; если это повторяется — это баг, о котором стоит сообщить.',

  status_enabled: 'Включено',
  status_disabled_everywhere: 'Отключено везде',
  aria_enable_global: 'Включить Content Blur глобально',
  this_page: 'Эта страница',
  status_global_off: 'Глобальный переключатель выключен',
  status_active_site: 'Активно на этом сайте',
  status_paused_site: 'Приостановлено на этом сайте',
  this_site_lc: 'этом сайте',
  aria_blur_on: 'Блюр на {target}',
  stat_images: 'Картинки и превью',
  stat_videos: 'Видео',
  stat_text: 'Текст',
  empty_no_run: 'Content Blur не может работать на этой странице.',

  heading_blur: 'Блюр',
  aria_scope: 'Настройки применяются к',
  scope_global: 'Глобально',
  scope_site: 'Этот сайт',
  ovr_sum_1: ' имеет свои ',
  ovr_sum_2: '. Изменения на этой вкладке до него не дойдут.',
  ovr_sum_btn_aria:
    'Сбросить переопределения этого сайта и использовать глобальные настройки на {host}',
  ovr_sum_btn: 'Использовать глобальные настройки на этом сайте',
  edit_note_1: 'Правка переопределений для ',
  edit_note_2:
    '. Отмеченные настройки — собственные для этого сайта; остальные следуют глобальным.',
  edit_note_clear: 'Сбросить переопределения этого сайта',
  aria_blur_category: 'Блюр: {category}',
  aria_blur_category_site: 'Блюр: {category} на {host}',
  note_text_blur:
    'Размытый текст остаётся в DOM и дереве доступности — скринридеры его читают, а Ctrl+F по-прежнему находит. Он смягчён визуально, а не скрыт.',
  aria_mask: 'Маска: {style}',
  aria_mask_site: 'Маска: {style} на {host}',
  aria_opacity_preset: 'Непрозрачность заливки {pct}% — {hint}',
  opacity_label: 'Непрозрачность: {pct}%',
  aria_opacity_range: 'Непрозрачность заливки, в процентах',
  aria_opacity_range_site: 'Непрозрачность заливки, в процентах, на {host}',
  aria_custom_fill: 'Свой цвет заливки',
  note_opacity_1: 'Непрозрачность ',
  note_opacity_not: 'не',
  note_opacity_2:
    ' раскрывает содержимое. Ниже 100% сквозь заливку виден ',
  note_opacity_bg: 'собственный фон страницы',
  note_opacity_3:
    ' — но никогда картинка или видео, которые вообще не отрисовываются.',
  field_blur_strength: 'Сила блюра',
  radius_label: 'Радиус: {r}px',
  aria_radius: 'Радиус блюра в пикселях',
  aria_reveal: 'Когда показывать скрытое содержимое',
  note_hover: 'На сенсорных устройствах наведение становится показом по касанию.',
  rehide_applies: 'Применяется везде',
  aria_rehide:
    'Скрывать раскрытое содержимое, когда вкладка или окно теряют фокус',
  btn_reveal_all: 'Показать всё',
  btn_hide_all: 'Скрыть всё снова',
  btn_open_settings: 'Открыть настройки',

  status_disabled: 'Отключено',
  note_disabled_all:
    'Content Blur выключен везде. Включите его снова, чтобы размывать содержимое и менять настройки ниже.',
  aria_tabs: 'Разделы настроек',
  tab_blur: 'Блюр',
  tab_text: 'Текстовые шаблоны',
  tab_sites: 'Сайты',
  tab_images: 'Источники картинок',
  tab_links: 'Ссылки',
  tab_backup: 'Резервная копия',
  tab_about: 'О расширении',

  alt_preview: 'Предпросмотр картинки с применённой маской',
  cap_original: 'Оригинал',
  cap_solid: 'Заливка {color} · {pct}%',
  cap_blur: 'Блюр {r}px',
  heading_how_hidden: 'Как скрывается содержимое',
  opt_opacity_label: 'Непрозрачность заливки: {pct}%',
  opt_note_opacity_1: 'Это ',
  opt_note_opacity_2:
    ' даёт скрытому содержимому проступить. Ниже 100% сквозь заливку виден ',
  opt_note_opacity_bg: 'собственный фон страницы',
  opt_note_opacity_3:
    ' — но никогда картинка или видео, которые вообще не отрисовываются. Снижайте её только чтобы маска сливалась со страницей.',
  opt_note_blur_1:
    'Блюр — это визуальное смягчение, а не гарантия: сильно размытую картинку всё ещё можно узнать. Выбирайте ',
  opt_note_blur_2: ', когда содержимое совсем не должно читаться.',

  ovr_notice_one: '1 сайт переопределяет',
  ovr_notice_many: 'сайтов переопределяют: {n}',
  ovr_notice_body:
    ' часть этих настроек и не будет следовать изменениям, сделанным здесь: {hosts}',
  ovr_notice_more: ' и ещё {n}',
  btn_review_overrides: 'Просмотреть переопределения по сайтам',

  opt_note_text_a11y:
    'Доступность: размытый текст остаётся в DOM и дереве доступности, поэтому скринридеры по-прежнему читают его вслух, а Ctrl+F по-прежнему его находит.',
  heading_revealing: 'Раскрытие',
  opt_note_hover_1: 'На сенсорных устройствах навести нельзя, поэтому ',
  opt_note_hover_2:
    ' там автоматически становится показом по касанию — скрытое содержимое никогда не становится тупиком на телефоне.',
  opt_rehide_desc:
    'Мгновенно скрывает всё, что вы раскрыли, как только вкладка уходит в фон или окно теряет фокус — на случай демонстрации экрана или если кто-то подошёл.',
  heading_labels: 'Метки',
  opt_label_what: 'Помечать, что скрыто',
  opt_labels_desc:
    'Ставит на каждый скрытый элемент маленькую метку с тем, что под ним, — «JPEG · 1200×800», «MP4 · 0:42», — чтобы различать элементы, не раскрывая их.',
  aria_show_labels: 'Показывать метку на каждом скрытом элементе',
  opt_rehide_after: 'Снова скрывать раскрытое через',
  aria_rehide_after: 'Автоматически скрывать раскрытое через столько секунд',
  opt_never_leave: 'Никогда (пока не уйду)',
  opt_seconds: '{n} секунд',

  err_pattern_dup: 'Этот шаблон уже есть в списке.',
  status_nothing_new: 'Нечего добавлять — эти ключевые слова уже в списке.',
  err_none_valid: 'Ни один из них не является допустимым шаблоном.',
  status_added_one: 'Добавлено {n} ключевое слово',
  status_added_other: 'Добавлено ключевых слов: {n}',
  status_skipped: ', пропущено недопустимых: {n}.',
  status_exported_one: 'Экспортировано {n} ключевое слово.',
  status_exported_other: 'Экспортировано ключевых слов: {n}.',
  err_no_keywords: 'В этом файле не было ключевых слов.',
  err_cant_read: 'Не удалось прочитать этот файл.',
  tp_note1_1:
    'Добавьте слова или фразы, чтобы размывать их везде, где они встречаются на странице. Используйте ',
  tp_note1_2: ' для регулярного выражения — например ',
  tp_note1_3: ', чтобы совпадать при любом регистре.',
  tp_note_a11y:
    'Доступность: размытый текст остаётся в DOM и дереве доступности, поэтому скринридеры по-прежнему читают его вслух, и он по-прежнему копируется и находится через Ctrl+F. CSS-блюр скрывает содержимое визуально — это не способ действительно его спрятать.',
  tp_tech_summary: 'Технические детали',
  tp_tech_body:
    'Простые ключевые слова компилируются в один регэксп-альтернативу и матчатся за один проход. За пределами ~1–2 тыс. слов это перешло бы на автомат Ахо — Корасик — один линейный проход независимо от числа слов.',
  aria_add_pattern: 'Добавить текстовый шаблон',
  ph_pattern: 'слово или /regex/i',
  tp_add_many: 'Добавить много сразу',
  tp_one_per_1: 'Одно ключевое слово или ',
  tp_one_per_2: ' в строке.',
  aria_add_multi: 'Добавить несколько ключевых слов, по одному в строке',
  ph_bulk: 'спойлер\nфинал сезона\n/leak(ed)?/i',
  btn_add_all: 'Добавить все',
  btn_export_txt: 'Экспорт .txt',
  btn_export_json: 'Экспорт .json',
  btn_import_file: 'Импорт файла',
  aria_import_keywords: 'Импортировать файл с ключевыми словами',
  aria_remove_pattern: 'Удалить шаблон {term}',

  err_valid_site: 'Введите корректный сайт, например example.com.',
  err_host_listed: '{host} уже в списке.',
  sites_note:
    'Сайты в списке разрешённых полностью исключаются — расширение на них ничего не делает.',
  aria_add_site: 'Добавить сайт в список разрешённых',
  ph_site: 'example.com или https://example.com/page',
  aria_remove_site: 'Удалить {host} из списка разрешённых',

  err_host_overrides: 'У {host} уже есть переопределения.',
  heading_per_site: 'Переопределения по сайтам',
  ov_help_1:
    'Выберите, какие именно категории размывать и насколько сильно на конкретном сайте. Переопределения сайта ',
  ov_help_strong1: 'важнее ваших глобальных настроек',
  ov_help_2:
    ' там — поэтому отмеченный ниже элемент управления вкладка «Блюр» на этом сайте больше не меняет. Отмеченные настройки — собственные для сайта; остальные следуют глобальным. Нажмите ',
  ov_help_3: ', чтобы вернуть одну настройку, или ',
  ov_help_4:
    ', чтобы очистить сайт целиком. Дополнительных разрешений браузера это не требует.',
  aria_add_override: 'Добавить переопределение для сайта',
  ph_example: 'example.com',
  btn_add_override: 'Добавить переопределение',
  ov_none: 'Пока нет переопределений по сайтам.',
  ov_follows_all: 'Следует глобальным во всём.',
  ov_overrides_one: 'Переопределяет {n} настройку: {list}. Остальное следует глобальным.',
  ov_overrides_other:
    'Переопределяет настроек ({n}): {list}. Остальное следует глобальным.',
  aria_reset_override:
    'Сбросить переопределения {host} и использовать там глобальные настройки',
  btn_reset_global: 'Сбросить к глобальным',
  ov_filled_1: 'Залито ',
  ov_filled_2: ' при {pct}%. Цвет и непрозрачность — глобальные, меняйте их в разделе ',
  ov_filled_3: '.',
  aria_radius_site: 'Радиус блюра на {host}',

  img_note_1: 'Совпадение по любой части URL картинки (обычно по домену). ',
  img_note_never: 'Никогда не размывать',
  img_note_2:
    ' оставляет картинки из этих источников чёткими, даже когда «Картинки» включены; ',
  img_note_always: 'Всегда размывать',
  img_note_3:
    ' размывает их, даже когда «Картинки» выключены. Совпадение — это простая подстрока в ',
  img_note_4: '.',
  img_never_title: 'Никогда не размывать картинки с',
  img_always_title: 'Всегда размывать картинки с',
  heading_min_size: 'Минимальный размер картинки',
  min_size_note:
    'Не размывать крохотные картинки — фавиконки, иконки и трекинговые пиксели 1px, — чтобы размывались только настоящие изображения. Картинка остаётся чёткой, если она меньше этого значения и по ширине, и по высоте.',
  min_size_label: 'Не размывать картинки меньше',
  aria_min_size: 'Минимальный размер картинки в пикселях',
  unit_px: 'px',
  ph_cdn: 'cdn.example.com',
  aria_remove: 'Удалить {v}',

  links_note_1:
    'Размывать ссылки, адрес которых содержит один из этих доменов, — например, чтобы смягчить результаты с сайта, который вы предпочли бы не видеть в поиске или лентах. Совпадение — это простая подстрока в атрибуте ',
  links_note_2:
    ' ссылки. Это использует только уже имеющийся движок блюра и не требует дополнительных разрешений.',
  links_title: 'Размывать ссылки, ведущие на',

  status_exported_settings: 'Настройки экспортированы.',
  confirm_import:
    'Импорт заменит ваши текущие настройки, переопределения по сайтам и правила источников картинок. Продолжить?',
  status_imported: 'Настройки импортированы.',
  err_import_failed: 'Не удалось импортировать.',
  backup_note:
    'Экспортируйте все настройки, переопределения по сайтам, текстовые шаблоны и правила источников картинок в файл JSON или импортируйте их обратно на другой машине. Всё остаётся на вашем устройстве.',
  btn_export_json_full: 'Экспорт в JSON',
  btn_import_json: 'Импорт из JSON',
  aria_import_settings: 'Импортировать файл настроек',

  about_privacy:
    'Приватность: данные о просмотре не покидают ваше устройство. Сканирование страниц, размытие и подсчёт происходят локально.',
  about_shortcuts_1: 'Горячие клавиши (переназначаются в ',
  about_shortcuts_2:
    '): Alt+Shift+B переключает расширение глобально, Alt+Shift+R раскрывает всё на странице, а Alt+Shift+P — «тревожный» переключатель, мгновенно размывающий всё медиа.',
  about_scope:
    'Это расширение только размывает содержимое. Блокировка рекламы живёт в отдельном расширении-компаньоне, так что каждое дополнение сохраняет одну узкую задачу.',

  language: 'Язык интерфейса',
  menu_blur_this: 'Размыть этот элемент',
  menu_always_images: 'Всегда размывать картинки на этом сайте',
};

const et: Record<MsgKey, string> = {
  app_name: 'Content Blur',
  loading: 'Laadimine…',
  btn_add: 'Lisa',
  btn_remove: 'Eemalda',
  value_on: 'Sees',
  value_off: 'Väljas',
  value_blur: 'Hägu',
  list_and: 'ja',

  target_images: 'Pildid',
  target_video: 'Video',
  target_posters: 'Pisipildid ja postrid',
  target_text: 'Tekst',

  reveal_hover: 'Hõljutamisel',
  reveal_click: 'Klõpsul',
  reveal_never: 'Mitte kunagi',

  mask_blur: 'Hägu',
  mask_solid: 'Ühtlane',
  value_solid: 'Ühtlane',

  opt_mask_solid: 'Ühtlane värv',
  opt_value_solid: 'Ühtlane värv',
  opt_mask_blur_hint:
    'Pehmendab sisu. Kuju ja värv paistavad ikka läbi — foto eristub videost.',
  opt_mask_solid_hint:
    'Katab sisu läbipaistmatu ristkülikuga. Sellest ei jää midagi alles ja seda on odavam renderdada kui hägu.',

  opacity_hint_60: 'sulandub lehe taustaga',
  opacity_hint_80: 'peaaegu läbipaistmatu',
  opacity_hint_100: 'täiesti läbipaistmatu',

  swatch_slate: 'Kiltkivi (vaikimisi)',
  swatch_black: 'Must',
  swatch_grey: 'Hall',
  swatch_paper: 'Paber',

  field_images: 'Pildid',
  field_video: 'Video',
  field_posters: 'Pisipildid ja postrid',
  field_text: 'Tekst',
  field_maskStyle: 'Maski stiil',
  field_radius: 'Hägu raadius',
  field_maskOpacity: 'Täite läbipaistmatus',
  field_maskColor: 'Täite värv',
  field_reveal: 'Näita peidetud sisu',
  field_rehideOnBlur: 'Peida uuesti, kui vahetan aknat',
  field_showLabels: 'Sildid',
  field_textPatterns: 'Tekstimustrid',
  field_blur_on_site: 'Hägu sellel saidil',

  preset_light: 'Nõrk',
  preset_medium: 'Keskmine',
  preset_heavy: 'Tugev',

  patterns_one: '{n} muster',
  patterns_other: '{n} mustrit',

  ovr_overrides_global_pre: ' alistab globaalse (',
  ovr_overrides_global_post: ').',
  ovr_global_1: ' on sellel saidil alistatud — ',
  ovr_global_2: ' kasutab ',
  ovr_global_3: '.',
  ovr_use_global: 'Kasuta globaalset',
  ovr_use_global_aria: 'Kasuta saidil {host} globaalset seadet „{label}“',

  stale_strong: 'See leht on aegunud.',
  stale_body:
    ' See laaditi enne laienduse uuendamist, seega jäid kehtima vanad seaded ja siin tehtud muudatusi eiratakse — kaasa arvatud maski stiil. Paranda see lehte uuesti laadides.',
  stale_reload: 'Laadi see leht uuesti',
  mismatch_showing: 'Leht kuvab ',
  value_a_solid_mask: 'ühtlast maski',
  value_blur_lc: 'hägu',
  mismatch_but: 'kuid sinu seaded ütlevad',
  value_solid_lc: 'ühtlane',
  mismatch_post:
    '. Laadi leht uuesti; kui see kordub, on tegu veaga, millest tasub teatada.',

  status_enabled: 'Lubatud',
  status_disabled_everywhere: 'Kõikjal keelatud',
  aria_enable_global: 'Luba Content Blur globaalselt',
  this_page: 'See leht',
  status_global_off: 'Globaalne lüliti on väljas',
  status_active_site: 'Aktiivne sellel saidil',
  status_paused_site: 'Peatatud sellel saidil',
  this_site_lc: 'sellel saidil',
  aria_blur_on: 'Hägu saidil {target}',
  stat_images: 'Pildid ja pisipildid',
  stat_videos: 'Videod',
  stat_text: 'Tekst',
  empty_no_run: 'Content Blur ei saa sellel lehel töötada.',

  heading_blur: 'Hägu',
  aria_scope: 'Seaded kehtivad',
  scope_global: 'Globaalne',
  scope_site: 'See sait',
  ovr_sum_1: ' oma ',
  ovr_sum_2: '. Sellel vahekaardil tehtud muudatused sinnani ei jõua.',
  ovr_sum_btn_aria:
    'Tühjenda selle saidi alistused ja kasuta saidil {host} globaalseid seadeid',
  ovr_sum_btn: 'Kasuta sellel saidil globaalseid seadeid',
  edit_note_1: 'Alistuste muutmine saidile ',
  edit_note_2:
    '. Märgitud seaded on selle saidi omad; kõik muu järgib globaalseid.',
  edit_note_clear: 'Tühjenda selle saidi alistused',
  aria_blur_category: 'Hägu: {category}',
  aria_blur_category_site: 'Hägu: {category} saidil {host}',
  note_text_blur:
    'Hägustatud tekst jääb DOM-i ja ligipääsetavuspuusse — ekraanilugejad loevad selle ikka ette ja Ctrl+F leiab selle üles. See on visuaalselt pehmendatud, mitte peidetud.',
  aria_mask: 'Mask: {style}',
  aria_mask_site: 'Mask: {style} saidil {host}',
  aria_opacity_preset: 'Täite läbipaistmatus {pct}% — {hint}',
  opacity_label: 'Läbipaistmatus: {pct}%',
  aria_opacity_range: 'Täite läbipaistmatus protsentides',
  aria_opacity_range_site: 'Täite läbipaistmatus protsentides saidil {host}',
  aria_custom_fill: 'Kohandatud täite värv',
  note_opacity_1: 'Läbipaistmatus ',
  note_opacity_not: 'ei',
  note_opacity_2:
    ' too sisu nähtavale. Alla 100% näed täite alt ',
  note_opacity_bg: 'lehe enda tausta',
  note_opacity_3:
    ' — kuid mitte kunagi pilti ega videot, mida ei joonistata üldse.',
  field_blur_strength: 'Hägu tugevus',
  radius_label: 'Raadius: {r}px',
  aria_radius: 'Hägu raadius pikslites',
  aria_reveal: 'Millal näidata peidetud sisu',
  note_hover: 'Puuteseadmetel muutub hõljutamine puudutusega avamiseks.',
  rehide_applies: 'Kehtib kõikjal',
  aria_rehide:
    'Peida avatud sisu uuesti, kui vahekaart või aken kaotab fookuse',
  btn_reveal_all: 'Näita kõike',
  btn_hide_all: 'Peida kõik uuesti',
  btn_open_settings: 'Ava seaded',

  status_disabled: 'Keelatud',
  note_disabled_all:
    'Content Blur on kõikjal välja lülitatud. Lülita see uuesti sisse, et sisu hägustada ja allolevaid seadeid muuta.',
  aria_tabs: 'Seadete jaotised',
  tab_blur: 'Hägu',
  tab_text: 'Tekstimustrid',
  tab_sites: 'Saidid',
  tab_images: 'Piltide allikad',
  tab_links: 'Lingid',
  tab_backup: 'Varukoopia',
  tab_about: 'Teave',

  alt_preview: 'Rakendatud maskiga pildi eelvaade',
  cap_original: 'Originaal',
  cap_solid: 'Ühtlane {color} · {pct}%',
  cap_blur: 'Hägu {r}px',
  heading_how_hidden: 'Kuidas sisu peidetakse',
  opt_opacity_label: 'Täite läbipaistmatus: {pct}%',
  opt_note_opacity_1: 'See ',
  opt_note_opacity_2:
    ' lase peidetud sisul läbi paista. Alla 100% näed täite alt ',
  opt_note_opacity_bg: 'lehe enda tausta',
  opt_note_opacity_3:
    ' — kuid mitte kunagi pilti ega videot, mida ei joonistata üldse. Langeta seda ainult selleks, et mask sulanduks lehega.',
  opt_note_blur_1:
    'Hägu on visuaalne pehmendus, mitte garantii: tugevalt hägustatud pilt võib ikka äratuntav olla. Vali ',
  opt_note_blur_2: ', kui sisu ei tohi üldse loetav olla.',

  ovr_notice_one: '1 sait alistab',
  ovr_notice_many: '{n} saiti alistavad',
  ovr_notice_body:
    ' osa neist seadetest ega järgi siin tehtud muudatusi: {hosts}',
  ovr_notice_more: ' ja veel {n}',
  btn_review_overrides: 'Vaata saidipõhiseid alistusi',

  opt_note_text_a11y:
    'Ligipääsetavus: hägustatud tekst jääb DOM-i ja ligipääsetavuspuusse, seega ekraanilugejad loevad selle ikka ette ja Ctrl+F leiab selle üles.',
  heading_revealing: 'Avamine',
  opt_note_hover_1: 'Puuteseadmetel ei saa midagi hõljutada, seega ',
  opt_note_hover_2:
    ' muutub seal automaatselt puudutusega avamiseks — peidetud sisu ei jää telefonis kunagi ummikteeks.',
  opt_rehide_desc:
    'Peidab kohe kõik, mille avasid, niipea kui vahekaart läheb tagaplaanile või aken kaotab fookuse — juhuks kui jagad ekraani või keegi astub ligi.',
  heading_labels: 'Sildid',
  opt_label_what: 'Märgista, mis on peidetud',
  opt_labels_desc:
    'Paneb igale peidetud elemendile väikese sildi, mis nimetab, mis selle all on — „JPEG · 1200×800“, „MP4 · 0:42“ — nii saad elemente eristada neid avamata.',
  aria_show_labels: 'Näita igal peidetud elemendil silti',
  opt_rehide_after: 'Peida avatud sisu uuesti pärast',
  aria_rehide_after: 'Peida avatud sisu automaatselt uuesti nii mitme sekundi pärast',
  opt_never_leave: 'Mitte kunagi (kuni lahkun)',
  opt_seconds: '{n} sekundit',

  err_pattern_dup: 'See muster on juba loendis.',
  status_nothing_new: 'Pole midagi uut lisada — need märksõnad olid juba loendis.',
  err_none_valid: 'Ükski neist polnud kehtiv muster.',
  status_added_one: 'Lisatud {n} märksõna',
  status_added_other: 'Lisatud {n} märksõna',
  status_skipped: ', vahele jäetud {n} kehtetut.',
  status_exported_one: 'Eksporditud {n} märksõna.',
  status_exported_other: 'Eksporditud {n} märksõna.',
  err_no_keywords: 'Selles failis polnud ühtegi märksõna.',
  err_cant_read: 'Seda faili ei õnnestunud lugeda.',
  tp_note1_1:
    'Lisa sõnu või fraase, mida hägustada kõikjal, kus need lehel esinevad. Kasuta ',
  tp_note1_2: ' regulaaravaldise jaoks — näiteks ',
  tp_note1_3: ', et sobitada mis tahes suur- ja väiketähtedega.',
  tp_note_a11y:
    'Ligipääsetavus: hägustatud tekst jääb DOM-i ja ligipääsetavuspuusse, seega ekraanilugejad loevad selle ikka ette ning seda saab endiselt kopeerida ja Ctrl+F-iga leida. CSS-hägu varjab sisu visuaalselt — see pole viis seda tegelikult peita.',
  tp_tech_summary: 'Tehnilised üksikasjad',
  tp_tech_body:
    'Lihttekstilised märksõnad kompileeritakse üheks alternatiiv-regulaaravaldiseks ja sobitatakse ühe läbikäiguga. Üle ~1–2 tuhande termini läheks see üle Aho-Corasicki automaadile — üks lineaarne läbikäik olenemata terminite arvust.',
  aria_add_pattern: 'Lisa tekstimuster',
  ph_pattern: 'märksõna või /regex/i',
  tp_add_many: 'Lisa palju korraga',
  tp_one_per_1: 'Üks märksõna või ',
  tp_one_per_2: ' rea kohta.',
  aria_add_multi: 'Lisa mitu märksõna, üks rea kohta',
  ph_bulk: 'spoiler\nhooaja finaal\n/leak(ed)?/i',
  btn_add_all: 'Lisa kõik',
  btn_export_txt: 'Ekspordi .txt',
  btn_export_json: 'Ekspordi .json',
  btn_import_file: 'Impordi fail',
  aria_import_keywords: 'Impordi märksõnade fail',
  aria_remove_pattern: 'Eemalda muster {term}',

  err_valid_site: 'Sisesta kehtiv sait, nt example.com.',
  err_host_listed: '{host} on juba loendis.',
  sites_note:
    'Lubatud saitide loendis olevad saidid on täielikult välja jäetud — laiendus ei tee neil midagi.',
  aria_add_site: 'Lisa sait lubatud saitide loendisse',
  ph_site: 'example.com või https://example.com/page',
  aria_remove_site: 'Eemalda {host} lubatud saitide loendist',

  err_host_overrides: 'Saidil {host} on juba alistused.',
  heading_per_site: 'Saidipõhised alistused',
  ov_help_1:
    'Vali täpselt, millised kategooriad ja kui tugevalt kindlal saidil hägustuvad. Saidi alistused ',
  ov_help_strong1: 'on tähtsamad kui sinu globaalsed seaded',
  ov_help_2:
    ' seal — seega on allolev märgitud juhtnupp selline, mida vahekaart „Hägu“ sellel saidil enam ei liiguta. Märgitud seaded on saidi omad; kõik muu järgib globaalseid. Vajuta ',
  ov_help_3: ', et üks seade tagasi anda, või ',
  ov_help_4:
    ', et sait täielikult tühjendada. See ei vaja lisaks brauseri luba.',
  aria_add_override: 'Lisa saidi alistus',
  ph_example: 'example.com',
  btn_add_override: 'Lisa alistus',
  ov_none: 'Saidipõhiseid alistusi veel pole.',
  ov_follows_all: 'Järgib kõiges globaalseid.',
  ov_overrides_one: 'Alistab {n} seade: {list}. Kõik muu järgib globaalseid.',
  ov_overrides_other: 'Alistab {n} seadet: {list}. Kõik muu järgib globaalseid.',
  aria_reset_override:
    'Tühjenda saidi {host} alistused ja kasuta seal globaalseid seadeid',
  btn_reset_global: 'Lähtesta globaalseks',
  ov_filled_1: 'Täidetud värviga ',
  ov_filled_2: ' läbipaistmatusega {pct}%. Värv ja läbipaistmatus on globaalsed — muuda neid jaotises ',
  ov_filled_3: '.',
  aria_radius_site: 'Hägu raadius saidil {host}',

  img_note_1: 'Sobitamine pildi URL-i mis tahes osa järgi (tavaliselt domeen). ',
  img_note_never: 'Ära kunagi hägusta',
  img_note_2:
    ' hoiab nendest allikatest pärit pildid teravana ka siis, kui „Pildid“ on sees; ',
  img_note_always: 'Alati hägusta',
  img_note_3:
    ' hägustab need ka siis, kui „Pildid“ on väljas. Sobitamine on lihtne alamstring atribuudis ',
  img_note_4: '.',
  img_never_title: 'Ära kunagi hägusta pilte allikast',
  img_always_title: 'Alati hägusta pilte allikast',
  heading_min_size: 'Pildi vähim suurus',
  min_size_note:
    'Jäta tillukesed pildid hägustamata — favikonid, ikoonid ja 1px jälgimispikslid —, et hägustuksid ainult päris pildid. Pilt jääb teravaks, kui see on sellest väiksem nii laiuselt kui ka kõrguselt.',
  min_size_label: 'Ära hägusta pilte, mis on väiksemad kui',
  aria_min_size: 'Pildi vähim suurus pikslites',
  unit_px: 'px',
  ph_cdn: 'cdn.example.com',
  aria_remove: 'Eemalda {v}',

  links_note_1:
    'Hägusta lingid, mille aadress sisaldab üht neist domeenidest — näiteks selleks, et pehmendada tulemusi saidilt, mida sa pigem otsingulehtedel või voogudes ei näeks. Sobitamine on lihtne alamstring lingi atribuudis ',
  links_note_2:
    '. See kasutab ainult olemasolevat hägu-mootorit ega vaja lisaluba.',
  links_title: 'Hägusta lingid, mis viivad saidile',

  status_exported_settings: 'Seaded eksporditud.',
  confirm_import:
    'Import asendab su praegused seaded, saidipõhised alistused ja piltide allikate reeglid. Kas jätkata?',
  status_imported: 'Seaded imporditud.',
  err_import_failed: 'Import ebaõnnestus.',
  backup_note:
    'Ekspordi kõik seaded, saidipõhised alistused, tekstimustrid ja piltide allikate reeglid JSON-faili või impordi need teises masinas tagasi. Kõik jääb sinu seadmesse.',
  btn_export_json_full: 'Ekspordi JSON-i',
  btn_import_json: 'Impordi JSON-ist',
  aria_import_settings: 'Impordi seadete fail',

  about_privacy:
    'Privaatsus: sirvimisandmed ei lahku sinu seadmest. Lehtede skannimine, hägustamine ja loendamine toimuvad kõik kohapeal.',
  about_shortcuts_1: 'Kiirklahvid (määra ümber aadressil ',
  about_shortcuts_2:
    '): Alt+Shift+B lülitab laienduse globaalselt, Alt+Shift+R avab lehel kõik ja Alt+Shift+P on paanikalüliti, mis hägustab kohe kogu meedia.',
  about_scope:
    'See laiendus ainult hägustab sisu. Reklaamiblokeerimine elab eraldi kaaslaslaienduses, nii et iga lisandmoodul hoiab üht kitsast eesmärki.',

  language: 'Liidese keel',
  menu_blur_this: 'Hägusta see element',
  menu_always_images: 'Alati hägusta sellel saidil pildid',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a `t(key, vars?)` bound to the active locale (from `useLocale()`). */
export function useT(): (key: MsgKey, vars?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Non-React translate: for background/content contexts that read the persisted
 *  locale directly rather than through React context. */
export function tAt(
  locale: Locale,
  key: MsgKey,
  vars?: Record<string, string | number>,
): string {
  return translate(locale, key, vars);
}

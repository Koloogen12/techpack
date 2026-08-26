import type { Messages } from './messages.js';

export const EN: Messages = {
  doc_title: 'Tech Pack',
  section_cover: 'Tech Pack',
  section_changes: 'What Changed',
  section_preview: 'Appearance',
  section_flats: 'Technical Flat',
  section_measurements: 'Points of Measure',
  section_grading: 'Grading & Acceptance',
  section_bom: 'Bill of Materials',
  section_colorways: 'Colourways',
  section_construction: 'Construction',
  section_artwork: 'Artwork Placement',
  section_pattern_preview: 'All-Over Print on Garment',
  section_labels: 'Labelling & SKU',
  section_patterns: 'Patterns & Marker',

  meta_brand: 'Brand',
  meta_model: 'Style',
  meta_article: 'Style No.',
  meta_season: 'Season',
  meta_base_size: 'Base size',
  meta_version: 'Version · qty',
  meta_height: 'height',
  meta_qty: 'pcs',
  meta_empty_brand: '[not filled — brand profile]',
  meta_empty_season: '[not filled — questionnaire]',

  status_fit_confirmed: 'confirmed on sample',
  status_user_input: 'stated by you',
  status_measured_by_scale: 'measured by scale reference',
  status_estimated_from_photo: 'estimated from photo',
  status_default_from_base: 'category default',
  status_assumption: 'assumption',

  pom_code: 'Code',
  pom_point: 'Point of measure',
  pom_how: 'How to measure',
  pom_base: 'Base',
  pom_tolerance: 'Tolerance',
  pom_sheet: 'Points of Measure',
  pom_intro:
    'All measurements are taken with the garment laid flat unless stated otherwise. ' +
    'The ± tolerance on each point is what QC works to.',

  grading_step: 'Per size, cm',
  grading_rule: 'Rule',
  grading_origin: 'Origin',
  grading_intro:
    'The size table is in Points of Measure. This page gives the rule behind it: ' +
    'how much each point grows one size up.',
  grading_not_graded: 'Not graded',
  grading_acceptance_title: 'Acceptance rules a point-by-point tolerance does not express',
  grading_acceptance_intro:
    'Points of Measure sets a tolerance on every point. That is not enough: ' +
    'some defects a point-by-point check misses by design.',
  grading_origin_primary: 'primary source',
  grading_origin_expert: 'expert estimate',

  bom_code: 'Code',
  bom_item: 'Item',
  bom_purpose: 'Placement',
  bom_composition: 'Composition',
  bom_gsm: 'gsm',
  bom_consumption: 'Consumption',
  bom_supplier: 'Supplier ref.',
  bom_supplier_tbd: 'to be confirmed with supplier',
  bom_colorways: 'Colourways',

  node_zone: 'Zone',
  node_name: 'Operation',
  node_seam: 'Seam',
  node_stitch: 'Stitch',
  node_spi: 'SPI',
  node_machine: 'Machine',
  node_allowance: 'Allowance',

  view_front: 'Front',
  view_back: 'Back',
  view_side: 'Side',
  flats_label: 'Technical flat · views share one scale, dimensions are in Points of Measure',
  flats_library_disclaimer: 'Illustrative silhouette — dimensions are in the size chart',
  flats_library_note:
    'The silhouette comes from the model library and is scaled to the garment by chest width. Detail proportions on it are illustrative: the size chart is the only source of dimensions. Callouts are deliberately omitted from this view.',

  form_kicker: 'Measurement Sheet · Seamsterly',
  form_who: 'Measured by',
  form_date: 'Date',
  form_label_size: 'Size on the label',
  form_tool: 'Measured with',
  form_rules_title: 'How to measure so the figures can be compared',
  form_rules: [
    'Lay the garment face up on a flat hard surface and smooth it by hand. Do not stretch or pull the fabric — rib and jersey give, and a stretched reading runs a centimetre or more over.',
    'Measure the garment laid flat, not on a person and not on a form. Readings taken on a body run systematically larger, and the two cannot be mixed in one set.',
    'Lay the tape flat, with no slack and no pressure. Read to the nearest half centimetre.',
    'Chest, waist and sweep are measured seam to seam laid flat — that is half the circumference. Do not double it.',
    'If a point is unclear, measure it twice and write both figures down. A gap of more than two centimetres means the two readings were taken differently.',
    'Photograph the same garment on the same table from above: measurements without a photo of that same garment calibrate nothing.',
  ],
  form_th_point: 'Point of measure and how to take it',
  form_th_value: 'Measured, cm',
  form_th_repeat: 'Repeat, cm',
  form_th_note: 'Note',
  form_foot:
    'Send the filled sheet back together with the photograph of the same garment. We will compare it against the tech pack and issue the next version with the confirmed figures.',

  cover_category: 'Category',
  cover_fit: 'Fit',
  cover_sizes: 'Size range',
  cover_shell: 'Shell fabric',

  sheet_of: (n, total) => `Sheet ${n} of ${total}`,
  seq_title: 'Operation breakdown',
  seq_no: 'No.',
  seq_operation: 'Operation',
  seq_specialty: 'Grade',
  seq_machine: 'Equipment',
  seq_time: 'Time, s',
  seq_time_note: 'Standard minute values are set by the factory for its own floor.',

  labels_requisites: 'Mandatory label content',
  labels_care: 'Care symbols',
  labels_care_ru_only: 'Care symbols are listed in the Russian version of this pack.',
  labels_sku_matrix: 'SKU matrix',
  labels_col_sku: 'SKU',
  labels_col_color: 'Colour',
  labels_col_size: 'Size',
  labels_col_gtin: 'Marking code (GTIN)',
  labels_gtin_tbd: 'assigned by the brand',
  labels_ru_only:
    'Label text is printed in Russian: EAEU technical regulation TR CU 017/2011 requires it. ' +
    'Translations here are for the factory to understand the package contents.',

  art_zone: 'Zone',
  art_technique: 'Technique',
  art_offset: 'Offset',
  art_size: 'Print size',
  art_repeat_step: 'Repeat step',
  art_colors: 'Colours',
  art_colors_full: 'full-colour print',
  art_colors_spot: 'spot colours',
  art_file: 'Artwork file',
  art_file_none: 'not supplied',
  art_repeat_type: 'Repeat type',
  art_repeat_mirror: 'mirrored (2×2 block)',
  art_repeat_straight: 'straight',
  art_grain: 'Direction to grain',
  art_yardage: 'Print yardage',
  art_yardage_tbd: 'calculated from order quantity',
  art_ru_only: 'Artwork checks and warnings are given in the Russian version of this pack.',

  cw_origin: 'Source',
  cw_from_swatch: (file) => `measured from swatch ${file}`,
  cw_from_brand: 'stated by the brand',
  cw_not_set: 'not set',
  cw_screen_color: 'Screen colour',
  cw_lab: 'Lab coordinates',
  cw_book_code: "Brand's colour book code",
  cw_ru_only: 'Full colour commentary is given in the Russian version of this pack.',

  cm: 'cm',
  pcs: 'pcs',
  m: 'm',
  not_filled: 'not filled',

  translation_notice:
    'This pack is a translation. Point names and measuring instructions were compiled ' +
    'from standard tech-pack vocabulary and have NOT been reviewed by a native-speaking ' +
    'technologist. If a measuring instruction reads ambiguously, measure to the Russian ' +
    'original and tell us — we will correct the wording, not the garment.',
  translation_verified_notice:
    'Point names and measuring instructions in this pack have been reviewed against ' +
    'a partner factory tech pack.',
};

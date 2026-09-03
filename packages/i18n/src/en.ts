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
  seam_legend_title: 'Seam diagram — cross-section.',
  seam_legend_body:
    'Black shows fabric plies and folds, red shows stitch lines and edge overlocking. ' +
    'The diagram shows how the seam is built, not its scale: the allowance is in the column beside it. ' +
    'Construction per ISO 4916; the exact configuration is confirmed by the technologist on the first sample.',
  node_stitch: 'Stitch',
  node_spi: 'SPI',
  node_machine: 'Machine',
  node_allowance: 'Allowance',

  view_front: 'Front',
  view_back: 'Back',
  view_side: 'Side',
  flats_label: 'Technical flat · views share one scale, dimensions are in Points of Measure',
  flats_library_disclaimer: 'Illustrative silhouette — callouts mark an area, not a point',
  flats_library_note:
    'The silhouette comes from the model library and is fitted to the drawing footprint derived from the size chart. Detail proportions on it are illustrative: the size chart is the only source of dimensions. Callouts mark an area of the garment, not a point of measure — a library silhouette carries no control points, so no dimension may be read off it.',
  flats_library_missing: 'Details not shown on the illustrative silhouette',
  flats_library_source: 'Library silhouette · the source vector ships with this pack',
  to_be_confirmed: 'to be confirmed',

  form_kicker: 'Measurement Sheet · Seamster',
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

  // ------------------------------------------------------------ request for quote
  rfq_kicker: 'Request for quote',
  rfq_row_category: 'Category',
  rfq_row_article: 'Style no.',
  rfq_row_fit: 'Fit',
  rfq_row_fabric: 'Fabric',
  rfq_row_trim: 'Trim',
  rfq_row_qty: 'Order quantity',
  rfq_row_sizes: 'Size run',
  rfq_row_consumption: 'Fabric consumption',
  rfq_units_pcs: 'pcs',
  rfq_gsm_unit: 'gsm',
  rfq_sketch_caption: 'Front · flat from the tech pack',
  rfq_ratio_tbc: 'size ratio to be confirmed',
  rfq_consumption: (perUnit, perBatch) =>
    `${perUnit} m per unit` + (perBatch ? ` · ${perBatch} m per order` : ''),
  rfq_affects_title: 'What drives price and lead time',
  rfq_ask_title: 'What we need from you',
  rfq_ask_price: 'Unit price at this quantity',
  rfq_ask_reply_by: (date) => ` — reply by ${date}`,
  rfq_ask_moq: 'Minimum order quantity you accept',
  rfq_ask_lead_time: 'Lead time from sample approval to shipment',
  rfq_ask_outsourced: 'Which of the above you do not do in-house and subcontract',
  rfq_pack_note:
    'The full tech pack is ready: points of measure with tolerances, construction nodes with seam codes and machine types, the operation sequence, the bill of materials and labelling.',
  rfq_pack_on_request: 'Sent on request — quote from this sheet, not from the pack.',
  rfq_pack_open: (link) => `Open in full: ${link}. Quote from this sheet, not from the pack.`,
  rfq_contact_title: 'Who to reply to',
  rfq_contact_missing:
    'No phone and no email — the factory has nowhere to reply. Fill in the brand profile before sending.',
  rfq_text_quote: (category, fit) => `Quote request: ${category}, ${fit}.`,
  rfq_text_fabric: (name, gsm) => `Fabric: ${name}${gsm ? `, ${gsm} gsm` : ''}.`,
  rfq_text_qty: (qty) => (qty ? `Quantity: ${qty} pcs.` : 'Quantity to be confirmed.'),
  rfq_text_sizes: (line) => `Sizes: ${line}.`,
  rfq_text_pack: 'Tech pack with measurements, nodes and tolerances is ready — sent on request.',
  rfq_text_pack_link: (link) => `Tech pack with measurements, nodes and tolerances: ${link}`,
  rfq_text_contact: (who) => `Contact: ${who}.`,
  rfq_hl_allover: (stepCm, roll) =>
    `all-over repeat, ${stepCm} cm step, ${roll ? 'roll printing before cutting' : 'panel printing'}`,
  rfq_hl_artwork: (zone, w, h, technique) => `artwork: ${zone}, ${w}×${h} cm, ${technique}`,
  rfq_hl_special: (nodes) =>
    `special equipment: ${nodes} — the pack lists a substitute for the standard machine park`,
  rfq_hl_colorways: (n) => `${n} colourways`,
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

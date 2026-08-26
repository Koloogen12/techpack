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

  sheet_of: (n, total) => `Sheet ${n} of ${total}`,
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

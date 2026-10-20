/**
 * The medicines a dental clinic actually prescribes.
 *
 * A starter list, not a rule book: every clinic edits it, because what is
 * available and what is licensed differ by country, and the pharmacy
 * downstairs stocks what it stocks. Doses are the common adult ones and are
 * all editable at the moment of prescribing.
 *
 * Arabic names are included because the patient reads the paper, and a
 * prescription in a script they cannot read is a prescription they take
 * wrongly.
 */
export const FORMULARY = [
  // ---- antibiotics --------------------------------------------------------
  ['Amoxicillin', 'أموكسيسيلين', 'amoxicillin', 'Antibiotic', 'capsule', '500 mg',
    '1 capsule', '3 times a day', '5 days', 'After food.',
    'Ask about penicillin allergy before prescribing.'],
  ['Amoxicillin + clavulanic acid', 'أموكسيسيلين وحمض الكلافولانيك', 'co-amoxiclav',
    'Antibiotic', 'tablet', '625 mg', '1 tablet', '3 times a day', '5 days',
    'After food.', 'Ask about penicillin allergy before prescribing.'],
  ['Metronidazole', 'ميترونيدازول', 'metronidazole', 'Antibiotic', 'tablet', '400 mg',
    '1 tablet', '3 times a day', '5 days',
    'After food. No alcohol during and for 48 hours after.', ''],
  ['Clindamycin', 'كليندامايسين', 'clindamycin', 'Antibiotic', 'capsule', '300 mg',
    '1 capsule', '4 times a day', '5 days', 'With a full glass of water.',
    'For patients allergic to penicillin.'],
  ['Azithromycin', 'أزيثرومايسين', 'azithromycin', 'Antibiotic', 'tablet', '500 mg',
    '1 tablet', 'once a day', '3 days', 'One hour before food.', ''],
  ['Erythromycin', 'إريثرومايسين', 'erythromycin', 'Antibiotic', 'tablet', '500 mg',
    '1 tablet', '4 times a day', '5 days', 'Before food.', ''],

  // ---- pain and swelling --------------------------------------------------
  ['Ibuprofen', 'إيبوبروفين', 'ibuprofen', 'Pain relief', 'tablet', '400 mg',
    '1 tablet', 'every 8 hours as needed', '3 days', 'After food.',
    'Avoid in stomach ulcer, asthma, kidney disease and pregnancy.'],
  ['Paracetamol', 'باراسيتامول', 'paracetamol', 'Pain relief', 'tablet', '500 mg',
    '1–2 tablets', 'every 6 hours as needed', '3 days',
    'No more than 8 tablets in 24 hours.', ''],
  ['Paracetamol + codeine', 'باراسيتامول وكودايين', 'co-codamol', 'Pain relief',
    'tablet', '500/30 mg', '1–2 tablets', 'every 6 hours as needed', '3 days',
    'May cause drowsiness. Do not drive.', ''],
  ['Diclofenac potassium', 'ديكلوفيناك بوتاسيوم', 'diclofenac', 'Pain relief',
    'tablet', '50 mg', '1 tablet', '3 times a day', '3 days', 'After food.',
    'Avoid in stomach ulcer and heart disease.'],
  ['Mefenamic acid', 'حمض الميفيناميك', 'mefenamic acid', 'Pain relief', 'capsule',
    '500 mg', '1 capsule', '3 times a day', '3 days', 'After food.', ''],
  ['Dexamethasone', 'ديكساميثازون', 'dexamethasone', 'Swelling', 'tablet', '4 mg',
    '1 tablet', 'once a day', '3 days', 'In the morning, after food.',
    'Avoid in uncontrolled diabetes and active infection without cover.'],

  // ---- mouth rinses and topical -------------------------------------------
  ['Chlorhexidine mouthwash 0.2%', 'غسول كلورهيكسيدين ٠٫٢٪', 'chlorhexidine',
    'Mouthwash', 'mouthwash', '0.2%', '10 ml', 'twice a day', '7 days',
    'Rinse for one minute. Do not eat or drink for 30 minutes after. '
    + 'Use 30 minutes apart from toothpaste.',
    'Stains teeth with long use.'],
  ['Benzydamine mouthwash', 'غسول بنزيدامين', 'benzydamine', 'Mouthwash',
    'mouthwash', '0.15%', '15 ml', 'every 3 hours', '7 days',
    'Rinse or gargle. Do not swallow.', ''],
  ['Saline mouth rinse', 'غسول ملحي', 'sodium chloride', 'Mouthwash', 'mouthwash',
    '', '1 glass', 'after meals', '7 days',
    'Half a teaspoon of salt in a glass of warm water.', ''],
  ['Lidocaine gel 2%', 'جل ليدوكايين ٢٪', 'lidocaine', 'Topical', 'gel', '2%',
    'small amount', 'as needed', '3 days', 'Apply to the sore area with a clean finger.',
    'Not for children under 2.'],
  ['Benzocaine gel', 'جل بنزوكايين', 'benzocaine', 'Topical', 'gel', '20%',
    'small amount', 'as needed', '3 days', 'Apply to the sore area.',
    'Not for children under 2.'],
  ['Triamcinolone oral paste', 'معجون تريامسينولون الفموي', 'triamcinolone', 'Topical',
    'gel', '0.1%', 'small amount', 'twice a day', '5 days',
    'Apply to mouth ulcers at bedtime.', ''],

  // ---- antifungal and antiviral -------------------------------------------
  ['Nystatin oral suspension', 'نيستاتين معلق فموي', 'nystatin', 'Antifungal',
    'syrup', '100,000 units/ml', '1 ml', '4 times a day', '7 days',
    'Hold in the mouth as long as possible before swallowing.', ''],
  ['Miconazole oral gel', 'جل ميكونازول الفموي', 'miconazole', 'Antifungal', 'gel',
    '2%', 'small amount', '4 times a day', '7 days',
    'Apply to the affected area after food.',
    'Interacts with warfarin.'],
  ['Fluconazole', 'فلوكونازول', 'fluconazole', 'Antifungal', 'capsule', '50 mg',
    '1 capsule', 'once a day', '7 days', '', ''],
  ['Aciclovir cream', 'كريم أسيكلوفير', 'aciclovir', 'Antiviral', 'gel', '5%',
    'small amount', '5 times a day', '5 days',
    'Start at the first tingle of a cold sore.', ''],

  // ---- prevention ---------------------------------------------------------
  ['High-fluoride toothpaste', 'معجون أسنان عالي الفلورايد', 'sodium fluoride',
    'Prevention', 'gel', '5000 ppm', 'pea-sized', 'twice a day', 'ongoing',
    'Brush and spit; do not rinse afterwards.', 'Not for children under 16.'],
  ['Fluoride mouthwash', 'غسول الفلورايد', 'sodium fluoride', 'Prevention',
    'mouthwash', '0.05%', '10 ml', 'once a day', 'ongoing',
    'At a different time from brushing.', ''],
];

/** Puts the starter list in place, without disturbing a clinic's own edits. */
export function seedFormulary(insert, q, now) {
  let added = 0;
  for (const [name, nameAr, generic, category, form, strength,
    dose, frequency, duration, instructions, caution] of FORMULARY) {
    if (q.get('SELECT id FROM medicines WHERE name = ?', name)) continue;
    insert('medicines', {
      name, name_ar: nameAr, generic, category, form, strength,
      dose, frequency, duration, instructions, caution,
      active: 1, created_at: now, updated_at: now,
    });
    added += 1;
  }
  return added;
}

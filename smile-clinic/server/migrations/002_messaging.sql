-- WhatsApp messaging: editable templates and a log of everything sent.

CREATE TABLE message_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('appointment','billing','general')),
  -- Which record the template is rendered against, so the UI knows where to
  -- offer it: an appointment, an invoice, a payment, or just the patient.
  context     TEXT NOT NULL DEFAULT 'patient'
              CHECK (context IN ('patient','appointment','invoice','payment')),
  body_ar     TEXT NOT NULL,
  body_en     TEXT NOT NULL DEFAULT '',
  -- Name of the matching approved template in Meta's WhatsApp Manager, if the
  -- clinic has moved to the official API. Empty means link mode only.
  cloud_name  TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  built_in    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  template_key  TEXT,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  -- 'link'  = staff opened WhatsApp with the text pre-filled (we cannot know
  --           whether they pressed send, so this is never reported as "sent")
  -- 'cloud' = delivered through the WhatsApp Business Cloud API
  mode          TEXT NOT NULL DEFAULT 'link' CHECK (mode IN ('link','cloud')),
  phone         TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'ar',
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'opened'
                CHECK (status IN ('opened','sent','failed')),
  provider_id   TEXT,
  error         TEXT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  invoice_id    INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_messages_patient ON messages(patient_id, created_at);
CREATE INDEX idx_messages_created ON messages(created_at);
CREATE INDEX idx_messages_appt ON messages(appointment_id);

-- Built-in templates. These are ordinary rows: the clinic can edit every word
-- of them in Settings without touching the code.
INSERT INTO message_templates
  (key, name, category, context, body_ar, body_en, built_in, created_at, updated_at)
VALUES
  ('appointment_reminder', 'Appointment reminder', 'appointment', 'appointment',
   'مرحباً {{patient_name}} 🦷
نذكّركم بموعدكم في {{clinic_name}}

📅 التاريخ: {{date}}
🕐 الوقت: {{time}}
👨‍⚕️ الطبيب: {{dentist}}
{{procedure_line}}
نرجو الحضور قبل الموعد بعشر دقائق.
لتغيير الموعد يرجى التواصل معنا: {{clinic_phone}}',
   'Hello {{patient_name}},
This is a reminder of your appointment at {{clinic_name}}.

Date: {{date}}
Time: {{time}}
With: {{dentist}}
{{procedure_line}}
Please arrive ten minutes early.
To reschedule, call us on {{clinic_phone}}.',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('appointment_confirmed', 'Appointment confirmation', 'appointment', 'appointment',
   'مرحباً {{patient_name}}
تم تأكيد موعدكم في {{clinic_name}} ✅

📅 التاريخ: {{date}}
🕐 الوقت: {{time}}
👨‍⚕️ الطبيب: {{dentist}}
{{procedure_line}}
في انتظاركم، مع تحيات {{clinic_name}}.',
   'Hello {{patient_name}},
Your appointment at {{clinic_name}} is confirmed.

Date: {{date}}
Time: {{time}}
With: {{dentist}}
{{procedure_line}}
We look forward to seeing you.',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('appointment_rescheduled', 'Appointment rescheduled', 'appointment', 'appointment',
   'مرحباً {{patient_name}}
تم تغيير موعدكم في {{clinic_name}}.

الموعد الجديد:
📅 التاريخ: {{date}}
🕐 الوقت: {{time}}

نعتذر عن أي إزعاج، ونشكر لكم تفهمكم.
للاستفسار: {{clinic_phone}}',
   'Hello {{patient_name}},
Your appointment at {{clinic_name}} has been moved.

New appointment:
Date: {{date}}
Time: {{time}}

We are sorry for any inconvenience.
Questions? Call us on {{clinic_phone}}.',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('appointment_missed', 'Missed appointment follow-up', 'appointment', 'appointment',
   'مرحباً {{patient_name}}
لاحظنا أنكم لم تتمكنوا من حضور موعدكم بتاريخ {{date}}.
نتمنى أن تكونوا بخير 🌿

يسعدنا حجز موعد جديد لكم في أي وقت يناسبكم.
للحجز: {{clinic_phone}}

{{clinic_name}}',
   'Hello {{patient_name}},
We noticed you were not able to make your appointment on {{date}}.
We hope everything is well.

We would be glad to book you another time.
Call us on {{clinic_phone}}.

{{clinic_name}}',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('payment_receipt', 'Payment received', 'billing', 'payment',
   'مرحباً {{patient_name}}
شكراً لكم 🌟
تم استلام مبلغ {{amount}} بتاريخ {{date}}.

طريقة الدفع: {{method}}
{{invoice_line}}
الرصيد المتبقي: {{balance}}

{{clinic_name}}',
   'Hello {{patient_name}},
Thank you. We have received {{amount}} on {{date}}.

Payment method: {{method}}
{{invoice_line}}
Remaining balance: {{balance}}

{{clinic_name}}',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('balance_reminder', 'Outstanding balance reminder', 'billing', 'patient',
   'مرحباً {{patient_name}}
نودّ تذكيركم بلطف بوجود رصيد مستحق لدى {{clinic_name}}.

💰 المبلغ المستحق: {{balance}}

يمكنكم السداد في العيادة، أو التواصل معنا لأي استفسار: {{clinic_phone}}
شاكرين لكم ثقتكم.',
   'Hello {{patient_name}},
A gentle reminder that you have an outstanding balance at {{clinic_name}}.

Amount due: {{balance}}

You can settle it at the clinic, or call us on {{clinic_phone}} with any questions.
Thank you.',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('invoice_issued', 'Invoice issued', 'billing', 'invoice',
   'مرحباً {{patient_name}}
تم إصدار فاتورتكم من {{clinic_name}}.

🧾 رقم الفاتورة: {{invoice_number}}
💰 الإجمالي: {{total}}
📅 التاريخ: {{date}}
{{due_line}}
شاكرين لكم ثقتكم.
للاستفسار: {{clinic_phone}}',
   'Hello {{patient_name}},
Your invoice from {{clinic_name}} is ready.

Invoice: {{invoice_number}}
Total: {{total}}
Date: {{date}}
{{due_line}}
Thank you.
Questions? Call us on {{clinic_phone}}.',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  ('post_treatment_care', 'After-treatment care', 'general', 'appointment',
   'مرحباً {{patient_name}}
نتمنى لكم الشفاء العاجل بعد زيارتكم اليوم 🦷

نصائح بعد العلاج:
• تجنّب الأكل والشرب لمدة ساعة
• تناول الأدوية حسب إرشادات الطبيب
• تجنّب الأطعمة الصلبة والساخنة اليوم

لأي استفسار أو ألم غير معتاد، تواصلوا معنا فوراً: {{clinic_phone}}

{{clinic_name}}',
   'Hello {{patient_name}},
We hope you are feeling well after today''s visit.

After your treatment:
- Avoid eating or drinking for one hour
- Take any medication as directed
- Avoid hard or hot food today

If you have unusual pain, call us straight away on {{clinic_phone}}.

{{clinic_name}}',
   1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

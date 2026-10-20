/**
 * The front desk assistant.
 *
 * What this is: help writing to patients, and answers about the clinic's own
 * records. A receptionist pastes in what a patient sent, and gets a reply in
 * the clinic's voice with the real appointment time and the real balance
 * already in it, which they read, edit and send.
 *
 * What this is deliberately not: something that answers WhatsApp on its own.
 * That needs the WhatsApp Business API and a server the internet can reach,
 * and a clinic computer behind a home router is not one. Pretending otherwise
 * would mean messages silently going unanswered.
 *
 * Two decisions worth stating plainly:
 *
 *   * It is off until somebody turns it on. The whole app is built to work
 *     with no internet at all, and this is the one part that cannot — so it
 *     never runs unless a clinic has chosen it and supplied a key.
 *
 *   * It sends the least it can. A first name, a date, an amount. Never the
 *     medical notes, never the whole file. A patient's record leaving the
 *     clinic is a decision somebody has to make on purpose.
 *
 * Called with `fetch` rather than Anthropic's SDK because the app ships as a
 * zip with no npm install and the same code runs inside a browser worker on a
 * phone; there is nowhere to install a package to.
 */
import { badRequest } from './errors.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** The model a clinic gets unless it picks another in Settings. */
export const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the front desk of a dental clinic, writing short messages to patients.

Rules:
- Write only the message. No greeting line about yourself, no explanation, no quotation marks around it.
- Keep it to two or three sentences. People read these on a phone.
- Be warm and plain. No marketing language.
- Use only facts given to you in the CLINIC FACTS block. If something is not there, do not invent it — say the clinic will confirm.
- Never give clinical or medical advice, never suggest a diagnosis, and never tell a patient to take or stop a medicine. If the message is about pain, bleeding, swelling or an emergency, say the clinic will call them back, and that if it is urgent they should ring the clinic.
- Match the language the patient wrote in. If they wrote Arabic, reply in Arabic.`;

/**
 * Asks for a draft. Returns the text, or throws something a person can read.
 *
 * `fetchImpl` is injectable so a test can exercise this without a network or
 * a key.
 */
export async function draftReply({
  apiKey,
  model = DEFAULT_MODEL,
  patientMessage,
  facts = [],
  instruction = '',
  fetchImpl = fetch,
  // Overridable for a clinic that must go out through its own gateway, and
  // so this can be exercised without calling the real thing.
  endpoint = ENDPOINT,
}) {
  if (!apiKey) throw badRequest('No assistant key is set. Add one in Settings.');
  if (!patientMessage && !instruction) {
    throw badRequest('Paste what the patient wrote, or say what the message should be about.');
  }

  const prompt = [
    facts.length ? `CLINIC FACTS\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
    patientMessage ? `THE PATIENT WROTE\n${patientMessage}` : '',
    instruction ? `WHAT TO SAY\n${instruction}` : '',
  ].filter(Boolean).join('\n\n');

  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: SYSTEM,
        // A two-sentence reply is not a hard problem, and a clinic pays for
        // every one of these. Low effort is the honest setting.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    throw badRequest('Could not reach the assistant. Check this computer is online.');
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // The two a clinic will actually hit, said in their own terms.
    if (res.status === 401) throw badRequest('That assistant key was not accepted.');
    if (res.status === 429) throw badRequest('The assistant is busy. Try again in a moment.');
    throw badRequest(body?.error?.message || `The assistant did not answer (${res.status}).`);
  }

  // A safety decline comes back as a normal 200, so it has to be checked for
  // rather than waited on.
  if (body.stop_reason === 'refusal') {
    throw badRequest('The assistant would not write that one. Please write it yourself.');
  }

  const text = (body.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw badRequest('The assistant sent nothing back. Please write it yourself.');
  return { text, model: body.model || model, usage: body.usage || null };
}

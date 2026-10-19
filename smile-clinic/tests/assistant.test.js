/**
 * The front desk assistant.
 *
 * Two things are worth testing and neither is the writing: what leaves the
 * clinic, and what happens when the other end says no. The network is faked
 * throughout — a test that spends money is a test nobody runs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { draftReply, DEFAULT_MODEL } from '../server/lib/assistant.js';

/** Captures the request instead of making it. */
function fakeApi(reply, record = {}) {
  return async (url, options) => {
    record.url = url;
    record.headers = options.headers;
    record.body = JSON.parse(options.body);
    return {
      ok: reply.status ? reply.status < 400 : true,
      status: reply.status || 200,
      json: async () => reply.body ?? {
        content: [{ type: 'text', text: 'See you Tuesday at 10.' }],
        model: DEFAULT_MODEL,
        stop_reason: 'end_turn',
      },
    };
  };
}

describe('asking for a draft', () => {
  test('sends the facts it was given and nothing else', async () => {
    const record = {};
    await draftReply({
      apiKey: 'sk-test',
      patientMessage: 'هل موعدي باكر؟',
      facts: ["The patient's first name is Leila.", 'They owe 40.00 USD.'],
      fetchImpl: fakeApi({}, record),
    });

    const sent = JSON.stringify(record.body);
    assert.match(sent, /Leila/);
    assert.match(sent, /40\.00/);
    assert.match(sent, /هل موعدي باكر/);
    // The things a clinic would be horrified to find in an outbound request.
    assert.doesNotMatch(sent, /medical_notes|allergies|tooth_chart|password/i);
  });

  test('the key travels in the header, never in the message', async () => {
    const record = {};
    await draftReply({ apiKey: 'sk-secret', patientMessage: 'hello',
      fetchImpl: fakeApi({}, record) });
    assert.equal(record.headers['x-api-key'], 'sk-secret');
    assert.equal(record.headers['anthropic-version'], '2023-06-01');
    assert.doesNotMatch(JSON.stringify(record.body), /sk-secret/);
  });

  test('it asks the model not to practise dentistry', async () => {
    const record = {};
    await draftReply({ apiKey: 'k', patientMessage: 'my tooth hurts a lot',
      fetchImpl: fakeApi({}, record) });
    assert.match(record.body.system, /never give clinical or medical advice/i);
    assert.match(record.body.system, /call them back/i);
  });

  test('a clinic with no key is told, not left waiting', async () => {
    await assert.rejects(
      () => draftReply({ apiKey: '', patientMessage: 'hi', fetchImpl: fakeApi({}) }),
      /No assistant key/);
  });

  test('nothing to write about is refused before a request is made', async () => {
    let called = false;
    await assert.rejects(
      () => draftReply({
        apiKey: 'k', patientMessage: '', instruction: '',
        fetchImpl: async () => { called = true; },
      }),
      /Paste what the patient wrote/);
    assert.equal(called, false, 'it should not have cost anything');
  });

  test('a rejected key says so in words a receptionist can act on', async () => {
    await assert.rejects(
      () => draftReply({ apiKey: 'bad', patientMessage: 'hi',
        fetchImpl: fakeApi({ status: 401, body: {} }) }),
      /key was not accepted/);
  });

  test('being rate limited is not an error message about HTTP', async () => {
    await assert.rejects(
      () => draftReply({ apiKey: 'k', patientMessage: 'hi',
        fetchImpl: fakeApi({ status: 429, body: {} }) }),
      /busy. Try again/);
  });

  test('no internet reads as no internet', async () => {
    await assert.rejects(
      () => draftReply({ apiKey: 'k', patientMessage: 'hi',
        fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
      /Check this computer is online/);
  });

  test('a refusal arrives as a success and must still be caught', async () => {
    // The API answers 200 with stop_reason "refusal"; waiting for a thrown
    // error would hand the receptionist an empty box and no explanation.
    await assert.rejects(
      () => draftReply({ apiKey: 'k', patientMessage: 'write something awful',
        fetchImpl: fakeApi({ body: { stop_reason: 'refusal', content: [] } }) }),
      /would not write that one/);
  });

  test('an empty answer is reported rather than pasted in', async () => {
    await assert.rejects(
      () => draftReply({ apiKey: 'k', patientMessage: 'hi',
        fetchImpl: fakeApi({ body: { content: [], stop_reason: 'end_turn' } }) }),
      /sent nothing back/);
  });

  test('the text comes back joined and trimmed', async () => {
    const result = await draftReply({
      apiKey: 'k', patientMessage: 'hi',
      fetchImpl: fakeApi({ body: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '  Hello Leila, ' },
          { type: 'text', text: 'see you Tuesday.  ' },
        ],
        model: DEFAULT_MODEL,
      } }),
    });
    assert.equal(result.text, 'Hello Leila, see you Tuesday.');
    assert.equal(result.model, DEFAULT_MODEL);
  });
});

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { localAddresses } from '../server/lib/network.js';

/** Stands in for os.networkInterfaces() so every platform can be exercised. */
function withInterfaces(interfaces, fn) {
  const original = os.networkInterfaces;
  os.networkInterfaces = () => interfaces;
  try { return fn(); } finally { os.networkInterfaces = original; }
}

const ipv4 = (address, extra = {}) =>
  ({ address, family: 'IPv4', internal: false, mac: '00:00:00:00:00:00', ...extra });

describe('finding the address a phone should use', () => {
  test('a Mac on Wi-Fi reports its en0 address', () => {
    const result = withInterfaces({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [ipv4('192.168.1.42')],
    }, () => localAddresses('4000'));

    assert.equal(result.addresses.length, 1);
    assert.equal(result.addresses[0].url, 'http://192.168.1.42:4000');
    assert.equal(result.addresses[0].label, 'Wi-Fi');
    assert.equal(result.addresses[0].kind, 'lan');
  });

  test('old Node builds that report family as the number 4 still work', () => {
    const result = withInterfaces({
      en0: [{ address: '192.168.1.42', family: 4, internal: false }],
    }, () => localAddresses('4000'));
    assert.equal(result.addresses.length, 1);
  });

  test('VPN, AirDrop and bridge interfaces are not offered', () => {
    const result = withInterfaces({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [ipv4('192.168.1.42')],
      awdl0: [ipv4('169.254.10.1')],
      llw0: [ipv4('169.254.10.2')],
      utun3: [ipv4('10.8.0.6')],
      bridge100: [ipv4('192.168.64.1')],
    }, () => localAddresses('4000'));

    assert.deepEqual(result.addresses.map((a) => a.interface), ['en0']);
    const skipped = result.rejected.map((r) => r.interface);
    for (const name of ['awdl0', 'llw0', 'utun3', 'bridge100']) {
      assert.ok(skipped.includes(name), `${name} should be reported as skipped`);
    }
  });

  test('a real LAN address outranks a self-assigned one', () => {
    const result = withInterfaces({
      en1: [ipv4('169.254.55.1')],
      en0: [ipv4('10.0.0.7')],
    }, () => localAddresses('4000'));
    assert.equal(result.addresses[0].address, '10.0.0.7');
    assert.equal(result.addresses[1].kind, 'self-assigned');
  });

  test('every private range is recognised as a LAN address', () => {
    for (const address of ['10.1.2.3', '192.168.0.5', '172.16.0.9', '172.31.255.1']) {
      const result = withInterfaces({ en0: [ipv4(address)] }, () => localAddresses('4000'));
      assert.equal(result.addresses[0].kind, 'lan', address);
    }
    // 172.32 is outside the private block.
    const outside = withInterfaces({ en0: [ipv4('172.32.0.1')] }, () => localAddresses('4000'));
    assert.equal(outside.addresses[0].kind, 'public');
  });

  test('IPv6-only and loopback-only machines report why, not a bare empty list', () => {
    const result = withInterfaces({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
    }, () => localAddresses('4000'));

    assert.equal(result.addresses.length, 0);
    assert.deepEqual(result.interfacesSeen.sort(), ['en0', 'lo0']);
    assert.ok(result.rejected.some((r) => r.why === 'IPv6'));
    assert.ok(result.rejected.some((r) => r.why === 'loopback'));
  });

  test('a machine with no interfaces at all does not throw', () => {
    const result = withInterfaces({}, () => localAddresses('4000'));
    assert.deepEqual(result.addresses, []);
    assert.deepEqual(result.interfacesSeen, []);
  });

  test('the port given is the port shown', () => {
    const result = withInterfaces({ en0: [ipv4('192.168.1.42')] },
      () => localAddresses('8080'));
    assert.equal(result.addresses[0].url, 'http://192.168.1.42:8080');
  });
});

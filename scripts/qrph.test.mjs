// Run: node --experimental-strip-types scripts/qrph.test.mjs
import assert from 'node:assert/strict';
import { crc16, isQrPh, withAmount, describe, parseTlv, inspect } from '../src/lib/qrph.ts';

// CRC-16/CCITT-FALSE check value
assert.equal(crc16('123456789'), '29B1');

// A static QR Ph-style payload (shape of a P2P QR: account info in tag 27, PHP currency 608, PH country)
const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
const acct = f('00', 'com.p2pqrpay') + f('01', 'GXCHPHM2XXX') + f('02', '99964403') + f('04', '09171234567');
const body = f('00', '01') + f('01', '11') + f('27', acct) + f('52', '6016') + f('53', '608') + f('58', 'PH') + f('59', 'MEDNOTES PUBLISHING') + f('60', 'ORMOC CITY') + '6304';
const staticQr = body + crc16(body);
assert.ok(isQrPh(staticQr), 'static payload valid');
assert.ok(!isQrPh(staticQr.slice(0, -1) + (staticQr.endsWith('0') ? '1' : '0')), 'bad CRC rejected');
assert.ok(!isQrPh('https://example.com'), 'non-EMV rejected');

const dyn = withAmount(staticQr, 450);
assert.ok(isQrPh(dyn), 'dynamic payload has a valid CRC');
const ids = parseTlv(dyn).map((t) => t.id);
assert.deepEqual(ids, ['00', '01', '27', '52', '53', '54', '58', '59', '60', '63'], 'amount inserted in order, CRC last');
assert.equal(describe(dyn).amount, 450);
assert.equal(parseTlv(dyn).find((t) => t.id === '01').value, '12', 'marked dynamic');
assert.equal(describe(withAmount(dyn, 99.5)).amount, 99.5, 'amount replaced, not duplicated');
assert.equal(parseTlv(withAmount(dyn, 99.5)).filter((t) => t.id === '54').length, 1);
assert.equal(describe(dyn).name, 'MEDNOTES PUBLISHING');
// inspect(): what the admin "Test this QR" dialog shows
const info = inspect(staticQr, 1);
assert.equal(info.name, 'MEDNOTES PUBLISHING');
assert.equal(info.city, 'ORMOC CITY');
assert.equal(info.currency, 'PHP');
assert.ok(info.staticCode, 'static code detected');
assert.equal(info.accounts[0].account, '09171234567', 'shows the GCash number');
assert.ok(info.generatedOk, 'a 1 peso test QR is valid');
assert.equal(describe(info.generated).amount, 1);
assert.equal(inspect(dyn, 25.5).staticCode, false, 'dynamic code detected');
assert.equal(describe(inspect(staticQr, 25.5).generated).amount, 25.5);
console.log('qrph: all tests passed');
console.log(dyn);

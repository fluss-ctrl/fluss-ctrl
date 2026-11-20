import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isPublicIp, parseIp, parseIpv4, parseIpv6 } from './ip.ts'

describe('parseIpv4', () => {
  it.each(['1.2.3.4', '0.0.0.0', '255.255.255.255'])('parses %s', (ip) => {
    expect(parseIpv4(ip)).toEqual(ip.split('.').map(Number))
  })

  it.each(['1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.x', ''])('rejects %s', (ip) => {
    expect(parseIpv4(ip)).toBeNull()
  })
})

describe('parseIpv6', () => {
  it.each([
    ['::', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['::1', [0, 0, 0, 0, 0, 0, 0, 1]],
    ['2606:4700::1111', [0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111]],
    ['fe80::', [0xfe80, 0, 0, 0, 0, 0, 0, 0]],
    ['1:2:3:4:5:6:7:8', [1, 2, 3, 4, 5, 6, 7, 8]],
    ['::ffff:10.0.0.1', [0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001]],
    ['::1.2.3.4', [0, 0, 0, 0, 0, 0, 0x0102, 0x0304]],
    ['1:2:3:4:5:6:1.2.3.4', [1, 2, 3, 4, 5, 6, 0x0102, 0x0304]],
  ])('parses %s', (ip, groups) => {
    expect(parseIpv6(ip)).toEqual(groups)
  })

  it.each(['1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', 'fe80::1%eth0', '12345::', '::ffff:1.2.3', 'g::1', '1:2:3:4:5:6:7::8'])('rejects %s', (ip) => {
    expect(parseIpv6(ip)).toBeNull()
  })

  it('round-trips any eight groups written in full (property)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 8, maxLength: 8 }), (groups) => {
      expect(parseIpv6(groups.map((g) => g.toString(16)).join(':'))).toEqual(groups)
    }))
  })
})

describe('isPublicIp', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.100.100.200', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2001::1',
    '2002:a00:1::', '3fff::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::10.0.0.1', '[::1]',
    'not-an-ip', '',
  ])('refuses %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '[2a00:1450::1]', '::ffff:1.1.1.1', '64:ff9b::8.8.8.8'])('allows %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true)
  })

  it('refuses every address in 10/8, 127/8 and 169.254/16 (property)', () => {
    const octet = fc.integer({ min: 0, max: 255 })
    fc.assert(fc.property(fc.constantFrom('10', '127', '169.254'), octet, octet, octet, (prefix, a, b, c) => {
      const rest = prefix.includes('.') ? [a, b] : [a, b, c]
      expect(isPublicIp([prefix, ...rest].join('.'))).toBe(false)
    }))
  })

  it('treats a parsed bracketed literal as IPv6', () => {
    expect(parseIp('[::1]')?.version).toBe(6)
    expect(parseIp('1.2.3.4')?.version).toBe(4)
  })
})

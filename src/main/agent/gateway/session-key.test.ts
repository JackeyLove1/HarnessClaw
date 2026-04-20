import { describe, expect, it } from 'vitest'
import { buildSessionId } from './session-key'

describe('buildSessionId', () => {
  it('builds a stable channel/account/peer session key', () => {
    expect(
      buildSessionId({
        channel: 'Weixin',
        accountId: 'bot_a',
        peerId: 'group-001'
      })
    ).toBe('weixin:bot_a:group-001')
  })

  it('sanitizes unsafe characters and blanks', () => {
    expect(
      buildSessionId({
        channel: '  ',
        accountId: 'acc#1',
        peerId: 'user 1'
      })
    ).toBe('unknown:acc_1:user_1')
  })
})

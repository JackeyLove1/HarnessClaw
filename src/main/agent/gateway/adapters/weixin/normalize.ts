import type { InboundMessage } from '../../types'
import type { WeixinMessage, WeixinMessageItem } from './protocol'

const WEIXIN_USER_MESSAGE_TYPE = 1
const WEIXIN_TEXT_ITEM_TYPE = 1

const extractTextFromItem = (item: WeixinMessageItem): string => {
  if (item.type !== WEIXIN_TEXT_ITEM_TYPE) {
    return ''
  }
  return item.text_item?.text?.trim() ?? ''
}

const extractInboundText = (message: WeixinMessage): string => {
  const items = message.item_list ?? []
  const parts = items.map(extractTextFromItem).filter(Boolean)
  return parts.join('\n').trim()
}

export const normalizeWeixinInbound = (params: {
  accountId: string
  channel: string
  message: WeixinMessage
}): InboundMessage | null => {
  const { accountId, channel, message } = params
  if (message.message_type != null && message.message_type !== WEIXIN_USER_MESSAGE_TYPE) {
    return null
  }

  const senderId = message.from_user_id?.trim()
  if (!senderId) {
    return null
  }

  const text = extractInboundText(message)
  return {
    text,
    senderId,
    channel,
    accountId,
    peerId: senderId,
    isGroup: Boolean(message.group_id?.trim()),
    media: [],
    raw: {
      messageId: message.message_id,
      toUserId: message.to_user_id,
      contextToken: message.context_token,
      createTimeMs: message.create_time_ms,
      source: message
    }
  }
}
